/**
 * @file   components/governance/governance-boundary-summary-table.tsx
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * Read-only boundary summary table.
 * Sorted by layer order (TOPOLOGY_LAYER_ORDER).
 * Critical (leak_detected) entries always appear first.
 *
 * SAFETY CONTRACT: read-only - no auto-fix, no boundary mutation.
 */

import { AlertTriangle, CheckCircle2, ShieldAlert, HelpCircle } from "lucide-react";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TOPOLOGY_LAYER_MAP,
  TOPOLOGY_LAYER_ORDER,
  BOUNDARY_STATUS_MAP,
  type TopologyLayerKey,
  type BoundaryStatusKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BoundarySummaryEntry {
  layerKey?:          string;
  layerId?:           string;
  name?:              string;
  boundaryStatus?:    string;
  expectedBoundary?:  string;
  observedBoundary?:  string;
  warnings?:          string[];
  evidenceReferences?: string[];
}

interface GovernanceBoundarySummaryTableProps {
  entries:         BoundarySummaryEntry[];
  isLoading?:      boolean;
  "data-testid"?:  string;
}

// ── Status icon ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status?: string }) {
  if (status === "leak_detected" || status === "boundary_leak_detected")
    return <ShieldAlert className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  if (status === "warning")
    return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  if (status === "isolated" || status === "read_only" || status === "human_governed")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function BoundaryBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as BoundaryStatusKey;
  const info = key in BOUNDARY_STATUS_MAP ? BOUNDARY_STATUS_MAP[key] : null;
  if (!info) return status ? (
    <Badge variant="outline" className="text-xs py-0">{status.replace(/_/g, " ")}</Badge>
  ) : <span className="text-xs text-muted-foreground">-</span>;
  return (
    <Badge className={`text-xs py-0 ${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Priority sort ──────────────────────────────────────────────────────────
// Critical (leak_detected) entries first, then by layer order index.

function sortEntries(entries: BoundarySummaryEntry[]): BoundarySummaryEntry[] {
  const priority = (e: BoundarySummaryEntry) => {
    const s = e.boundaryStatus ?? "";
    if (s === "leak_detected" || s === "boundary_leak_detected") return -100;
    if (s === "warning")                                          return -50;
    // Layer order
    const key = (e.layerKey ?? e.layerId ?? "") as keyof typeof TOPOLOGY_LAYER_MAP;
    const idx = TOPOLOGY_LAYER_ORDER.indexOf(key as any);
    return idx >= 0 ? idx : 99;
  };
  return [...entries].sort((a, b) => priority(a) - priority(b));
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceBoundarySummaryTable({
  entries,
  isLoading = false,
  "data-testid": testId = "boundary-summary-table",
}: GovernanceBoundarySummaryTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid={`${testId}-loading`}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <p className="text-sm">No boundary data available.</p>
      </div>
    );
  }

  const sorted = sortEntries(entries);

  return (
    <div data-testid={testId}>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b">
        <span>Layer</span>
        <span>Status</span>
        <span>Expected</span>
        <span>Observed</span>
      </div>

      {sorted.map((entry, i) => {
        const layerKey  = (entry.layerKey ?? entry.layerId ?? "") as TopologyLayerKey;
        const layerDef  = layerKey in TOPOLOGY_LAYER_MAP ? TOPOLOGY_LAYER_MAP[layerKey] : null;
        const isLeak    = entry.boundaryStatus === "leak_detected" || entry.boundaryStatus === "boundary_leak_detected";
        const isWarning = entry.boundaryStatus === "warning";
        const rowClass  = isLeak ? "bg-red-50 dark:bg-red-950/20 border-l-2 border-l-red-400"
          : isWarning ? "bg-amber-50 dark:bg-amber-950/10 border-l-2 border-l-amber-400"
          : "";

        return (
          <div key={i} className={`grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-3 py-2.5 text-xs border-b border-border last:border-0 items-start ${rowClass}`}
            data-testid={`boundary-row-${i}`}>

            {/* Layer name */}
            <div className="flex items-center gap-1.5">
              <StatusIcon status={entry.boundaryStatus} />
              <span className="font-medium truncate">
                {layerDef?.label ?? entry.name ?? layerKey}
              </span>
            </div>

            {/* Status */}
            <div>
              <BoundaryBadge status={entry.boundaryStatus} />
            </div>

            {/* Expected */}
            <span className="text-muted-foreground">
              {entry.expectedBoundary ?? layerDef?.expectedBoundary ?? "-"}
            </span>

            {/* Observed */}
            <div>
              <span className="text-muted-foreground">{entry.observedBoundary ?? "-"}</span>
              {entry.warnings && entry.warnings.length > 0 && (
                <div className="mt-0.5 space-y-0.5">
                  {entry.warnings.map((w, wi) => (
                    <p key={wi} className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              )}
              {entry.evidenceReferences && entry.evidenceReferences.length > 0 && (
                <div className="mt-0.5">
                  <span className="text-muted-foreground">
                    {entry.evidenceReferences.length} ref{entry.evidenceReferences.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground mt-2 px-1">
        Critical boundary entries (leak detected) shown first · Read-only
      </p>
    </div>
  );
}
