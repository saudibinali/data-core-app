/**
 * @phase P17-B - Custom Permissions panel for platform user detail
 */

import React, { useMemo, useState } from "react";
import { useAppAuth } from "@/lib/auth";
import { hasPlatformPermissionClient } from "@/lib/platform-access";
import { PlatformAccessDenied } from "@/components/platform-permission-route";
import { PLATFORM_PERMISSION_CONFIG, type PlatformPermissionCode } from "@/lib/platform-permissions-config";
import {
  usePlatformPermissionCatalog,
  usePlatformUserPermissions,
  usePatchPermissionOverride,
  useClearPermissionOverride,
} from "@/lib/platform-user-permissions-hooks";
import { OVERRIDE_REASON_MIN_LENGTH } from "@/lib/platform-permission-assignment-config";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";
import {
  isPolicyProtectedUser,
  PLATFORM_ADMIN_PROTECTION_NOTICE,
} from "@/lib/platform-admin-protection-config";

type PermFilter = "all" | "role" | "grant" | "deny" | "effective" | "denied";

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function SourceBadge({ source }: { source: "Role" | "Grant" | "Deny" | "Effective" | "Denied" }) {
  const styles: Record<string, string> = {
    Role: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    Grant: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    Deny: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    Effective: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    Denied: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", styles[source])}>{source}</span>
  );
}

export function CustomPermissionsSection({ user }: { user: PlatformUserProfile }) {
  const { user: authUser } = useAppAuth();
  const canRead = hasPlatformPermissionClient(authUser ?? {}, "platform.permissions.read");
  const canUpdate = hasPlatformPermissionClient(authUser ?? {}, "platform.permissions.update");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PermFilter>("all");
  const [reason, setReason] = useState("");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: catalog } = usePlatformPermissionCatalog(canRead);
  const { data: perms, isLoading } = usePlatformUserPermissions(canRead ? user.id : null);
  const patchMutation = usePatchPermissionOverride(user.id);
  const clearMutation = useClearPermissionOverride(user.id);

  const effectiveSet = useMemo(() => new Set(perms?.effectivePermissions ?? []), [perms]);
  const roleSet = useMemo(() => new Set(perms?.rolePermissions ?? []), [perms]);
  const grantSet = useMemo(() => new Set(perms?.grantedOverrides ?? []), [perms]);
  const denySet = useMemo(() => new Set(perms?.deniedOverrides ?? []), [perms]);

  const rows = useMemo(() => {
    const codes = catalog?.permissions?.map((p) => p.code) ?? [];
    return codes
      .filter((code) => {
        const def = PLATFORM_PERMISSION_CONFIG[code as PlatformPermissionCode];
        if (!def) return false;
        if (search && !def.label.toLowerCase().includes(search.toLowerCase()) && !code.includes(search)) {
          return false;
        }
        const inRole = roleSet.has(code as PlatformPermissionCode);
        const inGrant = grantSet.has(code as PlatformPermissionCode);
        const inDeny = denySet.has(code as PlatformPermissionCode);
        const inEffective = effectiveSet.has(code as PlatformPermissionCode);
        if (filter === "role") return inRole;
        if (filter === "grant") return inGrant;
        if (filter === "deny") return inDeny;
        if (filter === "effective") return inEffective;
        if (filter === "denied") return !inEffective;
        return true;
      })
      .map((code) => {
        const def = PLATFORM_PERMISSION_CONFIG[code as PlatformPermissionCode];
        const inEffective = effectiveSet.has(code as PlatformPermissionCode);
        return { code, def, inRole: roleSet.has(code as PlatformPermissionCode), inGrant: grantSet.has(code as PlatformPermissionCode), inDeny: denySet.has(code as PlatformPermissionCode), inEffective };
      });
  }, [catalog, search, filter, roleSet, grantSet, denySet, effectiveSet]);

  if (!canRead) {
    return (
      <PlatformAccessDenied compact requiredPermission="platform.permissions.read" data-testid="custom-permissions-denied" />
    );
  }

  if (isPolicyProtectedUser(user)) {
    return (
      <div className="mt-4 pt-4 border-t border-border" data-testid="custom-permissions-root-protected">
        <p className="text-xs text-muted-foreground" title={PLATFORM_ADMIN_PROTECTION_NOTICE}>
          {PLATFORM_ADMIN_PROTECTION_NOTICE}
        </p>
        <p className="text-xs mt-2">Effective: {perms?.effectivePermissions.length ?? "—"} platform permissions (full catalog).</p>
      </div>
    );
  }

  async function applyOverride(code: string, effect: "grant" | "deny") {
    if (!canUpdate) return;
    if (reason.trim().length < OVERRIDE_REASON_MIN_LENGTH) {
      setError(`Reason required (min ${OVERRIDE_REASON_MIN_LENGTH} characters)`);
      return;
    }
    setError(null);
    setPendingCode(code);
    try {
      await patchMutation.mutateAsync({ permissionCode: code, effect, reason: reason.trim() });
      setPendingCode(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update override");
      setPendingCode(null);
    }
  }

  async function clearOverride(code: string) {
    if (!canUpdate) return;
    if (reason.trim().length < OVERRIDE_REASON_MIN_LENGTH) {
      setError(`Reason required (min ${OVERRIDE_REASON_MIN_LENGTH} characters)`);
      return;
    }
    setError(null);
    setPendingCode(code);
    try {
      await clearMutation.mutateAsync({ permissionCode: code, reason: reason.trim() });
      setPendingCode(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to clear override");
      setPendingCode(null);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-3" data-testid="custom-permissions-section">
      <div>
        <h4 className="text-sm font-semibold">Custom Permissions</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Role + grant/deny overrides. Deny wins over role and grant.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span>Role: {perms?.rolePermissions.length ?? 0}</span>
        <span>Grants: {perms?.grantedOverrides.length ?? 0}</span>
        <span>Denies: {perms?.deniedOverrides.length ?? 0}</span>
        <span>Effective: {perms?.effectivePermissions.length ?? 0}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search permissions..."
          className="px-2 py-1 border border-input rounded text-xs min-w-[160px]"
          data-testid="custom-permissions-search"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as PermFilter)}
          className="px-2 py-1 border border-input rounded text-xs"
          data-testid="custom-permissions-filter"
        >
          <option value="all">All</option>
          <option value="role">Granted by role</option>
          <option value="grant">Custom grant</option>
          <option value="deny">Custom deny</option>
          <option value="effective">Effective allowed</option>
          <option value="denied">Effective denied</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Reason for changes (required)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 border border-input rounded text-xs"
          data-testid="custom-permissions-reason"
          placeholder="Document why permission overrides are being changed..."
        />
      </div>

      {error && <p className="text-xs text-destructive" data-testid="custom-permissions-error">{error}</p>}

      {isLoading && <p className="text-xs text-muted-foreground">Loading permissions...</p>}

      <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {rows.map(({ code, def, inRole, inGrant, inDeny, inEffective }) => (
          <div key={code} className="px-3 py-2 flex items-start gap-2 text-xs" data-testid={`custom-perm-row-${code}`}>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{def.label}</div>
              <p className="text-muted-foreground font-mono text-[10px]">{code}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {inRole && <SourceBadge source="Role" />}
                {inGrant && <SourceBadge source="Grant" />}
                {inDeny && <SourceBadge source="Deny" />}
                {inEffective ? <SourceBadge source="Effective" /> : <SourceBadge source="Denied" />}
              </div>
            </div>
            {canUpdate && (
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  disabled={pendingCode === code}
                  onClick={() => applyOverride(code, "grant")}
                  className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] hover:bg-emerald-700 disabled:opacity-50"
                  data-testid={`grant-override-${code}`}
                >
                  Grant
                </button>
                <button
                  type="button"
                  disabled={pendingCode === code}
                  onClick={() => applyOverride(code, "deny")}
                  className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] hover:bg-rose-700 disabled:opacity-50"
                  data-testid={`deny-override-${code}`}
                >
                  Deny
                </button>
                {(inGrant || inDeny) && (
                  <button
                    type="button"
                    disabled={pendingCode === code}
                    onClick={() => clearOverride(code)}
                    className="px-2 py-0.5 rounded border border-input text-[10px] hover:bg-accent disabled:opacity-50"
                    data-testid={`clear-override-${code}`}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

