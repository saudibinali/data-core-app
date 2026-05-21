/**
 * @file   components/governance/governance-readiness-dimension-grid.tsx
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * Read-only readiness dimension grid.
 * "blocked" and "partial" dimensions are visually prominent.
 * Stable ordering by READINESS_DIMENSION_ORDER.
 *
 * SAFETY CONTRACT: read-only - no readiness override, no auto-remediation.
 */

import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  READINESS_DIMENSION_MAP,
  READINESS_DIMENSION_ORDER,
  READINESS_STATUS_MAP,
  type ReadinessDimensionKey,
  type ReadinessStatusKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReadinessDimensionEntry {
  dimensionKey?:   string;
  dimension?:      string;
  status?:         string;
  score?:          number;
  blockers?:       string[];
  warnings?:       string[];
  notes?:          string;
}

interface GovernanceReadinessDimensionGridProps {
  dimensions:      ReadinessDimensionEntry[];
  isLoading?:      boolean;
  "data-testid"?:  string;
}

// ── Status helpers ─────────────────────────────────────────────────────────

function StatusIcon({ status }: { status?: string }) {
  if (status === "ready")   return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "partial") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  if (status === "blocked") return <XCircle       className="w-4 h-4 text-red-500 shrink-0"   />;
  return                           <HelpCircle    className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function StatusBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as ReadinessStatusKey;
  const info = key in READINESS_STATUS_MAP ? READINESS_STATUS_MAP[key] : null;
  if (!info) return <Badge variant="outline" className="text-xs">{status ?? "unknown"}</Badge>;
  return (
    <Badge className={`text-xs ${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score?: number }) {
  if (score === undefined || score === null) return null;
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const colourClass = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colourClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Dimension card ─────────────────────────────────────────────────────────

function DimensionCard({
  dimDef, liveEntry,
}: {
  dimDef:    typeof READINESS_DIMENSION_MAP[ReadinessDimensionKey];
  liveEntry?: ReadinessDimensionEntry;
}) {
  const status    = liveEntry?.status;
  const isBlocked = status === "blocked";
  const isPartial = status === "partial";
  const borderClass = isBlocked ? "border-red-400 border-2 bg-red-50 dark:bg-red-950/20"
    : isPartial ? "border-amber-400 border-2 bg-amber-50 dark:bg-amber-950/10"
    : "border-border";

  return (
    <div className={`rounded-md border p-3 ${borderClass}`}
      data-testid={`readiness-dim-${dimDef.order}`}>

      <div className="flex items-center gap-2 mb-1">
        <StatusIcon status={status} />
        <span className="text-sm font-medium flex-1 truncate">{dimDef.label}</span>
        <StatusBadge status={status} />
      </div>

      {liveEntry?.score !== undefined && <ScoreBar score={liveEntry.score} />}

      <p className="text-xs text-muted-foreground mt-1.5">{dimDef.description}</p>

      {liveEntry?.blockers && liveEntry.blockers.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {liveEntry.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <XCircle className="w-3 h-3 shrink-0" /> {b}
            </p>
          ))}
        </div>
      )}

      {liveEntry?.warnings && liveEntry.warnings.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {liveEntry.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      {liveEntry?.notes && (
        <p className="text-xs text-muted-foreground mt-1 italic">{liveEntry.notes}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceReadinessDimensionGrid({
  dimensions,
  isLoading = false,
  "data-testid": testId = "readiness-dimension-grid",
}: GovernanceReadinessDimensionGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid={`${testId}-loading`}>
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (dimensions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <HelpCircle className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-sm">No readiness dimension data available.</p>
      </div>
    );
  }

  // Build lookup from dimensionKey/dimension string
  const lookup = new Map<string, ReadinessDimensionEntry>();
  for (const d of dimensions) {
    if (d.dimensionKey) lookup.set(d.dimensionKey, d);
    if (d.dimension)    lookup.set(d.dimension, d);
  }

  return (
    <div data-testid={testId}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {READINESS_DIMENSION_ORDER.map(key => {
          const def  = READINESS_DIMENSION_MAP[key];
          const live = lookup.get(key) ?? dimensions.find(d =>
            d.dimensionKey === key || d.dimension === def.label
          );
          return <DimensionCard key={key} dimDef={def} liveEntry={live} />;
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2 px-1">
        Blocked and partial dimensions are highlighted · Read-only
      </p>
    </div>
  );
}
