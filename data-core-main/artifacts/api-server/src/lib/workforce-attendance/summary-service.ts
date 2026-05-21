import { db } from "@workspace/db";
import {
  attendanceEventsTable,
  attendanceSourcesTable,
  attendanceDailySummariesTable,
  hrShiftsTable,
  hrAttendanceTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { toHHMM, minutesBetweenHHMM, parseHHMMToMinutes, SOURCE_PRIORITY } from "./time-utils";
import { getWorkspaceTimezone, isHoliday, isWorkDay } from "./calendar-context";
import { hrWorkCalendarsTable } from "@workspace/db";

export class AttendanceSummaryService {
  async matchShift(workspaceId: number, existingShiftId: number | null): Promise<typeof hrShiftsTable.$inferSelect | null> {
    if (existingShiftId) {
      const [s] = await db
        .select()
        .from(hrShiftsTable)
        .where(and(eq(hrShiftsTable.id, existingShiftId), eq(hrShiftsTable.workspaceId, workspaceId)))
        .limit(1);
      if (s) return s;
    }
    const [def] = await db
      .select()
      .from(hrShiftsTable)
      .where(and(eq(hrShiftsTable.workspaceId, workspaceId), eq(hrShiftsTable.isActive, true)))
      .orderBy(asc(hrShiftsTable.displayOrder))
      .limit(1);
    return def ?? null;
  }

  async buildDailySummary(
    workspaceId: number,
    employeeId: number,
    localDate: string,
  ): Promise<typeof attendanceDailySummariesTable.$inferSelect> {
    const timezone = await getWorkspaceTimezone(workspaceId);

    const events = await db
      .select({
        eventType: attendanceEventsTable.eventType,
        occurredAt: attendanceEventsTable.occurredAt,
        sourceCode: attendanceSourcesTable.code,
        sourcePriority: attendanceSourcesTable.defaultPriority,
      })
      .from(attendanceEventsTable)
      .innerJoin(attendanceSourcesTable, eq(attendanceEventsTable.sourceId, attendanceSourcesTable.id))
      .where(
        and(
          eq(attendanceEventsTable.workspaceId, workspaceId),
          eq(attendanceEventsTable.employeeId, employeeId),
          eq(attendanceEventsTable.localDate, localDate),
          eq(attendanceEventsTable.isSuperseded, false),
        ),
      )
      .orderBy(asc(attendanceEventsTable.occurredAt));

    const [legacy] = await db
      .select({ id: hrAttendanceTable.id, shiftId: hrAttendanceTable.shiftId })
      .from(hrAttendanceTable)
      .where(
        and(
          eq(hrAttendanceTable.workspaceId, workspaceId),
          eq(hrAttendanceTable.employeeId, employeeId),
          eq(hrAttendanceTable.date, localDate),
        ),
      )
      .limit(1);

    const shift = await this.matchShift(workspaceId, legacy?.shiftId ?? null);

    let firstIn: string | null = null;
    let lastOut: string | null = null;
    let dominantSource = "manual";

    if (events.length > 0) {
      const sorted = [...events].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      const ins = sorted.filter((e) => e.eventType === "clock_in");
      const outs = sorted.filter((e) => e.eventType === "clock_out");
      if (ins[0]) firstIn = toHHMM(ins[0].occurredAt);
      if (outs.length > 0) lastOut = toHHMM(outs[outs.length - 1]!.occurredAt);
      else if (ins.length > 1) lastOut = toHHMM(ins[ins.length - 1]!.occurredAt);

      dominantSource = events
        .map((e) => ({
          code: e.sourceCode,
          priority: SOURCE_PRIORITY[e.sourceCode] ?? e.sourcePriority,
        }))
        .sort((a, b) => b.priority - a.priority)[0]?.code ?? "manual";
    }

    let workedMinutes = 0;
    if (firstIn && lastOut) workedMinutes = minutesBetweenHHMM(firstIn, lastOut);

    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    if (shift && firstIn) {
      const schedStart = parseHHMMToMinutes(shift.startTime);
      const actualStart = parseHHMMToMinutes(firstIn);
      if (schedStart != null && actualStart != null) {
        const grace = shift.graceMinutes ?? 0;
        if (actualStart > schedStart + grace) lateMinutes = actualStart - schedStart - grace;
      }
    }
    if (shift && lastOut) {
      const schedEnd = parseHHMMToMinutes(shift.endTime);
      const actualEnd = parseHHMMToMinutes(lastOut);
      if (schedEnd != null && actualEnd != null && actualEnd < schedEnd) {
        earlyLeaveMinutes = schedEnd - actualEnd;
      }
    }

    let overtimeMinutes = 0;
    if (shift && workedMinutes > 0) {
      const expected =
        minutesBetweenHHMM(shift.startTime, shift.endTime) - (shift.breakMinutes ?? 0);
      if (workedMinutes > expected && expected > 0) overtimeMinutes = workedMinutes - expected;
    }

    let status = "present";
    if (await isHoliday(workspaceId, localDate)) {
      status = "holiday";
    } else {
      const [cal] = await db
        .select({ workDays: hrWorkCalendarsTable.workDays })
        .from(hrWorkCalendarsTable)
        .where(and(eq(hrWorkCalendarsTable.workspaceId, workspaceId), eq(hrWorkCalendarsTable.isDefault, true)))
        .limit(1);
      const workDays = (cal?.workDays as number[]) ?? [1, 2, 3, 4, 5];
      if (!isWorkDay(localDate, workDays, timezone) && events.length === 0) {
        status = "holiday";
      } else if (events.length === 0) {
        status = "absent";
      } else if (!firstIn || !lastOut) {
        status = "half_day";
      } else if (lateMinutes > 0) {
        status = "late";
      }
    }

    const now = new Date();
    const values = {
      workspaceId,
      employeeId,
      date: localDate,
      shiftId: shift?.id ?? null,
      firstIn,
      lastOut,
      workedMinutes,
      lateMinutes,
      earlyLeaveMinutes,
      overtimeMinutes,
      status,
      dominantSourceCode: dominantSource,
      legacyAttendanceId: legacy?.id ?? null,
      calculationVersion: 1,
      calculatedAt: now,
    };

    const [existing] = await db
      .select({ id: attendanceDailySummariesTable.id })
      .from(attendanceDailySummariesTable)
      .where(
        and(
          eq(attendanceDailySummariesTable.employeeId, employeeId),
          eq(attendanceDailySummariesTable.date, localDate),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(attendanceDailySummariesTable)
        .set({ ...values, updatedAt: now })
        .where(eq(attendanceDailySummariesTable.id, existing.id))
        .returning();
      return updated!;
    }

    const [inserted] = await db
      .insert(attendanceDailySummariesTable)
      .values(values)
      .returning();
    return inserted!;
  }
}

export const attendanceSummaryService = new AttendanceSummaryService();
