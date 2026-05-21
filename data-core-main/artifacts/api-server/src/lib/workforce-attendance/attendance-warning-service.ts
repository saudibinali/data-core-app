import { db } from "@workspace/db";
import { attendanceRawEventsTable, attendanceEventsTable } from "@workspace/db";
import { and, eq, gte, desc } from "drizzle-orm";
import type { AttendancePolicyConfig } from "./policy-types";
import type { LocationPayload } from "./geofence-validation-service";
import { haversineMeters } from "./geofence-validation-service";
import { dispatchUserNotification } from "../notifications/dispatch";

export type AttendanceWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
};

export class AttendanceWarningService {
  async detectDuplicateClock(params: {
    workspaceId: number;
    employeeId: number;
    eventType: string;
    policy: AttendancePolicyConfig;
    occurredAt: Date;
  }): Promise<AttendanceWarning[]> {
    const since = new Date(params.occurredAt.getTime() - params.policy.duplicateWindowSeconds * 1000);
    const [recent] = await db
      .select({ id: attendanceRawEventsTable.id })
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.workspaceId, params.workspaceId),
          eq(attendanceRawEventsTable.employeeId, params.employeeId),
          eq(attendanceRawEventsTable.eventTypeHint, params.eventType),
          gte(attendanceRawEventsTable.occurredAt, since),
        ),
      )
      .limit(1);

    if (recent) {
      return [
        {
          code: "duplicate_clock",
          message: `Duplicate ${params.eventType} within ${params.policy.duplicateWindowSeconds}s window`,
          severity: "warning",
        },
      ];
    }
    return [];
  }

  async detectSuspiciousVelocity(params: {
    workspaceId: number;
    employeeId: number;
    location: LocationPayload;
    occurredAt: Date;
  }): Promise<AttendanceWarning[]> {
    const [last] = await db
      .select({
        occurredAt: attendanceEventsTable.occurredAt,
        locationJson: attendanceEventsTable.locationJson,
      })
      .from(attendanceEventsTable)
      .where(
        and(
          eq(attendanceEventsTable.workspaceId, params.workspaceId),
          eq(attendanceEventsTable.employeeId, params.employeeId),
        ),
      )
      .orderBy(desc(attendanceEventsTable.occurredAt))
      .limit(1);

    if (!last?.locationJson) return [];

    try {
      const prev = JSON.parse(last.locationJson) as LocationPayload;
      if (prev.lat == null || prev.lng == null) return [];

      const minutes =
        (params.occurredAt.getTime() - last.occurredAt.getTime()) / 60000;
      if (minutes <= 0 || minutes > 30) return [];

      const dist = haversineMeters(prev.lat, prev.lng, params.lat, params.lng);
      const kmh = dist / 1000 / (minutes / 60);
      if (kmh > 200) {
        return [
          {
            code: "suspicious_velocity",
            message: `Unusual movement speed (~${Math.round(kmh)} km/h since last punch)`,
            severity: "warning",
          },
        ];
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  detectMissingClockOut(params: {
    hasClockIn: boolean;
    hasClockOut: boolean;
    localHour: number;
  }): AttendanceWarning[] {
    if (params.hasClockIn && !params.hasClockOut && params.localHour >= 18) {
      return [
        {
          code: "missing_clock_out",
          message: "Clock-in recorded but no clock-out yet",
          severity: "info",
        },
      ];
    }
    return [];
  }

  mergeWarnings(...groups: AttendanceWarning[][]): AttendanceWarning[] {
    const seen = new Set<string>();
    const out: AttendanceWarning[] = [];
    for (const g of groups) {
      for (const w of g) {
        if (seen.has(w.code)) continue;
        seen.add(w.code);
        out.push(w);
      }
    }
    return out;
  }

  async notifyWarnings(params: {
    workspaceId: number;
    userId: number;
    warnings: AttendanceWarning[];
    eventType: string;
  }): Promise<void> {
    if (params.warnings.length === 0) return;
    const critical = params.warnings.some((w) => w.severity === "critical");
    await dispatchUserNotification({
      workspaceId: params.workspaceId,
      userId: params.userId,
      type: critical ? "attendance_clock_warning" : "attendance_clock_flag",
      title: "Attendance clock notice",
      message: params.warnings.map((w) => w.message).join("; "),
      enqueueEmail: false,
    });
  }
}

export const attendanceWarningService = new AttendanceWarningService();
