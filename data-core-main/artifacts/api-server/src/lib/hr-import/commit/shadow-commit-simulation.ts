/**
 * Phase 4 — Shadow commit simulation (parity only, no live writes).
 */

import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "../validation/hr-import-validator";
import { runEmployeeShadowPipeline } from "../execution/employee-shadow-pipeline";
import {
  compareCommitOutcomes,
  simulateLegacyCommitFromSessionRows,
  type V2CommitOutcome,
} from "./commit-diff-engine";
import { buildManagerCommitPlan } from "./hierarchy-commit";
import { buildEmployeeCommitPayload } from "./employee-persistence";
import { compareLegacyVsShadowRow, summarizeShadowComparison } from "../validation/shadow-validation";
import type { HrImportSessionRow } from "@workspace/db";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type ShadowCommitResult = {
  mode: "shadow_simulation";
  liveWrites: false;
  shadowPipeline: Awaited<ReturnType<typeof runEmployeeShadowPipeline>>;
  legacySimulation: ReturnType<typeof simulateLegacyCommitFromSessionRows>;
  v2Simulation: V2CommitOutcome;
  commitParity: ReturnType<typeof compareCommitOutcomes>;
  validationParity: ReturnType<typeof summarizeShadowComparison>;
  hierarchyPlan: ReturnType<typeof buildManagerCommitPlan>;
};

export async function runShadowCommitSimulation(input: {
  workspaceId: number;
  numberingMode: string;
  sessionRows: HrImportSessionRow[];
}): Promise<ShadowCommitResult> {
  incrementRuntimeMetric("import.v4.shadow_commit_simulation");

  const rawRows = input.sessionRows.map((r) => (r.rawRow ?? {}) as Record<string, string>);

  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId);
  const ctx = await HrImportValidator.createContext(input.workspaceId, catalog, input.numberingMode);
  const validations = HrImportValidator.validateRows(ctx, rawRows);

  const shadowPipeline = await runEmployeeShadowPipeline({
    workspaceId: input.workspaceId,
    numberingMode: input.numberingMode,
    rows: rawRows,
  });

  const legacyPreviewRows = input.sessionRows.map((r, i) => ({
    rowIndex: i + 1,
    errors: (Array.isArray(r.errors) ? r.errors : []) as string[],
    warnings: (Array.isArray(r.warnings) ? r.warnings : []) as string[],
    status: r.status,
  }));

  const validationComparisons = legacyPreviewRows.map((legacy, i) =>
    compareLegacyVsShadowRow(legacy, validations[i] ?? { rowIndex: legacy.rowIndex, errors: [], warnings: [], resolved: {} }),
  );

  const legacySimulation = simulateLegacyCommitFromSessionRows(
    input.sessionRows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      errors: r.errors,
      rawRow: (r.rawRow ?? {}) as Record<string, string>,
    })),
  );

  const v2RowOutcomes = input.sessionRows.map((r, i) => {
    const v = validations[i]!;
    if (v.errors.length) {
      return { rowNumber: r.rowNumber, action: "skip" as const, errors: v.errors };
    }
    const empNum = String((r.rawRow as Record<string, string>)?.employee_number ?? "");
    const action: "insert" | "update" =
      shadowPipeline.simulation.wouldUpdate > 0 && i < shadowPipeline.simulation.wouldUpdate
        ? "update"
        : "insert";
    return { rowNumber: r.rowNumber, action, employeeNumber: empNum };
  });

  const v2Simulation: V2CommitOutcome = {
    inserted: shadowPipeline.simulation.wouldInsert,
    updated: shadowPipeline.simulation.wouldUpdate,
    skipped: shadowPipeline.simulation.wouldSkip,
    errors: validations.filter((v) => v.errors.length).length,
    rowOutcomes: v2RowOutcomes,
  };

  const hierarchyPlan = buildManagerCommitPlan(
    input.sessionRows.map((r) => ({
      rowNumber: r.rowNumber,
      raw: (r.rawRow ?? {}) as Record<string, string>,
    })),
  );

  return {
    mode: "shadow_simulation",
    liveWrites: false,
    shadowPipeline,
    legacySimulation,
    v2Simulation,
    commitParity: compareCommitOutcomes(legacySimulation, v2Simulation),
    validationParity: summarizeShadowComparison(validationComparisons),
    hierarchyPlan,
  };
}

export function buildV2CommitPayloadPreview(
  sessionRows: HrImportSessionRow[],
  validations: Awaited<ReturnType<typeof HrImportValidator.validateRows>>,
): Array<{ rowNumber: number; payload: ReturnType<typeof buildEmployeeCommitPayload> }> {
  return sessionRows
    .map((r, i) => {
      const v = validations[i];
      if (!v || v.errors.length) return null;
      return {
        rowNumber: r.rowNumber,
        payload: buildEmployeeCommitPayload((r.rawRow ?? {}) as Record<string, string>, v),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}
