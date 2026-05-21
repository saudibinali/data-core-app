/**
 * @phase P17-D - Platform Access Review & Audit (visibility only)
 * Route: /super-admin/access-review
 */

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ClipboardCheck, X } from "lucide-react";
import { useAppAuth } from "@/lib/auth";
import { hasPlatformPermissionClient } from "@/lib/platform-access";
import { PlatformAccessDenied } from "@/components/platform-permission-route";
import {
  ACCESS_REVIEW_SAFETY_CONTRACT,
  RISK_LEVEL_STYLES,
} from "@/lib/platform-access-review-config";
import {
  useAccessReviewSummary,
  useUserAccessReview,
  useAccessReviewAuditEvents,
  useRecordAccessReview,
  type HighRiskUserRow,
  type AuditEventFilters,
} from "@/lib/platform-access-review-hooks";
import { PlatformAuditSeverityBadge } from "@/pages/super-admin-activity";

(function () {
  for (const [k, v] of Object.entries(ACCESS_REVIEW_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`ACCESS_REVIEW_SAFETY_CONTRACT violated: ${k}`);
  }
})();

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function RiskBadge({ level }: { level: string }) {
  return (
    <span
      className={cn("text-[10px] px-2 py-0.5 rounded font-medium uppercase", RISK_LEVEL_STYLES[level] ?? RISK_LEVEL_STYLES.low)}
      data-testid={`risk-badge-${level}`}
    >
      {level}
    </span>
  );
}

function SummaryCard({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="p-4 rounded-xl border border-border bg-card" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function UserDetailDrawer({
  userId,
  onClose,
  canRecordReview,
}: {
  userId: string;
  onClose: () => void;
  canRecordReview: boolean;
}) {
  const { data, isLoading } = useUserAccessReview(userId);
  const recordMutation = useRecordAccessReview(userId);
  const [reviewStatus, setReviewStatus] = useState("reviewed");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-background border-l border-border shadow-xl flex flex-col" data-testid="access-review-detail-drawer">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="font-semibold">User Access Detail</h2>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-accent" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {isLoading && <p className="text-muted-foreground">Loading...</p>}
        {data && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{data.user.displayName}</span>
              <RiskBadge level={data.riskLevel} />
              {data.user.isRootOwner && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">Root Owner</span>
              )}
              {data.user.isProtected && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Protected</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{data.user.email ?? "—"} · {data.user.roleCode} · {data.user.status}</p>

            {data.protectionReasons.length > 0 && (
              <section data-testid="detail-protection-reasons">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Protection reasons</h3>
                <div className="flex flex-wrap gap-1">
                  {data.protectionReasons.map((r) => (
                    <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">{r}</span>
                  ))}
                </div>
              </section>
            )}

            <section data-testid="detail-effective-permissions">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Effective permissions ({data.effectivePermissions.length})
              </h3>
              <div className="max-h-32 overflow-y-auto font-mono text-[10px] space-y-0.5 border border-border rounded p-2">
                {data.effectivePermissions.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
            </section>

            {data.criticalPermissions.length > 0 && (
              <section data-testid="detail-critical-permissions">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Critical permissions</h3>
                <div className="font-mono text-[10px] text-rose-700 dark:text-rose-300 space-y-0.5">
                  {data.criticalPermissions.map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </div>
              </section>
            )}

            {(data.grantedOverrides.length > 0 || data.deniedOverrides.length > 0) && (
              <section>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Custom overrides</h3>
                {data.grantedOverrides.length > 0 && (
                  <p className="text-[10px]"><span className="text-emerald-600">Grants:</span> {data.grantedOverrides.join(", ")}</p>
                )}
                {data.deniedOverrides.length > 0 && (
                  <p className="text-[10px] mt-1"><span className="text-rose-600">Denies:</span> {data.deniedOverrides.join(", ")}</p>
                )}
              </section>
            )}

            <section data-testid="detail-recent-audit">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Recent audit events</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.recentAuditEvents.length === 0 && (
                  <p className="text-xs text-muted-foreground">No recent events</p>
                )}
                {data.recentAuditEvents.map((ev) => (
                  <div key={ev.id} className="p-2 rounded border border-border text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PlatformAuditSeverityBadge severity={ev.severity} />
                      <span className="font-mono text-[10px]">{ev.action}</span>
                    </div>
                    {ev.blockedReason && <p className="text-rose-600 mt-1">Blocked: {ev.blockedReason}</p>}
                    <p className="text-muted-foreground text-[10px] mt-0.5">
                      {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {canRecordReview && (
              <section className="border-t border-border pt-4" data-testid="mark-reviewed-section">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Mark reviewed</h3>
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value)}
                  className="w-full mb-2 px-2 py-1.5 border border-input rounded text-xs"
                  data-testid="review-status-select"
                >
                  <option value="reviewed">Reviewed</option>
                  <option value="needs_follow_up">Needs follow-up</option>
                  <option value="exception_accepted">Exception accepted</option>
                </select>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={2}
                  placeholder="Review notes (optional)"
                  className="w-full px-2 py-1.5 border border-input rounded text-xs"
                  data-testid="review-notes-input"
                />
                {reviewError && <p className="text-xs text-destructive mt-1">{reviewError}</p>}
                <button
                  type="button"
                  disabled={recordMutation.isPending}
                  onClick={async () => {
                    setReviewError(null);
                    try {
                      await recordMutation.mutateAsync({ reviewStatus, reviewNotes: reviewNotes.trim() || undefined });
                    } catch (e: unknown) {
                      setReviewError(e instanceof Error ? e.message : "Failed to record review");
                    }
                  }}
                  className="mt-2 w-full px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium disabled:opacity-50"
                  data-testid="mark-reviewed-submit"
                >
                  Save review record
                </button>
                <p className="text-[10px] text-muted-foreground mt-2">Recording a review does not change permissions or account status.</p>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SuperAdminAccessReviewPage() {
  const { user: authUser } = useAppAuth();
  const canRead = hasPlatformPermissionClient(authUser ?? {}, "platform.accessReview.read");
  const canUpdate = hasPlatformPermissionClient(authUser ?? {}, "platform.accessReview.update");

  const { data: summary, isLoading, error, refetch } = useAccessReviewSummary(canRead);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [auditFilters, setAuditFilters] = useState<AuditEventFilters>({ page: 1, pageSize: 30 });
  const { data: auditData, isLoading: auditLoading } = useAccessReviewAuditEvents(auditFilters, canRead);

  if (!canRead) {
    return (
      <PlatformAccessDenied
        requiredPermission="platform.accessReview.read"
        data-testid="access-review-denied"
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="access-review-page">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Access Review</h1>
          <p className="text-sm text-muted-foreground">Platform administration access visibility — read-only audit</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground" data-testid="access-review-loading">Loading summary...</p>}
      {error && (
        <p className="text-sm text-destructive" data-testid="access-review-error">
          {error instanceof Error ? error.message : "Failed to load"}
        </p>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="access-review-summary-cards">
            <SummaryCard label="Total Platform Users" value={summary.totalPlatformUsers} testId="summary-total-users" />
            <SummaryCard label="Active" value={summary.activeUsers} testId="summary-active" />
            <SummaryCard label="Disabled / Suspended" value={summary.disabledUsers + summary.suspendedUsers} testId="summary-inactive" />
            <SummaryCard label="Root Owners" value={summary.rootOwners} testId="summary-root-owners" />
            <SummaryCard label="Protected Users" value={summary.protectedUsers} testId="summary-protected" />
            <SummaryCard label="Custom Overrides" value={summary.usersWithCustomOverrides} testId="summary-overrides" />
            <SummaryCard label="Critical Permissions" value={summary.usersWithCriticalPermissions} testId="summary-critical" />
            <SummaryCard label="High Risk Users" value={summary.highRiskUsers.length} testId="summary-high-risk" />
            <SummaryCard label="Stale Sensitive Users" value={summary.staleUsers.length} testId="summary-stale" />
          </div>

          <section data-testid="high-risk-users-table">
            <h2 className="text-lg font-semibold mb-3">High Risk Users</h2>
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">User</th>
                    <th className="text-left px-3 py-2">Role</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Risk</th>
                    <th className="text-left px-3 py-2">Critical</th>
                    <th className="text-left px-3 py-2">Overrides</th>
                    <th className="text-left px-3 py-2">Last login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.highRiskUsers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">No high-risk users</td>
                    </tr>
                  )}
                  {summary.highRiskUsers.map((row: HighRiskUserRow) => (
                    <tr
                      key={row.userId}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelectedUserId(row.userId)}
                      data-testid={`high-risk-row-${row.userId}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.displayName}</div>
                        <div className="text-[10px] text-muted-foreground">{row.email ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.roleCode}</td>
                      <td className="px-3 py-2">{row.status}</td>
                      <td className="px-3 py-2"><RiskBadge level={row.riskLevel} /></td>
                      <td className="px-3 py-2">{row.criticalPermissionsCount}</td>
                      <td className="px-3 py-2">{row.customOverridesCount}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.lastLoginAt ? formatDistanceToNow(new Date(row.lastLoginAt), { addSuffix: true }) : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="border border-border rounded-xl p-4 space-y-3" data-testid="audit-timeline-section">
        <h2 className="text-lg font-semibold">Audit Timeline</h2>
        <div className="flex flex-wrap gap-2 text-xs" data-testid="audit-timeline-filters">
          <input
            type="text"
            placeholder="User ID"
            className="px-2 py-1 border border-input rounded w-24"
            onChange={(e) => setAuditFilters((f) => ({ ...f, userId: e.target.value || undefined, page: 1 }))}
            data-testid="audit-filter-user"
          />
          <input
            type="text"
            placeholder="Actor ID"
            className="px-2 py-1 border border-input rounded w-24"
            onChange={(e) => setAuditFilters((f) => ({ ...f, actorId: e.target.value || undefined, page: 1 }))}
            data-testid="audit-filter-actor"
          />
          <input
            type="text"
            placeholder="Action"
            className="px-2 py-1 border border-input rounded min-w-[140px]"
            onChange={(e) => setAuditFilters((f) => ({ ...f, action: e.target.value || undefined, page: 1 }))}
            data-testid="audit-filter-action"
          />
          <input
            type="text"
            placeholder="Permission code"
            className="px-2 py-1 border border-input rounded min-w-[160px]"
            onChange={(e) => setAuditFilters((f) => ({ ...f, permissionCode: e.target.value || undefined, page: 1 }))}
            data-testid="audit-filter-permission"
          />
          <select
            className="px-2 py-1 border border-input rounded"
            onChange={(e) => setAuditFilters((f) => ({ ...f, severity: e.target.value || undefined, page: 1 }))}
            data-testid="audit-filter-severity"
          >
            <option value="">All severities</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              onChange={(e) => setAuditFilters((f) => ({ ...f, blockedOnly: e.target.checked, page: 1 }))}
              data-testid="audit-filter-blocked"
            />
            Blocked only
          </label>
          <button type="button" onClick={() => refetch()} className="px-2 py-1 border border-input rounded hover:bg-accent">
            Refresh summary
          </button>
        </div>
        {auditLoading && <p className="text-xs text-muted-foreground">Loading events...</p>}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(auditData?.events ?? []).map((ev) => (
            <div key={ev.id} className="p-3 rounded-lg border border-border text-xs" data-testid={`audit-event-${ev.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformAuditSeverityBadge severity={ev.severity} />
                <span className="font-medium">{ev.actionLabel}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{ev.action}</span>
              </div>
              <p className="text-muted-foreground mt-1">
                Actor: {ev.actorDisplayName ?? ev.actorId ?? "—"}
                {ev.targetUserId && ` · Target: ${ev.targetUserId}`}
              </p>
              {ev.blockedReason && <p className="text-rose-600 mt-0.5">Blocked: {ev.blockedReason}</p>}
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
              </p>
            </div>
          ))}
        </div>
        {auditData && (
          <p className="text-[10px] text-muted-foreground">
            Page {auditData.pagination.page} of {auditData.pagination.totalPages} ({auditData.pagination.total} events)
          </p>
        )}
      </section>

      {selectedUserId && (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          canRecordReview={canUpdate}
        />
      )}
    </div>
  );
}
