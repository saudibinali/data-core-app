/**
 * Simplified invoice document timeline.
 */

import { useRef, useState } from "react";
import { Receipt, PlusCircle, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommercialPdfActions } from "@/components/commercial/CommercialPdfActions";
import { useCommercialAccount } from "@/hooks/use-commercial";
import {
  useTenantCommercialInvoices,
  useCreateTenantCommercialInvoice,
  useUpdateTenantCommercialInvoice,
  useUploadCommercialInvoiceDocument,
  useDownloadCommercialInvoiceDocument,
  INVOICE_PDF_MAX_BYTES,
  type OperationalInvoice,
  type OperationalInvoiceInput,
} from "@/hooks/use-commercial-invoices";
import { useTenantCommercialContracts } from "@/hooks/use-commercial-contracts";

const inp =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground";

function ReminderBadge({ inv }: { inv: OperationalInvoice }) {
  const r = inv.primaryReminder;
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    r.urgency === "overdue"
      ? "bg-destructive/15 text-destructive"
      : r.urgency === "due"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium", cls)}>
      <AlertTriangle className="w-3 h-3" />
      {r.label}
    </span>
  );
}

interface Props {
  tenantId: string;
  commercialAccountId: number | undefined;
  canWrite: boolean;
  canUpload: boolean;
}

export function OperationalInvoicesPanel({
  tenantId,
  commercialAccountId: commercialAccountIdProp,
  canWrite,
  canUpload,
}: Props) {
  const { data: account } = useCommercialAccount(tenantId);
  const commercialAccountId = commercialAccountIdProp ?? account?.id;
  const { data: invoices = [], isLoading } = useTenantCommercialInvoices(tenantId);
  const { data: contracts = [] } = useTenantCommercialContracts(tenantId);
  const createM = useCreateTenantCommercialInvoice(tenantId);
  const updateM = useUpdateTenantCommercialInvoice(tenantId);
  const uploadM = useUploadCommercialInvoiceDocument(tenantId);
  const downloadM = useDownloadCommercialInvoiceDocument(tenantId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<OperationalInvoiceInput>({
    commercialAccountId: 0,
    invoiceNumber: "",
  });

  const busy = createM.isPending || updateM.isPending || uploadM.isPending || downloadM.isPending;

  function contractLabel(id: number | null) {
    if (!id) return "—";
    const c = contracts.find((x) => x.id === id);
    return c ? `${c.contractNumber ?? c.id} · ${c.contractTitle ?? "Contract"}` : `#${id}`;
  }

  function openCreate() {
    if (!commercialAccountId) return;
    setForm({
      commercialAccountId,
      invoiceNumber: "",
      responsiblePersonName: "",
      responsiblePersonPhone: "",
      responsiblePersonEmail: "",
    });
    setEditId(null);
    setFormOpen(true);
    setErr(null);
  }

  async function save() {
    if (!commercialAccountId) return;
    if (!form.invoiceNumber?.trim()) {
      setErr("Invoice number is required.");
      return;
    }
    setErr(null);
    try {
      if (editId !== null) {
        const { commercialAccountId: _a, ...rest } = form;
        await updateM.mutateAsync({ invoiceId: editId, input: rest });
      } else {
        const created = await createM.mutateAsync({ ...form, commercialAccountId });
        setFormOpen(false);
        if (canUpload) {
          setUploadTargetId(created.invoice.id);
          fileRef.current?.click();
        }
        return;
      }
      setFormOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function onFilePicked(file: File | undefined) {
    if (!file || uploadTargetId === null) return;
    if (file.size > INVOICE_PDF_MAX_BYTES) {
      setErr("PDF must be under 10 MB.");
      return;
    }
    setErr(null);
    try {
      await uploadM.mutateAsync({ invoiceId: uploadTargetId, file });
      setUploadTargetId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="operational-invoices-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Invoices &amp; documents</h4>
          <span className="text-xs text-muted-foreground">({invoices.length} records)</span>
        </div>
        {canWrite && commercialAccountId && (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={openCreate}
            data-testid="operational-add-invoice-btn"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add invoice record
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Document archive only — no payment tracking or accounting. Upload the official PDF for each invoice.
      </p>

      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {!commercialAccountId && !isLoading && (
        <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Create a commercial account above before adding invoices.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-lg">
          No invoices on file yet.
        </p>
      ) : (
        <ol className="relative border-s border-border ms-3 space-y-4">
          {invoices.map((inv) => (
            <li key={inv.id} className="ms-4" data-testid={`operational-invoice-row-${inv.id}`}>
              <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full bg-primary" />
              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-semibold">Invoice {inv.invoiceNumber}</p>
                  <ReminderBadge inv={inv} />
                </div>
                <p className="text-xs text-muted-foreground">Contract: {contractLabel(inv.contractTermId)}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Contact</span>
                    <p>{inv.responsiblePersonName ?? "—"}</p>
                    <p>{inv.responsiblePersonPhone ?? ""}</p>
                    <p className="truncate">{inv.responsiblePersonEmail ?? ""}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reminder</span>
                    <p>{inv.reminderDate ?? "—"}</p>
                    <span className="text-muted-foreground">Uploaded</span>
                    <p>{inv.uploadedAt ? new Date(inv.uploadedAt).toLocaleString() : "—"}</p>
                  </div>
                </div>
                {inv.notes ? (
                  <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{inv.notes}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                  <CommercialPdfActions
                    hasDocument={inv.hasDocument}
                    busy={busy}
                    canUpload={canUpload}
                    onUpload={() => {
                      setUploadTargetId(inv.id);
                      fileRef.current?.click();
                    }}
                    onDownload={() => downloadM.mutate(inv.id)}
                  />
                  {canWrite && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                      setForm({
                        commercialAccountId: inv.commercialAccountId,
                        invoiceNumber: inv.invoiceNumber,
                        contractTermId: inv.contractTermId,
                        responsiblePersonName: inv.responsiblePersonName ?? "",
                        responsiblePersonPhone: inv.responsiblePersonPhone ?? "",
                        responsiblePersonEmail: inv.responsiblePersonEmail ?? "",
                        reminderDate: inv.reminderDate ?? undefined,
                        notes: inv.notes ?? "",
                      });
                      setEditId(inv.id);
                      setFormOpen(true);
                    }}>
                      Edit details
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {formOpen && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <h5 className="text-sm font-semibold">{editId ? "Edit invoice" : "New invoice"}</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="font-medium">Invoice number *</span>
              <input className={inp} value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Linked contract</span>
              <select
                className={inp}
                value={form.contractTermId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    contractTermId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              >
                <option value="">None</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber ?? c.id} — {c.contractTitle ?? "Contract"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Responsible person name</span>
              <input className={inp} value={form.responsiblePersonName ?? ""} onChange={(e) => setForm((f) => ({ ...f, responsiblePersonName: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Phone number</span>
              <input className={inp} type="tel" value={form.responsiblePersonPhone ?? ""} onChange={(e) => setForm((f) => ({ ...f, responsiblePersonPhone: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-medium">Email address</span>
              <input className={inp} type="email" value={form.responsiblePersonEmail ?? ""} onChange={(e) => setForm((f) => ({ ...f, responsiblePersonEmail: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Reminder date</span>
              <input className={inp} type="date" value={form.reminderDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, reminderDate: e.target.value || undefined }))} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-medium">Notes</span>
              <textarea className={cn(inp, "min-h-[72px]")} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground" onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="px-3 py-1.5 text-xs rounded-md border" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
