import { db } from "@workspace/db";
import { attendanceGeofencesTable, employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { AttendancePolicyConfig } from "./policy-types";

export type LocationPayload = {
  lat: number;
  lng: number;
  accuracyM?: number;
  capturedAt?: string;
  provider?: string;
};

export type GeofenceValidationResult = {
  valid: boolean;
  withinGeofence: boolean | null;
  distanceMeters: number | null;
  matchedGeofenceId: number | null;
  accuracyBufferM: number;
  warnings: Array<{ code: string; message: string }>;
  shouldReject: boolean;
};

/** Haversine distance in meters (WGS84). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export class GeofenceValidationService {
  accuracyBuffer(accuracyM?: number): number {
    return Math.max(50, (accuracyM ?? 50) * 2);
  }

  async resolveGeofencesForEmployee(
    workspaceId: number,
    employeeId: number,
  ): Promise<Array<typeof attendanceGeofencesTable.$inferSelect>> {
    const [emp] = await db
      .select({ workLocationId: employeesTable.workLocationId })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);

    const conditions = [
      eq(attendanceGeofencesTable.workspaceId, workspaceId),
      eq(attendanceGeofencesTable.isActive, true),
    ];

    const all = await db
      .select()
      .from(attendanceGeofencesTable)
      .where(and(...conditions));

    if (!emp?.workLocationId) return all;

    const forLocation = all.filter((g) => g.workLocationId === emp.workLocationId);
    return forLocation.length > 0 ? forLocation : all;
  }

  validateAgainstGeofences(
    location: LocationPayload | null | undefined,
    geofences: Array<{ id: number; latitude: number; longitude: number; radiusMeters: number }>,
    policy: AttendancePolicyConfig,
  ): GeofenceValidationResult {
    const warnings: Array<{ code: string; message: string }> = [];
    const buffer = this.accuracyBuffer(location?.accuracyM);

    if (!location?.lat || !location?.lng) {
      if (policy.geofenceRequired) {
        warnings.push({ code: "location_missing", message: "Location required for clock" });
        return {
          valid: policy.suspiciousLocationAction !== "reject",
          withinGeofence: null,
          distanceMeters: null,
          matchedGeofenceId: null,
          accuracyBufferM: buffer,
          warnings,
          shouldReject: policy.suspiciousLocationAction === "reject",
        };
      }
      return {
        valid: true,
        withinGeofence: null,
        distanceMeters: null,
        matchedGeofenceId: null,
        accuracyBufferM: buffer,
        warnings,
        shouldReject: false,
      };
    }

    if (location.accuracyM != null && location.accuracyM > policy.minAccuracyMeters) {
      warnings.push({
        code: "low_accuracy",
        message: `GPS accuracy ${Math.round(location.accuracyM)}m exceeds threshold ${policy.minAccuracyMeters}m`,
      });
    }

    if (geofences.length === 0) {
      return {
        valid: true,
        withinGeofence: null,
        distanceMeters: null,
        matchedGeofenceId: null,
        accuracyBufferM: buffer,
        warnings,
        shouldReject: false,
      };
    }

    let best: { id: number; distance: number } | null = null;
    for (const g of geofences) {
      const d = haversineMeters(location.lat, location.lng, g.latitude, g.longitude);
      if (!best || d < best.distance) best = { id: g.id, distance: d };
    }

    if (!best) {
      return {
        valid: true,
        withinGeofence: null,
        distanceMeters: null,
        matchedGeofenceId: null,
        accuracyBufferM: buffer,
        warnings,
        shouldReject: false,
      };
    }

    const matched = geofences.find((g) => g.id === best!.id)!;
    const allowed = matched.radiusMeters + buffer;
    const within = best.distance <= allowed;

    if (!within) {
      warnings.push({
        code: "out_of_geofence",
        message: `Outside geofence by ${Math.round(best.distance - matched.radiusMeters)}m (allowed ${matched.radiusMeters}m + buffer)`,
      });
    }

    const shouldReject =
      !within &&
      policy.geofenceRequired &&
      policy.suspiciousLocationAction === "reject";

    return {
      valid: !shouldReject,
      withinGeofence: within,
      distanceMeters: Math.round(best.distance),
      matchedGeofenceId: best.id,
      accuracyBufferM: buffer,
      warnings,
      shouldReject,
    };
  }

  async validateEmployeeClock(params: {
    workspaceId: number;
    employeeId: number;
    location?: LocationPayload | null;
    policy: AttendancePolicyConfig;
  }): Promise<GeofenceValidationResult> {
    const geofences = await this.resolveGeofencesForEmployee(params.workspaceId, params.employeeId);
    return this.validateAgainstGeofences(params.location, geofences, params.policy);
  }
}

export const geofenceValidationService = new GeofenceValidationService();
