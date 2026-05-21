/**
 * platform-permission-route.tsx
 *
 * @phase P14-C - Platform Access Boundary & Route Guards
 *
 * Exports:
 *   - PlatformAccessDenied - reusable access-denied message (full + compact)
 *   - PlatformPermissionRoute - route guard using auth context (no extra network call)
 *
 * SuperAdminRoute in App.tsx remains intact for backward compatibility.
 * PlatformPermissionRoute adds granular permission gating within the platform zone.
 *
 * Safety:
 *   - Never exposes stack traces, DB names, or internal policy details.
 *   - Clear English messages on every denied state.
 *   - Backend remains the authoritative source of authorization.
 */

import React from "react";
import { ShieldOff, Lock } from "lucide-react";
import { useAppAuth } from "@/lib/auth";
import {
  hasPlatformPermissionClient,
  hasAnyPlatformPermissionClient,
  hasAllPlatformPermissionsClient,
} from "@/lib/platform-access";
import type { PlatformPermissionCode } from "@/lib/platform-permissions-config";

// ── PlatformAccessDenied ──────────────────────────────────────────────────────

interface PlatformAccessDeniedProps {
  requiredPermission?: PlatformPermissionCode;
  message?: string;
  compact?: boolean;
}

/**
 * Access-denied UI - two variants:
 *   compact=false (default) - centred card with icon + message
 *   compact=true            - inline row for embedding inside panels
 */
export function PlatformAccessDenied({
  requiredPermission,
  message,
  compact = false,
}: PlatformAccessDeniedProps) {
  if (compact) {
    return (
      <div
        data-testid="platform-access-denied-compact"
        className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border text-xs text-muted-foreground"
      >
        <Lock className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden="true" />
        <span>
          {message ?? "This action is restricted."}
        </span>
        {requiredPermission && (
          <code className="ml-1 font-mono text-[10px] opacity-60 bg-muted px-1 rounded">
            {requiredPermission}
          </code>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="platform-access-denied"
      className="flex flex-col items-center justify-center gap-4 py-14 px-6 text-center"
      role="alert"
      aria-live="polite"
    >
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <ShieldOff className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="space-y-1.5 max-w-sm">
        <p className="font-semibold text-foreground">
          Access Denied
        </p>
        <p className="text-sm text-muted-foreground">
          {message ?? "You do not have permission to view this content."}
        </p>
        {requiredPermission && (
          <p className="text-xs text-muted-foreground mt-2" data-testid="platform-access-denied-code">
            Required permission:{" "}
            <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
              {requiredPermission}
            </code>
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Contact the platform owner if you need access.
      </p>
    </div>
  );
}

// ── PlatformPermissionRoute ───────────────────────────────────────────────────

interface PlatformPermissionRouteProps {
  /** Require exactly this one permission. */
  permission?: PlatformPermissionCode;
  /** Require at least ONE of these permissions. */
  anyOf?: readonly PlatformPermissionCode[];
  /** Require ALL of these permissions. */
  allOf?: readonly PlatformPermissionCode[];
  children: React.ReactNode;
  /** Override the default access-denied message. */
  accessDeniedMessage?: string;
}

/**
 * Renders children if the current platform user has the required permission(s).
 * Uses auth context (synchronous, no extra network call).
 * Falls back to PlatformAccessDenied if missing the required permission.
 *
 * Props (mutually exclusive, evaluated in order):
 *   permission - single required code
 *   anyOf      - any one of the codes suffices
 *   allOf      - all codes must be present
 */
export function PlatformPermissionRoute({
  permission,
  anyOf,
  allOf,
  children,
  accessDeniedMessage,
}: PlatformPermissionRouteProps) {
  const { user, isLoaded } = useAppAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-14" aria-label="Loading">
        <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || user.role !== "super_admin") {
    return (
      <PlatformAccessDenied message="Platform administration access required." />
    );
  }

  // Determine required permission code for the denied message
  const primaryCode: PlatformPermissionCode | undefined =
    permission ?? anyOf?.[0] ?? allOf?.[0];

  let hasAccess = true;

  if (permission) {
    hasAccess = hasPlatformPermissionClient(user, permission);
  } else if (anyOf && anyOf.length > 0) {
    hasAccess = hasAnyPlatformPermissionClient(user, anyOf);
  } else if (allOf && allOf.length > 0) {
    hasAccess = hasAllPlatformPermissionsClient(user, allOf);
  }

  if (!hasAccess) {
    return (
      <PlatformAccessDenied
        requiredPermission={primaryCode}
        message={accessDeniedMessage}
      />
    );
  }

  return <>{children}</>;
}
