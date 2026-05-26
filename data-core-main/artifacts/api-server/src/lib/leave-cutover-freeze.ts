import type { Response } from "express";
import type { AuthRequest } from "../middlewares/requireAuth";
import { isLeaveCutoverEnabledForWorkspace } from "./leave-cutover-flags";
import { incrementLeaveMetric } from "./leave-cutover-metrics";
import { getLeaveRuntimeMode } from "./hr/hcm-workspace-settings";
import { isLeaveCanonicalWriteEnvEnabled } from "./leave/canonical-write-policy";

export const LEGACY_LEAVE_FROZEN_CODE = "LEGACY_LEAVE_FROZEN";

export async function isLegacyLeaveFrozenForWorkspace(
  workspaceId: number | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false;
  if (!isLeaveCanonicalWriteEnvEnabled()) return false;
  if (isLeaveCutoverEnabledForWorkspace("legacyLeaveFreeze", workspaceId)) return true;
  const mode = await getLeaveRuntimeMode(workspaceId);
  return mode === "canonical";
}

export function sendLegacyLeaveFrozenResponse(res: Response): void {
  res.status(410).json({
    error:
      "Legacy leave writes are frozen for this workspace. Use the canonical leave API instead.",
    code: LEGACY_LEAVE_FROZEN_CODE,
    canonicalEndpoints: {
      submit: "POST /hr/leave-requests",
      approve: "PATCH /hr/leave-requests/:id/approve",
      reject: "PATCH /hr/leave-requests/:id/reject",
      withdraw: "PATCH /hr/leave-requests/:id/withdraw",
    },
  });
}

/** Returns false when response was sent (frozen). */
export async function assertLegacyLeaveWriteAllowed(
  req: AuthRequest,
  res: Response,
  kind: "submit" | "patch" = "submit",
): Promise<boolean> {
  if (!req.workspaceId) return true;
  if (!(await isLegacyLeaveFrozenForWorkspace(req.workspaceId))) return true;
  incrementLeaveMetric(kind === "patch" ? "legacy_patch_blocked_410" : "legacy_submit_blocked_410");
  sendLegacyLeaveFrozenResponse(res);
  return false;
}
