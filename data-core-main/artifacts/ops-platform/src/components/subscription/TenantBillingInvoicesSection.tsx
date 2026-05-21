/**
 * Tenant subscription invoices (read-only) — uploaded by platform finance / super-admin.
 */

import { useState } from "react";
import { FileText, Download, AlertCircle } from "lucide-react";
import {
  useTenantBillingInvoices,
  useDownloadTenantInvoiceDocument,
  type TenantBillingInvoiceFilters,
} from "@/hooks/use-tenant-billing";
import { TENANT_BILLING_PERMISSIONS } from "@/lib/tenant-billing-config";
import { COMMERCIAL_INVOICE_STATUS_CONFIG } from "@/lib/commercial-config";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const PERM_DOWNLOAD = TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD;

const STATUS_FILTER_OPTIONS = ["issued", "shared", "paid", "overdue", "cancelled"] as const;

function formatMoney(amount: string | null, currency: string | null, isAr: boolean) {
  if (!amount) return "-";
  const cur = currency ?? "SAR";
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${cur}`;
  return new Intl.NumberFormat(isAr ? "ar-SA" : "en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: 2,
  }).format(n);
}

function statusBadge(status: string, isAr: boolean) {
  const cfg = COMMERCIAL_INVOICE_STATUS_CONFIG[status as keyof typeof COMMERCIAL_INVOICE_STATUS_CONFIG];
  if (!cfg) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant={cfg.variant}>{isAr ? cfg.labelAr : cfg.label}</Badge>;
}

function InvoiceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground block text-xs">{label}</span>
      {value}
    </div>
  );
}

interface Props {
  isAr: boolean;
}

export function TenantBillingInvoicesSection({ isAr }: Props) {
  const { hasPermission } = usePermissions();
  const canDownload = hasPermission(PERM_DOWNLOAD);

  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters: TenantBillingInvoiceFilters = {};
  if (status) filters.status = status;
  if (from) filters.from = from;
  if (to) filters.to = to;

  const { data: invoices = [], isLoading, isError, error } = useTenantBillingInvoices(filters);
  const downloadMutation = useDownloadTenantInvoiceDocument();

  return (
    <Card data-testid="tenant-subscription-invoices-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" />
          {isAr ? "فواتير الاشتراك" : "Subscription Invoices"}
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">
          {isAr
            ? "فواتير رسمية مرفوعة من إدارة المنصة — للعرض والتحميل فقط."
            : "Official invoices uploaded by platform administration — view and download only."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px]" data-testid="tenant-billing-status-filter">
              <SelectValue placeholder={isAr ? "الحالة" : "Status"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
              {STATUS_FILTER_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {isAr
                    ? COMMERCIAL_INVOICE_STATUS_CONFIG[s].labelAr
                    : COMMERCIAL_INVOICE_STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
            data-testid="tenant-billing-from-filter"
            aria-label={isAr ? "من تاريخ" : "From date"}
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
            data-testid="tenant-billing-to-filter"
            aria-label={isAr ? "إلى تاريخ" : "To date"}
          />
        </div>

        {isLoading && (
          <div className="space-y-2" data-testid="tenant-billing-loading">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {isError && (
          <div
            className="flex items-center gap-2 text-sm text-destructive"
            data-testid="tenant-billing-error"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error instanceof Error ? error.message : "Something went wrong"}</span>
          </div>
        )}

        {!isLoading && !isError && invoices.length === 0 && (
          <div
            className="py-10 text-center text-muted-foreground text-sm"
            data-testid="tenant-billing-empty"
          >
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{isAr ? "لا توجد فواتير لعرضها" : "No invoices to display"}</p>
          </div>
        )}

        {!isLoading && !isError && invoices.length > 0 && (
          <div className="space-y-3" data-testid="tenant-billing-invoice-list">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="rounded-md border border-border p-4 space-y-2"
                data-testid={`tenant-subscription-invoice-${inv.id}`}
              >
                <div className="flex flex-row items-start justify-between gap-2">
                  <p className="text-sm font-semibold">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    {inv.invoiceTitle ? (
                      <span className="text-muted-foreground font-normal ms-2">{inv.invoiceTitle}</span>
                    ) : null}
                  </p>
                  {statusBadge(inv.status, isAr)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <InvoiceField
                    label={isAr ? "تاريخ الفاتورة" : "Invoice date"}
                    value={inv.invoiceDate ?? "-"}
                  />
                  <InvoiceField label={isAr ? "تاريخ الاستحقاق" : "Due date"} value={inv.dueDate ?? "-"} />
                  <InvoiceField
                    label={isAr ? "المبلغ" : "Amount"}
                    value={formatMoney(inv.invoiceAmount, inv.currency, isAr)}
                  />
                  <InvoiceField
                    label={isAr ? "فترة الفوترة" : "Billing period"}
                    value={
                      inv.billingPeriodStart && inv.billingPeriodEnd
                        ? `${inv.billingPeriodStart} - ${inv.billingPeriodEnd}`
                        : "-"
                    }
                  />
                </div>
                {inv.documentAvailable && canDownload && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`tenant-billing-download-${inv.id}`}
                    disabled={downloadMutation.isPending}
                    onClick={() =>
                      downloadMutation.mutate({
                        invoiceId: inv.id,
                        fileName: inv.documentFileName ?? `${inv.invoiceNumber}.pdf`,
                      })
                    }
                  >
                    <Download className="w-4 h-4 me-1" />
                    {isAr ? "تحميل PDF" : "Download PDF"}
                  </Button>
                )}
                {inv.documentAvailable && !canDownload && (
                  <p className="text-xs text-muted-foreground">
                    {isAr
                      ? "PDF متاح - صلاحية التحميل غير ممنوحة"
                      : "PDF available - download permission required"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
