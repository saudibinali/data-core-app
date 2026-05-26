/**
 * F6.2 — Attendance canonical cutover flags (pilot-scoped, env-driven).
 * ATTENDANCE_CANONICAL_WRITE=false → rollback manual legacy hr_attendance UI/writes.
 * LEGACY_ATTENDANCE_FREEZE=true → block legacy POST/PATCH/bulk/import on hr_attendance.
 */

export type AttendanceCutoverFlagKey = "attendanceCanonicalWrite" | "legacyAttendanceFreeze";

export type AttendanceCutoverFlags = Record<AttendanceCutoverFlagKey, boolean>;

const ENV_MAP: Record<AttendanceCutoverFlagKey, string> = {
  attendanceCanonicalWrite: "ATTENDANCE_CANONICAL_WRITE",
  legacyAttendanceFreeze: "LEGACY_ATTENDANCE_FREEZE",
};

const PILOT_ENV = "ATTENDANCE_CUTOVER_PILOT_WORKSPACE_ID";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getAttendanceCutoverFlags(
  env: Record<string, string | undefined> = process.env,
): AttendanceCutoverFlags {
  return {
    attendanceCanonicalWrite: parseEnvBool(env[ENV_MAP.attendanceCanonicalWrite]),
    legacyAttendanceFreeze: parseEnvBool(env[ENV_MAP.legacyAttendanceFreeze]),
  };
}

export function getAttendancePilotWorkspaceId(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw =
    env[PILOT_ENV]
    ?? env.PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID
    ?? env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isAttendancePilotWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!workspaceId) return false;
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return true;
  const pilotId = getAttendancePilotWorkspaceId(env);
  return pilotId !== null && workspaceId === pilotId;
}

export function isAttendanceCutoverEnabledForWorkspace(
  key: AttendanceCutoverFlagKey,
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isAttendancePilotWorkspace(workspaceId, env)) return false;
  return getAttendanceCutoverFlags(env)[key];
}

export type AttendanceCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  globalFlags: AttendanceCutoverFlags;
  attendanceCanonicalWrite: boolean;
  legacyAttendanceFrozen: boolean;
  legacyAttendanceReadOnly: boolean;
  canonicalWriteEnabled: boolean;
  workforceImportPath: string;
  workforceClockPath: string;
};

export function attendanceCutoverStatusForWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): AttendanceCutoverStatus {
  const flags = getAttendanceCutoverFlags(env);
  const pilotWorkspaceId = getAttendancePilotWorkspaceId(env);
  const isPilot = isAttendancePilotWorkspace(workspaceId, env);
  const attendanceCanonicalWrite = isPilot && flags.attendanceCanonicalWrite;
  const legacyAttendanceFrozen = isPilot && flags.legacyAttendanceFreeze;
  const legacyAttendanceReadOnly = legacyAttendanceFrozen || attendanceCanonicalWrite;
  return {
    pilotWorkspaceId,
    isPilotWorkspace: isPilot,
    globalFlags: flags,
    attendanceCanonicalWrite,
    legacyAttendanceFrozen,
    legacyAttendanceReadOnly,
    canonicalWriteEnabled: attendanceCanonicalWrite,
    workforceImportPath: "POST /hr/workforce/imports/dry-run",
    workforceClockPath: "POST /hr/workforce/clock-in",
  };
}
