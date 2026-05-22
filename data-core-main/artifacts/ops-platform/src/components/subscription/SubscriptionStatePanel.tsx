/**
 * @phase P16-A - Subscription State (no enforcement, payment, or module blocking)
 */

import { useState } from "react";
import { CreditCard, Loader2, Pencil, PlusCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTenantProfile } from "@/lib/tenant-registry-hooks";
import {
  SubscriptionFormBody,
  SubscriptionStatusSelect,
  validateSubscriptionForm,
  type SubscriptionFormErrors,
} from "@/components/subscription/subscription-form-ui";
import {
  useTenantSubscription,
  useCreateTenantSubscription,
  useUpdateTenantSubscription,
  useUpdateTenantSubscriptionStatus,
  type WorkspaceSubscription,
  type WorkspaceSubscriptionCreateInput,
} from "@/hooks/use-tenant-subscription";
import { useCommercialAccount } from "@/hooks/use-commercial";
import { useTenantCommercialContracts } from "@/hooks/use-commercial-contracts";
import {
  WORKSPACE_SUBSCRIPTION_STATUS_CONFIG,
  type WorkspaceSubscriptionStatusCode,
} from "@/lib/subscription-state-config";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
  canChangeStatus: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const cfg =
    WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[status as WorkspaceSubscriptionStatusCode] ?? null;
  if (!cfg) {
    return <Badge variant="outline">{status}</Badge>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
        cfg.badgeClass,
      )}
    >
      {cfg.label}
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground font-medium">{label}</dt>
      <dd className="text-foreground break-words">{value ?? "-"}</dd>
    </div>
  );
}

export function SubscriptionStatePanel({
  tenantId,
  canRead,
  canUpdate,
  canChangeStatus,
}: Props) {
  const { data: subscription, isLoading, error } = useTenantSubscription(
    canRead ? tenantId : undefined,
  );
  const { data: account } = useCommercialAccount(canRead ? tenantId : undefined);
  const { data: contracts = [] } = useTenantCommercialContracts(canRead ? tenantId : undefined);

  const createMutation = useCreateTenantSubscription(tenantId);
  const updateMutation = useUpdateTenantSubscription(tenantId);
  const statusMutation = useUpdateTenantSubscriptionStatus(tenantId);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SubscriptionFormErrors>({});

  const { data: tenantProfileData } = useTenantProfile(canRead ? tenantId : null);
  const tenantRegion = tenantProfileData?.tenant.region ?? null;

  const [createForm, setCreateForm] = useState<WorkspaceSubscriptionCreateInput>({
    subscriptionCode: "",
    subscriptionName: "",
    status: "trial",
  });
  const [editForm, setEditForm] = useState<WorkspaceSubscriptionCreateInput>({
    subscriptionCode: "",
    subscriptionName: "",
  });
  const [statusForm, setStatusForm] = useState({ status: "active", reason: "" });

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="subscription-state-access-denied">
        No permission to view workspace subscription state.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="subscription-state-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading subscription state...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="subscription-state-error">
        {error instanceof Error ? error.message : "Failed to load subscription"}
      </p>
    );
  }

  const linkedAccount = account?.commercialAccountName ?? (subscription?.commercialAccountId
    ? `Account #${subscription.commercialAccountId}`
    : null);
  const linkedContract = contracts.find(
    (c) => c.id === subscription?.activeContractTermId,
  );
  const linkedContractLabel = linkedContract
    ? `${linkedContract.contractNumber ?? linkedContract.id} - ${linkedContract.contractTitle ?? "Contract"}`
    : subscription?.activeContractTermId
      ? `Contract #${subscription.activeContractTermId}`
      : null;

  function openEdit(sub: WorkspaceSubscription) {
    setEditForm({
      subscriptionCode: sub.subscriptionCode,
      subscriptionName: sub.subscriptionName,
      commercialAccountId: sub.commercialAccountId,
      activeContractTermId: sub.activeContractTermId,
      startDate: sub.startDate ?? undefined,
      endDate: sub.endDate ?? undefined,
      renewalDate: sub.renewalDate ?? undefined,
      planName: sub.planName ?? undefined,
      internalNotes: sub.internalNotes ?? undefined,
    });
    setFieldErrors({});
    setShowEdit(true);
    setFormError(null);
  }

  function openStatus(sub: WorkspaceSubscription) {
    setStatusForm({ status: sub.status === "trial" ? "active" : sub.status, reason: "" });
    setShowStatus(true);
    setFormError(null);
  }

  async function handleCreate() {
    setFormError(null);
    const errors = validateSubscriptionForm(createForm);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      await createMutation.mutateAsync(createForm);
      setShowCreate(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleEdit() {
    setFormError(null);
    const errors = validateSubscriptionForm(editForm);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      await updateMutation.mutateAsync(editForm);
      setShowEdit(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleStatusChange() {
    setFormError(null);
    try {
      await statusMutation.mutateAsync(statusForm);
      setShowStatus(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Status change failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="subscription-state-panel">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <CreditCard className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Subscription state model only - linked to commercial account and contract.
          No enforcement, module blocking, login suspension, or electronic payment.
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">Subscription State</h3>
        <div className="flex items-center gap-2">
          {!subscription && canUpdate && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground"
              data-testid="subscription-create-btn"
              onClick={() => {
                setCreateForm({
                  subscriptionCode: "",
                  subscriptionName: "",
                  status: "trial",
                  commercialAccountId: account?.id ?? null,
                });
                setFieldErrors({});
                setShowCreate(true);
                setFormError(null);
              }}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Create Subscription
            </button>
          )}
          {subscription && canUpdate && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border"
              data-testid="subscription-edit-btn"
              onClick={() => openEdit(subscription)}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Subscription
            </button>
          )}
          {subscription && canChangeStatus && subscription.status !== "archived" && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border"
              data-testid="subscription-status-btn"
              onClick={() => openStatus(subscription)}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Change Status
            </button>
          )}
        </div>
      </div>

      {!subscription && (
        <p className="text-xs text-muted-foreground" data-testid="subscription-state-empty">
          No workspace subscription record. Create one to track commercial subscription state.
        </p>
      )}

      {subscription && (
        <dl className="rounded-md border border-border bg-background/50 p-4" data-testid="subscription-state-details">
          <FieldRow label="Code" value={<code className="text-[11px]">{subscription.subscriptionCode}</code>} />
          <FieldRow label="Name" value={subscription.subscriptionName} />
          <FieldRow label="Status" value={<StatusBadge status={subscription.status} />} />
          <FieldRow label="Plan" value={subscription.planName} />
          <FieldRow label="Start" value={subscription.startDate} />
          <FieldRow label="End" value={subscription.endDate} />
          <FieldRow label="Renewal" value={subscription.renewalDate} />
          <FieldRow
            label="Grace ends"
            value={subscription.gracePeriodEndsAt ? new Date(subscription.gracePeriodEndsAt).toLocaleString() : null}
          />
          <FieldRow
            label="Suspended at"
            value={subscription.suspensionStartedAt ? new Date(subscription.suspensionStartedAt).toLocaleString() : null}
          />
          <FieldRow label="Terminated" value={subscription.terminationDate} />
          <FieldRow label="Commercial account" value={linkedAccount} />
          <FieldRow label="Active contract" value={linkedContractLabel} />
          <FieldRow label="Status reason" value={subscription.statusReason} />
          <FieldRow label="Internal notes" value={subscription.internalNotes} />
        </dl>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => !open && !createMutation.isPending && setShowCreate(false)}>
        <DialogContent
          className="sm:max-w-xl max-h-[min(90dvh,880px)] flex flex-col gap-0 p-0 overflow-hidden"
          data-testid="subscription-create-modal"
        >
          <DialogHeader className="px-6 pt-6 pb-2 space-y-1.5 border-b border-border shrink-0">
            <DialogTitle className="text-lg font-semibold text-foreground">Create Subscription</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Register workspace subscription state linked to the commercial account. Metadata only — no
              payment or access enforcement.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <SubscriptionFormBody
              form={createForm}
              setForm={setCreateForm}
              includeStatus
              tenantId={tenantId}
              region={tenantRegion}
              contracts={contracts}
              fieldErrors={fieldErrors}
              disabled={createMutation.isPending}
            />
            {formError && showCreate ? (
              <p className="mt-3 text-xs text-destructive" role="alert" data-testid="subscription-form-error">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreate(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={createMutation.isPending}
              data-testid="subscription-form-submit"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create subscription"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={(open) => !open && !updateMutation.isPending && setShowEdit(false)}>
        <DialogContent
          className="sm:max-w-xl max-h-[min(90dvh,880px)] flex flex-col gap-0 p-0 overflow-hidden"
          data-testid="subscription-edit-modal"
        >
          <DialogHeader className="px-6 pt-6 pb-2 space-y-1.5 border-b border-border shrink-0">
            <DialogTitle className="text-lg font-semibold text-foreground">Edit Subscription</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Update subscription metadata. Changes are audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <SubscriptionFormBody
              form={editForm}
              setForm={setEditForm}
              tenantId={tenantId}
              region={tenantRegion}
              contracts={contracts}
              fieldErrors={fieldErrors}
              disabled={updateMutation.isPending}
            />
            {formError && showEdit ? (
              <p className="mt-3 text-xs text-destructive" role="alert" data-testid="subscription-form-error">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowEdit(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleEdit()}
              disabled={updateMutation.isPending}
              data-testid="subscription-form-submit"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStatus} onOpenChange={(open) => !open && !statusMutation.isPending && setShowStatus(false)}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="subscription-status-modal"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">Change Status</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Record a lifecycle status transition with a required reason (audit-logged).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="subscription-status-select" className="text-sm font-medium text-foreground">
                New status <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">Select the target subscription lifecycle state.</p>
              <SubscriptionStatusSelect
                id="subscription-status-select"
                value={statusForm.status}
                onChange={(v) => setStatusForm((f) => ({ ...f, status: v }))}
                excludeStatus={subscription?.status}
                disabled={statusMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subscription-status-reason" className="text-sm font-medium text-foreground">
                Reason <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Explain why this status change is being recorded for compliance and audit review.
              </p>
              <Textarea
                id="subscription-status-reason"
                className="min-h-[88px] resize-y bg-background text-foreground border-input text-sm"
                value={statusForm.reason}
                onChange={(e) => setStatusForm((f) => ({ ...f, reason: e.target.value }))}
                disabled={statusMutation.isPending}
                data-testid="subscription-status-reason"
                placeholder="e.g. Customer requested activation after contract signature…"
              />
            </div>
            {formError && showStatus ? (
              <p className="text-xs text-destructive" role="alert" data-testid="subscription-form-error">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowStatus(false)}
              disabled={statusMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleStatusChange()}
              disabled={statusMutation.isPending || !statusForm.reason.trim()}
              data-testid="subscription-form-submit"
            >
              {statusMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  Applying…
                </>
              ) : (
                "Apply status"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

