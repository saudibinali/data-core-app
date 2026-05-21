/**
 * @file   components/governance/governance-escalation-distribution-chart.tsx
 * @phase  P12-E - Governance Analytics UI & Compliance Intelligence Visualization Foundations
 *
 * Read-only escalation distribution bar chart using Recharts.
 * Shows count + percentage per escalation level.
 *
 * SAFETY CONTRACT: read-only display - no mutation, no export, no AI.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { ESCALATION_LEVEL_MAP, type EscalationLevelKey } from "@/lib/governance-console-config";

export interface EscalationDistributionPoint {
  level:   string;
  count:   number;
  percent?: number;
}

interface GovernanceEscalationDistributionChartProps {
  data:            EscalationDistributionPoint[];
  "data-testid"?:  string;
}

const LEVEL_COLOURS: Record<string, string> = {
  L1_automated:  "#3b82f6",
  L2_operator:   "#f59e0b",
  L3_management: "#f97316",
  L4_executive:  "#ef4444",
  informational: "#3b82f6",
  standard:      "#f59e0b",
  elevated:      "#f97316",
  critical:      "#ef4444",
};

function levelLabel(k: string): string {
  const key = k as EscalationLevelKey;
  return key in ESCALATION_LEVEL_MAP ? ESCALATION_LEVEL_MAP[key].label : k;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: EscalationDistributionPoint = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded p-2 text-xs shadow">
      <p className="font-medium">{levelLabel(d.level)}</p>
      <p>Count: {d.count}</p>
      {d.percent !== undefined && <p>Share: {(d.percent * 100).toFixed(1)}%</p>}
    </div>
  );
}

export function GovernanceEscalationDistributionChart({
  data,
  "data-testid": testId = "escalation-distribution-chart",
}: GovernanceEscalationDistributionChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <BarChart3 className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-xs">No escalation data available.</p>
      </div>
    );
  }

  const formatted = data.map(d => ({ ...d, label: levelLabel(d.level) }));

  return (
    <div data-testid={testId} className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {formatted.map((d, i) => (
              <Cell key={i} fill={LEVEL_COLOURS[d.level] ?? "#6366f1"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
