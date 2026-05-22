/**
 * Simplified operational contracts — timeline + PDF upload.
 */

import { useRef, useState } from "react";
import { FileText, PlusCircle, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommercialPdfActions } from "@/components/commercial/CommercialPdfActions";
import { useCommercialAccount } from "@/hooks/use-commercial";
import {
  useTenantCommercialContracts,
  useCreateTenantCommercialContract,
  useUpdateTenantCommercialContract,
  useUploadCommercialContractDocument,
  useDownloadCommercialContractDocument,
  type OperationalContract,
  type OperationalContractInput,
} from "@/hooks/use-commercial-contracts";

const inp =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground";

function ReminderBadge({ contract }: { contract: OperationalContract }) {
  const r = contract.primaryReminder;
  if (!r) {
    return <span className="text-xs text-muted-foreground">No alerts</span>;
  }
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

export function OperationalContractsPanel({
  tenantId,
  commercialAccountId: commercialAccountIdProp,
  canWrite,
  canUpload,
}: Props) {
  const { data: account } = useCommercialAccount(tenantId);
  const commercialAccountId = commercialAccountIdProp ?? account?.id;
  const { data: contracts = [], isLoading } = useTenantCommercialContracts(tenantId);
  const createM = useCreateTenantCommercialContract(tenantId);
  const updateM = useUpdateTenantCommercialContract(tenantId);
  const uploadM = useUploadCommercialContractDocument(tenantId);
  const downloadM = useDownloadCommercialContractDocument(tenantId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<OperationalContractInput>({
    commercialAccountId: 0,
    contractNumber: "",
    contractTitle: "",
  });

  const busy = createM.isPending || updateM.isPending || uploadM.isPending || downloadM.isPending;

  function openCreate() {
    if (!commercialAccountId) return;
    setForm({
      commercialAccountId,
      contractNumber: "",
      contractTitle: "",
      companyName: "",
      responsiblePersonName: "",
      responsiblePersonPhone: "",
      responsiblePersonEmail: "",
    });
    setEditId(null);
    setFormOpen(true);
    setErr(null);
  }

  function openEdit(c: OperationalContract) {
    setForm({
      commercialAccountId: c.commercialAccountId,
      contractNumber: c.contractNumber ?? "",
      contractTitle: c.contractTitle ?? "",
      companyName: c.companyName ?? "",
      responsiblePersonName: c.responsiblePersonName ?? "",
      responsiblePersonPhone: c.responsiblePersonPhone ?? "",
      responsiblePersonEmail: c.responsiblePersonEmail ?? "",
      startDate: c.startDate ?? undefined,
      endDate: c.endDate ?? undefined,
      renewalReminderDate: c.renewalReminderDate ?? undefined,
      notes: c.notes ?? "",
    });
    setEditId(c.id);
    setFormOpen(true);
    setErr(null);
  }

  async function save() {
    if (!commercialAccountId) return;
    if (!form.contractNumber?.trim() && !form.contractTitle?.trim()) {
      setErr("Contract number or title is required.");
      return;
    }
    setErr(null);
    try {
      if (editId !== null) {
        const { commercialAccountId: _a, ...rest } = form;
        await updateM.mutateAsync({ contractId: editId, input: rest });
      } else {
        const created = await createM.mutateAsync({ ...form, commercialAccountId });
        setFormOpen(false);
        if (canUpload && created.contract?.id) {
          setUploadTargetId(created.contract.id);
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
    if (file.type !== "application/pdf") {
      setErr("Only PDF files are allowed.");
      return;
    }
    setErr(null);
    try {
      await uploadM.mutateAsync({ contractId: uploadTargetId, file });
      setUploadTargetId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="operational-contracts-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Contracts</h4>
          <span className="text-xs text-muted-foreground">({contracts.length} records)</span>
        </div>
        {canWrite && commercialAccountId && (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={openCreate}
            data-testid="operational-add-contract-btn"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add contract record
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Contract history for this customer. Signing happens outside the platform — store the final PDF here.
      </p>

      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {!commercialAccountId && !isLoading && (
        <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Create a commercial account above before adding contracts.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading contracts…
        </div>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-lg">
          No contracts yet. Add the first contract record.
        </p>
      ) : (
        <ul className="space-y-3">
          {contracts.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-card p-3 space-y-2"
              data-testid={`operational-contract-row-${c.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {c.contractNumber || "—"} · {c.contractTitle || "Untitled"}
                  </p>
                  {c.companyName ? (
                    <p className="text-xs text-muted-foreground">{c.companyName}</p>
                  ) : null}
                </div>
                <ReminderBadge contract={c} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Start</span>
                  <p>{c.startDate ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">End</span>
                  <p>{c.endDate ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Renewal reminder</span>
                  <p>{c.renewalReminderDate ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Contact</span>
                  <p>{c.responsiblePersonName ?? "—"}</p>
                  <p>{c.responsiblePersonPhone ?? ""}</p>
                  <p className="truncate">{c.responsiblePersonEmail ?? ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                <CommercialPdfActions
                  hasDocument={c.hasDocument}
                  busy={busy}
                  canUpload={canUpload}
                  onUpload={() => {
                    setUploadTargetId(c.id);
                    fileRef.current?.click();
                  }}
                  onDownload={() => downloadM.mutate(c.id)}
                />
                {canWrite && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openEdit(c)}>
                    Edit details
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
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
          <h5 className="text-sm font-semibold">{editId ? "Edit contract" : "New contract"}</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="font-medium">Contract number</span>
              <input className={inp} value={form.contractNumber ?? ""} onChange={(e) => setForm((f) => ({ ...f, contractNumber: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Contract title</span>
              <input className={inp} value={form.contractTitle ?? ""} onChange={(e) => setForm((f) => ({ ...f, contractTitle: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-medium">Company name</span>
              <input className={inp} value={form.companyName ?? ""} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
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
              <span className="font-medium">Start date</span>
              <input className={inp} type="date" value={form.startDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value || undefined }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">End date</span>
              <input className={inp} type="date" value={form.endDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value || undefined }))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">Renewal reminder date</span>
              <input className={inp} type="date" value={form.renewalReminderDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, renewalReminderDate: e.target.value || undefined }))} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-medium">Notes</span>
              <textarea className={cn(inp, "min-h-[72px]")} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">After saving, use Upload PDF on the contract row.</p>
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
