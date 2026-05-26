/**
 * platform-me-hooks.ts
 *
 * @phase P14-C - Platform Access Boundary & Route Guards
 *
 * React hooks for the current platform user's rich context from GET /platform/me.
 *
 * For lightweight permission checks in navigation / button visibility,
 * prefer useAppAuth() + platform-access.ts helpers (no extra network call).
 *
 * Use these hooks when components explicitly need the permissions[] array
 * or effectivePlatformRoleCode from the server.
 *
 * Safety:
 *   - Read-only. No profile mutations.
 *   - Only enabled when current user is a platform user.
 *   - 1-minute stale time to avoid hammering the endpoint.
 */

import {
  useGetPlatformMe,
  type PlatformMe,
} from "@workspace/api-client-react";
import { useAppAuth } from "./auth";
import type { PlatformPermissionCode } from "./platform-permissions-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CurrentPlatformUserData = PlatformMe & {
  permissions: PlatformPermissionCode[];
};

// ── Hook: useCurrentPlatformUser ──────────────────────────────────────────────

export function useCurrentPlatformUser() {
  const { user, isSignedIn } = useAppAuth();

  const isPlatformUser =
    isSignedIn &&
    user?.role === "super_admin" &&
    (user?.workspaceId == null || user?.workspaceId === null);

  const query = useGetPlatformMe({
    query: {
      enabled: isPlatformUser,
      staleTime: 60_000,
      gcTime: 120_000,
      retry: 1,
    },
  });

  return {
    ...query,
    data: query.data
      ? ({
          ...query.data,
          permissions: query.data.permissions as PlatformPermissionCode[],
        } satisfies CurrentPlatformUserData)
      : undefined,
  };
}

// ── Hook: useCurrentPlatformPermissions ───────────────────────────────────────

export function useCurrentPlatformPermissions(): {
  permissions: Set<PlatformPermissionCode>;
  isReady: boolean;
} {
  const { data, isSuccess } = useCurrentPlatformUser();
  return {
    permissions: isSuccess && data ? new Set(data.permissions) : new Set(),
    isReady: isSuccess,
  };
}
