/**
 * @file   pages/governance-dashboard.tsx
 * @phase  P6-E - Governance Dashboard & Operational Console Foundations
 *
 * Minimal enterprise operational console for workspace admins.
 *
 * ── SAFETY INVARIANTS ─────────────────────────────────────────────────────────
 *   READ-ONLY: no mutation actions, no cancel/timeout buttons, no alert
 *   dismissal, no workflow modifications. Visibility only.
 *
 * ── POLLING MODEL ─────────────────────────────────────────────────────────────
 *   All 4 governance queries poll every 30s (refetchInterval).
 *   A "stale" indicator appears after 3 missed cycles (90s).
 *   Manual refresh button forces immediate refetch of all 4 queries.
 *
 * ── OBSERVABILITY ─────────────────────────────────────────────────────────────
 *   governance_dashboard_loaded    - on first mount
 *   governance_dashboard_refreshed - on manual refresh
 *   governance_alert_viewed        - on alerts panel mount
 *   governance_stuck_table_viewed  - on stuck table mount
 */

import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Activity, AlertTriangle, RefreshCw, Clock, Zap, ShieldAlert,
  CheckCircle2, XCircle, Timer, Ban, TrendingUp, BarChart3,
  ChevronRight, Info,
} from "lucide-react";
import {
  useGetGovernanceHealth,
  useGetGovernanceMetrics,
  useGetGovernanceStuck,
  useGetGovernanceAlerts,
  usePostGovernanceEvents,
  type GovernanceAlertItem,
  type GovernanceStuck,
  type GovernanceEventBodyAction,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  healthSeverityPalette,
  alertSeverityBadge,
  stuckSeverityBadge,
  stuckReasonLabel,
  stuckReasonBadge,
  formatOverdueMs,
  isCapturedAtStale,
  capturedAtAge,
  sortAlertsBySeverity,
  errorRateToSeverity,
  formatErrorRate,
  healthSeverityLabel,
  buildDashboardEvent,
} from "@/lib/governance-utils";

// ── Poll interval ─────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;

// ── Small skeleton reused for loading states ──────────────────────────────────
function MetricSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

// ── Severity dot indicator ────────────────────────────────────────────────────
function SeverityDot({ severity }: { severity: string }) {
  const palette = healthSeverityPalette(severity);
  return <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", palette.dot)} />;
}

// ── Indicator dimension row ───────────────────────────────────────────────────
function IndicatorRow({ label, value }: { label: string; value: string }) {
  const palette = healthSeverityPalette(value);
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <SeverityDot severity={value} />
        <span className={cn("text-xs font-semibold uppercase tracking-wide", palette.text)}>
          {healthSeverityLabel(value)}
        </span>
      </div>
    </div>
  );
}

// ── Metric stat card ──────────────────────────────────────────────────────────
interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: number | undefined;
  isLoading: boolean;
  colorClass?: string;
}

function MetricCard({ icon: Icon, label, value, isLoading, colorClass }: MetricCardProps) {
  return (
    <Card className="flex flex-col gap-0">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-12 mt-1" />
            ) : (
              <p className={cn("text-2xl font-bold mt-0.5 tabular-nums", colorClass ?? "text-foreground")}>
                {value ?? 0}
              </p>
            )}
          </div>
          <div className={cn("p-2 rounded-md", colorClass ? "bg-current/10" : "bg-muted")}>
            <Icon className={cn("w-4 h-4", colorClass ?? "text-muted-foreground")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GovernanceDashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { isAdmin, isLoading: permLoading } = usePermissions();

  // Redirect non-admins
  useEffect(() => {
    if (!permLoading && !isAdmin) {
      navigate("/home");
    }
  }, [isAdmin, permLoading, navigate]);

  // ── Governance data queries ─────────────────────────────────────────────────
  const healthQ  = useGetGovernanceHealth({
    query: { queryKey: ["/api/governance/health"],  refetchInterval: POLL_INTERVAL_MS },
  });
  const metricsQ = useGetGovernanceMetrics({
    query: { queryKey: ["/api/governance/metrics"], refetchInterval: POLL_INTERVAL_MS },
  });
  const stuckQ   = useGetGovernanceStuck({
    query: { queryKey: ["/api/governance/stuck"],   refetchInterval: POLL_INTERVAL_MS },
  });
  const alertsQ  = useGetGovernanceAlerts(undefined, {
    query: { queryKey: ["/api/governance/alerts"],  refetchInterval: POLL_INTERVAL_MS },
  });

  // ── Observability events ────────────────────────────────────────────────────
  const eventMutation   = usePostGovernanceEvents();
  const loadedOnce      = useRef(false);

  const emitEvent = useCallback(
    (action: Parameters<typeof buildDashboardEvent>[0]) => {
      const alertCount   = alertsQ.data?.total  ?? 0;
      const stuckCount   = stuckQ.data?.total   ?? 0;
      const severity     = healthQ.data?.severity ?? "unknown";
      const payload      = buildDashboardEvent(action, alertCount, stuckCount, severity);
      eventMutation.mutate({
        data: {
          action:            payload.action as unknown as GovernanceEventBodyAction,
          visibleAlertCount: payload.visibleAlertCount,
          visibleStuckCount: payload.visibleStuckCount,
          dashboardSeverity: payload.dashboardSeverity,
        },
      });
    },
    [alertsQ.data, stuckQ.data, healthQ.data, eventMutation],
  );

  // Emit "loaded" once all 4 queries succeed for the first time
  useEffect(() => {
    if (
      !loadedOnce.current &&
      healthQ.isSuccess && metricsQ.isSuccess && stuckQ.isSuccess && alertsQ.isSuccess
    ) {
      loadedOnce.current = true;
      emitEvent("governance_dashboard_loaded");
    }
  }, [healthQ.isSuccess, metricsQ.isSuccess, stuckQ.isSuccess, alertsQ.isSuccess, emitEvent]);

  // ── Manual refresh ──────────────────────────────────────────────────────────
  const isRefreshing =
    healthQ.isFetching || metricsQ.isFetching || stuckQ.isFetching || alertsQ.isFetching;

  function handleRefresh() {
    void Promise.all([
      healthQ.refetch(),
      metricsQ.refetch(),
      stuckQ.refetch(),
      alertsQ.refetch(),
    ]);
    emitEvent("governance_dashboard_refreshed");
  }

  // ── Stale data detection ────────────────────────────────────────────────────
  const capturedAt = healthQ.data?.capturedAt ?? metricsQ.data?.capturedAt;
  const isStale    = capturedAt ? isCapturedAtStale(capturedAt) : false;
  const ageLabel   = capturedAt ? capturedAtAge(capturedAt) : null;

  // ── Derived display values ──────────────────────────────────────────────────
  const health     = healthQ.data;
  const metrics    = metricsQ.data;
  const stuck      = stuckQ.data;
  const alertsPage = alertsQ.data;

  const overallSeverity  = health?.severity ?? "healthy";
  const severityPalette  = healthSeverityPalette(overallSeverity);
  const sortedAlerts     = sortAlertsBySeverity(alertsPage?.data ?? []) as GovernanceAlertItem[];

  const isLoading =
    (healthQ.isLoading || metricsQ.isLoading || stuckQ.isLoading || alertsQ.isLoading) &&
    !health && !metrics;

  // ── Guard: non-admins see nothing while redirect happens ───────────────────
  if (permLoading || (!isAdmin && !permLoading)) {
    return null;
  }

  return (
    <div className="space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Governance Console</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operational visibility for this workspace - read-only
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stale indicator */}
          {isStale && ageLabel && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-md">
              <Clock className="w-3.5 h-3.5" />
              <span>Stale - {ageLabel}</span>
            </div>
          )}
          {/* Last updated */}
          {ageLabel && !isStale && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated {ageLabel}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Health overview panel ─────────────────────────────────────────────── */}
      <Card className={cn("border-2", severityPalette.border)}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldAlert className={cn("w-5 h-5", severityPalette.text)} />
              <CardTitle className="text-base">Tenant Health</CardTitle>
            </div>
            {isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <span className={cn("px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide", severityPalette.badge)}>
                {healthSeverityLabel(overallSeverity)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Severity dimensions */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Dimensions
              </p>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : health?.indicators ? (
                <div>
                  <IndicatorRow label="Execution pressure"  value={health.indicators.executionPressure  ?? "healthy"} />
                  <IndicatorRow label="Error concentration" value={health.indicators.errorConcentration ?? "healthy"} />
                  <IndicatorRow label="Approval pressure"   value={health.indicators.approvalPressure   ?? "healthy"} />
                  <IndicatorRow label="Delay pressure"      value={health.indicators.delayPressure      ?? "healthy"} />
                  <IndicatorRow label="Storm pressure"      value={health.indicators.stormPressure      ?? "healthy"} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data</p>
              )}
            </div>

            {/* Storm + Stuck summary */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Automation Storm
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-semibold uppercase",
                    healthSeverityPalette(health?.stormSeverity === "none" ? "healthy" : (health?.stormSeverity ?? "healthy")).badge,
                  )}>
                    {health?.stormSeverity === "none" ? "None" : (health?.stormSeverity ?? "None")}
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Stuck Executions
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className={cn(
                      "text-2xl font-bold tabular-nums",
                      (health?.stuckExecutionCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                    )}>
                      {health?.stuckExecutionCount ?? 0}
                    </span>
                    <span className="text-xs text-muted-foreground">total</span>
                  </div>
                )}
              </div>
            </div>

            {/* Error rate + key metrics */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Error Rate
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (() => {
                  const rate = health?.metrics?.workflowErrorRate ?? 0;
                  const sev  = errorRateToSeverity(rate);
                  return (
                    <div className="flex items-baseline gap-2">
                      <span className={cn(
                        "text-2xl font-bold tabular-nums",
                        healthSeverityPalette(sev).text,
                      )}>
                        {formatErrorRate(rate)}
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Approval Backlog
                </p>
                {isLoading ? <Skeleton className="h-5 w-8" /> : (
                  <span className={cn(
                    "text-lg font-bold tabular-nums",
                    (health?.metrics?.approvalBacklogCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                  )}>
                    {health?.metrics?.approvalBacklogCount ?? 0}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Execution metrics cards ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Execution Metrics
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <MetricCard
            icon={Activity}
            label="Active"
            value={metrics?.counts?.active}
            isLoading={metricsQ.isLoading}
            colorClass={(metrics?.counts?.active ?? 0) > 0 ? "text-blue-600 dark:text-blue-400" : undefined}
          />
          <MetricCard
            icon={Clock}
            label="Waiting Approval"
            value={metrics?.counts?.waitingApproval}
            isLoading={metricsQ.isLoading}
            colorClass={(metrics?.counts?.waitingApproval ?? 0) > 0 ? "text-purple-600 dark:text-purple-400" : undefined}
          />
          <MetricCard
            icon={Timer}
            label="Waiting Delay"
            value={metrics?.counts?.waitingDelay}
            isLoading={metricsQ.isLoading}
            colorClass={(metrics?.counts?.waitingDelay ?? 0) > 0 ? "text-sky-600 dark:text-sky-400" : undefined}
          />
          <MetricCard
            icon={CheckCircle2}
            label="Completed"
            value={metrics?.counts?.completed}
            isLoading={metricsQ.isLoading}
            colorClass="text-green-600 dark:text-green-400"
          />
          <MetricCard
            icon={XCircle}
            label="Failed"
            value={metrics?.counts?.failed}
            isLoading={metricsQ.isLoading}
            colorClass={(metrics?.counts?.failed ?? 0) > 0 ? "text-red-600 dark:text-red-400" : undefined}
          />
          <MetricCard
            icon={Zap}
            label="Timed Out"
            value={metrics?.counts?.timedOut}
            isLoading={metricsQ.isLoading}
            colorClass={(metrics?.counts?.timedOut ?? 0) > 0 ? "text-orange-600 dark:text-orange-400" : undefined}
          />
          <MetricCard
            icon={Ban}
            label="Cancelled"
            value={metrics?.counts?.cancelled}
            isLoading={metricsQ.isLoading}
          />
        </div>
      </div>

      {/* ── Two-column lower section ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Governance alerts panel ─────────────────────────────────────────── */}
        <AlertsPanel
          alerts={sortedAlerts}
          total={alertsPage?.total ?? 0}
          isLoading={alertsQ.isLoading}
          isError={alertsQ.isError}
          onViewed={() => emitEvent("governance_alert_viewed")}
        />

        {/* ── Stuck executions table ──────────────────────────────────────────── */}
        <StuckPanel
          stuck={stuck}
          isLoading={stuckQ.isLoading}
          isError={stuckQ.isError}
          onViewed={() => emitEvent("governance_stuck_table_viewed")}
        />
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts Panel
// ─────────────────────────────────────────────────────────────────────────────

interface AlertsPanelProps {
  alerts:    GovernanceAlertItem[];
  total:     number;
  isLoading: boolean;
  isError:   boolean;
  onViewed:  () => void;
}

function AlertsPanel({ alerts, total, isLoading, isError, onViewed }: AlertsPanelProps) {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current && !isLoading && !isError) {
      mounted.current = true;
      onViewed();
    }
  }, [isLoading, isError, onViewed]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Governance Alerts</CardTitle>
          </div>
          {!isLoading && (
            <span className="text-xs text-muted-foreground">{total} total</span>
          )}
        </div>
        <CardDescription>Active governance codes for this workspace</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4 justify-center">
            <XCircle className="w-4 h-4" />
            <span>Failed to load alerts</span>
          </div>
        )}

        {!isLoading && !isError && alerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm font-medium text-green-700 dark:text-green-400">No active alerts</p>
            <p className="text-xs text-muted-foreground">Workspace is operating normally</p>
          </div>
        )}

        {!isLoading && !isError && alerts.map((alert, idx) => (
          <div
            key={`${alert.code}-${idx}`}
            className="rounded-md border border-border p-3 space-y-1.5 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0", alertSeverityBadge(alert.severity ?? "info"))}>
                  {alert.severity}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">{alert.code}</span>
              </div>
              {(alert.affectedExecutionIds?.length ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {alert.affectedExecutionIds!.length} affected
                </span>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">{alert.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{alert.description}</p>
            {alert.recommendedAction && (
              <div className="flex items-start gap-1.5 pt-0.5">
                <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground italic">{alert.recommendedAction}</p>
              </div>
            )}
          </div>
        ))}

        {total > alerts.length && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            Showing {alerts.length} of {total} alerts
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stuck Executions Panel
// ─────────────────────────────────────────────────────────────────────────────

interface StuckPanelProps {
  stuck:     GovernanceStuck | undefined;
  isLoading: boolean;
  isError:   boolean;
  onViewed:  () => void;
}

function StuckPanel({ stuck, isLoading, isError, onViewed }: StuckPanelProps) {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current && !isLoading && !isError) {
      mounted.current = true;
      onViewed();
    }
  }, [isLoading, isError, onViewed]);

  const items = stuck?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Stuck Executions</CardTitle>
          </div>
          {!isLoading && stuck && (
            <div className="flex items-center gap-2">
              {stuck.truncated && (
                <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium">
                  Showing {stuck.limit} of {stuck.total}
                </span>
              )}
              {!stuck.truncated && (
                <span className="text-xs text-muted-foreground">{stuck.total} total</span>
              )}
            </div>
          )}
        </div>
        <CardDescription>Sorted by overdue duration - most critical first</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4 justify-center">
            <XCircle className="w-4 h-4" />
            <span>Failed to load stuck executions</span>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm font-medium text-green-700 dark:text-green-400">No stuck executions</p>
            <p className="text-xs text-muted-foreground">All executions are progressing normally</p>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-1 text-muted-foreground font-medium">ID</th>
                  <th className="text-left py-2 px-1 text-muted-foreground font-medium">WF</th>
                  <th className="text-left py-2 px-1 text-muted-foreground font-medium">Reason</th>
                  <th className="text-right py-2 px-1 text-muted-foreground font-medium">Overdue</th>
                  <th className="text-right py-2 px-1 text-muted-foreground font-medium">Severity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.executionId}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-2 px-1 font-mono text-muted-foreground">
                      #{item.executionId}
                    </td>
                    <td className="py-2 px-1 font-mono text-muted-foreground">
                      #{item.workflowId}
                    </td>
                    <td className="py-2 px-1">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", stuckReasonBadge(item.stuckReason ?? ""))}>
                        {stuckReasonLabel(item.stuckReason ?? "")}
                      </span>
                    </td>
                    <td className="py-2 px-1 text-right font-mono font-semibold">
                      {formatOverdueMs(item.overdueMs ?? 0)}
                    </td>
                    <td className="py-2 px-1 text-right">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase", stuckSeverityBadge(item.severity ?? "warning"))}>
                        {item.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {stuck?.truncated && (
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border text-xs text-amber-600 dark:text-amber-400">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>List is truncated at {stuck.limit ?? 0} entries - {(stuck.total ?? 0) - (stuck.limit ?? 0)} additional stuck executions not shown.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
