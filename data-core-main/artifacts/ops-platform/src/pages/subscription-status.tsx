/**
 * @phase P16-G - Tenant Subscription Status (read-only)
 */

import { useTranslation } from "react-i18next";
import {
  CreditCard,
  Lock,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useTenantSubscriptionSummary,
  useTenantSubscriptionEntitlements,
  useTenantSubscriptionQuotas,
} from "@/hooks/use-tenant-subscription-visibility";
import {
  TENANT_SUBSCRIPTION_PERMISSIONS,
  TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT,
} from "@/lib/tenant-subscription-visibility-config";
import { TENANT_BILLING_PERMISSIONS } from "@/lib/tenant-billing-config";
import { ENFORCEMENT_STATUS_LABELS } from "@/lib/workspace-access-enforcement-config";
import {
  WORKSPACE_SUBSCRIPTION_STATUS_CONFIG,
  type WorkspaceSubscriptionStatusCode,
} from "@/lib/subscription-state-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TenantBillingInvoicesSection } from "@/components/subscription/TenantBillingInvoicesSection";

const PERM_READ = TENANT_SUBSCRIPTION_PERMISSIONS.READ;
const PERM_ENT = TENANT_SUBSCRIPTION_PERMISSIONS.ENTITLEMENTS_READ;
const PERM_QUOTA = TENANT_SUBSCRIPTION_PERMISSIONS.QUOTAS_READ;
const PERM_BILLING = TENANT_BILLING_PERMISSIONS.INVOICES_READ;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value ?? "-"}</p>
    </div>
  );
}

function quotaStatusBadge(status: string, isAr: boolean) {
  switch (status) {
    case "exceeded":
      return <Badge variant="destructive">{isAr ? "تجاوز الحد" : "Exceeded"}</Badge>;
    case "warning":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
          {isAr ? "تحذير" : "Warning"}
        </Badge>
      );
    case "unlimited":
      return <Badge variant="secondary">{isAr ? "غير محدود" : "Unlimited"}</Badge>;
    case "unknown":
      return <Badge variant="outline">{isAr ? "غير مقاس بعد" : "Not measured yet"}</Badge>;
    default:
      return <Badge variant="outline">{isAr ? "ضمن الحد" : "Within limit"}</Badge>;
  }
}

export default function SubscriptionStatusPage() {
  void TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT;
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission, isLoading: permLoading } = usePermissions();

  const canRead = hasPermission(PERM_READ);
  const canReadEnt = canRead || hasPermission(PERM_ENT);
  const canReadQuota = canRead || hasPermission(PERM_QUOTA);
  const canReadBilling = hasPermission(PERM_BILLING);

  const { data: summary, isLoading: summaryLoading, isError: summaryError } =
    useTenantSubscriptionSummary(canRead);
  const { data: modules = [], isLoading: entLoading } =
    useTenantSubscriptionEntitlements(canReadEnt);
  const { data: quotas = [], isLoading: quotaLoading } =
    useTenantSubscriptionQuotas(canReadQuota);

  if (permLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {isAr ? "جاري التحميل..." : "Loading..."}
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="p-6" data-testid="tenant-subscription-access-denied">
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-sm text-muted-foreground">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>
              {isAr
                ? "ليس لديك صلاحية عرض حالة الاشتراك."
                : "You do not have permission to view subscription status."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCfg =
    WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[
      summary?.subscriptionStatus as WorkspaceSubscriptionStatusCode
    ];
  const accessLabel =
    ENFORCEMENT_STATUS_LABELS[summary?.accessMode ?? ""]?.[isAr ? "labelAr" : "label"] ??
    summary?.accessMode ??
    "-";

  const enabledModules = modules.filter((m) => m.isEnabled);
  const disabledModules = modules.filter((m) => !m.isEnabled && !m.isCore);

  return (
    <div className="p-6 space-y-6 max-w-5xl" data-testid="tenant-subscription-status-page">
      <div className="flex items-start gap-3">
        <CreditCard className="w-8 h-8 text-primary shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">
            {isAr ? "حالة الاشتراك" : "Subscription Status"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "عرض للقراءة فقط — لا يمكن تعديل الاشتراك أو الدفع من هذه الصفحة."
              : "Read-only view — subscription changes and payments are not available here."}
          </p>
        </div>
      </div>

      {summary?.readOnlyMode && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs"
          data-testid="tenant-subscription-read-only-banner"
          role="status"
        >
          <Lock className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <div className="space-y-1 text-amber-900 dark:text-amber-100">
            <p className="font-medium">
              {isAr
                ? "مساحة العمل في وضع القراءة فقط بسبب حالة الاشتراك."
                : "Workspace is in read-only mode due to subscription status."}
            </p>
            <p>
              {isAr
                ? "يمكنك مشاهدة البيانات المسموحة. لا يمكن تنفيذ عمليات إنشاء أو تعديل أو حذف أثناء هذا الوضع."
                : "You can view permitted data. Create, update, and delete actions are disabled while this mode is active."}
            </p>
            {summary.readOnlyReason && (
              <p className="italic text-amber-800/90 dark:text-amber-200/90">
                {summary.readOnlyReason}
              </p>
            )}
          </div>
        </div>
      )}

      <Card data-testid="tenant-subscription-overview-section">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{isAr ? "نظرة عامة" : "Overview"}</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : summaryError ? (
            <p className="text-sm text-destructive" data-testid="tenant-subscription-summary-error">
              {isAr ? "تعذر تحميل ملخص الاشتراك." : "Could not load subscription summary."}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {isAr ? "الحالة" : "Status"}
                </span>
                <Badge
                  variant="outline"
                  data-testid="tenant-subscription-status-badge"
                  className={statusCfg?.badgeClass}
                >
                  {statusCfg?.label ?? summary?.subscriptionStatus ?? "—"}
                </Badge>
                {summary?.recommendedStatus && (
                  <Badge variant="secondary" data-testid="tenant-subscription-recommended-badge">
                    {isAr ? "توصية: " : "Advisory: "}
                    {summary.recommendedStatus}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label={isAr ? "الخطة" : "Plan"} value={summary?.planName} />
                <Field label={isAr ? "البداية" : "Start"} value={summary?.startDate?.slice(0, 10)} />
                <Field label={isAr ? "النهاية" : "End"} value={summary?.endDate?.slice(0, 10)} />
                <Field label={isAr ? "التجديد" : "Renewal"} value={summary?.renewalDate?.slice(0, 10)} />
                <Field
                  label={isAr ? "نهاية فترة السماح" : "Grace ends"}
                  value={summary?.gracePeriodEndsAt?.slice(0, 10)}
                />
                <Field label={isAr ? "وضع الوصول" : "Access mode"} value={accessLabel} />
                <Field
                  label={isAr ? "أيام حتى الانتهاء" : "Days until end"}
                  value={
                    summary?.daysUntilEnd !== null && summary?.daysUntilEnd !== undefined
                      ? String(summary.daysUntilEnd)
                      : "—"
                  }
                />
                <Field
                  label={isAr ? "أيام بعد الانتهاء" : "Days past end"}
                  value={
                    summary?.daysPastEnd !== null && summary?.daysPastEnd !== undefined
                      ? String(summary.daysPastEnd)
                      : "—"
                  }
                />
              </div>
              {summary?.supportContact && (
                <div
                  className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1"
                  data-testid="tenant-subscription-support-contact"
                >
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {isAr ? "جهة الدعم / الفوترة" : "Support / billing contact"}
                  </p>
                  <p>{summary.supportContact.contactName}</p>
                  <p className="text-muted-foreground">{summary.supportContact.contactEmail}</p>
                  {summary.supportContact.contactPhone && (
                    <p className="text-muted-foreground">{summary.supportContact.contactPhone}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {canReadEnt && (
        <Card data-testid="tenant-subscription-modules-section">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isAr ? "الموديولات المتاحة" : "Available Modules"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {enabledModules.map((mod) => (
                    <div
                      key={mod.moduleKey}
                      className="flex items-start gap-2 rounded-md border border-border p-3"
                      data-testid={`tenant-module-enabled-${mod.moduleKey}`}
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{isAr ? mod.labelAr : mod.label}</p>
                        {mod.features.filter((f) => f.isEnabled).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {mod.features
                              .filter((f) => f.isEnabled)
                              .map((f) => (isAr ? f.labelAr : f.label))
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {disabledModules.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {isAr ? "غير مفعّل في اشتراكك" : "Not enabled on your subscription"}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 opacity-70">
                      {disabledModules.map((mod) => (
                        <div
                          key={mod.moduleKey}
                          className="flex items-start gap-2 rounded-md border border-dashed border-border p-3"
                          data-testid={`tenant-module-disabled-${mod.moduleKey}`}
                        >
                          <XCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-sm">{isAr ? mod.labelAr : mod.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canReadQuota && (
        <Card data-testid="tenant-subscription-quotas-section">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isAr ? "الاستخدام والحدود" : "Usage & Limits"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quotaLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-3">
                {quotas.map((q) => {
                  const label = isAr ? q.labelAr : q.label;
                  const pct =
                    q.usagePercent !== null && q.status !== "unknown" && q.status !== "unlimited"
                      ? Math.min(100, q.usagePercent)
                      : null;
                  return (
                    <div
                      key={q.quotaKey}
                      className="rounded-md border border-border p-3 space-y-2"
                      data-testid={`tenant-quota-${q.quotaKey}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{label}</p>
                        {quotaStatusBadge(q.status, isAr)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {q.status === "unknown" || q.currentUsage === null
                          ? isAr
                            ? "غير مقاس بعد"
                            : "Not measured yet"
                          : q.limitValue === null
                            ? `${q.currentUsage} ${q.unit} (${isAr ? "غير محدود" : "unlimited"})`
                            : `${q.currentUsage} / ${q.limitValue} ${q.unit}`}
                      </p>
                      {pct !== null && (
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              q.status === "exceeded"
                                ? "bg-destructive"
                                : q.status === "warning"
                                  ? "bg-amber-500"
                                  : "bg-primary",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canReadBilling && <TenantBillingInvoicesSection isAr={isAr} />}
    </div>
  );
}
