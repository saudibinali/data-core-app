/**
 * super-admin-platform-users.tsx
 *
 * @phase P14-A - Platform Users & Access page.
 * @phase P14-B - Role/Permission Matrix + Role Change Panel.
 * Route: /super-admin/platform-users
 *
 * Safety:
 *   - No password reset button
 *   - No delete button
 *   - No email change button
 *   - No invite email sending
 *   - No SSO/MFA
 *   - Root Platform Owner has protected notice only - no change controls
 *   - Root role never appears in role selector
 */

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAppAuth } from "@/lib/auth";
import { canPerformPlatformAction, hasAnyPlatformPermissionClient } from "@/lib/platform-access";
import { usePlatformUserActivity } from "@/lib/platform-audit-hooks";
import {
  PLATFORM_AUDIT_SEVERITY_CONFIG,
  PLATFORM_AUDIT_RESULT_CONFIG,
  type PlatformAuditSeverity,
  type PlatformAuditResultType,
} from "@/lib/platform-audit-config";
import { PlatformAccessDenied } from "@/components/platform-permission-route";
import {
  PLATFORM_USER_SAFETY_CONTRACT,
  PLATFORM_USER_STATUS_CONFIG,
  INITIAL_PLATFORM_ROLE_CONFIG,
  PLATFORM_USER_ACTION_CONFIG,
  ASSIGNABLE_PLATFORM_ROLE_KEYS,
  PLATFORM_USER_EMPTY_STATE,
  type PlatformUserStatus,
  type InitialPlatformRoleCode,
} from "@/lib/platform-users-config";
import {
  usePlatformUsers,
  useCreatePlatformUser,
  useUpdatePlatformUserProfile,
  useUpdatePlatformUserStatus,
  useUpdatePlatformUserRole,
  type PlatformUserProfile,
} from "@/lib/platform-users-hooks";
import { PlatformUsersSummaryCards } from "@/components/platform-users/PlatformUsersSummaryCards";
import { PlatformUsersTable, type PlatformUsersTableFilters } from "@/components/platform-users/PlatformUsersTable";
import { PlatformUserDetailDrawer } from "@/components/platform-users/PlatformUserDetailDrawer";
import {
  PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT,
} from "@/lib/platform-users-console-config";
import {
  usePlatformUsersConsoleSummary,
} from "@/lib/platform-users-console-hooks";
import {
  PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT,
  PLATFORM_USER_TYPE_CONFIG,
  PLATFORM_USER_TYPES,
  type PlatformUserType,
} from "@/lib/platform-user-directory-config";
import {
  PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT,
  PLATFORM_ROLE_PERMISSION_SUMMARY,
  PLATFORM_PERMISSION_GROUPS,
  PLATFORM_PERMISSION_CONFIG,
} from "@/lib/platform-permissions-config";
import {
  SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT,
  PLATFORM_ADMIN_PROTECTION_NOTICE,
  isPolicyProtectedUser,
} from "@/lib/platform-admin-protection-config";

// Import-time safety checks
(function () {
  for (const [k, v] of Object.entries(PLATFORM_USER_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`PLATFORM_USER_SAFETY_CONTRACT violated: ${k}`);
  }
  for (const [k, v] of Object.entries(PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT violated: ${k}`);
  }
  for (const [k, v] of Object.entries(PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT violated: ${k}`);
  }
  for (const [k, v] of Object.entries(SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT violated: ${k}`);
  }
  for (const [k, v] of Object.entries(PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT violated: ${k}`);
  }
})();

function AdminProtectionNotice({ testId = "platform-admin-protection-notice" }: { testId?: string }) {
  return (
    <div
      className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200"
      data-testid={testId}
      title={PLATFORM_ADMIN_PROTECTION_NOTICE}
    >
      {PLATFORM_ADMIN_PROTECTION_NOTICE}
    </div>
  );
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: string }) {
  const cfg = PLATFORM_USER_STATUS_CONFIG[status as PlatformUserStatus];
  if (!cfg) return <span className="text-xs text-muted-foreground">{status}</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.badgeClass)}>
      {cfg.label}
    </span>
  );
}

function RoleBadge({ roleCode }: { roleCode: string }) {
  const cfg = INITIAL_PLATFORM_ROLE_CONFIG[roleCode as InitialPlatformRoleCode];
  if (!cfg) return <span className="text-xs text-muted-foreground">{roleCode}</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.badgeClass)}>
      {cfg.label}
    </span>
  );
}

function UserTypeBadge({ userType }: { userType: string }) {
  const cfg = PLATFORM_USER_TYPE_CONFIG[userType as PlatformUserType];
  if (!cfg) return <span className="text-xs text-muted-foreground">{userType}</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.badgeClass)}>
      {cfg.label}
    </span>
  );
}

function canApplyStatusAction(authUser: Record<string, unknown>, actionKey: string): boolean {
  const cfg = PLATFORM_USER_ACTION_CONFIG[actionKey];
  if (!cfg) return false;
  if (cfg.targetStatus === "active") {
    return (
      canPerformPlatformAction(authUser as Parameters<typeof canPerformPlatformAction>[0], "platform.user.reactivate") ||
      canPerformPlatformAction(authUser as Parameters<typeof canPerformPlatformAction>[0], "platform.user.status.update")
    );
  }
  return (
    canPerformPlatformAction(authUser as Parameters<typeof canPerformPlatformAction>[0], "platform.user.disable") ||
    canPerformPlatformAction(authUser as Parameters<typeof canPerformPlatformAction>[0], "platform.user.status.update")
  );
}

function ProtectedBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
      Protected
    </span>
  );
}

function RootBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      Root Owner
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

// ── Risk Level Badge ──────────────────────────────────────────────────────────

function RiskBadge({ riskLevel }: { riskLevel: string }) {
  const styles: Record<string, string> = {
    read: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    controlled_write: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    sensitive_write: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    root_only: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  };
  const labels: Record<string, string> = {
    read: "Read",
    controlled_write: "Write",
    sensitive_write: "Sensitive",
    root_only: "Root",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", styles[riskLevel] ?? "bg-muted text-muted-foreground")}>
      {labels[riskLevel] ?? riskLevel}
    </span>
  );
}

// ── Role/Permission Matrix Section ────────────────────────────────────────────

function RolePermissionMatrix() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card" data-testid="role-permission-matrix">
      <button
        className="w-full px-4 py-3 flex items-center justify-between border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        <div className="text-left">
          <h2 className="text-sm font-semibold">Role / Permission Matrix</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Platform role capabilities - مصفوفة صلاحيات أدوار المنصة
          </p>
        </div>
        {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="permission-matrix-table">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap min-w-[200px]">
                  Permission
                </th>
                {PLATFORM_ROLE_PERMISSION_SUMMARY.map(role => (
                  <th key={role.roleCode} className="px-2 py-2 text-center whitespace-nowrap">
                    <div className="font-semibold text-[10px]">{role.label}</div>
                    <div className="text-muted-foreground text-[9px] mt-0.5">{role.labelAr}</div>
                    {!role.assignableFromUi && (
                      <div className="mt-1">
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Root</span>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLATFORM_PERMISSION_GROUPS.map(group => (
                <React.Fragment key={group.group}>
                  <tr className="bg-muted/40">
                    <td
                      colSpan={PLATFORM_ROLE_PERMISSION_SUMMARY.length + 1}
                      className="px-3 py-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider"
                    >
                      {group.label} - {group.labelAr}
                    </td>
                  </tr>
                  {group.permissions.map(code => {
                    const def = PLATFORM_PERMISSION_CONFIG[code];
                    return (
                      <tr key={code} className="border-b border-border/30 hover:bg-accent/20">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <RiskBadge riskLevel={def.riskLevel} />
                            <div>
                              <div className="font-medium text-[11px]">{def.label}</div>
                              <div className="text-muted-foreground text-[10px]">{def.labelAr}</div>
                            </div>
                          </div>
                        </td>
                        {PLATFORM_ROLE_PERMISSION_SUMMARY.map(role => {
                          const hasIt = role.permissions.includes(code);
                          return (
                            <td key={role.roleCode} className="px-2 py-2 text-center">
                              {hasIt ? (
                                <span className="text-green-600 dark:text-green-400 font-bold text-sm">✓</span>
                              ) : (
                                <span className="text-muted-foreground/30 text-sm">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Create Platform User Dialog ───────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
}

function CreatePlatformUserDialog({ open, onClose }: CreateDialogProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userType, setUserType] = useState<PlatformUserType>("platform_admin");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useCreatePlatformUser();

  function reset() {
    setEmail("");
    setDisplayName("");
    setUserType("platform_admin");
    setJobTitle("");
    setDepartment("");
    setPhone("");
    setError(null);
  }

  function handleClose() {
    reset();
    mutation.reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({
        email: email.trim(),
        displayName: displayName.trim(),
        userType,
        jobTitle: jobTitle.trim() || undefined,
        department: department.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create platform user");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">Create Platform User</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Internal platform administration account</p>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
          Platform accounts are for internal platform administration only - not tenant workspace users.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@platform.local"
              required
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="platform-user-email-input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Full name"
              required
              minLength={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="platform-user-name-input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">User type</label>
            <select
              value={userType}
              onChange={e => setUserType(e.target.value as PlatformUserType)}
              required
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="platform-user-type-select"
            >
              {PLATFORM_USER_TYPES.filter(t => t !== "platform_owner").map(t => (
                <option key={t} value={t}>
                  {PLATFORM_USER_TYPE_CONFIG[t].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Job title (optional)</label>
            <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" data-testid="platform-user-job-title-input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Department (optional)</label>
            <input type="text" value={department} onChange={e => setDepartment(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" data-testid="platform-user-department-input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Phone (optional)</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" data-testid="platform-user-phone-input" />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive" data-testid="create-platform-user-error">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-testid="platform-user-create-submit"
            >
              {mutation.isPending ? "Creating..." : "Create Platform User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Profile Dialog ───────────────────────────────────────────────────────

function EditPlatformUserProfileDialog({
  user,
  open,
  onClose,
}: {
  user: PlatformUserProfile;
  open: boolean;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [department, setDepartment] = useState(user.department ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdatePlatformUserProfile();
  const { user: authUser } = useAppAuth();

  if (!open) return null;
  if (!canPerformPlatformAction(authUser ?? {}, "platform.user.update")) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({
        userId: user.id,
        displayName: displayName.trim(),
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
        phone: phone.trim() || null,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Profile update failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="edit-platform-user-dialog">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Edit Profile</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Display name</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} required minLength={2} className="w-full px-3 py-2 border border-input rounded-lg text-sm" data-testid="edit-platform-user-display-name" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Job title</label>
            <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" data-testid="edit-platform-user-job-title" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input value={department} onChange={e => setDepartment(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" data-testid="edit-platform-user-department" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" data-testid="edit-platform-user-phone" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-3 py-2 border rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm" data-testid="edit-platform-user-submit">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Status Change Panel ───────────────────────────────────────────────────────

interface StatusChangePanelProps {
  user: PlatformUserProfile;
  onDone: () => void;
}

function StatusChangePanel({ user, onDone }: StatusChangePanelProps) {
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdatePlatformUserStatus();
  const { user: authUser } = useAppAuth();

  const actionEntries = Object.entries(PLATFORM_USER_ACTION_CONFIG).filter(
    ([key, cfg]) => cfg.targetStatus !== user.status && canApplyStatusAction(authUser ?? {}, key),
  );

  if (isPolicyProtectedUser(user)) {
    return <AdminProtectionNotice testId="status-change-protection-notice" />;
  }

  const hasStatusPermission =
    canPerformPlatformAction(authUser ?? {}, "platform.user.disable") ||
    canPerformPlatformAction(authUser ?? {}, "platform.user.reactivate") ||
    canPerformPlatformAction(authUser ?? {}, "platform.user.status.update");

  if (!hasStatusPermission) {
    return (
      <PlatformAccessDenied
        compact
        requiredPermission="platform.users.disable"
        data-testid="status-change-panel-denied"
      />
    );
  }

  async function handleApply() {
    if (!actionKey) return;
    const cfg = PLATFORM_USER_ACTION_CONFIG[actionKey];
    if (!cfg) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        userId: user.id,
        nextStatus: cfg.targetStatus as PlatformUserStatus,
        reason,
        confirmation: confirmed,
      });
      setActionKey(null);
      setReason("");
      setConfirmed(false);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Status change failed");
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Change Status</h4>

      <div className="flex flex-wrap gap-2 mb-4">
        {actionEntries.map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => { setActionKey(key); setReason(""); setConfirmed(false); setError(null); }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              actionKey === key
                ? cfg.buttonClass
                : "border border-input bg-background hover:bg-accent text-foreground",
            )}
            data-testid={`status-action-${key}`}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      {actionKey && (
        <div className="space-y-3 p-4 bg-muted/40 rounded-lg border border-border">
          <p className="text-sm">{PLATFORM_USER_ACTION_CONFIG[actionKey]?.description}</p>

          <div>
            <label className="block text-xs font-medium mb-1">Reason (required, min 10 characters)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this status change is needed..."
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="status-change-reason"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4"
              data-testid="status-change-confirm"
            />
            {PLATFORM_USER_ACTION_CONFIG[actionKey]?.confirmationPrompt}
          </label>

          {error && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive" data-testid="status-change-error">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setActionKey(null)}
              className="px-3 py-1.5 border border-input rounded-lg text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={mutation.isPending || reason.trim().length < 10 || !confirmed}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50",
                PLATFORM_USER_ACTION_CONFIG[actionKey]?.buttonClass ?? "bg-primary text-primary-foreground",
              )}
              data-testid="status-change-apply"
            >
              {mutation.isPending ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Role Change Panel ─────────────────────────────────────────────────────────

interface RoleChangePanelProps {
  user: PlatformUserProfile;
  onDone: () => void;
}

function RoleChangePanel({ user, onDone }: RoleChangePanelProps) {
  const [newRoleCode, setNewRoleCode] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdatePlatformUserRole();
  const { user: authUser } = useAppAuth();

  if (isPolicyProtectedUser(user)) {
    return <AdminProtectionNotice testId="role-change-protection-notice" />;
  }

  if (!canPerformPlatformAction(authUser ?? {}, "platform.user.role.update")) {
    return (
      <PlatformAccessDenied
        compact
        requiredPermission="platform.users.role.update"
        data-testid="role-change-panel-denied"
      />
    );
  }

  const availableRoles = ASSIGNABLE_PLATFORM_ROLE_KEYS.filter(k => k !== user.roleCode);

  async function handleApply() {
    if (!newRoleCode || !confirmed || reason.trim().length < 10) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        userId: user.id,
        roleCode: newRoleCode,
        reason,
        confirmation: confirmed,
      });
      setNewRoleCode("");
      setReason("");
      setConfirmed(false);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Role change failed");
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="role-change-panel">
      <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Change Role</h4>

      <div>
        <label className="block text-xs font-medium mb-1.5">New role</label>
        <select
          value={newRoleCode}
          onChange={e => { setNewRoleCode(e.target.value); setReason(""); setConfirmed(false); setError(null); }}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="role-change-select"
        >
          <option value="">Select new role...</option>
          {availableRoles.map(k => (
            <option key={k} value={k}>
              {INITIAL_PLATFORM_ROLE_CONFIG[k].label} - {INITIAL_PLATFORM_ROLE_CONFIG[k].labelAr}
            </option>
          ))}
        </select>
        {newRoleCode && INITIAL_PLATFORM_ROLE_CONFIG[newRoleCode as InitialPlatformRoleCode] && (
          <p className="text-xs text-muted-foreground mt-1">
            {INITIAL_PLATFORM_ROLE_CONFIG[newRoleCode as InitialPlatformRoleCode].description}
          </p>
        )}
      </div>

      {newRoleCode && (
        <div className="space-y-3 p-4 bg-muted/40 rounded-lg border border-border mt-3">
          <div>
            <label className="block text-xs font-medium mb-1">Reason (required, min 10 characters)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this role change is needed..."
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="role-change-reason"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4"
              data-testid="role-change-confirm"
            />
            I confirm this role change and understand it affects this user's platform access.
          </label>

          {error && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive" data-testid="role-change-error">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setNewRoleCode(""); setReason(""); setConfirmed(false); setError(null); }}
              className="px-3 py-1.5 border border-input rounded-lg text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={mutation.isPending || reason.trim().length < 10 || !confirmed}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-testid="role-change-apply"
            >
              {mutation.isPending ? "Applying..." : "Change Role"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── User Detail Panel ─────────────────────────────────────────────────────────

interface UserDetailPanelProps {
  user: PlatformUserProfile;
  onClose: () => void;
  embedded?: boolean;
}

function UserDetailPanel({ user, onClose, embedded }: UserDetailPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { user: authUser } = useAppAuth();
  const canEdit = canPerformPlatformAction(authUser ?? {}, "platform.user.update");

  return (
    <div
      className={embedded ? "space-y-4" : "border border-border rounded-xl bg-card p-5 mt-2"}
      data-testid="platform-user-detail-panel"
    >
      {!embedded && (
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
            {(user.displayName ?? "?").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-sm">{user.displayName}</p>
            <p className="text-xs text-muted-foreground">{user.email ?? "No email"}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <StatusBadge status={user.status} />
        <UserTypeBadge userType={user.userType} />
        <RoleBadge roleCode={user.roleCode} />
        {user.isProtected && <ProtectedBadge />}
        {user.isRootOwner && <RootBadge />}
        {canEdit && !user.isProtected && !user.isRootOwner && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="ml-auto text-xs px-2 py-1 border border-input rounded-lg hover:bg-accent"
            data-testid="edit-platform-user-btn"
          >
            Edit Profile
          </button>
        )}
      </div>

      {isPolicyProtectedUser(user) && (
        <div className="mb-4 space-y-2">
          <AdminProtectionNotice testId="user-detail-protection-notice" />
          {user.isRootOwner && (
            <div
              className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 text-sm"
              data-testid="root-protection-notice"
            >
              <p className="font-medium text-violet-800 dark:text-violet-300 mb-1">Root Platform Owner</p>
              <p className="text-violet-700 dark:text-violet-400 text-xs">{PLATFORM_USER_EMPTY_STATE.protectedNotice}</p>
            </div>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">User ID</dt>
          <dd className="font-mono text-xs">{user.id}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Role Code</dt>
          <dd className="font-mono text-xs">{user.roleCode}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Job Title</dt>
          <dd className="text-xs">{user.jobTitle ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Department</dt>
          <dd className="text-xs">{user.department ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Phone</dt>
          <dd className="text-xs">{user.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last Sign-in</dt>
          <dd className="text-xs">{formatDate(user.lastLoginAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="text-xs">{formatDate(user.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Protected</dt>
          <dd className="text-xs">{user.isProtected ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Root Owner</dt>
          <dd className="text-xs">{user.isRootOwner ? "Yes" : "No"}</dd>
        </div>
      </dl>

      <StatusChangePanel user={user} onDone={onClose} />
      <RoleChangePanel user={user} onDone={onClose} />
      <EditPlatformUserProfileDialog user={user} open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}

// ── UserRecentActivity ────────────────────────────────────────────────────────

interface UserRecentActivityProps {
  userId: string;
}

function UserRecentActivity({ userId }: UserRecentActivityProps) {
  const { user: authUser } = useAppAuth();

  const canView = hasAnyPlatformPermissionClient(authUser ?? {}, [
    "platform.activity.read",
    "audit.read",
  ]);

  const { data, isLoading } = usePlatformUserActivity(
    canView ? userId : null,
    { limit: 10 },
  );

  if (!canView) return null;

  const items = data?.items ?? [];

  return (
    <div
      className="mt-4 pt-4 border-t border-border space-y-2"
      data-testid="user-recent-activity"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Recent Activity - آخر النشاط
      </p>

      {isLoading && !data ? (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center" dir="rtl">
          لا توجد أنشطة حديثة
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const sevCfg =
              PLATFORM_AUDIT_SEVERITY_CONFIG[item.severity as PlatformAuditSeverity];
            const resCfg =
              PLATFORM_AUDIT_RESULT_CONFIG[item.result as PlatformAuditResultType];
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 text-xs py-1"
                data-testid="user-activity-row"
              >
                {resCfg ? (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${resCfg.badgeClass}`}
                  >
                    {resCfg.label}
                  </span>
                ) : null}
                {sevCfg ? (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${sevCfg.badgeClass}`}
                  >
                    {sevCfg.label}
                  </span>
                ) : null}
                <span className="flex-1 min-w-0 truncate">{item.actionLabel}</span>
                {item.reason ? (
                  <span
                    className="text-muted-foreground truncate max-w-[100px]"
                    title={item.reason}
                  >
                    {item.reason}
                  </span>
                ) : null}
                <span
                  className="text-muted-foreground shrink-0 flex items-center gap-0.5 tabular-nums"
                  title={new Date(item.createdAt).toLocaleString()}
                >
                  <Clock className="w-2.5 h-2.5" />
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuperAdminPlatformUsers() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [tableFilters, setTableFilters] = useState<PlatformUsersTableFilters>({
    search: "",
    status: "",
    userType: "",
    protectedOnly: false,
    hasOverrides: false,
    invitationStatus: "",
    highRiskOnly: false,
  });

  const { user: authUser } = useAppAuth();
  const canCreate = canPerformPlatformAction(authUser ?? {}, "platform.user.create");
  const canReadUsers = canPerformPlatformAction(authUser ?? {}, "platform.user.read");

  const listParams = {
    search: tableFilters.search.trim() || undefined,
    status: tableFilters.status || undefined,
    userType: tableFilters.userType || undefined,
    page: 1,
    pageSize: 100,
  };

  const { data, isLoading, isError, error } = usePlatformUsers(listParams);
  const { data: consoleSummary, isLoading: summaryLoading } = usePlatformUsersConsoleSummary(canReadUsers);
  const users = data?.users ?? [];
  const total = data?.total ?? users.length;

  const directoryMap = new Map(
    (consoleSummary?.directory ?? []).map((row) => [row.userId, row]),
  );

  const selectedUser = selectedUserId
    ? users.find(u => u.id === selectedUserId) ?? null
    : null;

  return (
    <div className="space-y-6" data-testid="platform-users-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Users</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Internal platform administration accounts - مستخدمو إدارة المنصة الداخليون
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium border border-border">
            Super Admin Only
          </span>
          {canCreate && (
            <button
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              data-testid="create-platform-user-btn"
            >
              Create Platform User
            </button>
          )}
        </div>
      </div>

      {/* Safety banner */}
      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
        {PLATFORM_USER_EMPTY_STATE.safetyBanner}
      </div>

      <PlatformUsersSummaryCards summary={consoleSummary} isLoading={summaryLoading} />

      <RolePermissionMatrix />

      <PlatformUsersTable
        users={users}
        directoryMap={directoryMap}
        filters={tableFilters}
        onFiltersChange={(patch) => setTableFilters((f) => ({ ...f, ...patch }))}
        selectedUserId={selectedUserId}
        onSelectUser={setSelectedUserId}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        total={total}
      />

      {selectedUser && (
        <PlatformUserDetailDrawer
          user={selectedUser}
          onClose={() => setSelectedUserId(null)}
          overviewContent={<UserDetailPanel user={selectedUser} onClose={() => setSelectedUserId(null)} embedded />}
        />
      )}
      <CreatePlatformUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}


