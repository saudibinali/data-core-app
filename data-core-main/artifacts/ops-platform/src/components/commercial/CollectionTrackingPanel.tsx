/**
 * @phase P15-E - Collection Tracking (manual payments only)
 */

import { useState } from "react";
import { Loader2, X, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CommercialInvoice } from "@/hooks/use-commercial-invoices";
import {
  useTenantCommercialPayments,
  useInvoiceCollectionSummary,
  useRecordCommercialPayment,
  useUpdateCommercialPayment,
  useVerifyCommercialPayment,
  useRejectCommercialPayment,
  useReverseCommercialPayment,
  type CommercialPaymentRecord,
} from "@/hooks/use-commercial-payments";
import {
  COLLECTION_STATE_CONFIG,
  COLLECTION_STATUS_CONFIG,
  PAYMENT_METHOD_CONFIG,
  PAYMENT_METHOD_CODES,
  SUPPORTED_CONTRACT_CURRENCIES,
  type CollectionStatus,
  type CollectionState,
  type PaymentMethod,
} from "@/lib/commercial-config";

const inp = "w-full rounded border border-input bg-background px-2 py-1 text-xs";
const MIN_REASON = 10;

interface Props {
  tenantId: string;
  invoice: CommercialInvoice;
  commercialAccountId: number;
  canRecord: boolean;
  canVerify: boolean;
  onClose: () => void;
}

export function CollectionTrackingPanel({
  tenantId,
  invoice,
  commercialAccountId,
  canRecord,
  canVerify,
  onClose,
}: Props) {
  const invoiceId = invoice.id;
  const { data: summary, isLoading: summaryLoading } = useInvoiceCollectionSummary(tenantId, invoiceId);
  const { data: payments = [], isLoading: paymentsLoading } = useTenantCommercialPayments(tenantId, {
    invoiceId,
  });

  const recordM = useRecordCommercialPayment(tenantId, invoiceId);
  const updateM = useUpdateCommercialPayment(tenantId, invoiceId);
  const verifyM = useVerifyCommercialPayment(tenantId, invoiceId);
  const rejectM = useRejectCommercialPayment(tenantId, invoiceId);
  const reverseM = useReverseCommercialPayment(tenantId, invoiceId);

  const [recordOpen, setRecordOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<CommercialPaymentRecord | null>(null);
  const [actionPayment, setActionPayment] = useState<{
    payment: CommercialPaymentRecord;
    action: "verify" | "reject" | "reverse";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    paymentReference: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    receivedAmount: "",
    currency: invoice.currency ?? "SAR",
    paymentMethod: "bank_transfer" as PaymentMethod,
    internalNotes: "",
  });

  const busy =
    recordM.isPending || updateM.isPending || verifyM.isPending
    || rejectM.isPending || reverseM.isPending;

  const collectionState = summary?.collectionState as CollectionState | undefined;
  const stateCfg = collectionState ? COLLECTION_STATE_CONFIG[collectionState] : null;

  async function saveRecord() {
    const amt = Number(form.receivedAmount);
    if (!form.paymentReference.trim()) {
      setErr("Payment reference is required");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Amount must be greater than 0");
      return;
    }
    setErr(null);
    try {
      if (editPayment) {
        await updateM.mutateAsync({
          paymentId: editPayment.id,
          input: {
            paymentReference: form.paymentReference.trim(),
            paymentDate: form.paymentDate,
            receivedAmount: amt,
            currency: form.currency,
            paymentMethod: form.paymentMethod,
            internalNotes: form.internalNotes || undefined,
          },
        });
        setEditPayment(null);
      } else {
        await recordM.mutateAsync({
          paymentReference: form.paymentReference.trim(),
          paymentDate: form.paymentDate,
          receivedAmount: amt,
          currency: form.currency,
          paymentMethod: form.paymentMethod,
          internalNotes: form.internalNotes || undefined,
          commercialAccountId,
        });
      }
      setRecordOpen(false);
      resetForm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save payment");
    }
  }

  async function runAction() {
    if (!actionPayment) return;
    if (reason.trim().length < MIN_REASON) {
      setErr(`Reason must be at least ${MIN_REASON} characters`);
      return;
    }
    setErr(null);
    try {
      const { payment, action } = actionPayment;
      if (action === "verify") {
        await verifyM.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      } else if (action === "reject") {
        await rejectM.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      } else {
        await reverseM.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      }
      setActionPayment(null);
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  }

  function resetForm() {
    setForm({
      paymentReference: "",
      paymentDate: new Date().toISOString().slice(0, 10),
      receivedAmount: "",
      currency: invoice.currency ?? "SAR",
      paymentMethod: "bank_transfer",
      internalNotes: "",
    });
  }

  function startEdit(p: CommercialPaymentRecord) {
    setEditPayment(p);
    setRecordOpen(true);
    setForm({
      paymentReference: p.paymentReference,
      paymentDate: p.paymentDate,
      receivedAmount: p.receivedAmount,
      currency: p.currency,
      paymentMethod: p.paymentMethod as PaymentMethod,
      internalNotes: p.internalNotes ?? "",
    });
    setErr(null);
  }

  return (
    <div
      className="rounded-lg border border-primary/30 bg-card p-4 mt-4"
      data-testid="commercial-collection-tracking-panel"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <HeaderRow>
          <Banknote className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Collection Tracking</span>
          <span className="text-xs text-muted-foreground">Collection tracking</span>
          <span className="text-xs font-mono text-muted-foreground">{invoice.invoiceNumber}</span>
        </HeaderRow>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {summaryLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" data-testid="collection-summary-loading" />
      ) : summary && (
        <div
          className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs"
          data-testid="collection-summary"
        >
          <SummaryCell label="Invoice amount" value={summary.invoiceAmount ?? "-"} />
          <SummaryCell label="Recorded" value={summary.totalRecordedPayments} />
          <SummaryCell label="Verified" value={summary.totalVerifiedPayments} />
          <SummaryCell label="Outstanding" value={summary.outstandingAmount} />
          <div>
            <span className="text-muted-foreground block">State</span>
            {stateCfg ? (
              <Badge variant={stateCfg.variant} data-testid="collection-state-badge">
                {stateCfg.label}
              </Badge>
            ) : (
              "-"
            )}
          </div>
        </div>
      )}

      <Toolbar>
        {canRecord && (
          <button
            type="button"
            data-testid="commercial-record-payment-btn"
            onClick={() => {
              setEditPayment(null);
              resetForm();
              setRecordOpen(true);
              setErr(null);
            }}
            className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
          >
            Record Payment
          </button>
        )}
      </Toolbar>

      {recordOpen && canRecord && (
        <div className="rounded border border-border p-3 mt-3 space-y-2 bg-muted/10" data-testid="record-payment-form">
          <p className="text-xs font-semibold">{editPayment ? "Edit Payment" : "Record Payment"}</p>
          <input
            className={inp}
            placeholder="Payment reference"
            value={form.paymentReference}
            onChange={e => setForm(f => ({ ...f, paymentReference: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              className={inp}
              value={form.paymentDate}
              onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
            />
            <input
              className={inp}
              placeholder="Amount"
              value={form.receivedAmount}
              onChange={e => setForm(f => ({ ...f, receivedAmount: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className={inp}
              value={form.paymentMethod}
              onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))}
            >
              {PAYMENT_METHOD_CODES.map(m => (
                <option key={m} value={m}>{PAYMENT_METHOD_CONFIG[m].label}</option>
              ))}
            </select>
            <select
              className={inp}
              value={form.currency}
              onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
            >
              {SUPPORTED_CONTRACT_CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <textarea
            className={`${inp} min-h-[50px]`}
            placeholder="Internal notes"
            value={form.internalNotes}
            onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveRecord()}
              className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
            >
              {busy ? "..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => { setRecordOpen(false); setEditPayment(null); }}
              className="px-3 py-1 rounded border text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {actionPayment && canVerify && (
        <div className="rounded border border-border p-3 mt-3 space-y-2 bg-muted/10" data-testid="payment-action-form">
          <p className="text-xs font-semibold capitalize">{actionPayment.action} payment</p>
          <textarea
            className={`${inp} min-h-[60px]`}
            placeholder={`Reason (min ${MIN_REASON} chars)`}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <Toolbar>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction()}
              className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => { setActionPayment(null); setReason(""); setErr(null); }}
              className="px-3 py-1 rounded border text-xs"
            >
              Cancel
            </button>
          </Toolbar>
        </div>
      )}

      <div className="mt-4 space-y-2" data-testid="commercial-payment-records-list">
        <p className="text-xs font-medium text-muted-foreground">Payment records</p>
        {paymentsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {!paymentsLoading && payments.length === 0 && (
          <p className="text-xs text-muted-foreground">No manual payments recorded.</p>
        )}
        {payments.map(p => (
          <PaymentRow
            key={p.id}
            payment={p}
            canRecord={canRecord}
            canVerify={canVerify}
            onEdit={() => startEdit(p)}
            onVerify={() => { setActionPayment({ payment: p, action: "verify" }); setReason(""); setErr(null); }}
            onReject={() => { setActionPayment({ payment: p, action: "reject" }); setReason(""); setErr(null); }}
            onReverse={() => { setActionPayment({ payment: p, action: "reverse" }); setReason(""); setErr(null); }}
          />
        ))}
      </div>

      {err && !recordOpen && !actionPayment && (
        <p className="text-xs text-destructive mt-2">{err}</p>
      )}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground block">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PaymentRow({
  payment: p,
  canRecord,
  canVerify,
  onEdit,
  onVerify,
  onReject,
  onReverse,
}: {
  payment: CommercialPaymentRecord;
  canRecord: boolean;
  canVerify: boolean;
  onEdit: () => void;
  onVerify: () => void;
  onReject: () => void;
  onReverse: () => void;
}) {
  const st = COLLECTION_STATUS_CONFIG[p.collectionStatus as CollectionStatus];
  const editable = p.collectionStatus === "pending_verification";

  return (
    <div
      className="rounded border border-border p-2 text-xs space-y-1"
      data-testid={`commercial-payment-row-${p.id}`}
    >
      <div className="flex justify-between gap-2 flex-wrap">
        <span className="font-mono font-semibold">{p.paymentReference}</span>
        {st && <Badge variant={st.variant}>{st.label}</Badge>}
      </div>
      <div className="text-muted-foreground">
        {p.paymentDate} · {p.receivedAmount} {p.currency} ·{" "}
        {PAYMENT_METHOD_CONFIG[p.paymentMethod as PaymentMethod]?.label ?? p.paymentMethod}
      </div>
      {p.internalNotes && <p className="text-muted-foreground">{p.internalNotes}</p>}
      {p.rejectionReason && (
        <p className="text-destructive">Rejected: {p.rejectionReason}</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {canRecord && editable && (
          <button
            type="button"
            data-testid={`commercial-edit-payment-${p.id}`}
            onClick={onEdit}
            className="text-primary hover:underline"
          >
            Edit
          </button>
        )}
        {canVerify && p.collectionStatus === "pending_verification" && (
          <>
            <button
              type="button"
              data-testid={`commercial-verify-payment-${p.id}`}
              onClick={onVerify}
              className="text-primary hover:underline"
            >
              Verify
            </button>
            <button
              type="button"
              data-testid={`commercial-reject-payment-${p.id}`}
              onClick={onReject}
              className="text-destructive hover:underline"
            >
              Reject
            </button>
          </>
        )}
        {canVerify && p.collectionStatus !== "reversed" && p.collectionStatus !== "rejected" && (
          <button
            type="button"
            data-testid={`commercial-reverse-payment-${p.id}`}
            onClick={onReverse}
            className="text-muted-foreground hover:underline"
          >
            Reverse
          </button>
        )}
      </div>
    </div>
  );
}

function HeaderRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>;
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 flex-wrap">{children}</div>;
}
