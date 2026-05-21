/**
 * P18-D4 — Leave cutover flags with pilot workspace scoping.
 * P-HCM2 — Workspace leave_runtime_mode merges effective flags (legacy | transition | canonical).
 */

import type { LeaveRuntimeMode } from "./hr/hcm-workspace-settings";

export type LeaveCutoverFlagKey =
  | "canonicalLeaveRead"
  | "canonicalLeaveSubmit"
  | "canonicalLeaveApprove"
  | "legacyLeaveFreeze";

export type LeaveCutoverFlags = Record<LeaveCutoverFlagKey, boolean>;

const ENV_MAP: Record<LeaveCutoverFlagKey, string> = {
  canonicalLeaveRead: "CANONICAL_LEAVE_READ",
  canonicalLeaveSubmit: "CANONICAL_LEAVE_SUBMIT",
  canonicalLeaveApprove: "CANONICAL_LEAVE_APPROVE",
  legacyLeaveFreeze: "LEGACY_LEAVE_FREEZE",
};

const PILOT_ENV = "LEAVE_CUTOVER_PILOT_WORKSPACE_ID";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getLeaveCutoverFlags(
  env: Record<string, string | undefined> = process.env,
): LeaveCutoverFlags {
  return {
    canonicalLeaveRead: parseEnvBool(env[ENV_MAP.canonicalLeaveRead]),
    canonicalLeaveSubmit: parseEnvBool(env[ENV_MAP.canonicalLeaveSubmit]),
    canonicalLeaveApprove: parseEnvBool(env[ENV_MAP.canonicalLeaveApprove]),
    legacyLeaveFreeze: parseEnvBool(env[ENV_MAP.legacyLeaveFreeze]),
  };
}

export function getLeavePilotWorkspaceId(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env[PILOT_ENV];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isLeavePilotWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!workspaceId) return false;
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return true;
  const pilotId = getLeavePilotWorkspaceId(env);
  return pilotId !== null && workspaceId === pilotId;
}

/** Flag is ON in env AND workspace is the pilot workspace. */
export function isLeaveCutoverEnabledForWorkspace(
  key: LeaveCutoverFlagKey,
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isLeavePilotWorkspace(workspaceId, env)) return false;
  return getLeaveCutoverFlags(env)[key];
}

export function isLeaveCutoverFlagEnabled(
  key: LeaveCutoverFlagKey,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getLeaveCutoverFlags(env)[key];
}

export function leaveCutoverStatusForWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const flags = getLeaveCutoverFlags(env);
  const pilotWorkspaceId = getLeavePilotWorkspaceId(env);
  const isPilot = isLeavePilotWorkspace(workspaceId, env);
  return {
    pilotWorkspaceId,
    isPilotWorkspace: isPilot,
    globalFlags: flags,
    canonicalSubmit: isPilot && flags.canonicalLeaveSubmit,
    canonicalApprove: isPilot && flags.canonicalLeaveApprove,
    legacyFreeze: isPilot && flags.legacyLeaveFreeze,
    canonicalRead: isPilot && flags.canonicalLeaveRead,
    leaveRuntimeMode: "transition" as LeaveRuntimeMode,
    workspaceDriven: false,
  };
}

/** Effective cutover flags after workspace leave_runtime_mode (P-HCM2). */
export function resolveLeaveCutoverStatus(
  workspaceId: number | null | undefined,
  leaveRuntimeMode: LeaveRuntimeMode,
  env: Record<string, string | undefined> = process.env,
) {
  const base = leaveCutoverStatusForWorkspace(workspaceId, env);

  if (leaveRuntimeMode === "canonical") {
    return {
      ...base,
      leaveRuntimeMode,
      workspaceDriven: true,
      isPilotWorkspace: true,
      canonicalSubmit: true,
      canonicalApprove: true,
      canonicalRead: true,
      legacyFreeze: true,
    };
  }

  if (leaveRuntimeMode === "transition") {
    return {
      ...base,
      leaveRuntimeMode,
      workspaceDriven: !base.canonicalSubmit,
      canonicalSubmit: true,
      canonicalApprove: true,
      canonicalRead: true,
      legacyFreeze: base.legacyFreeze,
    };
  }

  return {
    ...base,
    leaveRuntimeMode: "legacy" as const,
    workspaceDriven: false,
  };
}

export function leaveCutoverFlagsSnapshot(
  env: Record<string, string | undefined> = process.env,
): { flags: LeaveCutoverFlags; envKeys: typeof ENV_MAP; pilotEnvKey: string } {
  return { flags: getLeaveCutoverFlags(env), envKeys: ENV_MAP, pilotEnvKey: PILOT_ENV };
}
