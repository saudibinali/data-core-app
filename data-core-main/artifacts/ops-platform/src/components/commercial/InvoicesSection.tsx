/**
 * @phase P15-C - Invoices & Documents
 */

import { useRef, useState, type ReactNode } from "react";
import { FileText, PlusCircle, Loader2, Upload, Download, Banknote } from "lucide-react";
import { CollectionTrackingPanel } from "@/components/commercial/CollectionTrackingPanel";
import { Badge } from "@/components/ui/badge";
import {
  useTenantCommercialInvoices,
  useCreateTenantCommercialInvoice,
  useUpdateTenantCommercialInvoice,
  useUpdateTenantCommercialInvoiceStatus,
  useUploadCommercialInvoiceDocument,
  useDownloadCommercialInvoiceDocument,
  type CommercialInvoice,
  type CommercialInvoiceCreateInput,
} from "@/hooks/use-commercial-invoices";
import { useTenantCommercialContracts } from "@/hooks/use-commercial-contracts";
import {
  COMMERCIAL_INVOICE_STATUS_CONFIG,
  SUPPORTED_CONTRACT_CURRENCIES,
  INVOICE_PDF_MAX_BYTES,
  type CommercialInvoiceStatus,
} from "@/lib/commercial-config";

const STATUSES = Object.keys(COMMERCIAL_INVOICE_STATUS_CONFIG) as CommercialInvoiceStatus[];
const inp = "w-full rounded border border-input bg-background px-2 py-1 text-xs";

interface Props {
  tenantId: string;
  commercialAccountId: number | undefined;
  canWriteInvoice: boolean;
  canReadDocuments: boolean;
  canUploadDocuments: boolean;
  canReadPayments: boolean;
  canRecordPayments: boolean;
  canVerifyPayments: boolean;
  /** When true, collection panel opens via onOpenCollection instead of inline */
  hideInlineCollectionPanel?: boolean;
  onOpenCollection?: (invoice: CommercialInvoice) => void;
}

export function InvoicesSection({
  tenantId,
  commercialAccountId,
  canWriteInvoice,
  canReadDocuments,
  canUploadDocuments,
  canReadPayments,
  canRecordPayments,
  canVerifyPayments,
  hideInlineCollectionPanel = false,
  onOpenCollection,
}: Props) {
  const { data: invoices = [], isLoading } = useTenantCommercialInvoices(tenantId);
  const { data: contracts = [] } = useTenantCommercialContracts(tenantId);
  const createM = useCreateTenantCommercialInvoice(tenantId);
  const updateM = useUpdateTenantCommercialInvoice(tenantId);
  const statusM = useUpdateTenantCommercialInvoiceStatus(tenantId);
  const uploadM = useUploadCommercialInvoiceDocument(tenantId);
  const downloadM = useDownloadCommercialInvoiceDocument(tenantId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CommercialInvoiceCreateInput>({
    commercialAccountId: 0,
    invoiceNumber: "",
    currency: "SAR",
    status: "draft",
  });
  const [statusRow, setStatusRow] = useState<CommercialInvoice | null>(null);
  const [newStatus, setNewStatus] = useState("issued");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [collectionInvoice, setCollectionInvoice] = useState<CommercialInvoice | null>(null);

  const busy =
    createM.isPending || updateM.isPending || statusM.isPending
    || uploadM.isPending || downloadM.isPending;

  function contractLabel(termId: number | null) {
    if (!termId) return "-";
    const c = contracts.find(x => x.id === termId);
    return c ? `${c.contractNumber ?? c.id}${c.contractTitle ? ` · ${c.contractTitle}` : ""}` : `#${termId}`;
  }

  function startCreate() {
    if (!commercialAccountId) return;
    setForm({
      commercialAccountId,
      invoiceNumber: "",
      currency: "SAR",
      status: "draft",
    });
    setEditId(null);
    setFormOpen(true);
    setStatusRow(null);
    setErr(null);
  }

  function startEdit(inv: CommercialInvoice) {
    setForm({
      commercialAccountId: inv.commercialAccountId,
      contractTermId: inv.contractTermId,
      invoiceNumber: inv.invoiceNumber,
      invoiceTitle: inv.invoiceTitle ?? "",
      invoiceDate: inv.invoiceDate ?? "",
      dueDate: inv.dueDate ?? "",
      invoiceAmount: inv.invoiceAmount ? Number(inv.invoiceAmount) : undefined,
      currency: inv.currency ?? "SAR",
      billingPeriodStart: inv.billingPeriodStart ?? "",
      billingPeriodEnd: inv.billingPeriodEnd ?? "",
      externalAccountingSystemName: inv.externalAccountingSystemName ?? "",
      externalAccountingReference: inv.externalAccountingReference ?? "",
      notes: inv.notes ?? "",
      status: inv.status,
    });
    setEditId(inv.id);
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
        await updateM.mutateAsync({ invoiceId: editId, input: rest });
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
      await statusM.mutateAsync({
        invoiceId: statusRow.id,
        status: newStatus,
        reason: reason.trim(),
      });
      setStatusRow(null);
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Status change failed");
    }
  }

  async function onFilePicked(file: File | undefined, invoiceId: number) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setErr("Only PDF files are allowed");
      return;
    }
    if (file.size > INVOICE_PDF_MAX_BYTES) {
      setErr("PDF must be 10MB or smaller");
      return;
    }
    setErr(null);
    try {
      await uploadM.mutateAsync({ invoiceId, file });
      setUploadTargetId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div>
      <div
        className="rounded-lg border border-border bg-card overflow-hidden mt-4"
        data-testid="commercial-invoices-section"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Invoices &amp; Documents</span>
            <span className="text-xs text-muted-foreground" dir="rtl">الفواتير والمستندات</span>
            <Badge variant="secondary" className="text-xs">{invoices.length}</Badge>
          </div>
          {canWriteInvoice && commercialAccountId && !formOpen && !statusRow && (
            <button
              type="button"
              onClick={startCreate}
              data-testid="commercial-add-invoice-btn"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <PlusCircle className="w-3 h-3" />
              Add Invoice
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
            <p className="text-xs text-muted-foreground">
              Create a commercial account first to manage invoices.
            </p>
          )}
          {!isLoading && commercialAccountId && invoices.length === 0 && !formOpen && !statusRow && (
            <p className="text-xs text-muted-foreground">No invoice records on file.</p>
          )}
          {!isLoading && invoices.map(inv => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              contractLabel={contractLabel(inv.contractTermId)}
              canWriteInvoice={canWriteInvoice}
              canReadDocuments={canReadDocuments}
              canUploadDocuments={canUploadDocuments}
              onEdit={() => startEdit(inv)}
              onChangeStatus={() => {
                setStatusRow(inv);
                setNewStatus("issued");
                setReason("");
                setErr(null);
                setFormOpen(false);
              }}
              onUpload={() => {
                setUploadTargetId(inv.id);
                fileRef.current?.click();
              }}
              onDownload={() => {
                void downloadM.mutateAsync({
                  invoiceId: inv.id,
                  fileName: inv.invoiceNumber ? `${inv.invoiceNumber}.pdf` : "invoice.pdf",
                });
              }}
              onCollection={
                canReadPayments
                  ? () => {
                      setFormOpen(false);
                      setStatusRow(null);
                      if (onOpenCollection) {
                        onOpenCollection(inv);
                      } else {
                        setCollectionInvoice(inv);
                      }
                    }
                  : undefined
              }
            />
          ))}

          {!hideInlineCollectionPanel && collectionInvoice && canReadPayments && commercialAccountId && (
            <CollectionTrackingPanel
              tenantId={tenantId}
              invoice={collectionInvoice}
              commercialAccountId={commercialAccountId}
              canRecord={canRecordPayments}
              canVerify={canVerifyPayments}
              onClose={() => setCollectionInvoice(null)}
            />
          )}

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="commercial-invoice-pdf-input"
            onChange={e => {
              const id = uploadTargetId;
              const f = e.target.files?.[0];
              e.target.value = "";
              if (id && f) void onFilePicked(f, id);
            }}
          />

          {formOpen && (
            <InvoiceFormBlock
              form={form}
              setForm={setForm}
              editId={editId}
              contracts={contracts}
              err={err}
              busy={busy}
              onSave={() => void saveForm()}
              onCancel={() => setFormOpen(false)}
            />
          )}

          {statusRow && canWriteInvoice && (
            <div
              className="rounded-md border border-border p-3 space-y-2 bg-muted/10"
              data-testid="invoice-status-form"
            >
              <p className="text-xs font-semibold">Change Status</p>
              <select className={inp} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {STATUSES.map(s => (
                  <option key={s} value={s}>{COMMERCIAL_INVOICE_STATUS_CONFIG[s].label}</option>
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
                  data-testid="commercial-invoice-status-save-btn"
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

          {err && !formOpen && !statusRow && (
            <p className="text-xs text-destructive">{err}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InvoiceRow({
  inv,
  contractLabel,
  canWriteInvoice,
  canReadDocuments,
  canUploadDocuments,
  onEdit,
  onChangeStatus,
  onUpload,
  onDownload,
  onCollection,
}: {
  inv: CommercialInvoice;
  contractLabel: string;
  canWriteInvoice: boolean;
  canReadDocuments: boolean;
  canUploadDocuments: boolean;
  onEdit: () => void;
  onChangeStatus: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onCollection?: () => void;
}) {
  const st = COMMERCIAL_INVOICE_STATUS_CONFIG[inv.status as CommercialInvoiceStatus];
  const docLabel =
    inv.documentStatus === "uploaded"
      ? "PDF uploaded"
      : inv.documentStatus === "missing"
        ? "No PDF"
        : canReadDocuments
          ? "No PDF"
          : undefined;

  return (
    <div
      className="rounded-md border border-border p-3 text-xs space-y-1"
      data-testid={`commercial-invoice-row-${inv.id}`}
    >
      <div className="flex justify-between gap-2">
        <div>
          <span className="font-semibold">{inv.invoiceNumber}</span>
          {inv.invoiceTitle && <span className="text-muted-foreground ml-2">{inv.invoiceTitle}</span>}
        </div>
        {st && <Badge variant={st.variant}>{st.label}</Badge>}
      </div>
      <p className="text-muted-foreground">
        {inv.invoiceDate ?? "-"} → due {inv.dueDate ?? "-"} · {inv.invoiceAmount ?? "-"} {inv.currency ?? ""}
      </p>
      <p className="text-muted-foreground">
        Period: {inv.billingPeriodStart ?? "-"} - {inv.billingPeriodEnd ?? "-"} · Contract: {contractLabel}
      </p>
      {docLabel !== undefined && (
        <p className="text-muted-foreground">Document: {docLabel}</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {canWriteInvoice && (
          <>
            <button
              type="button"
              data-testid={`commercial-invoice-edit-${inv.id}`}
              onClick={onEdit}
              className="text-[10px] border rounded px-1.5 py-0.5"
            >
              Edit
            </button>
            <button
              type="button"
              data-testid={`commercial-invoice-status-${inv.id}`}
              onClick={onChangeStatus}
              className="text-[10px] border rounded px-1.5 py-0.5"
            >
              Change Status
            </button>
          </>
        )}
        {canUploadDocuments && (
          <button
            type="button"
            data-testid={`commercial-invoice-upload-${inv.id}`}
            onClick={onUpload}
            className="text-[10px] border rounded px-1.5 py-0.5 flex items-center gap-0.5"
          >
            <Upload className="w-3 h-3" /> Upload PDF
          </button>
        )}
        {canReadDocuments && inv.documentStatus === "uploaded" && (
          <button
            type="button"
            data-testid={`commercial-invoice-download-${inv.id}`}
            onClick={onDownload}
            className="text-[10px] border rounded px-1.5 py-0.5 flex items-center gap-0.5"
          >
            <Download className="w-3 h-3" /> Download PDF
          </button>
        )}
        {onCollection && (
          <button
            type="button"
            data-testid={`commercial-invoice-collection-${inv.id}`}
            onClick={onCollection}
            className="text-[10px] border rounded px-1.5 py-0.5 flex items-center gap-0.5"
          >
            <Banknote className="w-3 h-3" /> Collection
          </button>
        )}
      </div>
    </div>
  );
}

function InvoiceFormBlock({
  form,
  setForm,
  editId,
  contracts,
  err,
  busy,
  onSave,
  onCancel,
}: {
  form: CommercialInvoiceCreateInput;
  setForm: (f: CommercialInvoiceCreateInput) => void;
  editId: number | null;
  contracts: { id: number; contractNumber: string | null; contractTitle: string | null }[];
  err: string | null;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (p: Partial<CommercialInvoiceCreateInput>) => setForm({ ...form, ...p });
  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/10 text-xs" data-testid="commercial-invoice-form">
      <p className="font-semibold">{editId ? "Edit Invoice" : "New Invoice"}</p>
      <div className="grid grid-cols-2 gap-2">
        <L label="Invoice # *">
          <input
            className={inp}
            value={form.invoiceNumber}
            onChange={e => patch({ invoiceNumber: e.target.value })}
            disabled={editId !== null}
          />
        </L>
        <L label="Title">
          <input className={inp} value={form.invoiceTitle ?? ""} onChange={e => patch({ invoiceTitle: e.target.value })} />
        </L>
        <L label="Invoice date">
          <input type="date" className={inp} value={form.invoiceDate ?? ""} onChange={e => patch({ invoiceDate: e.target.value })} />
        </L>
        <L label="Due date">
          <input type="date" className={inp} value={form.dueDate ?? ""} onChange={e => patch({ dueDate: e.target.value })} />
        </L>
        <L label="Amount">
          <input
            type="number"
            min={0}
            step="0.01"
            className={inp}
            value={form.invoiceAmount ?? ""}
            onChange={e => patch({ invoiceAmount: e.target.value ? +e.target.value : undefined })}
          />
        </L>
        <L label="Currency">
          <select className={inp} value={form.currency ?? "SAR"} onChange={e => patch({ currency: e.target.value })}>
            {SUPPORTED_CONTRACT_CURRENCIES.map(x => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </L>
        <L label="Period start">
          <input
            type="date"
            className={inp}
            value={form.billingPeriodStart ?? ""}
            onChange={e => patch({ billingPeriodStart: e.target.value })}
          />
        </L>
        <L label="Period end">
          <input
            type="date"
            className={inp}
            value={form.billingPeriodEnd ?? ""}
            onChange={e => patch({ billingPeriodEnd: e.target.value })}
          />
        </L>
        <L label="Contract">
          <select
            className={inp}
            value={form.contractTermId ?? ""}
            onChange={e => patch({ contractTermId: e.target.value ? +e.target.value : null })}
          >
            <option value="">-</option>
            {contracts.map(c => (
              <option key={c.id} value={c.id}>
                {c.contractNumber ?? c.id}{c.contractTitle ? ` · ${c.contractTitle}` : ""}
              </option>
            ))}
          </select>
        </L>
        <L label="Ext. system">
          <input
            className={inp}
            value={form.externalAccountingSystemName ?? ""}
            onChange={e => patch({ externalAccountingSystemName: e.target.value })}
          />
        </L>
        <L label="Ext. reference">
          <input
            className={inp}
            value={form.externalAccountingReference ?? ""}
            onChange={e => patch({ externalAccountingReference: e.target.value })}
          />
        </L>
        {editId === null && (
          <L label="Status">
            <select className={inp} value={form.status ?? "draft"} onChange={e => patch({ status: e.target.value })}>
              {STATUSES.map(s => (
                <option key={s} value={s}>{COMMERCIAL_INVOICE_STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </L>
        )}
      </div>
      <L label="Notes">
        <textarea className={`${inp} min-h-[48px]`} value={form.notes ?? ""} onChange={e => patch({ notes: e.target.value })} />
      </L>
      {err && <p className="text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="commercial-invoice-save-btn"
          disabled={busy}
          onClick={onSave}
          className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
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
