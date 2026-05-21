/**
 * @file   components/governance/governance-topology-dependency-map.tsx
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * CSS-only layer dependency map. Shows each governance layer as a card in
 * canonical order with boundary status badge and optional readiness status.
 * No graph library dependency.
 *
 * SAFETY CONTRACT: read-only display - no mutation, no diff execution, no export.
 */

import { ArrowDown, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TOPOLOGY_LAYER_MAP,
  TOPOLOGY_LAYER_ORDER,
  BOUNDARY_STATUS_MAP,
  READINESS_STATUS_MAP,
  type TopologyLayerKey,
  type BoundaryStatusKey,
  type ReadinessStatusKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TopologyLayerEntry {
  layerKey?:        string;
  layerId?:         string;
  name?:            string;
  boundaryStatus?:  string;
  readinessStatus?: string;
  description?:     string;
  boundaryProperties?: string[];
  warnings?:        string[];
}

interface GovernanceTopologyDependencyMapProps {
  layers:          TopologyLayerEntry[];
  isLoading?:      boolean;
  compact?:        boolean;
  "data-testid"?:  string;
}

// ── Badge helpers ──────────────────────────────────────────────────────────

function BoundaryBadge({ status }: { status?: string }) {
  const key = (status ?? "") as BoundaryStatusKey;
  const info = key in BOUNDARY_STATUS_MAP ? BOUNDARY_STATUS_MAP[key] : null;
  if (!info) return status ? (
    <Badge variant="outline" className="text-xs py-0">{status.replace(/_/g, " ")}</Badge>
  ) : null;
  return (
    <Badge className={`text-xs py-0 ${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

function ReadinessBadge({ status }: { status?: string }) {
  const key = (status ?? "") as ReadinessStatusKey;
  const info = key in READINESS_STATUS_MAP ? READINESS_STATUS_MAP[key] : null;
  if (!info) return null;
  return (
    <Badge className={`text-xs py-0 ${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Layer row ─────────────────────────────────────────────────────────────

function LayerRow({
  layerDef, liveEntry, isLast, compact,
}: {
  layerDef:   typeof TOPOLOGY_LAYER_MAP[TopologyLayerKey];
  liveEntry?: TopologyLayerEntry;
  isLast:     boolean;
  compact:    boolean;
}) {
  const boundaryStatus = liveEntry?.boundaryStatus ?? layerDef.expectedBoundary;
  const isLeak         = boundaryStatus === "leak_detected" || boundaryStatus === "boundary_leak_detected";
  const isWarning      = boundaryStatus === "warning";
  const borderClass    = isLeak ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : isWarning ? "border-amber-400 bg-amber-50 dark:bg-amber-950/10"
    : "border-border bg-card";

  return (
    <div className="flex flex-col items-stretch">
      <div className={`rounded-md border ${borderClass} px-3 py-2.5`}
        data-testid={`topology-layer-${layerDef.order}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
            {layerDef.order}
          </span>
          <span className="text-sm font-medium flex-1 min-w-0 truncate">{layerDef.label}</span>
          <BoundaryBadge   status={liveEntry?.boundaryStatus ?? layerDef.expectedBoundary} />
          {liveEntry?.readinessStatus && (
            <ReadinessBadge status={liveEntry.readinessStatus} />
          )}
        </div>
        {!compact && (
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            {liveEntry?.description ?? layerDef.description}
          </p>
        )}
        {!compact && liveEntry?.warnings && liveEntry.warnings.length > 0 && (
          <div className="ml-6 mt-1 space-y-0.5">
            {liveEntry.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>

      {!isLast && (
        <div className="flex justify-center py-1">
          <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceTopologyDependencyMap({
  layers,
  isLoading = false,
  compact   = false,
  "data-testid": testId = "topology-dependency-map",
}: GovernanceTopologyDependencyMapProps) {
  if (isLoading) {
    return (
      <div className="space-y-1" data-testid={`${testId}-loading`}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-10 w-full rounded-md" />
            {i < 6 && <div className="h-4" />}
          </div>
        ))}
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <Layers className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-sm">No topology layer data available.</p>
      </div>
    );
  }

  // Build a lookup from layerId/layerKey to live entry
  const lookup = new Map<string, TopologyLayerEntry>();
  for (const entry of layers) {
    if (entry.layerKey)  lookup.set(entry.layerKey, entry);
    if (entry.layerId)   lookup.set(entry.layerId, entry);
    if (entry.name)      lookup.set(entry.name.toLowerCase().replace(/\s+/g, "_"), entry);
  }

  return (
    <div data-testid={testId} className="space-y-0">
      {TOPOLOGY_LAYER_ORDER.map((key, idx) => {
        const def   = TOPOLOGY_LAYER_MAP[key];
        const live  = lookup.get(key) ?? lookup.get(def.label) ?? layers[idx];
        return (
          <LayerRow
            key={key}
            layerDef={def}
            liveEntry={live}
            isLast={idx === TOPOLOGY_LAYER_ORDER.length - 1}
            compact={compact}
          />
        );
      })}
      {!compact && (
        <p className="text-xs text-muted-foreground pt-1 px-1">
          Layers shown in dependency order (0 = foundation, 6 = presentation) · Read-only
        </p>
      )}
    </div>
  );
}
