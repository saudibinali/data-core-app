/**
 * Phase 4 — Commit diff engine (legacy vs v2 parity at commit time).
 */

export type CommitRowOutcome = {
  rowNumber: number;
  action: "insert" | "update" | "skip" | "error";
  employeeNumber?: string;
  errors?: string[];
};

export type LegacyCommitSimulation = {
  imported: number;
  updated: number;
  skipped: number;
  rowOutcomes: CommitRowOutcome[];
};

export type V2CommitOutcome = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  rowOutcomes: CommitRowOutcome[];
};

export type CommitParityDiff = {
  rowNumber: number;
  legacyAction: string;
  v2Action: string;
  actionMismatch: boolean;
  fieldMismatches: string[];
};

export function compareCommitOutcomes(
  legacy: LegacyCommitSimulation,
  v2: V2CommitOutcome,
): {
  diffs: CommitParityDiff[];
  summary: {
    totalRows: number;
    actionMismatches: number;
    insertedDiff: number;
    updatedDiff: number;
    skippedDiff: number;
    parityRatio: number;
  };
} {
  const legacyByRow = new Map(legacy.rowOutcomes.map((r) => [r.rowNumber, r]));
  const v2ByRow = new Map(v2.rowOutcomes.map((r) => [r.rowNumber, r]));
  const allRows = new Set([...legacyByRow.keys(), ...v2ByRow.keys()]);

  const diffs: CommitParityDiff[] = [];
  let actionMismatches = 0;

  for (const rowNumber of allRows) {
    const leg = legacyByRow.get(rowNumber);
    const v2Row = v2ByRow.get(rowNumber);
    const legacyAction = leg?.action ?? "missing";
    const v2Action = v2Row?.action ?? "missing";
    const actionMismatch = legacyAction !== v2Action;
    if (actionMismatch) actionMismatches++;

    const fieldMismatches: string[] = [];
    if (leg?.employeeNumber !== v2Row?.employeeNumber && leg?.employeeNumber && v2Row?.employeeNumber) {
      fieldMismatches.push("employee_number");
    }

    if (actionMismatch || fieldMismatches.length) {
      diffs.push({ rowNumber, legacyAction, v2Action, actionMismatch, fieldMismatches });
    }
  }

  const totalRows = allRows.size || 1;
  return {
    diffs,
    summary: {
      totalRows: allRows.size,
      actionMismatches,
      insertedDiff: Math.abs(legacy.imported - v2.inserted),
      updatedDiff: Math.abs(legacy.updated - v2.updated),
      skippedDiff: Math.abs(legacy.skipped - v2.skipped),
      parityRatio: (allRows.size - actionMismatches) / totalRows,
    },
  };
}

export function simulateLegacyCommitFromSessionRows(
  rows: Array<{
    rowNumber: number;
    status: string;
    errors: unknown;
    rawRow: Record<string, string>;
  }>,
): LegacyCommitSimulation {
  const rowOutcomes: CommitRowOutcome[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const errs = Array.isArray(row.errors) ? (row.errors as string[]) : [];
    if (errs.length || row.status === "error") {
      skipped++;
      rowOutcomes.push({ rowNumber: row.rowNumber, action: "skip", errors: errs });
      continue;
    }
    const empNum = String(row.rawRow?.employee_number ?? "").trim();
    const existing = row.status === "warning";
    if (existing) {
      updated++;
      rowOutcomes.push({ rowNumber: row.rowNumber, action: "update", employeeNumber: empNum });
    } else {
      imported++;
      rowOutcomes.push({ rowNumber: row.rowNumber, action: "insert", employeeNumber: empNum });
    }
  }

  return { imported, updated, skipped, rowOutcomes };
}
