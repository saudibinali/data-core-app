import { db } from "@workspace/db";
import { hrAttendanceTable, attendanceDailySummariesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Map dominant source code to legacy source_type enum */
function toLegacySourceType(code: string | null): string {
  if (code === "web") return "mobile";
  if (code === "excel") return "manual";
  if (code === "system") return "system";
  return "manual";
}

/**
 * Transitional dual-write: attendance_daily_summaries → hr_attendance.
 * Does not remove or block legacy API writes.
 */
export async function syncSummaryToLegacyAttendance(
  summary: typeof attendanceDailySummariesTable.$inferSelect,
  createdByUserId?: number | null,
): Promise<number> {
  const payload = {
    workspaceId: summary.workspaceId,
    employeeId: summary.employeeId,
    date: summary.date,
    shiftId: summary.shiftId,
    checkIn: summary.firstIn,
    checkOut: summary.lastOut,
    status: summary.status,
    sourceType: toLegacySourceType(summary.dominantSourceCode),
    lateMinutes: summary.lateMinutes,
    earlyLeaveMinutes: summary.earlyLeaveMinutes,
    overtimeMinutes: summary.overtimeMinutes,
    notes: null as string | null,
  };

  const [existing] = await db
    .select({ id: hrAttendanceTable.id })
    .from(hrAttendanceTable)
    .where(
      and(
        eq(hrAttendanceTable.workspaceId, summary.workspaceId),
        eq(hrAttendanceTable.employeeId, summary.employeeId),
        eq(hrAttendanceTable.date, summary.date),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(hrAttendanceTable)
      .set({
        shiftId: payload.shiftId,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        status: payload.status,
        sourceType: payload.sourceType,
        lateMinutes: payload.lateMinutes,
        earlyLeaveMinutes: payload.earlyLeaveMinutes,
        overtimeMinutes: payload.overtimeMinutes,
      })
      .where(eq(hrAttendanceTable.id, existing.id));

    await db
      .update(attendanceDailySummariesTable)
      .set({ legacyAttendanceId: existing.id })
      .where(eq(attendanceDailySummariesTable.id, summary.id));

    return existing.id;
  }

  const [inserted] = await db
    .insert(hrAttendanceTable)
    .values({
      ...payload,
      createdBy: createdByUserId ?? null,
    })
    .returning({ id: hrAttendanceTable.id });

  await db
    .update(attendanceDailySummariesTable)
    .set({ legacyAttendanceId: inserted!.id })
    .where(eq(attendanceDailySummariesTable.id, summary.id));

  return inserted!.id;
}
