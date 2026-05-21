/**
 * @phase P16-D - Grace & Suspension Policy (advisory model only)
 */

import { useState } from "react";
import { ShieldAlert, Loader2, Pencil, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  useTenantSubscriptionPolicy,
  useTenantSubscriptionPolicyEvaluation,
  useUpsertTenantSubscriptionPolicy,
  useRefreshSubscriptionPolicyEvaluation,
  type WorkspaceSubscriptionPolicyRecord,
  type SubscriptionPolicyUpsertInput,
} from "@/hooks/use-tenant-subscription-policy";
import { useUpdateTenantSubscriptionStatus } from "@/hooks/use-tenant-subscription";
import {
  ENFORCEMENT_MODE_LABELS,
  RECOMMENDED_ACTION_LABELS,
  RECOMMENDED_STATUS_LABELS,
} from "@/lib/subscription-policy-model-config";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
  canEvaluate: boolean;
  canApplyRecommendedStatus: boolean;
}

const STATUS_FROM_ACTION: Record<string, string> = {
  mark_grace_period: "grace_period",
  mark_past_due: "past_due",
  mark_suspended: "suspended",
  mark_terminated: "terminated",
};

export function GraceSuspensionPolicyPanel({
  tenantId,
  canRead,
  canUpdate,
  canEvaluate,
  canApplyRecommendedStatus,
}: Props) {
  const { data: policy, isLoading, error } = useTenantSubscriptionPolicy(canRead ? tenantId : undefined);
  const {
    data: evalData,
    isLoading: evalLoading,
    error: evalError,
  } = useTenantSubscriptionPolicyEvaluation(canRead && canEvaluate ? tenantId : undefined);

  const upsert = useUpsertTenantSubscriptionPolicy(tenantId);
  const refreshEval = useRefreshSubscriptionPolicyEvaluation(tenantId);
  const statusMutation = useUpdateTenantSubscriptionStatus(tenantId);

  const [showEdit, setShowEdit] = useState(false);
  const [applyReason, setApplyReason] = useState("");
  const [showApply, setShowApply] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState<SubscriptionPolicyUpsertInput>({
    policyName: "Default grace & suspension policy",
    gracePeriodDays: 7,
    pastDueAfterDays: 14,
    suspensionAfterDays: 30,
    terminationAfterDays: 90,
    allowReadOnlyDuringSuspension: true,
    allowAdminAccessDuringSuspension: true,
    allowDataExportDuringSuspension: true,
    enforcementMode: "advisory_only",
    isActive: true,
    reason: "",
  });

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="subscription-policy-access-denied">
        No permission to view grace &amp; suspension policy.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="subscription-policy-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading policy...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="subscription-policy-error">
        {error instanceof Error ? error.message : "Failed to load policy"}
      </p>
    );
  }

  const evaluation = evalData?.evaluation;
  const recommendedAction = evaluation?.recommendedAction ?? "none";
  const applyStatus = STATUS_FROM_ACTION[recommendedAction];
  const canShowApply =
    canApplyRecommendedStatus &&
    !!applyStatus &&
    recommendedAction !== "none" &&
    recommendedAction !== "review_required" &&
    evaluation?.recommendedStatus !== "no_change";

  function openEdit(p: WorkspaceSubscriptionPolicyRecord) {
    setForm({
      policyName: p.policyName,
      gracePeriodDays: p.gracePeriodDays,
      pastDueAfterDays: p.pastDueAfterDays,
      suspensionAfterDays: p.suspensionAfterDays,
      terminationAfterDays: p.terminationAfterDays,
      allowReadOnlyDuringSuspension: p.allowReadOnlyDuringSuspension,
      allowAdminAccessDuringSuspension: p.allowAdminAccessDuringSuspension,
      allowDataExportDuringSuspension: p.allowDataExportDuringSuspension,
      enforcementMode: p.enforcementMode,
      isActive: p.isActive,
      subscriptionId: p.subscriptionId,
      reason: "",
      internalNotes: p.internalNotes ?? "",
    });
    setFormError(null);
    setShowEdit(true);
  }

  async function savePolicy() {
    setFormError(null);
    if (!form.reason.trim() || form.reason.trim().length < 10) {
      setFormError("Reason is required (min 10 characters).");
      return;
    }
    try {
      await upsert.mutateAsync(form);
      setShowEdit(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleEvaluate() {
    if (!canEvaluate) return;
    try {
      await refreshEval.mutateAsync();
    } catch {
      /* evalError */
    }
  }

  async function handleApplyRecommended() {
    if (!applyStatus || !applyReason.trim() || applyReason.trim().length < 10) {
      setFormError("Reason is required (min 10 characters).");
      return;
    }
    setFormError(null);
    try {
      await statusMutation.mutateAsync({
        status: applyStatus,
        reason: applyReason.trim(),
      });
      setShowApply(false);
      setApplyReason("");
      void refreshEval.mutateAsync();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Status change failed");
    }
  }

  const p = policy!;

  return (
    <div className="space-y-4" data-testid="grace-suspension-policy-panel">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Grace &amp; Suspension Policy - advisory rules only. No login blocking, module lockout,
          workspace shutdown, payments, or automated enforcement in this phase.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {canUpdate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs h-8"
            onClick={() => openEdit(p)}
            data-testid="subscription-policy-edit-btn"
          >
            <Pencil className="w-3 h-3 mr-1" />
            Edit Policy
          </Button>
        )}
        {canEvaluate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs h-8"
            onClick={() => void handleEvaluate()}
            disabled={refreshEval.isPending}
            data-testid="subscription-policy-evaluate-btn"
          >
            <RefreshCw className={cn("w-3 h-3 mr-1", refreshEval.isPending && "animate-spin")} />
            Evaluate
          </Button>
        )}
        {canShowApply && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="text-xs h-8"
            onClick={() => {
              setApplyReason("");
              setFormError(null);
              setShowApply(true);
            }}
            data-testid="subscription-policy-apply-recommended-btn"
          >
            Apply Recommended Status
          </Button>
        )}
      </div>

      <dl className="rounded-md border border-border bg-background/50 p-4 grid gap-2 text-xs" data-testid="subscription-policy-details">
        <PolicyRow label="Policy name" value={p.policyName} />
        {p.isDefault && (
          <p className="text-muted-foreground italic" data-testid="subscription-policy-default-badge">
            Using system default (not yet saved for this workspace).
          </p>
        )}
        <PolicyRow label="Grace period (days)" value={String(p.gracePeriodDays)} />
        <PolicyRow label="Past due after (days)" value={String(p.pastDueAfterDays)} />
        <PolicyRow label="Suspension after (days)" value={String(p.suspensionAfterDays)} />
        <PolicyRow
          label="Termination after (days)"
          value={p.terminationAfterDays == null ? "-" : String(p.terminationAfterDays)}
        />
        <PolicyRow label="Read-only during suspension" value={p.allowReadOnlyDuringSuspension ? "Yes" : "No"} />
        <PolicyRow label="Admin access during suspension" value={p.allowAdminAccessDuringSuspension ? "Yes" : "No"} />
        <PolicyRow label="Data export during suspension" value={p.allowDataExportDuringSuspension ? "Yes" : "No"} />
        <PolicyRow
          label="Enforcement mode"
          value={ENFORCEMENT_MODE_LABELS[p.enforcementMode]?.label ?? p.enforcementMode}
        />
        <PolicyRow label="Active" value={p.isActive ? "Yes" : "No"} />
      </dl>

      {canEvaluate && (
        <div className="space-y-2" data-testid="subscription-policy-evaluation">
          <h4 className="text-xs font-semibold">Policy evaluation</h4>
          {evalLoading && !evaluation && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="subscription-policy-evaluation-loading">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading evaluation...
            </div>
          )}
          {evalError && (
            <p className="text-xs text-destructive">
              {evalError instanceof Error ? evalError.message : "Evaluation failed"}
            </p>
          )}
          {evaluation && (
            <div className="rounded-md border border-border p-3 space-y-2 text-xs">
              <PolicyRow label="Current status" value={evaluation.currentSubscriptionStatus} />
              <PolicyRow
                label="Days since end date"
                value={evaluation.daysSinceEndDate == null ? "-" : String(evaluation.daysSinceEndDate)}
              />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Recommended status:</span>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium",
                    RECOMMENDED_STATUS_LABELS[evaluation.recommendedStatus]?.className ?? "bg-muted",
                  )}
                  data-testid="subscription-policy-recommended-status"
                >
                  {RECOMMENDED_STATUS_LABELS[evaluation.recommendedStatus]?.label ??
                    evaluation.recommendedStatus}
                </span>
              </div>
              <PolicyRow
                label="Recommended action"
                value={RECOMMENDED_ACTION_LABELS[evaluation.recommendedAction] ?? evaluation.recommendedAction}
              />
              <PolicyRow label="Automatic allowed" value="No" />
              <PolicyRow label="Enforcement mode" value={evaluation.enforcementMode} />
              {evaluation.reasons.length > 0 && (
                <ul className="list-disc pl-4 text-muted-foreground space-y-1" data-testid="subscription-policy-reasons">
                  {evaluation.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {showEdit && (
        <Dialog open onOpenChange={(o) => !o && setShowEdit(false)}>
          <DialogContent className="max-w-md" data-testid="subscription-policy-edit-modal">
            <DialogHeader>
              <DialogTitle className="text-sm">Edit Grace &amp; Suspension Policy</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-xs">
              <Field label="Policy name" value={form.policyName} onChange={(v) => setForm((f) => ({ ...f, policyName: v }))} />
              <Field label="Grace period days" type="number" value={String(form.gracePeriodDays)} onChange={(v) => setForm((f) => ({ ...f, gracePeriodDays: Number(v) }))} />
              <Field label="Past due after days" type="number" value={String(form.pastDueAfterDays)} onChange={(v) => setForm((f) => ({ ...f, pastDueAfterDays: Number(v) }))} />
              <Field label="Suspension after days" type="number" value={String(form.suspensionAfterDays)} onChange={(v) => setForm((f) => ({ ...f, suspensionAfterDays: Number(v) }))} />
              <Field
                label="Termination after days (optional)"
                type="number"
                value={form.terminationAfterDays == null ? "" : String(form.terminationAfterDays)}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    terminationAfterDays: v.trim() === "" ? null : Number(v),
                  }))
                }
              />
              <CheckRow
                label="Allow read-only during suspension"
                checked={form.allowReadOnlyDuringSuspension ?? true}
                onChange={(c) => setForm((f) => ({ ...f, allowReadOnlyDuringSuspension: c }))}
              />
              <CheckRow
                label="Allow admin access during suspension"
                checked={form.allowAdminAccessDuringSuspension ?? true}
                onChange={(c) => setForm((f) => ({ ...f, allowAdminAccessDuringSuspension: c }))}
              />
              <CheckRow
                label="Allow data export during suspension"
                checked={form.allowDataExportDuringSuspension ?? true}
                onChange={(c) => setForm((f) => ({ ...f, allowDataExportDuringSuspension: c }))}
              />
              <Label className="text-xs">Enforcement mode</Label>
              <select
                className="w-full text-xs border rounded px-2 py-1.5"
                value={form.enforcementMode}
                onChange={(e) => setForm((f) => ({ ...f, enforcementMode: e.target.value }))}
              >
                <option value="advisory_only">Advisory only</option>
                <option value="manual_required">Manual required</option>
                <option value="automatic_recommended">Automatic recommended</option>
              </select>
              <Label className="text-xs">Reason (required)</Label>
              <textarea
                className="w-full text-xs border rounded px-2 py-1.5 min-h-[72px]"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                data-testid="subscription-policy-reason"
              />
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowEdit(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void savePolicy()}
                disabled={upsert.isPending}
                data-testid="subscription-policy-save-btn"
              >
                {upsert.isPending ? "Saving..." : "Save Policy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showApply && applyStatus && (
        <Dialog open onOpenChange={(o) => !o && setShowApply(false)}>
          <DialogContent className="max-w-md" data-testid="subscription-policy-apply-modal">
            <DialogHeader>
              <DialogTitle className="text-sm">Apply Recommended Status</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Manually apply recommended status <strong>{applyStatus}</strong> via subscription
              status change (P16-A). This does not enforce login or module blocking.
            </p>
            <Label className="text-xs">Reason (required)</Label>
            <textarea
              className="w-full text-xs border rounded px-2 py-1.5 min-h-[72px]"
              value={applyReason}
              onChange={(e) => setApplyReason(e.target.value)}
              data-testid="subscription-policy-apply-reason"
            />
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowApply(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleApplyRecommended()}
                disabled={statusMutation.isPending}
              >
                {statusMutation.isPending ? "Applying..." : "Apply Status"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={type} className="text-xs h-8 mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
