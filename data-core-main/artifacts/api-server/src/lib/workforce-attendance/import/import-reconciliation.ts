import { db } from "@workspace/db";
import { generatedReportsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ValidatedImportRow } from "./import-validator";

export type ReconciliationSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  duplicates: number;
  employeeCoverage: { employeeId: number; days: number }[];
  missingPunchRows: Array<{ employeeId: number; date: string; warnings: string[] }>;
  errors: Array<{ rowNumber: number; message: string }>;
};

export function buildReconciliationFromRows(
  applied: Array<{
    row: ValidatedImportRow;
    outcome: "inserted" | "updated" | "skipped" | "failed";
    error?: string;
  }>,
): ReconciliationSummary {
  const summary: ReconciliationSummary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    duplicates: 0,
    employeeCoverage: [],
    missingPunchRows: [],
    errors: [],
  };

  const coverageMap = new Map<number, Set<string>>();

  for (const a of applied) {
    if (a.outcome === "inserted") summary.inserted++;
    else if (a.outcome === "updated") summary.updated++;
    else if (a.outcome === "skipped") summary.skipped++;
    else summary.failed++;

    if (a.row.fileDuplicate) summary.duplicates++;
    if (a.error) summary.errors.push({ rowNumber: a.row.rowNumber, message: a.error });

    if (a.row.employeeId && a.row.date) {
      if (!coverageMap.has(a.row.employeeId)) coverageMap.set(a.row.employeeId, new Set());
      coverageMap.get(a.row.employeeId)!.add(a.row.date);
    }

    if (a.row.normalizationWarnings.some((w) => w.includes("without"))) {
      summary.missingPunchRows.push({
        employeeId: a.row.employeeId!,
        date: a.row.date!,
        warnings: a.row.normalizationWarnings,
      });
    }
  }

  summary.employeeCoverage = [...coverageMap.entries()].map(([employeeId, days]) => ({
    employeeId,
    days: days.size,
  }));

  return summary;
}

export async function persistReconciliationReport(params: {
  workspaceId: number;
  userId: number;
  batchId: number;
  summary: ReconciliationSummary;
}): Promise<number> {
  const payload = JSON.stringify({ batchId: params.batchId, summary: params.summary });
  const [report] = await db
    .insert(generatedReportsTable)
    .values({
      workspaceId: params.workspaceId,
      reportDefinitionKey: "hr.attendance.import.reconciliation",
      format: "json",
      status: "completed",
      requestedByUserId: params.userId,
      parametersJson: payload,
      fileName: `attendance-import-reconciliation-${params.batchId}.json`,
      storageKey: `inline:reconciliation:batch-${params.batchId}`,
      completedAt: new Date(),
    })
    .returning({ id: generatedReportsTable.id });

  return report!.id;
}

export async function getReconciliationReport(reportId: number, workspaceId: number) {
  const [row] = await db
    .select()
    .from(generatedReportsTable)
    .where(
      and(
        eq(generatedReportsTable.id, reportId),
        eq(generatedReportsTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row?.parametersJson) return null;
  try {
    return JSON.parse(row.parametersJson) as {
      batchId: number;
      summary: ReconciliationSummary;
    };
  } catch {
    return null;
  }
}
