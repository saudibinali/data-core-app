/**
 * @file   components/governance/governance-policy-effectiveness-table.tsx
 * @phase  P12-E - Governance Analytics UI & Compliance Intelligence Visualization Foundations
 *
 * Read-only per-policy effectiveness table.
 * Sorted by unresolvedFrequency desc, then escalationFrequency desc.
 * Highlights high false-positive and high confirmed-violation rates.
 *
 * SAFETY CONTRACT: read-only display - no edit, no policy tuning, no AI.
 */

import { BookOpen, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  POLICY_EFFECTIVENESS_COLUMNS,
  WORKFLOW_EFFECTIVENESS_SCORE_MAP,
  type WorkflowEffectivenessScoreKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PolicyEffectivenessProfile {
  policyId?:                  string;
  policyName?:                string;
  totalViolations?:           number;
  confirmedViolationRate?:    number;
  falsePositiveRate?:         number;
  escalationFrequency?:       number;
  averageResolutionDuration?: number;
  unresolvedFrequency?:       number;
  policyStabilityScore?:      string;
}

interface GovernancePolicyEffectivenessTableProps {
  profiles:        PolicyEffectivenessProfile[];
  isLoading?:      boolean;
  "data-testid"?:  string;
}

// ── Formatters ────────────────────────────────────────────────────────────

function pct(v?: number): string {
  if (v === undefined || v === null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function dur(v?: number): string {
  if (v === undefined || v === null) return "-";
  if (v < 1000)    return `${v}ms`;
  if (v < 60_000)  return `${(v / 1000).toFixed(1)}s`;
  if (v < 3_600_000) return `${(v / 60_000).toFixed(1)}m`;
  return `${(v / 3_600_000).toFixed(1)}h`;
}

// ── Stability score badge ──────────────────────────────────────────────────

function StabilityBadge({ score }: { score?: string }) {
  const key  = (score ?? "") as WorkflowEffectivenessScoreKey;
  const info = key in WORKFLOW_EFFECTIVENESS_SCORE_MAP ? WORKFLOW_EFFECTIVENESS_SCORE_MAP[key] : null;

  if (!info) return score ? <span className="text-xs text-muted-foreground">{score.replace(/_/g, " ")}</span> : <span className="text-xs text-muted-foreground">-</span>;

  const colours: Record<string, string> = {
    critical:  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
    attention: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
    neutral:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0",
    good:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
    excellent: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-0",
  };

  return (
    <Badge className={`text-xs ${colours[info.tier] ?? ""}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Rate cell - highlight when above attention threshold ───────────────────

function RateCell({ value, attentionThreshold = 0.5 }: { value?: number; attentionThreshold?: number }) {
  const isHigh = typeof value === "number" && value >= attentionThreshold;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${isHigh ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`}>
      {isHigh && <AlertTriangle className="w-3 h-3 shrink-0" />}
      {pct(value)}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernancePolicyEffectivenessTable({
  profiles,
  isLoading = false,
  "data-testid": testId = "policy-effectiveness-table",
}: GovernancePolicyEffectivenessTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid={`${testId}-loading`}>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <BookOpen className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-sm">No policy effectiveness profiles available.</p>
        <p className="text-xs mt-1">Profiles appear once governance workflows have been processed.</p>
      </div>
    );
  }

  // Sort: unresolvedFrequency desc, then escalationFrequency desc
  const sorted = [...profiles].sort((a, b) => {
    const diffU = (b.unresolvedFrequency ?? 0) - (a.unresolvedFrequency ?? 0);
    if (diffU !== 0) return diffU;
    return (b.escalationFrequency ?? 0) - (a.escalationFrequency ?? 0);
  });

  return (
    <div data-testid={testId}>
      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b mb-1 overflow-x-auto">
        {POLICY_EFFECTIVENESS_COLUMNS.map(col => (
          <span key={col.key} className={`shrink-0 ${col.width}`}>{col.label}</span>
        ))}
      </div>

      {/* Rows */}
      <div>
        {sorted.map((p, i) => (
          <div
            key={p.policyId ?? `policy-${i}`}
            className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border last:border-0 hover:bg-muted/40 transition-colors overflow-x-auto"
            data-testid={`policy-eff-row-${i}`}
          >
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[0].width} shrink-0 font-mono text-muted-foreground truncate`}>
              {p.policyId ?? "-"}
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[1].width} shrink-0 text-foreground truncate`}>
              {p.policyName ?? "-"}
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[2].width} shrink-0 text-right tabular-nums`}>
              {p.totalViolations ?? 0}
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[3].width} shrink-0`}>
              <RateCell value={p.confirmedViolationRate} attentionThreshold={0.7} />
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[4].width} shrink-0`}>
              <RateCell value={p.falsePositiveRate} attentionThreshold={0.4} />
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[5].width} shrink-0`}>
              <RateCell value={p.escalationFrequency} attentionThreshold={0.5} />
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[6].width} shrink-0 text-muted-foreground`}>
              {dur(p.averageResolutionDuration)}
            </span>
            <span className={`${POLICY_EFFECTIVENESS_COLUMNS[7].width} shrink-0`}>
              <StabilityBadge score={p.policyStabilityScore} />
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <p className="text-xs text-muted-foreground mt-2 px-1">
        <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-500" />
        Amber highlight indicates rates above attention threshold - review recommended.
        Sorted by unresolved frequency (highest first).
      </p>
    </div>
  );
}
