/**
 * Phase 4 — Controlled v2 commit orchestrator.
 */

import { randomBytes } from "node:crypto";
import {
  db,
  employeesTable,
  hrWorkspaceSettingsTable,
  hrImportSessionsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { importSessionService } from "../session/import-session-service";
import {
  getImportRuntimeSettings,
  isLiveCommitAllowed,
  isShadowCommitSimulationMode,
  getCommitModeLabel,
} from "../runtime-settings";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "../validation/hr-import-validator";
import { runTransactionalBatch, type TxClient } from "./transaction-manager";
import {
  buildEmployeeCommitPayload,
  persistEmployeeRow,
  type EmployeePersistResult,
} from "./employee-persistence";
import {
  buildManagerCommitPlan,
  loadWorkspaceEmployeeNumberIndex,
  applyManagerPass,
  resolveManagerId,
} from "./hierarchy-commit";
import { recordRollbackSnapshot } from "../rollback/rollback-foundation";
import { runShadowCommitSimulation } from "./shadow-commit-simulation";
import { syncImportWorkforceSideEffects } from "../workforce/import-workforce-sync";
import { recordCommitTelemetry } from "../telemetry/commit-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type CommitExecutionResult = {
  sessionId: number;
  status: string;
  mode: "disabled" | "shadow_simulation" | "controlled_commit";
  committed: boolean;
  liveWrites: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
  revertToken?: string;
  shadowResult?: Awaited<ReturnType<typeof runShadowCommitSimulation>>;
  timingMs?: Record<string, number>;
  reason?: string;
};

export class CommitOrchestrator {
  async executeCommit(input: {
    workspaceId: number;
    sessionId: number;
    userId?: number;
  }): Promise<CommitExecutionResult> {
    const t0 = Date.now();
    incrementRuntimeMetric("import.v4.commit_request");

    const settings = await getImportRuntimeSettings(input.workspaceId);
    const mode = getCommitModeLabel(settings);

    if (mode === "disabled") {
      return {
        sessionId: input.sessionId,
        status: "commit_disabled",
        mode: "disabled",
        committed: false,
        liveWrites: false,
        reason: "COMMIT_REQUIRES_CONTROLLED_COMMIT_MODE",
      };
    }

    const session = await importSessionService.getSession(input.workspaceId, input.sessionId);
    if (!session) throw new Error("Session not found");

    if (!["validated", "shadow_complete"].includes(session.status)) {
      return {
        sessionId: input.sessionId,
        status: session.status,
        mode,
        committed: false,
        liveWrites: false,
        reason: "SESSION_NOT_READY_FOR_COMMIT",
      };
    }

    const rows = await importSessionService.getSessionRows(input.sessionId, input.workspaceId);
    const [settingsRow] = await db
      .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, input.workspaceId));

    const numberingMode = settingsRow?.numberingMode ?? "auto";

    if (isShadowCommitSimulationMode(settings)) {
      const shadowResult = await runShadowCommitSimulation({
        workspaceId: input.workspaceId,
        numberingMode,
        sessionRows: rows,
      });

      await importSessionService.updateSessionStatus(input.workspaceId, input.sessionId, session.status, {
        ...(session.summary as object),
        shadowCommitSimulation: shadowResult,
        commitMode: "shadow_simulation",
        commitEnabled: false,
      });

      void recordCommitTelemetry({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        event: "shadow_commit_simulation",
        timingMs: { totalMs: Date.now() - t0 },
        metadata: { parityRatio: shadowResult.commitParity.summary.parityRatio },
      });

      return {
        sessionId: input.sessionId,
        status: session.status,
        mode: "shadow_simulation",
        committed: false,
        liveWrites: false,
        shadowResult,
        timingMs: { totalMs: Date.now() - t0 },
      };
    }

    if (!isLiveCommitAllowed(settings)) {
      return {
        sessionId: input.sessionId,
        status: session.status,
        mode,
        committed: false,
        liveWrites: false,
        reason: "LIVE_COMMIT_NOT_ALLOWED",
      };
    }

    const revertToken = `rev_${randomBytes(16).toString("hex")}`;
    await importSessionService.beginCommit(input.workspaceId, input.sessionId, revertToken);

    const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId);
    const ctx = await HrImportValidator.createContext(input.workspaceId, catalog, numberingMode);
    const validations = HrImportValidator.validateRows(
      ctx,
      rows.map((r) => (r.rawRow ?? {}) as Record<string, string>),
    );

    const existingEmps = await db
      .select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber, email: employeesTable.email })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, input.workspaceId));

    const empByNum = new Map<string, number>();
    const empByEmail = new Map<string, { id: number; employeeNumber: string }>();
    for (const e of existingEmps) {
      if (e.employeeNumber) empByNum.set(String(e.employeeNumber).toLowerCase(), e.id);
      if (e.email) empByEmail.set(String(e.email).toLowerCase(), { id: e.id, employeeNumber: String(e.employeeNumber ?? "") });
    }

    const workspaceIndex = await loadWorkspaceEmployeeNumberIndex(input.workspaceId);
    const hierarchyPlan = buildManagerCommitPlan(
      rows.map((r) => ({ rowNumber: r.rowNumber, raw: (r.rawRow ?? {}) as Record<string, string> })),
    );

    const rowOrder = hierarchyPlan.orderedRowNumbers.length
      ? hierarchyPlan.orderedRowNumbers
      : rows.map((r) => r.rowNumber);

    const batchRows = rowOrder.map((rowNumber) => {
      const rowIdx = rows.findIndex((r) => r.rowNumber === rowNumber);
      const row = rows[rowIdx]!;
      const validation = validations[rowIdx]!;

      return {
        rowNumber,
        execute: async (tx: TxClient) => {
          if (validation.errors.length) {
            return { action: "skip" as const, reason: validation.errors.join("; ") };
          }

          const raw = (row.rawRow ?? {}) as Record<string, string>;
          const payload = buildEmployeeCommitPayload(raw, validation);
          const empNum = payload.employeeNumber.toLowerCase();
          const email = (payload.email ?? "").toLowerCase();

          let existingId: number | undefined;
          if (empNum && empByNum.has(empNum)) existingId = empByNum.get(empNum);
          else if (email && empByEmail.has(email)) existingId = empByEmail.get(email)!.id;

          const mgrNum = hierarchyPlan.managerByRow.get(rowNumber);
          if (hierarchyPlan.selfManagerRows.includes(rowNumber)) {
            return { action: "skip" as const, reason: "self_manager_not_allowed" };
          }

          const managerId = resolveManagerId(mgrNum, empByNum, workspaceIndex);

          const result = await persistEmployeeRow({
            tx,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            rowNumber,
            payload,
            existingId,
            numberingMode,
            managerId,
            empByNum,
          });

          await recordRollbackSnapshot({
            sessionId: input.sessionId,
            workspaceId: input.workspaceId,
            entityType: "employee",
            entityId: result.employeeId,
            action: result.action,
            beforeJson: result.before ?? null,
            afterJson: { employeeNumber: result.employeeNumber, rowNumber, phase: 4 },
          });

          return result;
        },
      };
    });

    const tCommit = Date.now();
    const batch = await runTransactionalBatch<EmployeePersistResult | { action: "skip"; reason: string }>({
      label: `session_${input.sessionId}`,
      rows: batchRows,
    });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const managerUpdates: Array<{ employeeId: number; managerId: number | null; rowNumber: number }> = [];

    for (const r of batch.results) {
      if (!r.ok) {
        skipped++;
        errors.push(`Row ${r.rowNumber}: ${r.error}`);
        continue;
      }
      const res = r.result!;
      if ("reason" in res && res.action === "skip") {
        skipped++;
        continue;
      }
      if (res.action === "insert") inserted++;
      else if (res.action === "update") updated++;
      else skipped++;

      if ("employeeId" in res && res.employeeId) {
        const mgrNum = hierarchyPlan.managerByRow.get(r.rowNumber);
        const managerId = resolveManagerId(mgrNum, empByNum, workspaceIndex);
        managerUpdates.push({ employeeId: res.employeeId, managerId, rowNumber: r.rowNumber });
      }
    }

    const managerPass = await applyManagerPass({
      workspaceId: input.workspaceId,
      updates: managerUpdates,
    });

    const timingMs = {
      commitMs: Date.now() - tCommit,
      totalMs: Date.now() - t0,
    };

    const finalStatus = batch.committed ? "committed" : "commit_failed";

    await db
      .update(hrImportSessionsTable)
      .set({
        status: finalStatus,
        dryRun: false,
        revertToken,
        summary: {
          ...(session.summary as object),
          commitResult: { inserted, updated, skipped, errors, managerPass, hierarchyPlan, timingMs },
          commitMode: "controlled_commit",
          phase: 4,
        },
      })
      .where(
        and(
          eq(hrImportSessionsTable.id, input.sessionId),
          eq(hrImportSessionsTable.workspaceId, input.workspaceId),
        ),
      );

    if (batch.committed) {
      void syncImportWorkforceSideEffects({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        employeeIds: managerUpdates.map((m) => m.employeeId),
        actorUserId: input.userId,
        correlationId: `import_session_${input.sessionId}`,
      });
    }

    void recordCommitTelemetry({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      event: batch.committed ? "commit_success" : "commit_failed",
      timingMs,
      metadata: { inserted, updated, skipped, errorCount: errors.length },
    });

    return {
      sessionId: input.sessionId,
      status: finalStatus,
      mode: "controlled_commit",
      committed: batch.committed,
      liveWrites: batch.committed,
      inserted,
      updated,
      skipped,
      errors,
      revertToken: batch.committed ? revertToken : undefined,
      timingMs,
    };
  }
}

export const commitOrchestrator = new CommitOrchestrator();
