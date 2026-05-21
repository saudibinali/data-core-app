/**
 * @phase P16-E - Super Admin Workspace Access Control
 */

import { useState } from "react";
import { Shield, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useTenantWorkspaceAccess,
  useTenantWorkspaceAccessEvaluation,
  useUpdateTenantWorkspaceAccess,
  useRefreshWorkspaceAccessEvaluation,
} from "@/hooks/use-workspace-access";
import { ENFORCEMENT_STATUS_LABELS } from "@/lib/workspace-access-enforcement-config";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
  canEvaluate: boolean;
}

export function WorkspaceAccessControlPanel({ tenantId, canRead, canUpdate, canEvaluate }: Props) {
  const { data: access, isLoading, error } = useTenantWorkspaceAccess(canRead ? tenantId : undefined);
  const { data: evalData, isLoading: evalLoading } = useTenantWorkspaceAccessEvaluation(
    canRead && canEvaluate ? tenantId : undefined,
  );
  const updateAccess = useUpdateTenantWorkspaceAccess(tenantId);
  const refreshEval = useRefreshWorkspaceAccessEvaluation(tenantId);

  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="workspace-access-denied">
        No permission to view workspace access control.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="workspace-access-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading access mode...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="workspace-access-error">
        {error instanceof Error ? error.message : "Failed to load access mode"}
      </p>
    );
  }

  const evaluation = evalData?.evaluation;
  const a = access!;

  async function applyMode(mode: string) {
    setFormError(null);
    if (!reason.trim() || reason.trim().length < 10) {
      setFormError("Reason is required (min 10 characters).");
      return;
    }
    try {
      await updateAccess.mutateAsync({
        enforcementStatus: mode,
        reason: reason.trim(),
        source: "manual",
      });
      setPendingMode(null);
      setReason("");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="workspace-access-control-panel">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Workspace Access Control - manual read-only enforcement. Users can log in and view data;
          operational writes are blocked. No login block, data deletion, or payments in this phase.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {canEvaluate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs h-8"
            onClick={() => void refreshEval.mutateAsync()}
            disabled={refreshEval.isPending}
            data-testid="workspace-access-evaluate-btn"
          >
            <RefreshCw className={cn("w-3 h-3 mr-1", refreshEval.isPending && "animate-spin")} />
            Evaluate Access
          </Button>
        )}
        {canUpdate && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-xs h-8"
              onClick={() => {
                setPendingMode("read_only");
                setReason("");
                setFormError(null);
              }}
              data-testid="workspace-access-apply-readonly-btn"
            >
              Apply Read-Only
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-xs h-8"
              onClick={() => {
                setPendingMode("suspended_view_only");
                setReason("");
                setFormError(null);
              }}
              data-testid="workspace-access-apply-suspended-btn"
            >
              Apply Suspended View-Only
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-xs h-8"
              onClick={() => {
                setPendingMode("terminated_view_only");
                setReason("");
                setFormError(null);
              }}
              data-testid="workspace-access-apply-terminated-btn"
            >
              Apply Terminated View-Only
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={() => {
                setPendingMode("normal");
                setReason("");
                setFormError(null);
              }}
              data-testid="workspace-access-restore-normal-btn"
            >
              Restore Normal
            </Button>
          </>
        )}
      </div>

      <dl className="rounded-md border border-border bg-background/50 p-4 grid gap-2 text-xs" data-testid="workspace-access-details">
        <Row label="Status" value={ENFORCEMENT_STATUS_LABELS[a.enforcementStatus]?.label ?? a.enforcementStatus} />
        <Row label="Allow login" value={a.allowLogin ? "Yes" : "No"} />
        <Row label="Allow read" value={a.allowRead ? "Yes" : "No"} />
        <Row label="Allow create" value={a.allowCreate ? "Yes" : "No"} />
        <Row label="Allow update" value={a.allowUpdate ? "Yes" : "No"} />
        <Row label="Allow delete" value={a.allowDelete ? "Yes" : "No"} />
        <Row label="Allow export" value={a.allowExport ? "Yes" : "No"} />
        <Row label="Subscription status" value={a.subscriptionStatus ?? "-"} />
        <Row label="Reason" value={a.reason ?? "-"} />
        <Row label="Source" value={a.source ?? "-"} />
        <Row label="Applied at" value={a.appliedAt ?? "-"} />
      </dl>

      {canEvaluate && (
        <div className="space-y-2" data-testid="workspace-access-evaluation">
          <h4 className="text-xs font-semibold">Access evaluation</h4>
          {evalLoading && !evaluation && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading evaluation...
            </div>
          )}
          {evaluation && (
            <div className="rounded-md border border-border p-3 text-xs space-y-1">
              <Row label="Recommendation" value={evaluation.recommendation} />
              <Row label="Subscription" value={evaluation.subscriptionStatus ?? "-"} />
              {evaluation.reasons.map((r, i) => (
                <p key={i} className="text-muted-foreground">
                  - {r}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingMode && (
        <Dialog open onOpenChange={(o) => !o && setPendingMode(null)}>
          <DialogContent className="max-w-md" data-testid="workspace-access-apply-modal">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Apply {ENFORCEMENT_STATUS_LABELS[pendingMode]?.label ?? pendingMode}
              </DialogTitle>
            </DialogHeader>
            <Label className="text-xs">Reason (required)</Label>
            <textarea
              className="w-full text-xs border rounded px-2 py-1.5 min-h-[72px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="workspace-access-reason"
            />
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setPendingMode(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={updateAccess.isPending}
                onClick={() => void applyMode(pendingMode)}
              >
                {updateAccess.isPending ? "Applying..." : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}
