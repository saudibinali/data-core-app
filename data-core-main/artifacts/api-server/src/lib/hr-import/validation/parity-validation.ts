/**
 * Phase 4 — Import parity validation (legacy vs v2 diagnostics).
 */

import type { HrImportSession } from "@workspace/db";
import { importSessionService } from "../session/import-session-service";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "../validation/hr-import-validator";
import { compareLegacyVsShadowRow, summarizeShadowComparison } from "../validation/shadow-validation";
import { compareCommitOutcomes, simulateLegacyCommitFromSessionRows } from "../commit/commit-diff-engine";
import { runShadowCommitSimulation } from "../commit/shadow-commit-simulation";
import { db, hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ImportParityReport = {
  sessionId: number;
  phase: 4;
  validationParity: ReturnType<typeof summarizeShadowComparison>;
  commitParity?: ReturnType<typeof compareCommitOutcomes>["summary"];
  fieldMismatches: Array<{ rowNumber: number; fields: string[] }>;
  dependencyMismatches: unknown;
  mappingMismatches: unknown;
  blockingEnforced: false;
};

export async function buildImportParityReport(
  workspaceId: number,
  sessionId: number,
): Promise<ImportParityReport | null> {
  const session = await importSessionService.getSession(workspaceId, sessionId);
  if (!session) return null;

  const rows = await importSessionService.getSessionRows(sessionId, workspaceId);
  const [settingsRow] = await db
    .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

  const numberingMode = settingsRow?.numberingMode ?? "auto";
  const rawRows = rows.map((r) => (r.rawRow ?? {}) as Record<string, string>);

  const catalog = await masterDataCatalogService.loadSnapshot(workspaceId);
  const ctx = await HrImportValidator.createContext(workspaceId, catalog, numberingMode);
  const validations = HrImportValidator.validateRows(ctx, rawRows);

  const legacyPreviewRows = rows.map((r, i) => ({
    rowIndex: i + 1,
    errors: (Array.isArray(r.errors) ? r.errors : []) as string[],
    warnings: (Array.isArray(r.warnings) ? r.warnings : []) as string[],
    status: r.status,
  }));

  const comparisons = legacyPreviewRows.map((legacy, i) =>
    compareLegacyVsShadowRow(legacy, validations[i] ?? { rowIndex: legacy.rowIndex, errors: [], warnings: [], resolved: {} }),
  );

  const shadowSim = await runShadowCommitSimulation({ workspaceId, numberingMode, sessionRows: rows });

  const fieldMismatches = comparisons
    .filter((c) => c.hasMismatch)
    .map((c) => ({
      rowNumber: c.rowIndex,
      fields: [...c.errorMismatches, ...c.warningMismatches],
    }));

  const summary = (session.summary as Record<string, unknown>) ?? {};

  return {
    sessionId,
    phase: 4,
    validationParity: summarizeShadowComparison(comparisons),
    commitParity: shadowSim.commitParity.summary,
    fieldMismatches,
    dependencyMismatches: summary.dependencyDiagnostics ?? shadowSim.hierarchyPlan.unresolvedManagers,
    mappingMismatches: validations
      .filter((v) => Object.values(v.resolved).some((x) => x == null))
      .map((v) => ({ rowIndex: v.rowIndex, unresolved: v.resolved })),
    blockingEnforced: false,
  };
}

export function extractParityFromSession(session: HrImportSession): Partial<ImportParityReport> {
  const summary = (session.summary as Record<string, unknown>) ?? {};
  const shadowCommit = summary.shadowCommitSimulation as Record<string, unknown> | undefined;
  return {
    sessionId: session.id,
    phase: 4,
    commitParity: (shadowCommit?.commitParity as { summary?: ImportParityReport["commitParity"] })?.summary,
    validationParity: shadowCommit?.validationParity as ImportParityReport["validationParity"],
    blockingEnforced: false,
  };
}
