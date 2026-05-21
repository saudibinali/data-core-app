/**
 * @phase P15-B - Contract Terms & Renewal Commitments
 */

import { useState, type ReactNode } from "react";
import { FileText, PlusCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  useTenantCommercialContracts,
  useCreateTenantCommercialContract,
  useUpdateTenantCommercialContract,
  useUpdateTenantCommercialContractStatus,
  type CommercialContractTerm,
  type CommercialContractCreateInput,
} from "@/hooks/use-commercial-contracts";
import {
  COMMERCIAL_CONTRACT_STATUS_CONFIG,
  RENEWAL_TYPE_CONFIG,
  RENEWAL_COMMITMENT_STATUS_CONFIG,
  BILLING_CYCLE_CONFIG,
  PAYMENT_TERMS_CONFIG,
  SUPPORTED_CONTRACT_CURRENCIES,
  type CommercialContractStatus,
} from "@/lib/commercial-config";

const STATUSES = Object.keys(COMMERCIAL_CONTRACT_STATUS_CONFIG) as CommercialContractStatus[];
const inp = "w-full rounded border border-input bg-background px-2 py-1 text-xs";

interface Props {
  tenantId: string;
  commercialAccountId: number | undefined;
  canWrite: boolean;
}

export function ContractTermsSection({ tenantId, commercialAccountId, canWrite }: Props) {
  const { data: contracts = [], isLoading } = useTenantCommercialContracts(tenantId);
  const createM = useCreateTenantCommercialContract(tenantId);
  const updateM = useUpdateTenantCommercialContract(tenantId);
  const statusM = useUpdateTenantCommercialContractStatus(tenantId);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CommercialContractCreateInput>({
    commercialAccountId: 0,
    renewalType: "manual",
    renewalCommitmentStatus: "not_started",
    status: "draft",
    currency: "SAR",
  });
  const [statusRow, setStatusRow] = useState<CommercialContractTerm | null>(null);
  const [newStatus, setNewStatus] = useState("active");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const busy = createM.isPending || updateM.isPending || statusM.isPending;

  function startCreate() {
    if (!commercialAccountId) return;
    setForm({
      commercialAccountId,
      renewalType: "manual",
      renewalCommitmentStatus: "not_started",
      status: "draft",
      currency: "SAR",
    });
    setEditId(null);
    setFormOpen(true);
    setStatusRow(null);
    setErr(null);
  }

  function startEdit(c: CommercialContractTerm) {
    setForm({
      commercialAccountId: c.commercialAccountId,
      contractNumber: c.contractNumber ?? "",
      contractTitle: c.contractTitle ?? "",
      contractStartDate: c.contractStartDate ?? "",
      contractEndDate: c.contractEndDate ?? "",
      renewalDate: c.renewalDate ?? "",
      renewalNoticeDays: c.renewalNoticeDays ?? undefined,
      contractTermMonths: c.contractTermMonths ?? undefined,
      renewalType: c.renewalType,
      renewalCommitmentStatus: c.renewalCommitmentStatus,
      contractValue: c.contractValue ? Number(c.contractValue) : undefined,
      currency: c.currency ?? "SAR",
      billingCycle: c.billingCycle ?? undefined,
      paymentTerms: c.paymentTerms ?? undefined,
      internalOwnerUserId: c.internalOwnerUserId ?? undefined,
      customerDecisionMakerName: c.customerDecisionMakerName ?? "",
      customerDecisionMakerEmail: c.customerDecisionMakerEmail ?? "",
      renewalNotes: c.renewalNotes ?? "",
      status: c.status,
    });
    setEditId(c.id);
    setFormOpen(true);
    setStatusRow(null);
    setErr(null);
  }

  async function saveForm() {
    if (!commercialAccountId) return;
    setErr(null);
    try {
      if (editId !== null) {
        const { commercialAccountId: _a, ...rest } = { ...form, commercialAccountId };
        await updateM.mutateAsync({ contractId: editId, input: rest });
      } else {
        await createM.mutateAsync({ ...form, commercialAccountId });
      }
      setFormOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function saveStatus() {
    if (!statusRow) return;
    if (reason.trim().length < 10) {
      setErr("Reason must be at least 10 characters");
      return;
    }
    setErr(null);
    try {
      await statusM.mutateAsync({ contractId: statusRow.id, status: newStatus, reason: reason.trim() });
      setStatusRow(null);
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Status change failed");
    }
  }

  return (
    <div>
      <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid="commercial-contract-terms-section">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Contract Terms &amp; Renewal</span>
            <span className="text-xs text-muted-foreground">Contracts &amp; renewal</span>
            <Badge variant="secondary" className="text-xs">{contracts.length}</Badge>
          </div>
          {canWrite && commercialAccountId && !formOpen && !statusRow && (
            <button
              type="button"
              onClick={startCreate}
              data-testid="commercial-add-contract-btn"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <PlusCircle className="w-3 h-3" />
              Add Contract Term
            </button>
          )}
        </div>
        <div className="px-4 py-4 space-y-3">
          {isLoading && (
            <div>
              <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> Loading...
            </div>
          )}
          {!isLoading && !commercialAccountId && (
            <p className="text-xs text-muted-foreground">Create a commercial account first to manage contract terms.</p>
          )}
          {!isLoading && commercialAccountId && contracts.length === 0 && !formOpen && !statusRow && (
            <p className="text-xs text-muted-foreground">No contract terms on file.</p>
          )}
          {!isLoading && contracts.map(c => (
            <ContractRow
              key={c.id}
              c={c}
              canWrite={canWrite}
              onEdit={() => startEdit(c)}
              onChangeStatus={() => {
                setStatusRow(c);
                setNewStatus("active");
                setReason("");
                setErr(null);
                setFormOpen(false);
              }}
            />
          ))}
          {formOpen && (
            <ContractFormBlock
              form={form}
              setForm={setForm}
              editId={editId}
              err={err}
              busy={busy}
              onSave={() => void saveForm()}
              onCancel={() => setFormOpen(false)}
            />
          )}
          {statusRow && canWrite && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-muted/10" data-testid="contract-status-form">
              <p className="text-xs font-semibold">Change Status</p>
              <select className={inp} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {STATUSES.map(s => (
                  <option key={s} value={s}>{COMMERCIAL_CONTRACT_STATUS_CONFIG[s].label}</option>
                ))}
              </select>
              <textarea
                className={`${inp} min-h-[60px]`}
                placeholder="Reason (min 10 chars)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              {err && <p className="text-xs text-destructive">{err}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveStatus()}
                  disabled={busy}
                  data-testid="commercial-contract-status-save-btn"
                  className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
                >
                  {busy ? "..." : "Apply"}
                </button>
                <button type="button" onClick={() => setStatusRow(null)} className="px-3 py-1 rounded border text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContractRow({
  c,
  canWrite,
  onEdit,
  onChangeStatus,
}: {
  c: CommercialContractTerm;
  canWrite: boolean;
  onEdit: () => void;
  onChangeStatus: () => void;
}) {
  const st = COMMERCIAL_CONTRACT_STATUS_CONFIG[c.status as CommercialContractStatus];
  const rt = RENEWAL_TYPE_CONFIG[c.renewalType as keyof typeof RENEWAL_TYPE_CONFIG];
  const rc = RENEWAL_COMMITMENT_STATUS_CONFIG[c.renewalCommitmentStatus as keyof typeof RENEWAL_COMMITMENT_STATUS_CONFIG];
  return (
    <div className="rounded-md border border-border p-3 text-xs space-y-1" data-testid={`commercial-contract-row-${c.id}`}>
      <div className="flex justify-between gap-2">
        <div>
          <span className="font-semibold">{c.contractNumber ?? "-"}</span>
          {c.contractTitle && <span className="text-muted-foreground ml-2">{c.contractTitle}</span>}
        </div>
        {st && <Badge variant={st.variant}>{st.label}</Badge>}
      </div>
      <p className="text-muted-foreground">
        {c.contractStartDate ?? "-"} → {c.contractEndDate ?? "-"} · Renewal {c.renewalDate ?? "-"}
      </p>
      <p>{rt?.label} · {rc?.label} · {c.contractValue ?? "-"} {c.currency ?? ""}</p>
      <p className="text-muted-foreground">
        Billing: {c.billingCycle ?? "-"} · Payment: {c.paymentTerms ?? "-"} · Owner ID: {c.internalOwnerUserId ?? "-"}
      </p>
      {(c.customerDecisionMakerName || c.customerDecisionMakerEmail) && (
        <p>
          Decision maker: {c.customerDecisionMakerName ?? "-"} · {c.customerDecisionMakerEmail ?? "-"}
        </p>
      )}
      {c.renewalNotes && <p className="italic text-muted-foreground">{c.renewalNotes}</p>}
      {canWrite && (
        <div className="flex gap-2 pt-1">
          <button type="button" data-testid={`commercial-contract-edit-${c.id}`} onClick={onEdit} className="text-[10px] border rounded px-1.5 py-0.5">
            Edit
          </button>
          <button type="button" data-testid={`commercial-contract-status-${c.id}`} onClick={onChangeStatus} className="text-[10px] border rounded px-1.5 py-0.5">
            Change Status
          </button>
        </div>
      )}
    </div>
  );
}

function ContractFormBlock({
  form,
  setForm,
  editId,
  err,
  busy,
  onSave,
  onCancel,
}: {
  form: CommercialContractCreateInput;
  setForm: (f: CommercialContractCreateInput) => void;
  editId: number | null;
  err: string | null;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (p: Partial<CommercialContractCreateInput>) => setForm({ ...form, ...p });
  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/10 text-xs" data-testid="commercial-contract-form">
      <p className="font-semibold">{editId ? "Edit Contract" : "New Contract"}</p>
      <div className="grid grid-cols-2 gap-2">
        <L label="Number"><input className={inp} value={form.contractNumber ?? ""} onChange={e => patch({ contractNumber: e.target.value })} /></L>
        <L label="Title"><input className={inp} value={form.contractTitle ?? ""} onChange={e => patch({ contractTitle: e.target.value })} /></L>
        <L label="Start"><input type="date" className={inp} value={form.contractStartDate ?? ""} onChange={e => patch({ contractStartDate: e.target.value })} /></L>
        <L label="End"><input type="date" className={inp} value={form.contractEndDate ?? ""} onChange={e => patch({ contractEndDate: e.target.value })} /></L>
        <L label="Renewal"><input type="date" className={inp} value={form.renewalDate ?? ""} onChange={e => patch({ renewalDate: e.target.value })} /></L>
        <L label="Notice days"><input type="number" min={0} className={inp} value={form.renewalNoticeDays ?? ""} onChange={e => patch({ renewalNoticeDays: e.target.value ? +e.target.value : undefined })} /></L>
        <L label="Term months"><input type="number" min={1} className={inp} value={form.contractTermMonths ?? ""} onChange={e => patch({ contractTermMonths: e.target.value ? +e.target.value : undefined })} /></L>
        <L label="Value"><input type="number" min={0} step="0.01" className={inp} value={form.contractValue ?? ""} onChange={e => patch({ contractValue: e.target.value ? +e.target.value : undefined })} /></L>
        <L label="Currency">
          <select className={inp} value={form.currency ?? "SAR"} onChange={e => patch({ currency: e.target.value })}>
            {SUPPORTED_CONTRACT_CURRENCIES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </L>
        <L label="Renewal type">
          <select className={inp} value={form.renewalType} onChange={e => patch({ renewalType: e.target.value })}>
            {Object.keys(RENEWAL_TYPE_CONFIG).map(k => (
              <option key={k} value={k}>{RENEWAL_TYPE_CONFIG[k as keyof typeof RENEWAL_TYPE_CONFIG].label}</option>
            ))}
          </select>
        </L>
        <L label="Commitment">
          <select className={inp} value={form.renewalCommitmentStatus} onChange={e => patch({ renewalCommitmentStatus: e.target.value })}>
            {Object.keys(RENEWAL_COMMITMENT_STATUS_CONFIG).map(k => (
              <option key={k} value={k}>
                {RENEWAL_COMMITMENT_STATUS_CONFIG[k as keyof typeof RENEWAL_COMMITMENT_STATUS_CONFIG].label}
              </option>
            ))}
          </select>
        </L>
        <L label="Billing cycle">
          <select className={inp} value={form.billingCycle ?? ""} onChange={e => patch({ billingCycle: e.target.value || undefined })}>
            <option value="">-</option>
            {Object.keys(BILLING_CYCLE_CONFIG).map(k => (
              <option key={k} value={k}>{BILLING_CYCLE_CONFIG[k as keyof typeof BILLING_CYCLE_CONFIG].label}</option>
            ))}
          </select>
        </L>
        <L label="Payment terms">
          <select className={inp} value={form.paymentTerms ?? ""} onChange={e => patch({ paymentTerms: e.target.value || undefined })}>
            <option value="">-</option>
            {Object.keys(PAYMENT_TERMS_CONFIG).map(k => (
              <option key={k} value={k}>{PAYMENT_TERMS_CONFIG[k as keyof typeof PAYMENT_TERMS_CONFIG].label}</option>
            ))}
          </select>
        </L>
        <L label="Owner user ID">
          <input type="number" min={1} className={inp} value={form.internalOwnerUserId ?? ""} onChange={e => patch({ internalOwnerUserId: e.target.value ? +e.target.value : null })} />
        </L>
        <L label="DM name"><input className={inp} value={form.customerDecisionMakerName ?? ""} onChange={e => patch({ customerDecisionMakerName: e.target.value })} /></L>
        <L label="DM email"><input type="email" className={inp} value={form.customerDecisionMakerEmail ?? ""} onChange={e => patch({ customerDecisionMakerEmail: e.target.value })} /></L>
        {editId === null && (
          <L label="Status">
            <select className={inp} value={form.status ?? "draft"} onChange={e => patch({ status: e.target.value })}>
              {STATUSES.map(s => <option key={s} value={s}>{COMMERCIAL_CONTRACT_STATUS_CONFIG[s].label}</option>)}
            </select>
          </L>
        )}
      </div>
      <L label="Notes">
        <textarea className={`${inp} min-h-[48px]`} value={form.renewalNotes ?? ""} onChange={e => patch({ renewalNotes: e.target.value })} />
      </L>
      {err && <p className="text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button type="button" data-testid="commercial-contract-save-btn" disabled={busy} onClick={onSave} className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1 border rounded">Cancel</button>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
