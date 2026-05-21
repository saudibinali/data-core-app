import { Link } from "wouter";
import { useMemo } from "react";
import { useGetPlatformActivity } from "@workspace/api-client-react";
import {
  Building2,
  Users,
  ArrowRight,
  CheckCircle2,
  PauseCircle,
  XCircle,
  AlertTriangle,
  Plus,
  ShieldCheck,
  Plug,
  Mail,
  CreditCard,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  usePlatformDashboard,
  PLATFORM_DASHBOARD_REFRESH_MS,
} from "@/hooks/use-platform-dashboard";
import {
  useTenantRegistry,
  type PlatformTenantProfile,
} from "@/lib/tenant-registry-hooks";
import { SUBSCRIPTION_STATUS_CONFIG } from "@/lib/subscription-lifecycle-config";
import { PLAN_CODE_CONFIG } from "@/lib/subscription-lifecycle-config";

const WORKSPACE_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  suspended: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  disabled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

function StatCard({
  title,
  value,
  icon: Icon,
  color = "text-primary",
  sub,
}: {
  title: string;
  value: number | string | undefined;
  icon: React.ElementType;
  color?: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {value === undefined ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <p className="text-3xl font-bold mt-1 tabular-nums">
                {typeof value === "number" ? value.toLocaleString() : value}
              </p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{sub}</p>}
          </div>
          <div className={cn("p-2.5 rounded-lg bg-muted shrink-0", color)}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SubscriptionBadge({ status }: { status: string }) {
  const cfg =
    SUBSCRIPTION_STATUS_CONFIG[status as keyof typeof SUBSCRIPTION_STATUS_CONFIG] ?? null;
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium",
        cfg?.badgeClass ?? "bg-muted text-muted-foreground",
      )}
    >
      {cfg?.label ?? status}
    </span>
  );
}

function PlanBadge({ planCode }: { planCode: string | null }) {
  if (!planCode) {
    return <span className="text-xs text-muted-foreground italic">No plan</span>;
  }
  const cfg = PLAN_CODE_CONFIG[planCode as keyof typeof PLAN_CODE_CONFIG];
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium",
        cfg?.badgeClass ?? "bg-muted",
      )}
    >
      {cfg?.name ?? planCode}
    </span>
  );
}

function TenantRow({ tenant }: { tenant: PlatformTenantProfile }) {
  const wsStatus = tenant.workspaceStatus ?? tenant.tenantStatus;
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell>
        <Link
          href={`/super-admin/tenants?tenant=${tenant.tenantId}`}
          className="font-medium text-sm hover:text-primary"
        >
          {tenant.workspaceName}
        </Link>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">#{tenant.tenantId}</p>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize",
            WORKSPACE_STATUS_STYLES[wsStatus] ?? "bg-muted",
          )}
        >
          {wsStatus}
        </span>
      </TableCell>
      <TableCell>
        <PlanBadge planCode={tenant.planCode} />
      </TableCell>
      <TableCell>
        <SubscriptionBadge status={tenant.subscriptionStatus} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">{tenant.userCount}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {tenant.usageSummary.seatLimit != null
          ? `${tenant.usageSummary.activeUsers} / ${tenant.usageSummary.seatLimit}`
          : tenant.usageSummary.activeUsers}
      </TableCell>
      <TableCell>
        <Badge
          variant={
            tenant.riskSignalSummary.healthRiskLevel === "critical"
              ? "destructive"
              : tenant.riskSignalSummary.healthRiskLevel === "warning"
                ? "outline"
                : "secondary"
          }
          className="text-[10px]"
        >
          {tenant.riskSignalSummary.healthStatus || tenant.riskSignalSummary.riskLevel || "—"}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {tenant.lastActivityAt
          ? formatDistanceToNow(new Date(tenant.lastActivityAt), { addSuffix: true })
          : "—"}
      </TableCell>
      <TableCell className="text-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link href={`/super-admin/tenants`}>View</Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function SuperAdminOverview() {
  const {
    data: dashboard,
    isLoading: dashLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = usePlatformDashboard();
  const { data: registry, isLoading: registryLoading } = useTenantRegistry(
    undefined,
    { refetchInterval: PLATFORM_DASHBOARD_REFRESH_MS },
  );
  const { data: activity, isLoading: activityLoading } = useGetPlatformActivity({
    query: { refetchInterval: PLATFORM_DASHBOARD_REFRESH_MS },
  });

  const tenants = registry?.tenants ?? [];
  const subByStatus = dashboard?.subscriptions.byStatus ?? {};
  const planByCode = dashboard?.plans.byCode ?? {};

  const atRiskCount = useMemo(
    () =>
      tenants.filter(
        (t) =>
          t.riskSignalSummary.healthRiskLevel === "critical" ||
          t.riskSignalSummary.healthRiskLevel === "warning" ||
          t.riskSignalSummary.renewalDueSoon ||
          t.riskSignalSummary.gracePeriodActive,
      ).length,
    [tenants],
  );

  const lastUpdated = dataUpdatedAt
    ? format(new Date(dataUpdatedAt), "yyyy-MM-dd HH:mm:ss")
    : "—";

  return (
    <div className="space-y-6" data-testid="super-admin-overview" lang="en" dir="ltr">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Platform Command Center</h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed">
            Read-only operational view of all workspaces, subscription metadata, integration
            footprint, and risk signals. Auto-refreshes every 60 seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1 rounded-md border border-border bg-muted/30">
            <Clock className="w-3.5 h-3.5" />
            Updated {lastUpdated}
            {isFetching && <RefreshCw className="w-3 h-3 animate-spin ms-1" />}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="w-3.5 h-3.5 me-1" />
            Refresh now
          </Button>
          <Button asChild>
            <Link href="/super-admin/workspaces/new">
              <Plus className="w-4 h-4 me-2" />
              New workspace
            </Link>
          </Button>
        </div>
      </div>

      {/* Workspace & users */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total workspaces"
          value={dashboard?.workspaces.total}
          icon={Building2}
          color="text-blue-600"
        />
        <StatCard
          title="Active workspaces"
          value={dashboard?.workspaces.active}
          icon={CheckCircle2}
          color="text-emerald-600"
          sub={`${dashboard?.workspaces.suspended ?? 0} suspended · ${dashboard?.workspaces.disabled ?? 0} disabled`}
        />
        <StatCard
          title="Platform users"
          value={dashboard?.users.total}
          icon={Users}
          color="text-violet-600"
          sub="Excludes super-admin accounts"
        />
        <StatCard
          title="At-risk tenants"
          value={atRiskCount}
          icon={AlertTriangle}
          color="text-amber-600"
          sub="Health warning, renewal, or grace signals"
        />
      </div>

      {/* Subscriptions & integrations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Trial ending (14d)"
          value={dashboard?.subscriptions.trialEndingWithin14Days}
          icon={CreditCard}
          color="text-sky-600"
        />
        <StatCard
          title="Grace period active"
          value={dashboard?.subscriptions.gracePeriodActive}
          icon={PauseCircle}
          color="text-orange-600"
        />
        <StatCard
          title="Attendance integrations"
          value={dashboard?.integrations.attendanceConnections}
          icon={Plug}
          color="text-indigo-600"
          sub={`${dashboard?.integrations.attendanceEnabled ?? 0} enabled connections`}
        />
        <StatCard
          title="SMTP configured"
          value={dashboard?.integrations.smtpConfigured}
          icon={Mail}
          color="text-teal-600"
          sub="Workspaces with outbound mail"
        />
      </div>

      {/* Subscription breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Subscription status</CardTitle>
            <CardDescription>Metadata only — no payment processing on this dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(subByStatus).map(([status, n]) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30 text-sm"
                  >
                    <SubscriptionBadge status={status} />
                    <span className="font-semibold tabular-nums">{n}</span>
                  </div>
                ))}
                {(dashboard?.workspaces.withoutSubscription ?? 0) > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 text-sm">
                    <span className="text-amber-800 dark:text-amber-200">No subscription row</span>
                    <span className="font-semibold tabular-nums">
                      {dashboard!.workspaces.withoutSubscription}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Plans distribution</CardTitle>
            <CardDescription>By planCode on tenant_subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(planByCode).map(([code, n]) => (
                  <div
                    key={code}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm"
                  >
                    <PlanBadge planCode={code === "no_plan" ? null : code} />
                    <span className="font-semibold tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {dashboard &&
        (dashboard.workspaces.suspended > 0 ||
          dashboard.workspaces.disabled > 0 ||
          atRiskCount > 0) && (
          <div className="space-y-2">
            {dashboard.workspaces.suspended > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {dashboard.workspaces.suspended} workspace(s) suspended
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/super-admin/workspaces">Manage</Link>
                </Button>
              </div>
            )}
            {atRiskCount > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  {atRiskCount} tenant(s) with renewal, grace, or health warnings
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/super-admin/tenants">Tenant registry</Link>
                </Button>
              </div>
            )}
          </div>
        )}

      {/* Full workspace registry table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              All workspaces ({registry?.total ?? tenants.length})
            </CardTitle>
            <CardDescription className="mt-1">
              Display-only inventory — open Tenant Registry for subscription edits, quotas, and
              integrations console.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/super-admin/tenants">
              Tenant registry <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {registryLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No workspaces found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TenantRow key={t.tenantId} tenant={t} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent workspaces (activity feed) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Recently created workspaces
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/super-admin/workspaces">
              All workspaces <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !activity?.recentWorkspaces?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No workspaces yet.</p>
          ) : (
            <div className="space-y-1">
              {activity.recentWorkspaces.slice(0, 8).map((ws) => {
                const StatusIcon =
                  ws.status === "active"
                    ? CheckCircle2
                    : ws.status === "suspended"
                      ? PauseCircle
                      : XCircle;
                return (
                  <Link key={ws.id} href={`/super-admin/workspaces/${ws.id}`}>
                    <div className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-muted transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ws.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ws.slug}</p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize",
                          WORKSPACE_STATUS_STYLES[ws.status] ?? "bg-muted",
                        )}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {ws.status}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(ws.createdAt ?? Date.now()), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center pb-4">
        {dashboard?.safetyNotice ??
          "Read-only dashboard. Integration counts include attendance connectors and workspace SMTP configs."}
      </p>
    </div>
  );
}
