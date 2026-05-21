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

import { useQuery } from "@tanstack/react-query";
import { useAppAuth } from "./auth";
import type { PlatformPermissionCode } from "./platform-permissions-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurrentPlatformUserData {
  id: number;
  email: string | null;
  displayName: string;
  role: string;
  workspaceId: number | null;
  platformRoleCode: string | null;
  effectivePlatformRoleCode: string;
  isRootOwner: boolean;
  isProtected: boolean;
  permissions: PlatformPermissionCode[];
}

// ── Hook: useCurrentPlatformUser ──────────────────────────────────────────────

export function useCurrentPlatformUser() {
  const { user, isSignedIn } = useAppAuth();

  const isPlatformUser =
    isSignedIn &&
    user?.role === "super_admin" &&
    (user?.workspaceId == null || user?.workspaceId === null);

  return useQuery<CurrentPlatformUserData, Error>({
    queryKey: ["platform", "me"],
    queryFn: async () => {
      const token = (() => {
        try { return localStorage.getItem("ops_access_token"); } catch { return null; }
      })();
      const r = await fetch("/api/platform/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(
          typeof body["error"] === "string"
            ? body["error"]
            : "Failed to load platform user context",
        );
      }
      return r.json() as Promise<CurrentPlatformUserData>;
    },
    enabled: isPlatformUser,
    staleTime: 60_000,
    gcTime: 120_000,
    retry: 1,
  });
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
