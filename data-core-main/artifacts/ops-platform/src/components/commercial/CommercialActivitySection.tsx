/**
 * @phase P15-H - Tenant-scoped commercial activity (read-only)
 */

import { Loader2, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTenantCommercialActivity } from "@/hooks/use-commercial-activity";

interface Props {
  tenantId: string;
}

export function CommercialActivitySection({ tenantId }: Props) {
  const { data: items = [], isLoading, isError } = useTenantCommercialActivity(tenantId, true);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4" data-testid="commercial-activity-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading commercial activity...
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive" data-testid="commercial-activity-error">
        Failed to load commercial activity.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2" data-testid="commercial-activity-empty">
        No commercial audit events recorded for this tenant yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="commercial-activity-list">
      {items.map(item => (
        <li
          key={item.id}
          className="rounded-md border border-border p-2.5 text-xs"
          data-testid={`commercial-activity-item-${item.id}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium">
              <Activity className="w-3 h-3 text-muted-foreground shrink-0" />
              {item.actionLabel}
            </div>
            <Badge variant="outline" className="text-[10px]">
              {item.result}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {item.actorDisplayName ?? "System"}
            <span className="mx-1">·</span>
            {new Date(item.createdAt).toLocaleString()}
          </p>
          {item.metadataSummary && (
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {item.metadataSummary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
