/**
 * @phase P17-F - Access Review tab (visibility + mark reviewed only)
 */

import { useState } from "react";
import { useAppAuth } from "@/lib/auth";
import { hasPlatformPermissionClient } from "@/lib/platform-access";
import { RISK_LEVEL_STYLES } from "@/lib/platform-access-review-config";
import {
  usePlatformUserAccessReview,
  useRecordAccessReview,
} from "@/lib/platform-users-console-hooks";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

export function PlatformUserAccessReviewTab({ user }: { user: PlatformUserProfile }) {
  const { user: authUser } = useAppAuth();
  const canUpdate = hasPlatformPermissionClient(authUser ?? {}, "platform.accessReview.update");
  const { data, isLoading } = usePlatformUserAccessReview(user.id);
  const recordMutation = useRecordAccessReview(user.id);
  const [reviewStatus, setReviewStatus] = useState("reviewed");
  const [reviewNotes, setReviewNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground" data-testid="access-review-tab-loading">Loading...</p>;
  }

  if (!data) {
    return <p className="text-xs text-muted-foreground">Access review data unavailable.</p>;
  }

  return (
    <div className="space-y-4 text-sm" data-testid="user-access-review-tab">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Risk level</span>
        <span
          className={cn("text-[10px] px-2 py-0.5 rounded font-medium uppercase", RISK_LEVEL_STYLES[data.riskLevel] ?? RISK_LEVEL_STYLES.low)}
          data-testid="user-risk-level"
        >
          {data.riskLevel}
        </span>
      </div>

      <section data-testid="critical-permissions-list">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Critical permissions</h4>
        {data.criticalPermissions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="text-xs font-mono space-y-0.5 max-h-24 overflow-y-auto">
            {data.criticalPermissions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="access-review-recent-events">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Recent audit events</h4>
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {data.recentAuditEvents.slice(0, 8).map((e) => (
            <li key={e.id} className="text-xs flex justify-between gap-2 border-b border-border/50 py-1">
              <span className="truncate">{e.actionLabel}</span>
              <span className="text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {canUpdate && (
        <section className="p-3 border rounded-lg space-y-2" data-testid="mark-reviewed-form">
          <h4 className="text-xs font-semibold">Mark reviewed</h4>
          <select
            value={reviewStatus}
            onChange={(e) => setReviewStatus(e.target.value)}
            className="w-full px-2 py-1 border rounded text-xs"
          >
            <option value="reviewed">Reviewed</option>
            <option value="needs_followup">Needs follow-up</option>
          </select>
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Review notes (optional)"
            rows={2}
            className="w-full px-2 py-1 border rounded text-xs"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="button"
            disabled={recordMutation.isPending}
            onClick={async () => {
              setError(null);
              try {
                await recordMutation.mutateAsync({ reviewStatus, reviewNotes: reviewNotes.trim() || undefined });
              } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to record review");
              }
            }}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded disabled:opacity-50"
            data-testid="mark-reviewed-submit"
          >
            Save review record
          </button>
        </section>
      )}
    </div>
  );
}
