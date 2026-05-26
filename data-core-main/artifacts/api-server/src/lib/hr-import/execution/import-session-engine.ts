/**
 * Phase 3 — Import session execution engine (dry-run / shadow only).
 */

import { db, hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { importSessionService } from "../session/import-session-service";
import { parseWorkbookBuffer, parseEmployeeTemplateRows, parseMasterDataRows } from "../xlsx/workbook-parser";
import { verifyWorkbook } from "../xlsx/workbook-verifier";
import { getImportRuntimeSettings } from "../runtime-settings";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "../validation/hr-import-validator";
import { validateMasterDataImportDryRun } from "./master-data-import-runtime";
import { runEmployeeShadowPipeline } from "./employee-shadow-pipeline";
import { topologicalSortManagers } from "./dependency-ordering";
import { prepareRollbackSnapshots } from "../rollback/rollback-preparation";
import { recordSessionExecutionTelemetry } from "../telemetry/session-execution-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { getOrgRuntimeMode } from "../../workforce/org/org-runtime-settings";
import { getLeaveRuntimeMode } from "../../hr/hcm-workspace-settings";
import { evaluateImportCutoverGates } from "../../workforce/stabilization/import-cutover-gates";

export type UploadExecutionResult = {
  sessionId: number;
  rowCount: number;
  verification: ReturnType<typeof verifyWorkbook>;
  timingMs: Record<string, number>;
};

export class ImportSessionEngine {
  async executeUpload(input: {
    workspaceId: number;
    userId?: number;
    buffer: Buffer;
    fileName: string;
    templateKey?: string;
    importType?: string;
  }): Promise<UploadExecutionResult> {
    const t0 = Date.now();
    incrementRuntimeMetric("import.v3.upload");

    const settings = await getImportRuntimeSettings(input.workspaceId);
    const { workbook } = parseWorkbookBuffer(input.buffer);
    const tParse = Date.now();

    const verification = verifyWorkbook(workbook, input.templateKey);
    incrementRuntimeMetric("import.v3.workbook_verify");

    const isMaster = (input.importType ?? "").startsWith("master") || input.templateKey?.includes("master_data");
    const parsed = isMaster
      ? { templateKey: input.templateKey ?? "hr.master_data.bundle.v2", rows: parseMasterDataRows(workbook), sheetName: "master" }
      : parseEmployeeTemplateRows(workbook);

    if (!parsed?.rows) {
      throw new Error("Unable to parse import rows from workbook");
    }

    const session = await importSessionService.createSession({
      workspaceId: input.workspaceId,
      importType: input.importType ?? (isMaster ? "master.data.dry_run" : "hr.employee.v2.shadow"),
      templateKey: verification.templateKey ?? input.templateKey ?? parsed.templateKey,
      templateVersion: verification.templateVersion,
      runtimeMode: settings.employeeImportRuntimeMode,
      dryRun: true,
      createdByUserId: input.userId,
      sourcePath: `upload:${input.fileName}`,
    });

    await importSessionService.updateSessionStatus(input.workspaceId, session.id, "draft", {
      phase: 3,
      workbookVerification: verification,
      staleTemplateIssues: verification.issues.filter((i) => i.code === "STALE_TEMPLATE"),
      fileName: input.fileName,
    });

    for (let i = 0; i < parsed.rows.length; i++) {
      await importSessionService.appendRow({
        sessionId: session.id,
        workspaceId: input.workspaceId,
        rowNumber: i + 1,
        rawRow: parsed.rows[i],
        status: "parsed",
      });
    }

    const timingMs = {
      parseMs: tParse - t0,
      verifyMs: Date.now() - tParse,
      totalMs: Date.now() - t0,
    };

    await importSessionService.mergeSessionSummary(input.workspaceId, session.id, { timing: timingMs });

    void recordSessionExecutionTelemetry({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      event: "upload",
      timingMs,
      metadata: { rowCount: parsed.rows.length, verificationOk: verification.ok },
    });

    return { sessionId: session.id, rowCount: parsed.rows.length, verification, timingMs };
  }

  async executeValidate(workspaceId: number, sessionId: number): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    incrementRuntimeMetric("import.v3.validate");

    const session = await importSessionService.getSession(workspaceId, sessionId);
    if (!session) throw new Error("Session not found");

    await importSessionService.updateSessionStatus(workspaceId, sessionId, "validating");

    const rows = await importSessionService.getSessionRows(sessionId, workspaceId);
    const rawRows = rows.map((r) => (r.rawRow ?? {}) as Record<string, string>);

    const [settingsRow] = await db
      .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

    const numberingMode = settingsRow?.numberingMode ?? "auto";
    const isMaster = session.importType.startsWith("master");

    const [orgRuntimeMode, leaveRuntimeMode, importGates] = await Promise.all([
      getOrgRuntimeMode(workspaceId),
      getLeaveRuntimeMode(workspaceId),
      evaluateImportCutoverGates(workspaceId),
    ]);
    const canonicalModes = { orgRuntimeMode, leaveRuntimeMode };

    let summary: Record<string, unknown> = {
      importGates: {
        strictRowValidation: importGates.strictRowValidation,
        commitAllowed: importGates.commitAllowed,
        commitBlockers: importGates.commitBlockers,
        readyForCanonicalEmployeeImport: importGates.readyForCanonicalEmployeeImport,
        readyForCanonicalMasterDataImport: importGates.readyForCanonicalMasterDataImport,
      },
    };

    if (isMaster) {
      const catalog = await masterDataCatalogService.loadSnapshot(workspaceId);
      const mdResult = validateMasterDataImportDryRun(catalog, rawRows, canonicalModes);
      summary = { masterDataDryRun: mdResult, dependencyDiagnostics: mdResult.orgOrdering };

      for (let i = 0; i < mdResult.rows.length; i++) {
        const v = mdResult.rows[i]!;
        await importSessionService.appendRow({
          sessionId,
          workspaceId,
          rowNumber: v.rowNumber,
          validationResult: v,
          action: v.wouldAction,
          status: v.status,
          errors: v.errors,
          warnings: v.warnings,
          normalizedRow: rawRows[v.rowNumber - 1],
        });
      }
    } else {
      const catalog = await masterDataCatalogService.loadSnapshot(workspaceId);
      const ctx = await HrImportValidator.createContext(workspaceId, catalog, numberingMode);
      ctx.canonicalModes = canonicalModes;
      const validations = HrImportValidator.validateRows(ctx, rawRows);

      const managerOrder = topologicalSortManagers(
        rawRows
          .map((r) => ({
            employeeNumber: String(r.employee_number ?? "").trim(),
            managerEmployeeNumber: String(r.direct_manager_num ?? "").trim() || null,
          }))
          .filter((r) => r.employeeNumber),
      );

      summary = {
        ...summary,
        dependencyDiagnostics: { managerOrdering: managerOrder },
        validationSummary: {
          errors: validations.filter((v) => v.errors.length).length,
          warnings: validations.filter((v) => v.warnings.length).length,
          canonicalViolations: validations.filter((v) =>
            v.errors.some((e) => e.includes("canonical") || e.includes("legacy")),
          ).length,
        },
      };

      for (let i = 0; i < validations.length; i++) {
        const v = validations[i]!;
        await importSessionService.appendRow({
          sessionId,
          workspaceId,
          rowNumber: i + 1,
          validationResult: v,
          normalizedRow: v.resolved,
          action: v.errors.length ? "error" : "simulate",
          status: v.errors.length ? "error" : v.warnings.length ? "warning" : "valid",
          errors: v.errors,
          warnings: v.warnings,
        });
      }
    }

    const timingMs = { validateMs: Date.now() - t0 };
    await importSessionService.updateSessionStatus(workspaceId, sessionId, "validated", {
      ...(session.summary as object),
      ...summary,
      timing: { ...((session.summary as Record<string, unknown>)?.timing as object), ...timingMs },
      commitEnabled: importGates.commitAllowed && importGates.strictRowValidation,
      importBlocked: importGates.strictRowValidation && !importGates.commitAllowed,
    });

    void recordSessionExecutionTelemetry({
      workspaceId,
      sessionId,
      event: "validate",
      timingMs,
      metadata: summary,
    });

    return {
      sessionId,
      status: "validated",
      summary,
      timingMs,
      commitEnabled: importGates.commitAllowed && importGates.strictRowValidation,
      importGates,
      importBlocked: importGates.strictRowValidation && !importGates.commitAllowed,
    };
  }

  async executeShadowRun(workspaceId: number, sessionId: number): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    incrementRuntimeMetric("import.v3.shadow_run");

    const session = await importSessionService.getSession(workspaceId, sessionId);
    if (!session) throw new Error("Session not found");
    if (session.importType.startsWith("master")) {
      return { sessionId, status: session.status, note: "Shadow run applies to employee imports only" };
    }

    const rows = await importSessionService.getSessionRows(sessionId, workspaceId);
    const rawRows = rows.map((r) => (r.rawRow ?? {}) as Record<string, string>);

    const [settingsRow] = await db
      .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

    const shadow = await runEmployeeShadowPipeline({
      workspaceId,
      numberingMode: settingsRow?.numberingMode ?? "auto",
      rows: rawRows,
    });

    const rollbackPrepared = await prepareRollbackSnapshots({
      workspaceId,
      sessionId,
      plannedActions: shadow.validations.map((v, i) => ({
        entityType: "employee",
        rowNumber: i + 1,
        action: v.errors.length ? "skip" : "simulate",
        afterJson: { resolved: v.resolved, simulation: true },
      })),
    });

    const shadowSimulation = { ...shadow, rollbackPrepared };
    const timingMs = { shadowMs: Date.now() - t0 };

    await importSessionService.updateSessionStatus(workspaceId, sessionId, "shadow_complete", {
      ...(session.summary as object),
      shadowSimulation,
      rollbackPrepared,
      timing: { ...((session.summary as Record<string, unknown>)?.timing as object), ...timingMs },
      commitEnabled: false,
    });

    void recordSessionExecutionTelemetry({
      workspaceId,
      sessionId,
      event: "shadow_run",
      timingMs,
      metadata: { simulation: shadow.simulation, rollbackPrepared },
    });

    return { sessionId, status: "shadow_complete", shadowSimulation, timingMs, commitEnabled: false };
  }
}

export const importSessionEngine = new ImportSessionEngine();
