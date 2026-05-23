/**
 * Phase 2 — Shadow validation comparison (log/telemetry only, no enforcement).
 */

import type { HrImportRowValidation } from "./hr-import-validator";

export type LegacyPreviewRow = {
  rowIndex: number;
  errors: string[];
  warnings: string[];
  status: string;
};

export type ShadowComparisonResult = {
  rowIndex: number;
  legacyErrorCount: number;
  shadowErrorCount: number;
  legacyWarningCount: number;
  shadowWarningCount: number;
  errorMismatches: string[];
  warningMismatches: string[];
  hasMismatch: boolean;
};

function normalizeMsgs(msgs: string[]): Set<string> {
  return new Set(msgs.map((m) => m.toLowerCase().trim()));
}

function diffSets(a: Set<string>, b: Set<string>, label: string): string[] {
  const out: string[] = [];
  for (const x of a) {
    if (!b.has(x)) out.push(`${label}_only_legacy:${x}`);
  }
  for (const x of b) {
    if (!a.has(x)) out.push(`${label}_only_shadow:${x}`);
  }
  return out;
}

export function compareLegacyVsShadowRow(
  legacy: LegacyPreviewRow,
  shadow: HrImportRowValidation,
): ShadowComparisonResult {
  const legacyErrors = normalizeMsgs(legacy.errors);
  const shadowErrors = normalizeMsgs(shadow.errors);
  const legacyWarnings = normalizeMsgs(legacy.warnings);
  const shadowWarnings = normalizeMsgs(shadow.warnings);

  const errorMismatches = diffSets(legacyErrors, shadowErrors, "error");
  const warningMismatches = diffSets(legacyWarnings, shadowWarnings, "warning");

  return {
    rowIndex: legacy.rowIndex,
    legacyErrorCount: legacy.errors.length,
    shadowErrorCount: shadow.errors.length,
    legacyWarningCount: legacy.warnings.length,
    shadowWarningCount: shadow.warnings.length,
    errorMismatches,
    warningMismatches,
    hasMismatch: errorMismatches.length > 0 || warningMismatches.length > 0,
  };
}

export function summarizeShadowComparison(results: ShadowComparisonResult[]) {
  const mismatchedRows = results.filter((r) => r.hasMismatch).length;
  const totalErrorDiff = results.reduce((s, r) => s + Math.abs(r.legacyErrorCount - r.shadowErrorCount), 0);
  const totalWarningDiff = results.reduce((s, r) => s + Math.abs(r.legacyWarningCount - r.shadowWarningCount), 0);
  return {
    totalRows: results.length,
    mismatchedRows,
    parityRatio: results.length ? (results.length - mismatchedRows) / results.length : 1,
    totalErrorDiff,
    totalWarningDiff,
  };
}
