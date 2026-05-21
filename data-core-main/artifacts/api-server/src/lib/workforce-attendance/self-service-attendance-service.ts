import { db } from "@workspace/db";
import {
  employeesTable,
  attendanceEventsTable,
  attendanceDailySummariesTable,
  hrAttendanceTable,
  hrWorkLocationsTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getWorkspaceTimezone } from "./calendar-context";
import { toLocalDateString } from "./time-utils";
import { attendancePolicyService } from "./attendance-policy-service";
import { attendanceWarningService } from "./attendance-warning-service";

export class SelfServiceAttendanceService {
  async getEmployeeContext(workspaceId: number, userId: number) {
    const [emp] = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        workLocationId: employeesTable.workLocationId,
        locationName: hrWorkLocationsTable.name,
      })
      .from(employeesTable)
      .leftJoin(hrWorkLocationsTable, eq(employeesTable.workLocationId, hrWorkLocationsTable.id))
      .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)))
      .limit(1);
    return emp ?? null;
  }

  async getCurrentStatus(workspaceId: number, employeeId: number, userId: number) {
    const timezone = await getWorkspaceTimezone(workspaceId);
    const today = toLocalDateString(new Date(), timezone);
    const { config: policy } = await attendancePolicyService.getDefaultPolicy(workspaceId);

    const events = await db
      .select({
        id: attendanceEventsTable.id,
        eventType: attendanceEventsTable.eventType,
        occurredAt: attendanceEventsTable.occurredAt,
        locationJson: attendanceEventsTable.locationJson,
      })
      .from(attendanceEventsTable)
      .where(
        and(
          eq(attendanceEventsTable.workspaceId, workspaceId),
          eq(attendanceEventsTable.employeeId, employeeId),
          eq(attendanceEventsTable.localDate, today),
          eq(attendanceEventsTable.isSuperseded, false),
        ),
      )
      .orderBy(attendanceEventsTable.occurredAt);

    const ins = events.filter((e) => e.eventType === "clock_in");
    const outs = events.filter((e) => e.eventType === "clock_out");
    const lastIn = ins[ins.length - 1];
    const lastOut = outs[outs.length - 1];

    let clockState: "not_started" | "clocked_in" | "clocked_out" | "complete" = "not_started";
    if (lastIn && !lastOut) clockState = "clocked_in";
    else if (lastIn && lastOut) clockState = "complete";
    else if (lastOut && !lastIn) clockState = "clocked_out";

    const [summary] = await db
      .select()
      .from(attendanceDailySummariesTable)
      .where(
        and(
          eq(attendanceDailySummariesTable.workspaceId, workspaceId),
          eq(attendanceDailySummariesTable.employeeId, employeeId),
          eq(attendanceDailySummariesTable.date, today),
        ),
      )
      .limit(1);

    const hour = Number(
      new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: timezone }),
    );

    const warnings = attendanceWarningService.mergeWarnings(
      attendanceWarningService.detectMissingClockOut({
        hasClockIn: ins.length > 0,
        hasClockOut: outs.length > 0,
        localHour: hour,
      }),
    );

    const pendingReview = events.some((e) => {
      if (!e.locationJson) return false;
      try {
        const p = JSON.parse(e.locationJson) as { warnings?: unknown[] };
        return Array.isArray(p.warnings) && p.warnings.length > 0;
      } catch {
        return false;
      }
    });

    return {
      employeeId,
      userId,
      localDate: today,
      timezone,
      clockState,
      canClockIn: clockState === "not_started" || clockState === "clocked_out",
      canClockOut: clockState === "clocked_in",
      firstIn: summary?.firstIn ?? null,
      lastOut: summary?.lastOut ?? null,
      workedMinutes: summary?.workedMinutes ?? 0,
      status: summary?.status ?? (clockState === "not_started" ? "pending" : "in_progress"),
      warnings,
      pendingReview,
      policy: {
        geofenceRequired: policy.geofenceRequired,
        allowRemoteClock: policy.allowRemoteClock,
        minAccuracyMeters: policy.minAccuracyMeters,
      },
      recentPunches: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        hasLocation: Boolean(e.locationJson),
      })),
    };
  }

  async getTodaySummary(workspaceId: number, employeeId: number) {
    const timezone = await getWorkspaceTimezone(workspaceId);
    const today = toLocalDateString(new Date(), timezone);

    const [summary] = await db
      .select()
      .from(attendanceDailySummariesTable)
      .where(
        and(
          eq(attendanceDailySummariesTable.workspaceId, workspaceId),
          eq(attendanceDailySummariesTable.employeeId, employeeId),
          eq(attendanceDailySummariesTable.date, today),
        ),
      )
      .limit(1);

    const [legacy] = await db
      .select()
      .from(hrAttendanceTable)
      .where(
        and(
          eq(hrAttendanceTable.workspaceId, workspaceId),
          eq(hrAttendanceTable.employeeId, employeeId),
          eq(hrAttendanceTable.date, today),
        ),
      )
      .limit(1);

    return {
      localDate: today,
      summary: summary ?? null,
      legacy: legacy ?? null,
      sourceBreakdown: {
        dominantSource: summary?.dominantSourceCode ?? legacy?.sourceType ?? null,
      },
    };
  }

  async getMyHistory(
    workspaceId: number,
    employeeId: number,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const conditions = [
      eq(hrAttendanceTable.workspaceId, workspaceId),
      eq(hrAttendanceTable.employeeId, employeeId),
    ];
    if (dateFrom) conditions.push(gte(hrAttendanceTable.date, dateFrom));
    if (dateTo) conditions.push(lte(hrAttendanceTable.date, dateTo));

    const rows = await db
      .select({
        id: hrAttendanceTable.id,
        date: hrAttendanceTable.date,
        checkIn: hrAttendanceTable.checkIn,
        checkOut: hrAttendanceTable.checkOut,
        status: hrAttendanceTable.status,
        sourceType: hrAttendanceTable.sourceType,
        lateMinutes: hrAttendanceTable.lateMinutes,
        overtimeMinutes: hrAttendanceTable.overtimeMinutes,
      })
      .from(hrAttendanceTable)
      .where(and(...conditions))
      .orderBy(desc(hrAttendanceTable.date))
      .limit(90);

    return rows.map((r) => ({
      ...r,
      geofenceFlag: r.sourceType === "mobile" || r.sourceType === "web",
    }));
  }
}

export const selfServiceAttendanceService = new SelfServiceAttendanceService();
