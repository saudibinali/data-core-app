/**
 * @phase P15-F - Commercial Risk & Renewal Readiness dashboard
 */

import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ShieldAlert, Loader2, ExternalLink } from "lucide-react";
import { useAppAuth } from "@/lib/auth";
import { hasPlatformPermissionClient } from "@/lib/platform-access";
import {
  useCommercialRiskSummary,
  useCommercialRiskList,
  useTenantCommercialRisk,
  type CommercialRiskListFilters,
} from "@/hooks/use-commercial-risk";
import {
  COMMERCIAL_RISK_LEVEL_CONFIG,
  RENEWAL_READINESS_CONFIG,
  RISK_REASON_LABELS,
  RECOMMENDED_ACTION_LABELS,
  type CommercialRiskLevel,
  type RenewalReadinessStatus,
} from "@/lib/commercial-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function RiskBadge({ level }: { level: CommercialRiskLevel }) {
  const cfg = COMMERCIAL_RISK_LEVEL_CONFIG[level];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function ReadinessBadge({ status }: { status: RenewalReadinessStatus }) {
  const cfg = RENEWAL_READINESS_CONFIG[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function SummaryCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string | number | undefined;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        {value === undefined ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <p className="text-2xl font-bold mt-1">{value}</p>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function AccessDenied(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-[40vh]" {...props}>
      <AlertTriangle className="w-10 h-10 text-muted-foreground" />
      <p className="text-lg font-semibold">Access denied</p>
      <p className="text-sm text-muted-foreground">Requires commercial.risk.read permission.</p>
    </div>
  );
}

export default function SuperAdminCommercialRiskPage() {
  const { user } = useAppAuth();
  const canRead = hasPlatformPermissionClient(user ?? {}, "commercial.risk.read");

  const [riskFilter, setRiskFilter] = useState<string>("");
  const [readinessFilter, setReadinessFilter] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const filters: CommercialRiskListFilters = {};
  if (riskFilter) filters.riskLevel = riskFilter;
  if (readinessFilter) filters.renewalReadinessStatus = readinessFilter;
  if (overdueOnly) filters.hasOverdueInvoices = true;

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useCommercialRiskSummary(canRead);
  const { data: tenants = [], isLoading: listLoading, isError: listError } = useCommercialRiskList(
    filters,
    canRead,
  );
  const { data: detail, isLoading: detailLoading } = useTenantCommercialRisk(
    selectedTenantId ?? undefined,
    canRead,
  );

  if (!canRead) {
    return <AccessDenied data-testid="commercial-risk-access-denied" />;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl" data-testid="commercial-risk-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-muted-foreground" />
          Commercial Risk &amp; Renewal Readiness
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Commercial risk and renewal readiness — read-only analysis
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Read-only intelligence. No automated emails, status changes, or payment actions.
        </p>
      </div>

      {summaryError && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-sm text-destructive">Failed to load summary</CardContent>
        </Card>
      )}

      <div
        className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3"
        data-testid="commercial-risk-summary-cards"
      >
        <SummaryCard title="Total tenants" value={summaryLoading ? undefined : summary?.totalTenants} />
        <SummaryCard title="Critical risk" value={summaryLoading ? undefined : summary?.criticalRiskCount} />
        <SummaryCard title="High risk" value={summaryLoading ? undefined : summary?.highRiskCount} />
        <SummaryCard
          title="Overdue invoices"
          value={summaryLoading ? undefined : summary?.overdueInvoiceCount}
        />
        <SummaryCard
          title="Outstanding"
          value={summaryLoading ? undefined : summary?.totalOutstandingAmount}
          sub="SAR total"
        />
        <SummaryCard
          title="Upcoming renewals"
          value={summaryLoading ? undefined : summary?.upcomingRenewalsCount}
          sub="≤ 90 days"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Risk list</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={riskFilter || "all"} onValueChange={v => setRiskFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="commercial-risk-filter-level">
                  <SelectValue placeholder="Risk level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risks</SelectItem>
                  {(Object.keys(COMMERCIAL_RISK_LEVEL_CONFIG) as CommercialRiskLevel[]).map(k => (
                    <SelectItem key={k} value={k}>{COMMERCIAL_RISK_LEVEL_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={readinessFilter || "all"}
                onValueChange={v => setReadinessFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Readiness" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All readiness</SelectItem>
                  {(Object.keys(RENEWAL_READINESS_CONFIG) as RenewalReadinessStatus[]).map(k => (
                    <SelectItem key={k} value={k}>{RENEWAL_READINESS_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={e => setOverdueOnly(e.target.checked)}
                  data-testid="commercial-risk-filter-overdue"
                />
                Overdue only
              </label>
            </div>

            {listLoading && <Loader2 className="w-5 h-5 animate-spin" />}
            {listError && <p className="text-sm text-destructive">Failed to load list</p>}
            {!listLoading && !listError && tenants.length === 0 && (
              <p className="text-sm text-muted-foreground">No tenants match filters.</p>
            )}
            <div className="space-y-2" data-testid="commercial-risk-tenant-list">
              {tenants.map(t => (
                <button
                  key={t.tenantId}
                  type="button"
                  data-testid={`commercial-risk-row-${t.tenantId}`}
                  onClick={() => setSelectedTenantId(String(t.tenantId))}
                  onKeyDown={e => {
                    if (e.key === "Enter") setSelectedTenantId(String(t.tenantId));
                  }}
                  className={`w-full text-left rounded-md border p-3 text-xs hover:bg-muted/40 transition-colors ${
                    selectedTenantId === String(t.tenantId) ? "border-primary bg-muted/30" : "border-border"
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-semibold">{t.tenantName}</span>
                    <RiskBadge level={t.riskLevel} />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1 text-muted-foreground">
                    <ReadinessBadge status={t.renewalReadinessStatus} />
                    <span>Outstanding: {t.outstandingAmount}</span>
                    <span>Overdue: {t.overdueInvoiceCount}</span>
                  </div>
                  {t.reasons.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {t.reasons.map(r => RISK_REASON_LABELS[r]?.en ?? r).join(" · ")}
                    </p>
                  )}
                  <Link
                    href={`/super-admin/tenants?tenantId=${t.tenantId}&tab=commercial`}
                    className="mt-2 inline-block text-[10px] text-primary hover:underline"
                    data-testid={`commercial-risk-tenant-console-link-${t.tenantId}`}
                    onClick={e => e.stopPropagation()}
                  >
                    Open Commercial Console
                  </Link>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="commercial-risk-detail-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tenant detail</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-3">
            {!selectedTenantId && (
              <p className="text-muted-foreground">Select a tenant from the list.</p>
            )}
            {selectedTenantId && detailLoading && <Loader2 className="w-5 h-5 animate-spin" />}
            {selectedTenantId && detail && (
              <>
                <div>
                  <p className="font-semibold text-sm">{detail.tenantName}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <RiskBadge level={detail.riskLevel} />
                    <ReadinessBadge status={detail.renewalReadinessStatus} />
                  </div>
                </div>
                <Link
                  href={`/super-admin/tenants?tenantId=${detail.tenantId}&tab=commercial`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  data-testid="commercial-risk-open-tenant-console"
                >
                  Open Commercial Console <ExternalLink className="w-3 h-3" />
                </Link>
                <Link
                  href="/super-admin/commercial-risk"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:underline text-[10px]"
                >
                  Full risk dashboard
                </Link>
                <div>
                  <p className="font-medium mb-1">Signals</p>
                  <ul className="space-y-0.5 text-muted-foreground list-disc ps-4">
                    <li>Active contract: {detail.signals.activeContractExists ? "Yes" : "No"}</li>
                    <li>Days to contract end: {detail.signals.daysUntilContractEnd ?? "-"}</li>
                    <li>Days to renewal: {detail.signals.daysUntilRenewalDate ?? "-"}</li>
                    <li>Outstanding: {detail.signals.outstandingAmount}</li>
                    <li>Overdue invoices: {detail.signals.overdueInvoiceCount}</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">Reasons</p>
                  <ul className="list-disc ps-4 text-muted-foreground">
                    {detail.reasons.map(r => (
                      <li key={r}>{RISK_REASON_LABELS[r]?.en ?? r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">Recommended actions (read-only)</p>
                  <ul className="list-disc ps-4 text-muted-foreground">
                    {detail.recommendedActions.map(a => (
                      <li key={a}>{RECOMMENDED_ACTION_LABELS[a]?.en ?? a}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
