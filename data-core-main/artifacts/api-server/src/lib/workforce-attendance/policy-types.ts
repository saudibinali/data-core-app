/** P20-D — Attendance policy JSON shape */

export type AttendancePolicyConfig = {
  geofenceRequired: boolean;
  allowRemoteClock: boolean;
  suspiciousLocationAction: "flag" | "reject" | "review";
  minAccuracyMeters: number;
  graceMinutes: number;
  duplicateWindowSeconds: number;
};

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicyConfig = {
  geofenceRequired: false,
  allowRemoteClock: true,
  suspiciousLocationAction: "flag",
  minAccuracyMeters: 100,
  graceMinutes: 15,
  duplicateWindowSeconds: 60,
};

export function parsePolicyJson(raw: string | null | undefined): AttendancePolicyConfig {
  if (!raw) return { ...DEFAULT_ATTENDANCE_POLICY };
  try {
    const parsed = JSON.parse(raw) as Partial<AttendancePolicyConfig>;
    return { ...DEFAULT_ATTENDANCE_POLICY, ...parsed };
  } catch {
    return { ...DEFAULT_ATTENDANCE_POLICY };
  }
}
