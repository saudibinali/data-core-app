/**
 * P18-D4 — Frontend leave cutover flags (pilot-scoped via API status).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";

export type LeaveCutoverFlagKey =
  | "canonicalLeaveRead"
  | "canonicalLeaveSubmit"
  | "canonicalLeaveApprove"
  | "legacyLeaveFreeze";

export type LeaveCutoverFlags = Record<LeaveCutoverFlagKey, boolean>;

export type LeaveRuntimeMode = "legacy" | "transition" | "canonical";

export type LeaveCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  globalFlags: LeaveCutoverFlags;
  canonicalSubmit: boolean;
  canonicalApprove: boolean;
  legacyFreeze: boolean;
  canonicalRead: boolean;
  canonicalWriteEnabled?: boolean;
  leaveRuntimeMode?: LeaveRuntimeMode;
  workspaceDriven?: boolean;
};

function parseViteBool(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Build-time globals (default OFF). Effective pilot flags come from API. */
export function getLeaveCutoverFlags(): LeaveCutoverFlags {
  const e = import.meta.env;
  return {
    canonicalLeaveRead: parseViteBool(e.VITE_CANONICAL_LEAVE_READ),
    canonicalLeaveSubmit: parseViteBool(e.VITE_CANONICAL_LEAVE_SUBMIT),
    canonicalLeaveApprove: parseViteBool(e.VITE_CANONICAL_LEAVE_APPROVE),
    legacyLeaveFreeze: parseViteBool(e.VITE_LEGACY_LEAVE_FREEZE),
  };
}

export async function fetchLeaveCutoverStatus(): Promise<LeaveCutoverStatus> {
  const res = await apiClient.get<LeaveCutoverStatus>("/api/hr/leave-cutover/status");
  return res.data;
}

export function useLeaveCutover() {
  const q = useQuery({
    queryKey: ["/hr/leave-cutover/status"],
    queryFn: fetchLeaveCutoverStatus,
    staleTime: 60_000,
  });
  const status = q.data;
  return {
    ...q,
    status,
    isPilotWorkspace: status?.isPilotWorkspace ?? false,
    useCanonicalSubmit: status?.canonicalSubmit ?? false,
    useCanonicalApprove: status?.canonicalApprove ?? false,
    legacyFrozen: status?.legacyFreeze ?? false,
    pilotWorkspaceId: status?.pilotWorkspaceId ?? null,
  };
}

export function isCanonicalLeaveApprovalUiEnabled(status?: LeaveCutoverStatus): boolean {
  return status?.canonicalApprove ?? false;
}
