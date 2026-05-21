/**
 * @file   pages/super-admin-governance-analytics.tsx
 * @phase  P12-E - Governance Analytics UI & Compliance Intelligence Visualization Foundations
 *
 * Full governance analytics dashboard - read-only, super_admin only.
 * Sections:
 *   1. Analytics overview banner (metric summary)
 *   2. Metric cards (7 key metrics with tier colouring)
 *   3. Violation trend chart (time-series if available)
 *   4. Escalation distribution chart
 *   5. Workflow effectiveness section
 *   6. Unresolved critical panel
 *   7. Policy effectiveness table
 *
 * Time-range filter: 7d / 30d / 90d / all (client-side over available data)
 *
 * SAFETY CONTRACT: read-only - no mutations, no export, no AI, no legal conclusions.
 */

import { useState, useMemo } from "react";
import {
  BarChart3, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Clock, ShieldAlert, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGovernanceAnalytics,
  useGovernanceAnalyticsEffectiveness,
  useGovernancePolicyEffectiveness,
} from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceViolationTrendChart, type ViolationTrendPoint }
  from "@/components/governance/governance-violation-trend-chart";
import { GovernanceEscalationDistributionChart, type EscalationDistributionPoint }
  from "@/components/governance/governance-escalation-distribution-chart";
import { GovernancePolicyEffectivenessTable }
  from "@/components/governance/governance-policy-effectiveness-table";
import {
  ANALYTICS_METRIC_MAP,
  WORKFLOW_EFFECTIVENESS_SCORE_MAP,
  ANALYTICS_TIME_RANGE_OPTIONS,
  ANALYTICS_UI_SAFETY_CONTRACT,
  type AnalyticsTimeRangeKey,
  type WorkflowEffectivenessScoreKey,
} from "@/lib/governance-console-config";

// ── Formatters ─────────────────────────────────────────────────────────────

function pct(v?: number) {
  if (v === undefined || v === null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function ms(v?: number) {
  if (v === undefined || v === null) return "-";
  if (v < 1000)       return `${v}ms`;
  if (v < 60_000)     return `${(v / 1000).toFixed(1)}s`;
  if (v < 3_600_000)  return `${(v / 60_000).toFixed(1)}m`;
  return `${(v / 3_600_000).toFixed(1)}h`;
}

// ── Trend icon ─────────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend?: string }) {
  if (trend === "improving") return <TrendingDown className="w-4 h-4 text-emerald-500" />;
  if (trend === "worsening") return <TrendingUp    className="w-4 h-4 text-red-500"     />;
  if (trend === "critical")  return <TrendingUp    className="w-4 h-4 text-red-600 animate-pulse" />;
  if (trend === "stable")    return <Minus         className="w-4 h-4 text-muted-foreground" />;
  return                            <Minus         className="w-4 h-4 text-muted-foreground" />;
}

// ── Effectiveness score display ────────────────────────────────────────────

const EFFECTIVENESS_COLOURS: Record<string, { badge: string; text: string }> = {
  critical:  { badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",     text: "text-red-600 dark:text-red-400"     },
  attention: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0", text: "text-amber-600 dark:text-amber-400" },
  neutral:   { badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0", text: "text-slate-600 dark:text-slate-400"  },
  good:      { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0", text: "text-emerald-600 dark:text-emerald-400" },
  excellent: { badge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-0", text: "text-teal-600 dark:text-teal-400"     },
};

function EffectivenessBadge({ score }: { score?: string }) {
  const key  = (score ?? "") as WorkflowEffectivenessScoreKey;
  const info = key in WORKFLOW_EFFECTIVENESS_SCORE_MAP ? WORKFLOW_EFFECTIVENESS_SCORE_MAP[key] : null;
  if (!info) return <span className="text-2xl font-bold capitalize text-foreground">{score?.replace(/_/g, " ") ?? "-"}</span>;
  const c = EFFECTIVENESS_COLOURS[info.tier] ?? EFFECTIVENESS_COLOURS.neutral;
  return (
    <div>
      <p className={`text-2xl font-bold ${c.text}`}>{info.label}</p>
      <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
    </div>
  );
}

// ── Metric card ────────────────────────────────────────────────────────────

const METRIC_TIER_COLOURS: Record<string, string> = {
  neutral:  "border-l-slate-300",
  status:   "border-l-blue-400",
  elevated: "border-l-orange-400",
  good:     "border-l-emerald-400",
  critical: "border-l-red-500",
};

function MetricCard({
  metricKey, value, loading,
}: {
  metricKey: keyof typeof ANALYTICS_METRIC_MAP;
  value?: string | number;
  loading?: boolean;
}) {
  const m = ANALYTICS_METRIC_MAP[metricKey];
  const borderColour = METRIC_TIER_COLOURS[m.tier] ?? "border-l-slate-300";

  return (
    <div className={`border border-border rounded-md p-3 border-l-4 ${borderColour} bg-card`}
      title={m.description} data-testid={`metric-card-${metricKey}`}>
      <p className="text-xs text-muted-foreground">{m.label}</p>
      {loading
        ? <Skeleton className="h-6 w-16 mt-1" />
        : <p className="text-xl font-bold tabular-nums mt-0.5">{value ?? "-"}</p>
      }
    </div>
  );
}

// ── Time-range toggle ──────────────────────────────────────────────────────

function TimeRangeToggle({
  value, onChange,
}: {
  value: AnalyticsTimeRangeKey;
  onChange: (v: AnalyticsTimeRangeKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-muted/40"
      data-testid="time-range-toggle">
      {ANALYTICS_TIME_RANGE_OPTIONS.map(opt => (
        <Button
          key={opt.value}
          size="sm"
          variant={value === opt.value ? "secondary" : "ghost"}
          className={`h-6 px-2 text-xs rounded ${value === opt.value ? "font-semibold" : "font-normal"}`}
          onClick={() => onChange(opt.value)}
          data-testid={`time-range-${opt.value}`}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

// ── Analytics overview banner ──────────────────────────────────────────────

function AnalyticsOverviewBanner({
  profile, report, isLoading,
}: {
  profile: any;
  report:  any;
  isLoading: boolean;
}) {
  const hasCritical   = (profile?.unresolvedCriticalCount ?? 0) > 0;
  const isEscalating  = report?.escalationTrend === "worsening" || report?.escalationTrend === "critical";
  const borderClass   = hasCritical || isEscalating
    ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : "border-border bg-card";

  return (
    <div className={`rounded-md border-2 ${borderClass} p-4`} data-testid="analytics-overview-banner">
      <div className="flex flex-wrap items-center gap-4">

        <div className="flex items-center gap-2">
          <Activity className={`w-5 h-5 ${hasCritical ? "text-red-500" : "text-muted-foreground"}`} />
          <div>
            {isLoading
              ? <Skeleton className="h-5 w-24" />
              : <p className="text-sm font-semibold">{profile?.totalWorkflows ?? 0} workflows total</p>
            }
            <p className="text-xs text-muted-foreground">Platform-wide governance coverage</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ShieldAlert className={`w-5 h-5 ${hasCritical ? "text-red-500 animate-pulse" : "text-muted-foreground"}`} />
          <div>
            {isLoading
              ? <Skeleton className="h-5 w-20" />
              : (
                <p className={`text-sm font-semibold ${hasCritical ? "text-red-600 dark:text-red-400" : ""}`}>
                  {profile?.unresolvedCriticalCount ?? 0} unresolved critical
                </p>
              )
            }
            <p className="text-xs text-muted-foreground">Critical-severity workflows</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TrendIcon trend={report?.escalationTrend} />
          <div>
            {isLoading
              ? <Skeleton className="h-5 w-28" />
              : (
                <p className={`text-sm font-semibold capitalize ${isEscalating ? "text-red-600 dark:text-red-400" : ""}`}>
                  {report?.escalationTrend?.replace(/_/g, " ") ?? "-"} escalation trend
                </p>
              )
            }
            <p className="text-xs text-muted-foreground">Escalation direction over review window</p>
          </div>
        </div>

        {(hasCritical || isEscalating) && (
          <Badge className="ml-auto bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0 text-xs">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Attention required
          </Badge>
        )}
      </div>
    </div>
  );
}

// ── Unresolved critical panel ──────────────────────────────────────────────

function UnresolvedCriticalPanel({ profile, isLoading }: { profile: any; isLoading: boolean }) {
  const count      = profile?.unresolvedCriticalCount ?? 0;
  const durationMs = profile?.criticalUnresolvedDurationMs;

  return (
    <Card data-testid="unresolved-critical-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          Unresolved Critical Workflows
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : count === 0 ? (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400"
            data-testid="unresolved-critical-empty">
            <CheckCircle2 className="w-4 h-4" />
            <p className="text-sm">No unresolved critical workflows - all critical workflows are resolved.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-3xl font-bold text-red-600 dark:text-red-400 tabular-nums">{count}</p>
                <p className="text-xs text-muted-foreground">unresolved critical</p>
              </div>
              {durationMs !== undefined && durationMs !== null && (
                <div className="border-l pl-4">
                  <div className="flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                    <Clock className="w-4 h-4" />
                    {ms(durationMs)} avg. duration
                  </div>
                  <p className="text-xs text-muted-foreground">Average time unresolved</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground border-t pt-2">
              Review these workflows on the{" "}
              <a href="/super-admin/governance/workflows" className="underline hover:text-foreground transition-colors">
                Governance Workflows
              </a>{" "}
              page. Filter by escalation level L4 or status "escalated" to prioritise.
              This panel is read-only - no escalation or resolution actions are available here.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Derive escalation distribution from profile ────────────────────────────

function deriveEscalationDistribution(profile: any): EscalationDistributionPoint[] {
  if (!profile) return [];
  const escalated = profile.escalatedWorkflows ?? 0;
  const total     = profile.totalWorkflows     ?? 0;
  if (total === 0) return [];
  // The analytics endpoint returns aggregate counts, not per-level breakdowns.
  // Build a simplified two-bucket distribution from available data.
  const notEscalated = Math.max(0, total - escalated);
  return [
    { level: "L1_automated",  count: notEscalated, percent: total > 0 ? notEscalated / total : 0 },
    { level: "L3_management", count: escalated,    percent: total > 0 ? escalated / total    : 0 },
  ].filter(d => d.count > 0);
}

// ── Derive violation trend from trend data ─────────────────────────────────
// The analytics endpoints return aggregate scalars, not time-series arrays.
// The trend chart shows an empty state until a time-series endpoint is wired.

function deriveTrendData(_profile: any, _report: any): ViolationTrendPoint[] {
  return [];
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceAnalytics() {
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRangeKey>("30d");
  const [showSeverityBreakdown, setShowSeverityBreakdown] = useState(false);

  const analytics     = useGovernanceAnalytics();
  const effectiveness = useGovernanceAnalyticsEffectiveness();
  const policyEff     = useGovernancePolicyEffectiveness();

  const profile  = (analytics.data    as any)?.profile  ?? {};
  const report   = (effectiveness.data as any)?.report  ?? {};
  const profiles = (policyEff.data    as any)?.profiles ?? [];

  const isLoading = analytics.isLoading || effectiveness.isLoading;
  const isError   = analytics.isError;

  // Derived chart data (client-side)
  const trendData        = useMemo(() => deriveTrendData(profile, report),       [profile, report]);
  const escalationDist   = useMemo(() => deriveEscalationDistribution(profile),  [profile]);

  return (
    <div className="space-y-6" data-testid="governance-analytics-page">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <GovernanceSectionHeader
          icon={BarChart3}
          title="Compliance Analytics"
          description="Governance health metrics, workflow effectiveness scoring, per-policy stability ratings, and escalation trend analysis."
        />
        <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
      </div>

      <GovernanceReadOnlyNotice data-testid="governance-read-only-notice" />

      {isError && <GovernanceErrorState message="Could not load governance analytics data. The metrics will appear once the API is reachable." />}

      {/* Overview banner */}
      <AnalyticsOverviewBanner profile={profile} report={report} isLoading={isLoading} />

      {/* 7 key metric cards */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Key Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MetricCard metricKey="totalWorkflows"          value={profile?.totalWorkflows}               loading={isLoading} />
          <MetricCard metricKey="activeWorkflows"         value={profile?.activeWorkflows}              loading={isLoading} />
          <MetricCard metricKey="escalatedWorkflows"      value={profile?.escalatedWorkflows}           loading={isLoading} />
          <MetricCard metricKey="unresolvedCriticalCount" value={profile?.unresolvedCriticalCount}      loading={isLoading} />
          <MetricCard metricKey="escalationRate"          value={pct(profile?.escalationRate)}          loading={isLoading} />
          <MetricCard metricKey="throughputRate"          value={pct(profile?.throughputRate)}          loading={isLoading} />
          <MetricCard metricKey="averageResolutionDurationMs" value={ms(profile?.averageResolutionDurationMs)} loading={isLoading} />
        </div>
      </section>

      {/* Violation trend + escalation distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm flex-1">Violation Trend</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setShowSeverityBreakdown(v => !v)}
                data-testid="toggle-severity-breakdown"
              >
                {showSeverityBreakdown ? "Total only" : "By severity"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Violations over time · {ANALYTICS_TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label}
            </p>
          </CardHeader>
          <CardContent>
            {isLoading
              ? <Skeleton className="h-52 w-full" />
              : (
                <GovernanceViolationTrendChart
                  data={trendData}
                  showBreakdown={showSeverityBreakdown}
                  data-testid="violation-trend-chart"
                />
              )
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm">Escalation Distribution</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Workflow count by escalation level
            </p>
          </CardHeader>
          <CardContent>
            {isLoading
              ? <Skeleton className="h-48 w-full" />
              : (
                <GovernanceEscalationDistributionChart
                  data={escalationDist}
                  data-testid="escalation-distribution-chart"
                />
              )
            }
          </CardContent>
        </Card>
      </div>

      {/* Workflow effectiveness + escalation trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <Card data-testid="workflow-effectiveness-section">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Workflow Effectiveness Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading
              ? <Skeleton className="h-12 w-40" />
              : <EffectivenessBadge score={profile?.workflowStabilityScore} />
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Escalation Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-12 w-32" /> : (
              <div className="flex items-center gap-3">
                <TrendIcon trend={report?.escalationTrend} />
                <div>
                  <p className="text-xl font-bold capitalize">
                    {report?.escalationTrend?.replace(/_/g, " ") ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Based on platform-wide escalation patterns
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unresolved critical panel */}
      <UnresolvedCriticalPanel profile={profile} isLoading={isLoading} />

      {/* All 13 metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All 13 Governance Metrics</CardTitle>
          <p className="text-xs text-muted-foreground">
            Platform-wide aggregate · Computed from governance workflow data
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {(Object.keys(ANALYTICS_METRIC_MAP) as (keyof typeof ANALYTICS_METRIC_MAP)[])
              .sort((a, b) => ANALYTICS_METRIC_MAP[a].order - ANALYTICS_METRIC_MAP[b].order)
              .map(key => {
                const m = ANALYTICS_METRIC_MAP[key];
                let display: string | number | undefined;
                if (m.unit === "percent") display = pct((profile as any)?.[key]);
                else if (m.unit === "ms") display = ms((profile as any)?.[key]);
                else if (m.unit === "ratio") display = (profile as any)?.[key]?.toFixed(2);
                else display = (profile as any)?.[key];
                return (
                  <div key={key} className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
                    title={m.description}>
                    <span className="text-xs text-muted-foreground truncate pr-2">{m.label}</span>
                    {isLoading
                      ? <Skeleton className="h-4 w-14 shrink-0" />
                      : <span className="text-xs font-semibold tabular-nums shrink-0">{display ?? "-"}</span>
                    }
                  </div>
                );
              })
            }
          </div>
        </CardContent>
      </Card>

      {/* Policy effectiveness table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm flex-1">Per-Policy Effectiveness</CardTitle>
            {!policyEff.isLoading && (
              <Badge variant="outline" className="text-xs">{profiles.length} policies</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Sorted by unresolved frequency · Amber highlights indicate rates above attention threshold
          </p>
        </CardHeader>
        <CardContent>
          <GovernancePolicyEffectivenessTable
            profiles={profiles}
            isLoading={policyEff.isLoading}
            data-testid="policy-effectiveness-table"
          />
        </CardContent>
      </Card>

      {/* Safety annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        {ANALYTICS_UI_SAFETY_CONTRACT.superAdminOnly && (
          <>
            Governance console - read-only analytics visualization
            {" · "}No auto-escalation
            {" · "}No policy tuning
            {" · "}No recommendations
            {" · "}No legal conclusions
          </>
        )}
      </p>

    </div>
  );
}
