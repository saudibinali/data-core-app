/**
 * @phase P17-F - Platform Users main table with enriched columns
 */

import React from "react";
import {
  PLATFORM_USER_STATUS_CONFIG,
  type PlatformUserStatus,
} from "@/lib/platform-users-config";
import {
  PLATFORM_USER_TYPE_CONFIG,
  type PlatformUserType,
} from "@/lib/platform-user-directory-config";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";
import type { PlatformUserDirectoryRow } from "@/lib/platform-users-console-hooks";

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: string }) {
  const cfg = PLATFORM_USER_STATUS_CONFIG[status as PlatformUserStatus];
  if (!cfg) return <span className="text-xs">{status}</span>;
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", cfg.badgeClass)}>
      {cfg.label}
    </span>
  );
}

function RoleBadge({ roleCode }: { roleCode: string }) {
  return <span className="text-xs font-mono">{roleCode}</span>;
}

function UserTypeBadge({ userType }: { userType: string }) {
  const cfg = PLATFORM_USER_TYPE_CONFIG[userType as PlatformUserType];
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", cfg?.badgeClass ?? "bg-muted")}>
      {cfg?.label ?? userType}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export interface PlatformUsersTableFilters {
  search: string;
  status: string;
  userType: string;
  protectedOnly: boolean;
  hasOverrides: boolean;
  invitationStatus: string;
  highRiskOnly: boolean;
}

export function PlatformUsersTable({
  users,
  directoryMap,
  filters,
  onFiltersChange,
  selectedUserId,
  onSelectUser,
  isLoading,
  isError,
  errorMessage,
  total,
}: {
  users: PlatformUserProfile[];
  directoryMap: Map<string, PlatformUserDirectoryRow>;
  filters: PlatformUsersTableFilters;
  onFiltersChange: (patch: Partial<PlatformUsersTableFilters>) => void;
  selectedUserId: string | null;
  onSelectUser: (id: string | null) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  total: number;
}) {
  const filtered = users.filter((u) => {
    const dir = directoryMap.get(u.id);
    if (filters.protectedOnly && !u.isProtected && !u.isRootOwner) return false;
    if (filters.hasOverrides && (dir?.customOverridesCount ?? 0) === 0) return false;
    if (filters.invitationStatus && dir?.invitationStatus !== filters.invitationStatus) return false;
    if (filters.highRiskOnly && !dir?.riskLevel) return false;
    return true;
  });

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="px-4 py-3 border-b border-border bg-muted/30 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Directory</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Showing {filtered.length} of {total} platform user{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="platform-users-filters">
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
            placeholder="Search name or email..."
            className="px-3 py-1.5 border border-input rounded-lg text-sm bg-background min-w-[200px]"
            data-testid="platform-users-search"
          />
          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ status: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm bg-background"
            data-testid="platform-users-status-filter"
          >
            <option value="">All statuses</option>
            {Object.keys(PLATFORM_USER_STATUS_CONFIG).map((s) => (
              <option key={s} value={s}>
                {PLATFORM_USER_STATUS_CONFIG[s as PlatformUserStatus].label}
              </option>
            ))}
          </select>
          <select
            value={filters.userType}
            onChange={(e) => onFiltersChange({ userType: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm bg-background"
            data-testid="platform-users-type-filter"
          >
            <option value="">All roles / types</option>
            {Object.keys(PLATFORM_USER_TYPE_CONFIG).map((t) => (
              <option key={t} value={t}>
                {PLATFORM_USER_TYPE_CONFIG[t as PlatformUserType].label}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-lg">
            <input
              type="checkbox"
              checked={filters.protectedOnly}
              onChange={(e) => onFiltersChange({ protectedOnly: e.target.checked })}
              data-testid="filter-protected-only"
            />
            Protected only
          </label>
          <label className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-lg">
            <input
              type="checkbox"
              checked={filters.hasOverrides}
              onChange={(e) => onFiltersChange({ hasOverrides: e.target.checked })}
              data-testid="filter-has-overrides"
            />
            Has overrides
          </label>
          <label className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-lg">
            <input
              type="checkbox"
              checked={filters.highRiskOnly}
              onChange={(e) => onFiltersChange({ highRiskOnly: e.target.checked })}
              data-testid="filter-high-risk-only"
            />
            High risk only
          </label>
          <select
            value={filters.invitationStatus}
            onChange={(e) => onFiltersChange({ invitationStatus: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm bg-background"
            data-testid="filter-invitation-status"
          >
            <option value="">Any invitation</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="p-8 text-center text-sm text-muted-foreground" data-testid="platform-users-loading">
          Loading...
        </div>
      )}

      {isError && (
        <div className="p-8 text-center text-sm text-destructive" data-testid="platform-users-error">
          {errorMessage ?? "Failed to load users"}
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground" data-testid="platform-users-empty">
          No users match filters
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="platform-users-table">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Display Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Type / Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Badges</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Overrides</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Invitation</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Last login</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Last reviewed</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const dir = directoryMap.get(user.id);
                return (
                  <tr
                    key={user.id}
                    className={cn(
                      "border-b border-border/50 cursor-pointer transition-colors",
                      selectedUserId === user.id ? "bg-accent/50" : "hover:bg-accent/30",
                    )}
                    onClick={() => onSelectUser(selectedUserId === user.id ? null : user.id)}
                    data-testid={`platform-user-row-${user.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{user.displayName}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{user.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <UserTypeBadge userType={user.userType} />
                      <RoleBadge roleCode={user.roleCode} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1" data-testid="user-protected-badges">
                        {user.isProtected && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
                            Protected
                          </span>
                        )}
                        {user.isRootOwner && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            Root
                          </span>
                        )}
                        {dir?.riskLevel && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-900/30">
                            {dir.riskLevel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" data-testid="user-overrides-count">
                      {dir?.customOverridesCount ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs" data-testid="user-invitation-status">
                      {dir?.invitationStatus ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(user.lastLoginAt)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {dir?.lastReviewedAt ? formatDate(dir.lastReviewedAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(user.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
