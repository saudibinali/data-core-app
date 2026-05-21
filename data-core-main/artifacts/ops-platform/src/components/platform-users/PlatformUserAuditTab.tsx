/**
 * @phase P17-F - Audit timeline tab (sanitized, no raw payload)
 */

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useAppAuth } from "@/lib/auth";
import { hasAnyPlatformPermissionClient } from "@/lib/platform-access";
import { usePlatformUserAuditEvents } from "@/lib/platform-users-console-hooks";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";

export function PlatformUserAuditTab({ user }: { user: PlatformUserProfile }) {
  const { user: authUser } = useAppAuth();
  const canView = hasAnyPlatformPermissionClient(authUser ?? {}, [
    "platform.activity.read",
    "audit.read",
    "platform.accessReview.read",
  ]);
  const [severity, setSeverity] = useState("");

  const { data, isLoading } = usePlatformUserAuditEvents(
    { userId: user.id, severity: severity || undefined, pageSize: 20 },
    canView,
  );

  if (!canView) {
    return <p className="text-xs text-muted-foreground">You do not have permission to view audit events.</p>;
  }

  const events = data?.events ?? [];

  return (
    <div className="space-y-3" data-testid="user-audit-tab">
      <div className="flex gap-2" data-testid="audit-timeline-filters">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-2 py-1 border rounded text-xs"
        >
          <option value="">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading audit events...</p>}

      <ul className="space-y-2 max-h-64 overflow-y-auto">
        {events.map((e) => (
          <li
            key={e.id}
            className="text-xs p-2 rounded border border-border"
            data-testid="audit-timeline-row"
          >
            <div>
              <span className="font-medium">{e.actionLabel}</span>
              <span className="text-muted-foreground ml-2">{e.severity}</span>
              {e.blockedReason && (
                <p className="text-destructive mt-1" data-testid="audit-blocked-reason">
                  {e.blockedReason}
                </p>
              )}
              {e.reason && <p className="text-muted-foreground mt-0.5">Reason: {e.reason}</p>}
              <p className="text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {events.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-4">No audit events</p>
      )}
    </div>
  );
}
