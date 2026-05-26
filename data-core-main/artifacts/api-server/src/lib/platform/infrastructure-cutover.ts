/**
 * P-STA — Infrastructure cutover flags (legacy write freeze, pilot scoping).
 * Mirrors leave-cutover pattern for payroll/attendance legacy HR routes.
 */
import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/requireAuth";
import {
  getLeavePilotWorkspaceId,
  isLeavePilotWorkspace,
  leaveCutoverStatusForWorkspace,
} from "../leave-cutover-flags";
import {
  isPayrollCutoverEnabledForWorkspace,
  payrollCutoverStatusForWorkspace,
} from "../payroll-cutover-flags";
import {
  attendanceCutoverStatusForWorkspace,
  isAttendanceCutoverEnabledForWorkspace,
} from "../attendance-cutover-flags";

const PILOT_ENV = "PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function stabilizationPilotWorkspaceId(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env[PILOT_ENV] ?? env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isStabilizationPilotWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!workspaceId) return false;
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return true;
  const pilotId = stabilizationPilotWorkspaceId(env);
  if (pilotId !== null) return workspaceId === pilotId;
  return isLeavePilotWorkspace(workspaceId, env);
}

function isLegacyFreezeEnabled(
  freezeEnvKey: string,
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!parseEnvBool(env[freezeEnvKey])) return false;
  return isStabilizationPilotWorkspace(workspaceId, env);
}

export function isLegacyPayrollFrozen(workspaceId: number | null | undefined): boolean {
  if (isLegacyFreezeEnabled("LEGACY_PAYROLL_FREEZE", workspaceId)) return true;
  return isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", workspaceId);
}

export function isLegacyAttendanceFrozen(workspaceId: number | null | undefined): boolean {
  if (isLegacyFreezeEnabled("LEGACY_ATTENDANCE_FREEZE", workspaceId)) return true;
  return isAttendanceCutoverEnabledForWorkspace("attendanceCanonicalWrite", workspaceId);
}

function sendLegacyFrozen(
  res: Response,
  code: string,
  message: string,
  canonicalEndpoints: Record<string, string>,
): void {
  res.status(410).json({ error: message, code, canonicalEndpoints });
}

export function assertLegacyPayrollWriteAllowed(req: AuthRequest, res: Response): boolean {
  if (!req.workspaceId || !isLegacyPayrollFrozen(req.workspaceId)) return true;
  sendLegacyFrozen(res, "LEGACY_PAYROLL_FROZEN", "Legacy HR payroll writes are frozen. Use canonical payroll APIs.", {
    listRuns: "GET /hr/payroll/canonical/runs",
    createRun: "POST /hr/payroll/canonical/runs",
    ops: "GET /hr/payroll/ops/overview",
  });
  return false;
}

export function assertLegacyAttendanceWriteAllowed(req: AuthRequest, res: Response): boolean {
  if (!req.workspaceId || !isLegacyAttendanceFrozen(req.workspaceId)) return true;
  sendLegacyFrozen(res, "LEGACY_ATTENDANCE_FROZEN", "Legacy HR attendance writes are frozen. Use workforce attendance APIs.", {
    clock: "POST /hr/workforce/clock",
    events: "GET /hr/workforce/events",
    imports: "POST /hr/workforce/imports",
  });
  return false;
}

export function infrastructureCutoverStatus(workspaceId: number | null | undefined) {
  const leave = leaveCutoverStatusForWorkspace(workspaceId);
  const payroll = payrollCutoverStatusForWorkspace(workspaceId);
  const attendance = attendanceCutoverStatusForWorkspace(workspaceId);
  return {
    pilotWorkspaceId: stabilizationPilotWorkspaceId(),
    allWorkspacesMode: parseEnvBool(process.env.PLATFORM_STABILIZATION_ALL_WORKSPACES),
    leave,
    payroll,
    attendance,
    legacyPayrollFrozen: isLegacyPayrollFrozen(workspaceId),
    legacyAttendanceFrozen: isLegacyAttendanceFrozen(workspaceId),
    envKeys: {
      pilot: PILOT_ENV,
      payrollFreeze: "LEGACY_PAYROLL_FREEZE",
      payrollCanonicalWrite: "PAYROLL_CANONICAL_WRITE",
      attendanceFreeze: "LEGACY_ATTENDANCE_FREEZE",
      attendanceCanonicalWrite: "ATTENDANCE_CANONICAL_WRITE",
      leavePilot: "LEAVE_CUTOVER_PILOT_WORKSPACE_ID",
      allWorkspaces: "PLATFORM_STABILIZATION_ALL_WORKSPACES",
    },
  };
}
