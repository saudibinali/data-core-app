/**
 * Phase 3 — Import session results & diagnostics aggregation.
 */

import type { HrImportSession, HrImportSessionRow } from "@workspace/db";

export type ImportSessionResults = {
  sessionId: number;
  status: string;
  summary: Record<string, unknown>;
  rows: Array<{
    rowNumber: number;
    status: string;
    action: string | null;
    errors: unknown;
    warnings: unknown;
    validationResult: unknown;
    normalizedRow: unknown;
  }>;
  totals: {
    total: number;
    errors: number;
    warnings: number;
    valid: number;
  };
};

export type ImportSessionDiagnostics = {
  sessionId: number;
  phase: number;
  workbookVerification?: unknown;
  dependencyDiagnostics?: unknown;
  mappingDiagnostics?: unknown;
  shadowSimulation?: unknown;
  timing?: Record<string, number>;
  staleTemplateIssues?: unknown;
  rollbackExecutionEnabled: false;
  commitEnabled: false;
};

export function buildSessionResults(
  session: HrImportSession,
  rows: HrImportSessionRow[],
): ImportSessionResults {
  let errorCount = 0;
  let warningCount = 0;
  let validCount = 0;

  const mapped = rows.map((r) => {
    const errs = Array.isArray(r.errors) ? r.errors : [];
    const warns = Array.isArray(r.warnings) ? r.warnings : [];
    if (errs.length) errorCount++;
    else if (warns.length) warningCount++;
    else validCount++;
    return {
      rowNumber: r.rowNumber,
      status: r.status,
      action: r.action,
      errors: r.errors,
      warnings: r.warnings,
      validationResult: r.validationResult,
      normalizedRow: r.normalizedRow,
    };
  });

  return {
    sessionId: session.id,
    status: session.status,
    summary: (session.summary as Record<string, unknown>) ?? {},
    rows: mapped,
    totals: {
      total: rows.length,
      errors: errorCount,
      warnings: warningCount,
      valid: validCount,
    },
  };
}

export function buildSessionDiagnostics(session: HrImportSession): ImportSessionDiagnostics {
  const summary = (session.summary as Record<string, unknown>) ?? {};
  return {
    sessionId: session.id,
    phase: 3,
    workbookVerification: summary.workbookVerification,
    dependencyDiagnostics: summary.dependencyDiagnostics,
    mappingDiagnostics: summary.mappingDiagnostics,
    shadowSimulation: summary.shadowSimulation,
    timing: summary.timing as Record<string, number> | undefined,
    staleTemplateIssues: summary.staleTemplateIssues,
    rollbackExecutionEnabled: false,
    commitEnabled: false,
  };
}
