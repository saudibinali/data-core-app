/**
 * @phase P16-C - Limits & Quotas (indicators only, no enforcement)
 */

import { useState } from "react";
import { Gauge, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTenantQuotaUsage,
  useUpdateTenantQuotas,
  useUpdateTenantQuota,
  type QuotaUsageItem,
} from "@/hooks/use-workspace-quotas";
import { QUOTA_SOURCE_LABELS, QUOTA_STATUS_BADGE } from "@/lib/quota-model-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
}

function formatUsage(item: QuotaUsageItem): string {
  if (item.currentUsage === null) return "-";
  if (item.unit === "gb") return `${item.currentUsage} GB`;
  return String(item.currentUsage);
}

function formatLimit(item: QuotaUsageItem): string {
  if (item.limitValue === null) return "∞";
  if (item.unit === "gb") return `${item.limitValue} GB`;
  return String(item.limitValue);
}

export function LimitsQuotasPanel({ tenantId, canRead, canUpdate }: Props) {
  const { data: usage = [], isLoading, error, refetch } = useTenantQuotaUsage(
    canRead ? tenantId : undefined,
  );
  const bulkUpdate = useUpdateTenantQuotas(tenantId);
  const patchUpdate = useUpdateTenantQuota(tenantId);

  const [editItem, setEditItem] = useState<QuotaUsageItem | null>(null);
  const [limitValue, setLimitValue] = useState("");
  const [warningPct, setWarningPct] = useState("80");
  const [isHardLimit, setIsHardLimit] = useState(false);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="quotas-access-denied">
        No permission to view workspace quotas.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="quotas-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading quotas...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="quotas-error">
        {error instanceof Error ? error.message : "Failed to load quotas"}
      </p>
    );
  }

  function openEdit(item: QuotaUsageItem) {
    setEditItem(item);
    setLimitValue(item.limitValue === null ? "" : String(item.limitValue));
    setWarningPct(String(item.warningThresholdPercent));
    setIsHardLimit(item.isHardLimit);
    setReason("");
    setFormError(null);
  }

  async function saveEdit() {
    if (!editItem || !canUpdate) return;
    setFormError(null);

    const parsedLimit =
      limitValue.trim() === "" ? null : Number(limitValue);
    if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 0)) {
      setFormError("Limit must be a number >= 0, or empty for unlimited.");
      return;
    }

    const pct = Number(warningPct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      setFormError("Warning threshold must be between 1 and 100.");
      return;
    }

    const payload = {
      quotaKey: editItem.quotaKey,
      limitValue: parsedLimit,
      warningThresholdPercent: pct,
      isHardLimit,
      source: "manual" as const,
      reason: reason.trim() || undefined,
    };

    try {
      if (editItem.quotaLimitId) {
        await patchUpdate.mutateAsync({
          quotaLimitId: editItem.quotaLimitId,
          ...payload,
        });
      } else {
        await bulkUpdate.mutateAsync([payload]);
      }
      setEditItem(null);
      void refetch();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="limits-quotas-panel">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <Gauge className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Limits &amp; Quotas - usage indicators and configurable limits per workspace.
          No login blocking, suspension enforcement, payments, or destructive cleanup in this phase.
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs" data-testid="quotas-table">
          <thead className="bg-muted/50">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Quota</th>
              <th className="px-3 py-2 font-medium">Usage / Limit</th>
              <th className="px-3 py-2 font-medium">%</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Warn %</th>
              <th className="px-3 py-2 font-medium">Hard</th>
              <th className="px-3 py-2 font-medium">Source</th>
              {canUpdate && <th className="px-3 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {usage.map((item) => {
              const badge = QUOTA_STATUS_BADGE[item.status];
              return (
                <tr key={item.quotaKey} className="border-t border-border" data-testid={`quota-row-${item.quotaKey}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{item.quotaKey}</div>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatUsage(item)} / {formatLimit(item)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {item.usagePercent === null ? "-" : `${item.usagePercent}%`}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", badge.className)}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">{item.warningThresholdPercent}%</td>
                  <td className="px-3 py-2">{item.isHardLimit ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {QUOTA_SOURCE_LABELS[item.source ?? ""] ?? item.source ?? "-"}
                  </td>
                  {canUpdate && (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        data-testid={`edit-quota-${item.quotaKey}`}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={editItem !== null} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent data-testid="quota-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit quota - {editItem?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label htmlFor="quota-limit">Limit (empty = unlimited)</Label>
              <Input
                id="quota-limit"
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="quota-warn">Warning threshold %</Label>
              <Input
                id="quota-warn"
                type="number"
                min={1}
                max={100}
                value={warningPct}
                onChange={(e) => setWarningPct(e.target.value)}
                className="mt-1"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isHardLimit}
                onChange={(e) => setIsHardLimit(e.target.checked)}
                data-testid="quota-hard-limit"
              />
              Hard limit flag (indicator only in P16-C)
            </label>
            <div>
              <Label htmlFor="quota-reason">Reason (required when reducing limit or enabling hard limit)</Label>
              <Input
                id="quota-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1"
              />
            </div>
            {formError && (
              <p className="text-xs text-destructive" data-testid="quota-form-error">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditItem(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="quota-save"
              disabled={bulkUpdate.isPending || patchUpdate.isPending}
              onClick={() => void saveEdit()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
