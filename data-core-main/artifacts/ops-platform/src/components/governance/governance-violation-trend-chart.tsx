/**
 * @file   components/governance/governance-violation-trend-chart.tsx
 * @phase  P12-E - Governance Analytics UI & Compliance Intelligence Visualization Foundations
 *
 * Read-only violation trend chart using Recharts (already installed).
 * Shows total violations per date bucket, with optional severity breakdown.
 *
 * SAFETY CONTRACT: read-only display - no mutation, no export, no AI.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { TREND_SEVERITY_COLOURS } from "@/lib/governance-console-config";

export interface ViolationTrendPoint {
  date:          string;
  total?:        number;
  critical?:     number;
  high?:         number;
  medium?:       number;
  low?:          number;
  informational?: number;
}

interface GovernanceViolationTrendChartProps {
  data:            ViolationTrendPoint[];
  showBreakdown?:  boolean;
  "data-testid"?:  string;
}

function fmtDate(d: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(d));
  } catch { return d; }
}

export function GovernanceViolationTrendChart({
  data,
  showBreakdown = false,
  "data-testid": testId = "violation-trend-chart",
}: GovernanceViolationTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <TrendingUp className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-xs">No trend data available for the selected period.</p>
      </div>
    );
  }

  const formatted = data.map(d => ({ ...d, date: fmtDate(d.date) }));

  return (
    <div data-testid={testId} className="w-full h-52">
      <ResponsiveContainer width="100%" height="100%">
        {showBreakdown ? (
          <AreaChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {(["critical", "high", "medium", "low", "informational"] as const).map(sev => (
              <Area
                key={sev}
                type="monotone"
                dataKey={sev}
                stackId="1"
                stroke={TREND_SEVERITY_COLOURS[sev]}
                fill={TREND_SEVERITY_COLOURS[sev]}
                fillOpacity={0.6}
                name={sev.charAt(0).toUpperCase() + sev.slice(1)}
              />
            ))}
          </AreaChart>
        ) : (
          <AreaChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="total"
              stroke={TREND_SEVERITY_COLOURS.total}
              fill={TREND_SEVERITY_COLOURS.total}
              fillOpacity={0.3}
              name="Total violations"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
