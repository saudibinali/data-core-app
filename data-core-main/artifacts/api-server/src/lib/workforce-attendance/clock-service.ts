import { attendancePolicyService } from "./attendance-policy-service";
import { geofenceValidationService, type LocationPayload } from "./geofence-validation-service";
import { attendanceWarningService, type AttendanceWarning } from "./attendance-warning-service";
import { processIngestedEvent, type ProcessIngestResult } from "./pipeline";
import { logAttendanceAccess } from "./access-log";

export type ClockLocationInput = {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  capturedAt?: string;
  provider?: string;
};

function normalizeLocation(input?: ClockLocationInput | null): LocationPayload | null {
  if (input?.lat == null || input?.lng == null) return null;
  return {
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    provider: input.provider ?? "browser",
  };
}

export async function executeWebClock(params: {
  workspaceId: number;
  employeeId: number;
  userId: number;
  eventType: "clock_in" | "clock_out";
  location?: ClockLocationInput | null;
  ipAddress?: string;
}): Promise<ProcessIngestResult & { warnings: AttendanceWarning[] }> {
  const occurredAt = new Date();
  const { config: policy } = await attendancePolicyService.getDefaultPolicy(params.workspaceId);
  const location = normalizeLocation(params.location);

  if (!location && !policy.allowRemoteClock && policy.geofenceRequired) {
    throw new Error("Location required for clock");
  }

  const geo = await geofenceValidationService.validateEmployeeClock({
    workspaceId: params.workspaceId,
    employeeId: params.employeeId,
    location,
    policy,
  });

  const geoWarnings: AttendanceWarning[] = geo.warnings.map((w) => ({
    code: w.code,
    message: w.message,
    severity: w.code === "out_of_geofence" ? "warning" : "info",
  }));

  const dupWarnings = await attendanceWarningService.detectDuplicateClock({
    workspaceId: params.workspaceId,
    employeeId: params.employeeId,
    eventType: params.eventType,
    policy,
    occurredAt,
  });

  const velocityWarnings = location
    ? await attendanceWarningService.detectSuspiciousVelocity({
        workspaceId: params.workspaceId,
        employeeId: params.employeeId,
        location,
        occurredAt,
      })
    : [];

  const warnings = attendanceWarningService.mergeWarnings(
    geoWarnings,
    dupWarnings,
    velocityWarnings,
  );

  if (geo.shouldReject) {
    throw new Error(geo.warnings.map((w) => w.message).join("; ") || "Clock rejected by geofence policy");
  }

  const { getWorkspaceTimezone } = await import("./calendar-context");
  const timezone = await getWorkspaceTimezone(params.workspaceId);

  const result = await processIngestedEvent(
    {
      workspaceId: params.workspaceId,
      sourceCode: "web",
      employeeId: params.employeeId,
      eventTypeHint: params.eventType,
      occurredAt,
      timezone,
      payload: {
        eventType: params.eventType,
        location,
        userId: params.userId,
        warnings,
        geofence: {
          withinGeofence: geo.withinGeofence,
          distanceMeters: geo.distanceMeters,
          matchedGeofenceId: geo.matchedGeofenceId,
        },
        privacy: { punchTimeOnly: true, noBackgroundTracking: true },
      },
      createdByUserId: params.userId,
    },
    { createdByUserId: params.userId, ipAddress: params.ipAddress },
  );

  if (warnings.length > 0) {
    await attendanceWarningService.notifyWarnings({
      workspaceId: params.workspaceId,
      userId: params.userId,
      warnings,
      eventType: params.eventType,
    });
  }

  logAttendanceAccess({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: params.eventType,
    resourceType: "attendance_raw_event",
    resourceId: result.rawEventId,
    ipAddress: params.ipAddress,
    metadata: { warningCount: warnings.length },
  });

  return { ...result, warnings };
}
