/**
 * F5.2 — Effective canonical leave write policy (env + workspace mode).
 */

import {
  isLeaveCutoverEnabledForWorkspace,
  resolveLeaveCutoverStatus,
} from "../leave-cutover-flags";
import { getLeaveRuntimeMode } from "../hr/hcm-workspace-settings";

const LEAVE_CANONICAL_WRITE_ENV = "LEAVE_CANONICAL_WRITE";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return v === "1" || v === "true" || v === "yes";
}

/** Global kill-switch: LEAVE_CANONICAL_WRITE=false restores legacy write path. */
export function isLeaveCanonicalWriteEnvEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseEnvBool(env[LEAVE_CANONICAL_WRITE_ENV]);
}

export async function getEffectiveLeaveCutoverStatus(
  workspaceId: number,
  env: Record<string, string | undefined> = process.env,
) {
  const mode = await getLeaveRuntimeMode(workspaceId);
  const status = resolveLeaveCutoverStatus(workspaceId, mode, env);
  if (!isLeaveCanonicalWriteEnvEnabled(env)) {
    return {
      ...status,
      canonicalSubmit: false,
      canonicalApprove: false,
      canonicalRead: status.canonicalRead,
      legacyFreeze: false,
      canonicalWriteEnabled: false,
    };
  }
  return { ...status, canonicalWriteEnabled: true };
}

export async function shouldUseCanonicalLeaveSubmit(
  workspaceId: number,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const status = await getEffectiveLeaveCutoverStatus(workspaceId, env);
  return status.canonicalSubmit;
}

export async function shouldMirrorCanonicalToLegacy(
  workspaceId: number,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!isLeaveCanonicalWriteEnvEnabled(env)) return false;
  const mode = await getLeaveRuntimeMode(workspaceId);
  if (mode === "canonical" || mode === "transition") return true;
  return isLeaveCutoverEnabledForWorkspace("canonicalLeaveSubmit", workspaceId, env);
}
