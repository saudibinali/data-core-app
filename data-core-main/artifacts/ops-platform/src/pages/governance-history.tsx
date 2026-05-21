/**
 * @file   pages/governance-history.tsx
 * @phase  P7-E - Historical Analytics Dashboard & Trend Visualization Foundations
 *
 * Read-only historical analytics dashboard. Consumes the 4 P7-D trend endpoints
 * and visualises them with Recharts. Shared range selector drives all 4 charts
 * simultaneously.
 *
 * ── SAFETY INVARIANTS ─────────────────────────────────────────────────────────
 *   READ-ONLY: no mutations, no writes, no pruning, no rollup triggers.
 *   Visualization-only analytics surface.
 *
 * ── RANGE / QUERY CASCADE ─────────────────────────────────────────────────────
 *   The API transparently serves data from the appropriate storage tier:
 *     1h / 24h / 7d / 30d  → raw 5-min snapshots
 *     90d                  → hourly rollups
 *     180d / 365d          → daily rollups
 *   sourceLayer on each point identifies the tier used.
 *
 * ── TRUNCATION ────────────────────────────────────────────────────────────────
 *   Payloads cap at 1,000 points.  When truncated=true the TruncationBanner
 *   is rendered prominently above the charts.
 *
 * ── OBSERVABILITY ─────────────────────────────────────────────────────────────
 *   historical_dashboard_loaded        - on first successful data load
 *   historical_dashboard_range_changed - on every range button click
 *   historical_chart_rendered          - once per chart after first data load
 *   historical_truncation_warning_shown - when truncation banner appears
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  useGetGovernanceTrendsSeverity,
  useGetGovernanceTrendsErrorRate,
  useGetGovernanceTrendsBacklogs,
  useGetGovernanceTrendsStorms,
  usePostGovernanceEvents,
  type GovernanceEventBodyAction,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Zap,
  BarChart3,
  Info,
  Layers,
} from "lucide-react";
import {
  TREND_RANGES,
  type TrendRange,
  severityHex,
  severityToNumeric,
  sourceLayerLabel,
  formatTimestampForRange,
  formatTimestampFull,
  dominantHistoricalSeverity,
  summarizeErrorRate,
  peakBacklogPeriod,
  stormHeavyPeriods,
  countSeverityDistribution,
  isTrendDataTruncated,
  formatErrorRatePct,
  formatStormFrequency,
  STORM_HEAVY_THRESHOLD,
} from "@/lib/governance-trend-utils";
import {
  healthSeverityPalette,
  healthSeverityLabel,
} from "@/lib/governance-utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_RANGE: TrendRange = "30d";

const RANGE_LABELS: Record<TrendRange, string> = {
  "1h":   "1 hour",
  "24h":  "24 hours",
  "7d":   "7 days",
  "30d":  "30 days",
  "90d":  "90 days",
  "180d": "180 days",
  "365d": "1 year",
};

// ── Small helpers ──────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-48 flex items-center justify-center">
      <Skeleton className="w-full h-full rounded-md" />
    </div>
  );
}

function ChartError({ message }: { message: string }) {
  return (
    <div className="h-48 flex items-center justify-center gap-2 text-sm text-muted-foreground border rounded-md border-dashed">
      <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground border rounded-md border-dashed">
      <BarChart3 className="w-5 h-5 opacity-40" />
      <span>No {label} data for this range</span>
    </div>
  );
}

// ── Source layer badge ─────────────────────────────────────────────────────────

function SourceLayerBadge({ layer }: { layer: string }) {
  return (
    <Badge variant="outline" className="gap-1 text-xs font-normal">
      <Layers className="w-3 h-3 opacity-70" />
      {sourceLayerLabel(layer)}
    </Badge>
  );
}

// ── Range selector ─────────────────────────────────────────────────────────────

function RangeSelector({
  selected,
  onChange,
}: {
  selected: TrendRange;
  onChange: (r: TrendRange) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Select time range">
      {TREND_RANGES.map((r) => (
        <Button
          key={r}
          variant={r === selected ? "default" : "outline"}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onChange(r)}
        >
          {r}
        </Button>
      ))}
    </div>
  );
}

// ── Truncation banner ──────────────────────────────────────────────────────────

function TruncationBanner({
  range,
  onNarrow,
}: {
  range: TrendRange;
  onNarrow: () => void;
}) {
  return (
    <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900">
      <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      <AlertDescription className="text-yellow-800 dark:text-yellow-300">
        <strong>Data cap reached</strong> - showing only the first 1,000 data points
        of your {RANGE_LABELS[range]} window. Some points were omitted because
        the dataset exceeded the display limit.{" "}
        <button
          onClick={onNarrow}
          className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-200 transition-colors"
        >
          Narrow the time range to restore full resolution.
        </button>
      </AlertDescription>
    </Alert>
  );
}

// ── Severity timeline chart ────────────────────────────────────────────────────
//
// Each bar height = numeric severity (0-3), filled by its severity colour.
// A stepped visual makes level transitions immediately apparent.

interface SeverityChartPoint {
  t:        string;
  value:    number;
  severity: string;
  fullTs:   string;
}

function SeverityTimelineChart({
  data,
  range,
}: {
  data:  SeverityChartPoint[];
  range: TrendRange;
}) {
  const SEVERITY_TICKS = [
    { value: 0, label: "Healthy" },
    { value: 1, label: "Warning" },
    { value: 2, label: "Degraded" },
    { value: 3, label: "Critical" },
  ];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={data.length > 200 ? 2 : data.length > 60 ? 3 : 6} barGap={0}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval="preserveStartEnd"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          ticks={[0, 1, 2, 3]}
          tickFormatter={(v: number) => SEVERITY_TICKS[v]?.label?.slice(0, 4) ?? String(v)}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          width={50}
          domain={[0, 3]}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as SeverityChartPoint;
            return (
              <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md text-xs space-y-1">
                <p className="text-muted-foreground">{d.fullTs}</p>
                <p className="font-semibold" style={{ color: severityHex(d.severity) }}>
                  {healthSeverityLabel(d.severity)}
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`sev-${index}`} fill={severityHex(entry.severity)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Error rate area chart ──────────────────────────────────────────────────────

interface NumericChartPoint {
  t:      string;
  value:  number;
  fullTs: string;
}

function ErrorRateChart({ data }: { data: NumericChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="errGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval="preserveStartEnd"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          domain={[0, "auto"]}
          width={42}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as NumericChartPoint;
            return (
              <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md text-xs space-y-1">
                <p className="text-muted-foreground">{d.fullTs}</p>
                <p className="font-semibold text-red-600">{formatErrorRatePct(d.value)}</p>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#ef4444"
          strokeWidth={1.5}
          fill="url(#errGradient)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Backlog pressure chart ─────────────────────────────────────────────────────

interface BacklogChartPoint {
  t:        string;
  approval: number;
  delay:    number;
  stuck:    number;
  fullTs:   string;
}

function BacklogPressureChart({ data }: { data: BacklogChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="approvalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="delayGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="stuckGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval="preserveStartEnd"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          domain={[0, "auto"]}
          allowDecimals={false}
          width={36}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as BacklogChartPoint;
            return (
              <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md text-xs space-y-1 min-w-[150px]">
                <p className="text-muted-foreground">{d.fullTs}</p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  <span>Approval: <strong>{d.approval.toFixed(1)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
                  <span>Delay: <strong>{d.delay.toFixed(1)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                  <span>Stuck: <strong>{d.stuck.toFixed(1)}</strong></span>
                </div>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="approval" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#approvalGrad)" dot={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="delay"    stroke="#06b6d4" strokeWidth={1.5} fill="url(#delayGrad)"    dot={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="stuck"    stroke="#f97316" strokeWidth={1.5} fill="url(#stuckGrad)"    dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Storm activity chart ───────────────────────────────────────────────────────

interface StormChartPoint {
  t:             string;
  value:         number;
  severity:      string;
  fullTs:        string;
}

function StormActivityChart({ data }: { data: StormChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={data.length > 200 ? 2 : data.length > 60 ? 3 : 6} barGap={0}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval="preserveStartEnd"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          domain={[0, 1]}
          width={42}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as StormChartPoint;
            return (
              <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md text-xs space-y-1">
                <p className="text-muted-foreground">{d.fullTs}</p>
                <p className="font-semibold" style={{ color: severityHex(d.severity) }}>
                  Storm freq: {formatStormFrequency(d.value)}
                </p>
                {d.severity !== "none" && (
                  <p className="text-muted-foreground">
                    Dominant: {healthSeverityLabel(d.severity)}
                  </p>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => {
            const color = entry.value > STORM_HEAVY_THRESHOLD
              ? "#ef4444"
              : entry.value > 0.25
              ? "#f97316"
              : "#eab308";
            return <Cell key={`storm-${index}`} fill={color} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Operational insights panel ─────────────────────────────────────────────────

interface InsightRowProps {
  icon:   React.ElementType;
  label:  string;
  value:  string;
  sub?:   string;
  color?: string;
}

function InsightRow({ icon: Icon, label, value, sub, color }: InsightRowProps) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
      <div className="p-1.5 rounded-md bg-muted mt-0.5 shrink-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-semibold mt-0.5", color ?? "text-foreground")}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function GovernanceHistoryPage() {
  const [, navigate] = useLocation();
  const { isAdmin, isLoading: permLoading } = usePermissions();

  // Redirect non-admins
  useEffect(() => {
    if (!permLoading && !isAdmin) navigate("/home");
  }, [isAdmin, permLoading, navigate]);

  // ── Shared range state ─────────────────────────────────────────────────────
  const [range, setRange] = useState<TrendRange>(DEFAULT_RANGE);

  // ── Trend queries (all driven by the same range) ───────────────────────────
  const severityQ = useGetGovernanceTrendsSeverity(
    { range },
    { query: { queryKey: ["/api/governance/trends/severity", range] } },
  );
  const errorRateQ = useGetGovernanceTrendsErrorRate(
    { range },
    { query: { queryKey: ["/api/governance/trends/error-rate", range] } },
  );
  const backlogsQ = useGetGovernanceTrendsBacklogs(
    { range },
    { query: { queryKey: ["/api/governance/trends/backlogs", range] } },
  );
  const stormsQ = useGetGovernanceTrendsStorms(
    { range },
    { query: { queryKey: ["/api/governance/trends/storms", range] } },
  );

  // ── Observability ──────────────────────────────────────────────────────────
  const eventMutation = usePostGovernanceEvents();
  const loadedOnce    = useRef(false);
  const chartsRendered = useRef(new Set<string>());

  const emitEvent = useCallback(
    (action: GovernanceEventBodyAction, severity = "healthy") => {
      eventMutation.mutate({
        data: {
          action,
          visibleAlertCount: 0,
          visibleStuckCount: 0,
          dashboardSeverity: severity,
        },
      });
    },
    [eventMutation],
  );

  // Emit "loaded" once all 4 queries succeed
  useEffect(() => {
    if (
      !loadedOnce.current &&
      severityQ.isSuccess &&
      errorRateQ.isSuccess &&
      backlogsQ.isSuccess &&
      stormsQ.isSuccess
    ) {
      loadedOnce.current = true;
      const dominant = dominantHistoricalSeverity(severityQ.data?.points ?? []);
      emitEvent("historical_dashboard_loaded" as GovernanceEventBodyAction, dominant);
    }
  }, [severityQ.isSuccess, errorRateQ.isSuccess, backlogsQ.isSuccess, stormsQ.isSuccess, severityQ.data, emitEvent]);

  // ── Range change handler ────────────────────────────────────────────────────
  function handleRangeChange(newRange: TrendRange) {
    setRange(newRange);
    chartsRendered.current.clear();
    emitEvent("historical_dashboard_range_changed" as GovernanceEventBodyAction);
  }

  // ── Chart rendered events (once per chart per range) ───────────────────────
  useEffect(() => {
    if (severityQ.isSuccess && !chartsRendered.current.has("severity")) {
      chartsRendered.current.add("severity");
      emitEvent("historical_chart_rendered" as GovernanceEventBodyAction);
    }
  }, [severityQ.isSuccess, emitEvent]);

  useEffect(() => {
    if (errorRateQ.isSuccess && !chartsRendered.current.has("error-rate")) {
      chartsRendered.current.add("error-rate");
      emitEvent("historical_chart_rendered" as GovernanceEventBodyAction);
    }
  }, [errorRateQ.isSuccess, emitEvent]);

  useEffect(() => {
    if (backlogsQ.isSuccess && !chartsRendered.current.has("backlogs")) {
      chartsRendered.current.add("backlogs");
      emitEvent("historical_chart_rendered" as GovernanceEventBodyAction);
    }
  }, [backlogsQ.isSuccess, emitEvent]);

  useEffect(() => {
    if (stormsQ.isSuccess && !chartsRendered.current.has("storms")) {
      chartsRendered.current.add("storms");
      emitEvent("historical_chart_rendered" as GovernanceEventBodyAction);
    }
  }, [stormsQ.isSuccess, emitEvent]);

  // ── Truncation detection + event ───────────────────────────────────────────
  const truncationWarnedRef = useRef(false);
  const anyTruncated = isTrendDataTruncated(
    severityQ.data,
    errorRateQ.data,
    backlogsQ.data,
    stormsQ.data,
  );

  useEffect(() => {
    if (anyTruncated && !truncationWarnedRef.current) {
      truncationWarnedRef.current = true;
      emitEvent("historical_truncation_warning_shown" as GovernanceEventBodyAction);
    }
    if (!anyTruncated) {
      truncationWarnedRef.current = false;
    }
  }, [anyTruncated, emitEvent]);

  // ── Transform data for charts ──────────────────────────────────────────────

  const severityPoints: SeverityChartPoint[] = (severityQ.data?.points ?? []).map((p) => ({
    t:        formatTimestampForRange(p.timestamp, range),
    value:    severityToNumeric(p.severity),
    severity: p.severity,
    fullTs:   formatTimestampFull(p.timestamp),
  }));

  const errorRatePoints: NumericChartPoint[] = (errorRateQ.data?.points ?? []).map((p) => ({
    t:      formatTimestampForRange(p.timestamp, range),
    value:  p.value,
    fullTs: formatTimestampFull(p.timestamp),
  }));

  const backlogPoints: BacklogChartPoint[] = (backlogsQ.data?.points ?? []).map((p) => ({
    t:        formatTimestampForRange(p.timestamp, range),
    approval: p.approvalBacklog,
    delay:    p.delayBacklog,
    stuck:    p.stuckCount,
    fullTs:   formatTimestampFull(p.timestamp),
  }));

  const stormPoints: StormChartPoint[] = (stormsQ.data?.points ?? []).map((p) => ({
    t:        formatTimestampForRange(p.timestamp, range),
    value:    p.stormFrequency,
    severity: p.dominantSeverity,
    fullTs:   formatTimestampFull(p.timestamp),
  }));

  // ── Derived insights ───────────────────────────────────────────────────────

  const dominantSeverity  = dominantHistoricalSeverity(severityQ.data?.points ?? []);
  const dominantPalette   = healthSeverityPalette(dominantSeverity);
  const errorSummary      = summarizeErrorRate(errorRateQ.data?.points ?? []);
  const peakBacklog       = peakBacklogPeriod(backlogsQ.data?.points ?? []);
  const heavyStorms       = stormHeavyPeriods(stormsQ.data?.points ?? []);
  const severityDist      = countSeverityDistribution(severityQ.data?.points ?? []);
  const activeSourceLayer = severityQ.data?.sourceLayer ?? errorRateQ.data?.sourceLayer ?? "";

  const isAnyLoading =
    severityQ.isLoading || errorRateQ.isLoading || backlogsQ.isLoading || stormsQ.isLoading;

  const DirectionIcon =
    errorSummary.direction === "rising"  ? TrendingUp :
    errorSummary.direction === "falling" ? TrendingDown : Minus;

  const directionColor =
    errorSummary.direction === "rising"  ? "text-red-600 dark:text-red-400" :
    errorSummary.direction === "falling" ? "text-green-600 dark:text-green-400" :
    "text-muted-foreground";

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (permLoading || (!isAdmin && !permLoading)) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground -ml-2"
              onClick={() => navigate("/governance")}
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Governance Console
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Historical Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Trend visibility across severity, error rate, backlog pressure, and storm activity -{" "}
            <span className="font-medium">read-only</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeSourceLayer && <SourceLayerBadge layer={activeSourceLayer} />}
          <RangeSelector selected={range} onChange={handleRangeChange} />
        </div>
      </div>

      {/* ── Truncation warning ─────────────────────────────────────────────── */}
      {anyTruncated && (
        <TruncationBanner
          range={range}
          onNarrow={() => {
            const idx = TREND_RANGES.indexOf(range);
            if (idx > 0) handleRangeChange(TREND_RANGES[idx - 1]!);
          }}
        />
      )}

      {/* ── Chart grid (2 × 2) ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Severity timeline */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold">Severity Timeline</CardTitle>
                <CardDescription className="text-xs">Health level per snapshot</CardDescription>
              </div>
              <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </CardHeader>
          <CardContent>
            {severityQ.isLoading ? (
              <ChartSkeleton />
            ) : severityQ.isError ? (
              <ChartError message="Could not load severity trend data" />
            ) : severityPoints.length === 0 ? (
              <EmptyChart label="severity" />
            ) : (
              <SeverityTimelineChart data={severityPoints} range={range} />
            )}
            <div className="flex flex-wrap gap-3 mt-3">
              {(["healthy", "warning", "degraded", "critical"] as const).map((s) => (
                <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: severityHex(s) }}
                  />
                  {healthSeverityLabel(s)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Error rate */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold">Error Rate Trend</CardTitle>
                <CardDescription className="text-xs">Workflow failure rate [0 - 100%]</CardDescription>
              </div>
              <BarChart3 className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </CardHeader>
          <CardContent>
            {errorRateQ.isLoading ? (
              <ChartSkeleton />
            ) : errorRateQ.isError ? (
              <ChartError message="Could not load error rate data" />
            ) : errorRatePoints.length === 0 ? (
              <EmptyChart label="error rate" />
            ) : (
              <ErrorRateChart data={errorRatePoints} />
            )}
            {errorRateQ.isSuccess && errorRatePoints.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Avg: <strong>{formatErrorRatePct(errorSummary.average)}</strong>
                <span className={cn("ml-2 inline-flex items-center gap-0.5", directionColor)}>
                  <DirectionIcon className="w-3 h-3" />
                  {errorSummary.direction}
                </span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Backlog pressure */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold">Backlog Pressure</CardTitle>
                <CardDescription className="text-xs">Approval · delay · stuck queue depths</CardDescription>
              </div>
              <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </CardHeader>
          <CardContent>
            {backlogsQ.isLoading ? (
              <ChartSkeleton />
            ) : backlogsQ.isError ? (
              <ChartError message="Could not load backlog data" />
            ) : backlogPoints.length === 0 ? (
              <EmptyChart label="backlog" />
            ) : (
              <BacklogPressureChart data={backlogPoints} />
            )}
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { label: "Approval", color: "#8b5cf6" },
                { label: "Delay",    color: "#06b6d4" },
                { label: "Stuck",    color: "#f97316" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Storm activity */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold">Storm Activity</CardTitle>
                <CardDescription className="text-xs">Storm frequency per snapshot [0 - 100%]</CardDescription>
              </div>
              <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </CardHeader>
          <CardContent>
            {stormsQ.isLoading ? (
              <ChartSkeleton />
            ) : stormsQ.isError ? (
              <ChartError message="Could not load storm data" />
            ) : stormPoints.length === 0 ? (
              <EmptyChart label="storm" />
            ) : (
              <StormActivityChart data={stormPoints} />
            )}
            {stormsQ.isSuccess && stormPoints.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {heavyStorms.length > 0
                  ? `${heavyStorms.length} heavy storm period${heavyStorms.length !== 1 ? "s" : ""} (>${(STORM_HEAVY_THRESHOLD * 100).toFixed(0)}% frequency)`
                  : "No heavy storm periods in this range"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Operational insights panel ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">Operational Insights</CardTitle>
              <CardDescription className="text-xs">
                Derived from the {RANGE_LABELS[range]} window · {activeSourceLayer ? sourceLayerLabel(activeSourceLayer) : "loading..."}
              </CardDescription>
            </div>
            <Info className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </CardHeader>
        <CardContent>
          {isAnyLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <InsightRow
                icon={Activity}
                label="Dominant severity in period"
                value={healthSeverityLabel(dominantSeverity)}
                sub={
                  severityQ.data?.points.length
                    ? `${severityDist.critical} critical · ${severityDist.degraded} degraded · ${severityDist.warning} warning · ${severityDist.healthy} healthy snapshots`
                    : "No snapshot data available"
                }
                color={dominantPalette.text}
              />

              <InsightRow
                icon={BarChart3}
                label="Average error rate trend"
                value={
                  errorRateQ.data?.points.length
                    ? `${formatErrorRatePct(errorSummary.average)} · ${errorSummary.direction}`
                    : "No data"
                }
                sub={
                  errorSummary.direction === "rising"
                    ? "Error rate increased over the period - investigate recent deployments"
                    : errorSummary.direction === "falling"
                    ? "Error rate is recovering - conditions are improving"
                    : "Error rate is stable"
                }
                color={
                  errorSummary.direction === "rising"
                    ? "text-red-600 dark:text-red-400"
                    : errorSummary.direction === "falling"
                    ? "text-green-600 dark:text-green-400"
                    : undefined
                }
              />

              <InsightRow
                icon={Zap}
                label="Peak backlog period"
                value={
                  peakBacklog && peakBacklog.totalBacklog > 0
                    ? `${peakBacklog.totalBacklog.toFixed(0)} total items`
                    : "No backlog pressure detected"
                }
                sub={
                  peakBacklog && peakBacklog.totalBacklog > 0
                    ? formatTimestampFull(peakBacklog.timestamp)
                    : undefined
                }
                color={peakBacklog && peakBacklog.totalBacklog > 5 ? "text-orange-600 dark:text-orange-400" : undefined}
              />

              <InsightRow
                icon={Zap}
                label="Heavy storm periods"
                value={
                  stormsQ.data?.points.length
                    ? heavyStorms.length > 0
                      ? `${heavyStorms.length} period${heavyStorms.length !== 1 ? "s" : ""} above ${(STORM_HEAVY_THRESHOLD * 100).toFixed(0)}% frequency`
                      : "No heavy storm activity"
                    : "No data"
                }
                sub={
                  heavyStorms.length > 0
                    ? `Peak: ${formatStormFrequency(Math.max(...heavyStorms.map((s) => s.stormFrequency)))} storm frequency`
                    : undefined
                }
                color={heavyStorms.length > 0 ? "text-red-600 dark:text-red-400" : undefined}
              />
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
