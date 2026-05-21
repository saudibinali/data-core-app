/**
 * @phase P17-F - Unified Platform Users Console hooks
 */

import { useQuery } from "@tanstack/react-query";
import { PLATFORM_USERS_CONSOLE_API } from "./platform-users-console-config";

export {
  usePlatformUsers,
  usePlatformUser,
  useCreatePlatformUser,
  useUpdatePlatformUserProfile,
  useUpdatePlatformUserStatus,
  useUpdatePlatformUserRole,
  type PlatformUserProfile,
  type PlatformUsersListParams,
} from "./platform-users-hooks";

export {
  usePlatformUserPermissions,
  usePlatformPermissionCatalog,
  usePatchPermissionOverride,
  useClearPermissionOverride,
} from "./platform-user-permissions-hooks";

export {
  usePlatformUserInvitations,
  useCreatePlatformInvitation,
  useResendPlatformInvitation,
  useRevokePlatformInvitation,
} from "./platform-user-invitations-hooks";

export {
  useAccessReviewSummary as usePlatformAccessReviewSummary,
  useUserAccessReview as usePlatformUserAccessReview,
  useAccessReviewAuditEvents as usePlatformUserAuditEvents,
  useRecordAccessReview,
} from "./platform-access-review-hooks";

function getAuthToken(): string | null {
  return localStorage.getItem("ops_access_token");
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface PlatformUserDirectoryRow {
  userId: string;
  customOverridesCount: number;
  riskLevel: string | null;
  invitationStatus: string | null;
  lastReviewedAt: string | null;
}

export interface PlatformUsersConsoleSummary {
  totalPlatformUsers: number;
  active: number;
  invited: number;
  suspendedDisabled: number;
  protectedUsers: number;
  usersWithCustomOverrides: number;
  pendingInvitations: number;
  highRiskUsers: number;
  directory: PlatformUserDirectoryRow[];
  generatedAt: string;
}

export function usePlatformUsersConsoleSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "users", "console-summary"],
    queryFn: () => getJson<PlatformUsersConsoleSummary>(PLATFORM_USERS_CONSOLE_API.summary),
    enabled,
    staleTime: 30_000,
  });
}

export interface PlatformUserConsoleData {
  profile: Record<string, unknown>;
  permissionSummary: {
    rolePermissions: string[];
    grantedOverrides: string[];
    deniedOverrides: string[];
    effectivePermissions: string[];
    customOverridesCount: number;
    restrictedByProtection: boolean;
  };
  protectionSummary: {
    protectionReasons: string[];
    policySnapshot: Record<string, unknown>;
    blockedActions: Array<{ action: string; blockedReason: string }>;
  };
  invitationSummary: {
    latestStatus: string | null;
    pendingCount: number;
    invitations: Array<{
      id: number;
      status: string;
      expiresAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }>;
  };
  accessReviewSummary: {
    riskLevel: string;
    criticalPermissions: string[];
    reviewStatus: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
  } | null;
  recentAuditEvents: Array<{
    id: number;
    action: string;
    actionLabel: string;
    severity: string;
    result: string | null;
    blockedReason: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
}

export function usePlatformUserConsole(userId: string | null, enabled: boolean) {
  return useQuery<PlatformUserConsoleData>({
    queryKey: ["platform", "users", userId, "console"],
    queryFn: () => getJson<PlatformUserConsoleData>(PLATFORM_USERS_CONSOLE_API.userConsole(userId!)),
    enabled: enabled && Boolean(userId),
    staleTime: 15_000,
  });
}
