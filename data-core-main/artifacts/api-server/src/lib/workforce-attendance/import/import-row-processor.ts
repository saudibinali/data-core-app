import { db } from "@workspace/db";
import { hrAttendanceTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ValidatedImportRow } from "./import-validator";
import { ingestExcelRowWithMeta } from "../pipeline";
import { attendanceNormalizationService } from "../normalization-service";

function toLegacySourceType(sourceType?: string): string {
  const s = (sourceType ?? "excel").toLowerCase();
  if (s === "excel" || s === "import") return "manual";
  if (s === "web") return "mobile";
  return s;
}

export async function processImportRow(params: {
  workspaceId: number;
  userId: number;
  batchId: number;
  row: ValidatedImportRow;
}): Promise<{
  outcome: "inserted" | "updated" | "skipped" | "failed";
  rawEventId?: number;
  legacyAttendanceId?: number;
}> {
  const { row, workspaceId, userId, batchId } = params;
  if (!row.employeeId || !row.date) {
    return { outcome: "skipped" };
  }

  const existing = await db
    .select({ id: hrAttendanceTable.id })
    .from(hrAttendanceTable)
    .where(
      and(
        eq(hrAttendanceTable.workspaceId, workspaceId),
        eq(hrAttendanceTable.employeeId, row.employeeId),
        eq(hrAttendanceTable.date, row.date),
      ),
    )
    .limit(1);

  const legacyPayload = {
    checkIn: row.checkIn ?? null,
    checkOut: row.checkOut ?? null,
    status: row.status ?? "present",
    shiftId: row.shiftId ?? null,
    sourceType: toLegacySourceType(row.sourceType),
    lateMinutes: row.lateMinutes ?? 0,
    earlyLeaveMinutes: row.earlyLeaveMinutes ?? 0,
    overtimeMinutes: row.overtimeMinutes ?? 0,
    notes: row.notes ?? null,
  };

  let legacyAttendanceId: number;
  let outcome: "inserted" | "updated";

  if (existing[0]) {
    await db
      .update(hrAttendanceTable)
      .set(legacyPayload)
      .where(eq(hrAttendanceTable.id, existing[0].id));
    legacyAttendanceId = existing[0].id;
    outcome = "updated";
  } else {
    const [ins] = await db
      .insert(hrAttendanceTable)
      .values({
        workspaceId,
        employeeId: row.employeeId,
        date: row.date,
        ...legacyPayload,
        createdBy: userId,
      })
      .returning({ id: hrAttendanceTable.id });
    legacyAttendanceId = ins!.id;
    outcome = "inserted";
  }

  const ingest = await ingestExcelRowWithMeta({
    workspaceId,
    employeeId: row.employeeId,
    date: row.date,
    checkIn: row.checkIn ?? null,
    checkOut: row.checkOut ?? null,
    userId,
    importBatchId: batchId,
    rowNumber: row.rowNumber,
  });

  await attendanceNormalizationService.rebuildEmployeeDay(
    workspaceId,
    row.employeeId,
    row.date,
  );

  return {
    outcome,
    rawEventId: ingest.rawEventId,
    legacyAttendanceId,
  };
}
