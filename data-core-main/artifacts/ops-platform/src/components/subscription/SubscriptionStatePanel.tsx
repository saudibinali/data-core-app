/**
 * @phase P16-A - Subscription State (no enforcement, payment, or module blocking)
 */

import { useState } from "react";
import { CreditCard, Loader2, Pencil, PlusCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  WORKSPACE_SUBSCRIPTION_STATUS_CODES,
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
    try {
      await createMutation.mutateAsync(createForm);
      setShowCreate(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleEdit() {
    setFormError(null);
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

      {showCreate && (
        <FormModal title="Create Subscription" onClose={() => setShowCreate(false)} testId="subscription-create-modal">
          <SubscriptionFormFields
            form={createForm}
            setForm={setCreateForm}
            includeStatus
            accountId={account?.id}
            contracts={contracts}
          />
          <FormActions
            onCancel={() => setShowCreate(false)}
            onSubmit={() => void handleCreate()}
            pending={createMutation.isPending}
            label="Create"
          />
        </FormModal>
      )}

      {showEdit && subscription && (
        <FormModal title="Edit Subscription" onClose={() => setShowEdit(false)} testId="subscription-edit-modal">
          <SubscriptionFormFields
            form={editForm}
            setForm={setEditForm}
            accountId={account?.id}
            contracts={contracts}
          />
          <FormActions
            onCancel={() => setShowEdit(false)}
            onSubmit={() => void handleEdit()}
            pending={updateMutation.isPending}
            label="Save"
          />
        </FormModal>
      )}

      {showStatus && subscription && (
        <FormModal title="Change Status" onClose={() => setShowStatus(false)} testId="subscription-status-modal">
          <label className="block text-xs font-medium mb-1">New status</label>
          <select
            className="w-full text-xs border rounded px-2 py-1.5 mb-3"
            value={statusForm.status}
            onChange={(e) => setStatusForm((f) => ({ ...f, status: e.target.value }))}
            data-testid="subscription-status-select"
          >
            {WORKSPACE_SUBSCRIPTION_STATUS_CODES.filter((s) => s !== subscription.status).map((s) => (
              <option key={s} value={s}>
                {WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[s].label}
              </option>
            ))}
          </select>
          <label className="block text-xs font-medium mb-1">Reason (required)</label>
          <textarea
            className="w-full text-xs border rounded px-2 py-1.5 min-h-[80px]"
            value={statusForm.reason}
            onChange={(e) => setStatusForm((f) => ({ ...f, reason: e.target.value }))}
            data-testid="subscription-status-reason"
            placeholder="Explain why this status change is being recorded..."
          />
          <FormActions
            onCancel={() => setShowStatus(false)}
            onSubmit={() => void handleStatusChange()}
            pending={statusMutation.isPending}
            label="Apply Status"
          />
        </FormModal>
      )}

      {formError && (
        <p className="text-xs text-destructive" data-testid="subscription-form-error">
          {formError}
        </p>
      )}
    </div>
  );
}

function FormModal({
  title,
  children,
  onClose,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  testId: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid={testId}
    >
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md p-4 space-y-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        {children}
        <button type="button" className="text-xs text-muted-foreground underline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormActions({
  onCancel,
  onSubmit,
  pending,
  label,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="button"
        className="px-3 py-1.5 text-xs rounded border"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </button>
      <button
        type="button"
        className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground"
        onClick={onSubmit}
        disabled={pending}
        data-testid="subscription-form-submit"
      >
        {pending ? "Saving..." : label}
      </button>
    </div>
  );
}

function SubscriptionFormFields({
  form,
  setForm,
  includeStatus,
  accountId,
  contracts,
}: {
  form: WorkspaceSubscriptionCreateInput;
  setForm: React.Dispatch<React.SetStateAction<WorkspaceSubscriptionCreateInput>>;
  includeStatus?: boolean;
  accountId?: number;
  contracts: { id: number; contractNumber: string | null; contractTitle: string | null }[];
}) {
  return (
    <div className="space-y-2 text-xs">
      <input
        className="w-full border rounded px-2 py-1.5"
        placeholder="Subscription code"
        value={form.subscriptionCode}
        onChange={(e) => setForm((f) => ({ ...f, subscriptionCode: e.target.value }))}
        data-testid="subscription-form-code"
      />
      <input
        className="w-full border rounded px-2 py-1.5"
        placeholder="Subscription name"
        value={form.subscriptionName}
        onChange={(e) => setForm((f) => ({ ...f, subscriptionName: e.target.value }))}
        data-testid="subscription-form-name"
      />
      {includeStatus && (
        <select
          className="w-full border rounded px-2 py-1.5"
          value={form.status ?? "trial"}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
        >
          {WORKSPACE_SUBSCRIPTION_STATUS_CODES.map((s) => (
            <option key={s} value={s}>
              {WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>
      )}
      {accountId != null && (
        <input type="hidden" value={accountId} readOnly />
      )}
      <select
        className="w-full border rounded px-2 py-1.5"
        value={form.activeContractTermId ?? ""}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            activeContractTermId: e.target.value ? Number(e.target.value) : null,
          }))
        }
      >
        <option value="">No linked contract</option>
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.contractNumber ?? c.id} - {c.contractTitle ?? "Contract"}
          </option>
        ))}
      </select>
      <input
        type="date"
        className="w-full border rounded px-2 py-1.5"
        value={form.startDate ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value || undefined }))}
      />
      <input
        type="date"
        className="w-full border rounded px-2 py-1.5"
        value={form.endDate ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value || undefined }))}
      />
      <input
        type="date"
        className="w-full border rounded px-2 py-1.5"
        value={form.renewalDate ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value || undefined }))}
      />
      <input
        className="w-full border rounded px-2 py-1.5"
        placeholder="Plan name"
        value={form.planName ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value || undefined }))}
      />
      <textarea
        className="w-full border rounded px-2 py-1.5 min-h-[60px]"
        placeholder="Internal notes"
        value={form.internalNotes ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value || undefined }))}
      />
    </div>
  );
}
