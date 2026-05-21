/**
 * @file   pages/super-admin-governance-topology.tsx
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * Full governance topology review page - read-only, super_admin only.
 * Sections:
 *   1. Header + time + GovernanceReadOnlyNotice
 *   2. Topology overview banner (layer counts by boundary tier)
 *   3. Critical boundary warnings panel (only when leaks/warnings exist)
 *   4. GovernanceTopologyDependencyMap (CSS-only layer spine)
 *   5. GovernanceBoundarySummaryTable (per-layer boundary detail)
 *   6. Topology snapshot payload viewer
 *   7. Topology diff placeholder
 *   8. Topology metadata panel
 *   9. Link to readiness page
 *
 * SAFETY CONTRACT: read-only - no topology mutation, no boundary auto-fix,
 *   no snapshot persistence, no diff execution, no export, no AI.
 */

import { useMemo } from "react";
import {
  Network, Layers, ShieldAlert, AlertTriangle,
  CheckCircle2, Camera, GitCompare, ArrowRight, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link }     from "wouter";
import {
  useGovernanceTopology,
  useGovernanceTopologyBoundaries,
  useGovernanceTopologySnapshot,
  useGovernanceReadiness,
} from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceTopologyDependencyMap, type TopologyLayerEntry }
  from "@/components/governance/governance-topology-dependency-map";
import { GovernanceBoundarySummaryTable, type BoundarySummaryEntry }
  from "@/components/governance/governance-boundary-summary-table";
import {
  TOPOLOGY_UI_SAFETY_CONTRACT,
  TOPOLOGY_EMPTY_STATE,
} from "@/lib/governance-console-config";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null): string {
  if (!s) return "-";
  try { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s)); }
  catch { return s; }
}

function truncateHash(h?: string | null, len = 16): string {
  if (!h) return "-";
  return h.length > len ? `${h.slice(0, len)}...` : h;
}

// ── Overview banner ────────────────────────────────────────────────────────

function TopologyOverviewBanner({
  boundarySummary, isLoading,
}: {
  boundarySummary: any;
  isLoading: boolean;
}) {
  const leakCount    = boundarySummary?.leakDetectedLayers ?? 0;
  const warningCount = boundarySummary?.warningLayers       ?? 0;
  const hasCritical  = leakCount > 0;

  return (
    <div
      className={`rounded-md border-2 p-4 ${hasCritical ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "border-border bg-card"}`}
      data-testid="topology-overview-banner"
    >
      <div className="flex flex-wrap items-center gap-5">
        {[
          { label: "Total Layers",   value: boundarySummary?.totalLayers,       colour: "text-foreground" },
          { label: "Verified",       value: boundarySummary?.verifiedLayers,     colour: "text-emerald-600 dark:text-emerald-400" },
          { label: "Warning",        value: warningCount,                        colour: warningCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
          { label: "Leak Detected",  value: leakCount,                           colour: hasCritical ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground" },
          { label: "Incomplete",     value: boundarySummary?.incompleteLayers,   colour: "text-muted-foreground" },
        ].map(({ label, value, colour }) => (
          <div key={label}>
            {isLoading
              ? <Skeleton className="h-6 w-12" />
              : <p className={`text-xl font-bold tabular-nums ${colour}`}>{value ?? "-"}</p>
            }
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
        {hasCritical && (
          <Badge className="ml-auto bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0">
            <ShieldAlert className="w-3 h-3 mr-1" />
            Boundary leak detected
          </Badge>
        )}
      </div>
    </div>
  );
}

// ── Critical warnings panel ────────────────────────────────────────────────

function CriticalWarningsPanel({ layers, isLoading }: { layers: any[]; isLoading: boolean }) {
  const criticalLayers = useMemo(() =>
    layers.filter(l =>
      l.boundaryStatus === "leak_detected" ||
      l.boundaryStatus === "boundary_leak_detected" ||
      l.boundaryStatus === "warning"
    ), [layers]);

  if (isLoading || criticalLayers.length === 0) return null;

  return (
    <Card className="border-2 border-amber-400" data-testid="critical-warnings-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          Boundary Warnings ({criticalLayers.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Review these layers on the boundary summary table below.
          This panel is read-only - no auto-fix controls are available.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {criticalLayers.map((layer: any, i: number) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <ShieldAlert className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">{layer.name ?? layer.layerId}</span>
              <span className="text-muted-foreground ml-1">
                - boundary: {layer.boundaryStatus?.replace(/_/g, " ")}
              </span>
              {layer.description && (
                <p className="text-muted-foreground mt-0.5">{layer.description}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Snapshot panel ─────────────────────────────────────────────────────────

function SnapshotPanel({ snapshot, isLoading }: { snapshot: any; isLoading: boolean }) {
  const s = snapshot;
  return (
    <Card data-testid="snapshot-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Camera className="w-4 h-4 text-muted-foreground" />
          Topology Snapshot
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Point-in-time topology state · Read-only
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !s ? (
          <div className="text-center py-4 text-muted-foreground">
            <Camera className="w-5 h-5 mx-auto mb-1 opacity-20" />
            <p className="text-sm">{TOPOLOGY_EMPTY_STATE.noSnapshotData.description}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              { label: "Snapshot Hash",    value: truncateHash(s.snapshotHash ?? s.hash) },
              { label: "Generated At",     value: fmtDate(s.generatedAt ?? s.capturedAt) },
              { label: "Layer Count",      value: s.layerCount ?? s.topologyLayerCount ?? "-" },
              { label: "Boundary Count",   value: s.boundaryCount ?? "-" },
              { label: "Readiness Status", value: s.readinessStatus?.replace(/_/g, " ") ?? "-" },
              { label: "Snapshot ID",      value: truncateHash(s.snapshotId ?? s.id, 12) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-medium">{value ?? "-"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Diff placeholder ───────────────────────────────────────────────────────

function DiffPlaceholder() {
  return (
    <Card className="border-dashed" data-testid="topology-diff-placeholder">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <GitCompare className="w-4 h-4" />
          Topology Diff Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Info className="w-4 h-4 shrink-0" />
          <p>
            Topology diff comparison will be available when two snapshots are selected.
            No snapshot persistence or diff execution is performed from this view.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Topology metadata panel ────────────────────────────────────────────────

function TopologyMetadataPanel({ topologyData, isLoading }: { topologyData: any; isLoading: boolean }) {
  if (!topologyData && !isLoading) return null;
  return (
    <Card data-testid="topology-metadata-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          Topology Metadata
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-10 w-full" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              { label: "Topology Version",  value: topologyData?.version ?? topologyData?.topologyVersion },
              { label: "Last Computed",     value: fmtDate(topologyData?.lastComputedAt ?? topologyData?.computedAt) },
              { label: "Governance Layers", value: topologyData?.governanceLayers?.length },
              { label: "Boundary Checks",   value: topologyData?.boundaryCheckCount ?? topologyData?.boundaryChecks },
              { label: "Status",            value: topologyData?.status?.replace(/_/g, " ") },
              { label: "Platform ID",       value: truncateHash(topologyData?.platformId, 10) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value ?? "-"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceTopology() {
  const topology   = useGovernanceTopology();
  const boundaries = useGovernanceTopologyBoundaries();
  const snapshot   = useGovernanceTopologySnapshot();
  const readiness  = useGovernanceReadiness();

  const topologyData    = (topology.data   as any)?.topology;
  const boundarySummary = (boundaries.data as any)?.boundarySummary;
  const snapshotData    = (snapshot.data   as any)?.snapshot;
  const readinessData   = (readiness.data  as any)?.readiness;

  const layers: any[]  = topologyData?.governanceLayers ?? [];
  const isLoading      = topology.isLoading || boundaries.isLoading;

  // Map API layers to component shape
  const layerEntries: TopologyLayerEntry[] = useMemo(() =>
    layers.map((l: any): TopologyLayerEntry => ({
      layerKey:         l.layerKey ?? l.layerId,
      layerId:          l.layerId,
      name:             l.name,
      boundaryStatus:   l.boundaryStatus,
      description:      l.description,
      boundaryProperties: l.boundaryProperties,
      warnings:         l.warnings ?? [],
    })), [layers]);

  const boundaryEntries: BoundarySummaryEntry[] = useMemo(() =>
    layers.map((l: any): BoundarySummaryEntry => ({
      layerKey:          l.layerKey ?? l.layerId,
      layerId:           l.layerId,
      name:              l.name,
      boundaryStatus:    l.boundaryStatus,
      expectedBoundary:  l.expectedBoundary,
      observedBoundary:  l.observedBoundary,
      warnings:          l.warnings ?? [],
      evidenceReferences: l.evidenceReferences ?? [],
    })), [layers]);

  const hasError = topology.isError || boundaries.isError;

  return (
    <div className="space-y-6" data-testid="governance-topology-page">

      <GovernanceSectionHeader
        icon={Network}
        title="Governance Topology"
        description="Cross-layer boundary verification - 7 governance layers from audit foundation to frontend console. Boundary status and layer dependency order."
      />

      <GovernanceReadOnlyNotice data-testid="governance-read-only-notice" />

      {hasError && (
        <GovernanceErrorState message="Could not load topology or boundary data from the governance API." />
      )}

      {/* Overview banner */}
      <TopologyOverviewBanner boundarySummary={boundarySummary} isLoading={isLoading} />

      {/* Critical warnings (only when present) */}
      <CriticalWarningsPanel layers={layers} isLoading={isLoading} />

      {/* Readiness verdict strip (quick link) */}
      {!isLoading && readinessData?.overallStatus && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1"
          data-testid="readiness-quick-strip">
          <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
          Platform readiness:
          <span className="font-medium capitalize text-foreground">
            {readinessData.overallStatus.replace(/_/g, " ")}
          </span>
          <Link href="/super-admin/governance/readiness"
            className="ml-auto flex items-center gap-1 underline hover:text-foreground transition-colors">
            Full Readiness Review <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Layer dependency map */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Layer Dependency Map
            {!topology.isLoading && layers.length > 0 && (
              <Badge variant="outline" className="ml-auto text-xs">{layers.length} layers</Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Canonical 7-layer governance stack · Order 0 = foundation, 6 = presentation
          </p>
        </CardHeader>
        <CardContent>
          <GovernanceTopologyDependencyMap
            layers={layerEntries}
            isLoading={topology.isLoading}
            data-testid="topology-dependency-map"
          />
        </CardContent>
      </Card>

      {/* Boundary summary table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            Boundary Summary
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-layer boundary verification · Critical entries shown first
          </p>
        </CardHeader>
        <CardContent>
          {boundaries.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <GovernanceBoundarySummaryTable
              entries={boundaryEntries}
              data-testid="boundary-summary-table"
            />
          )}
        </CardContent>
      </Card>

      {/* Snapshot + diff side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SnapshotPanel snapshot={snapshotData} isLoading={snapshot.isLoading} />
        <DiffPlaceholder />
      </div>

      {/* Topology metadata */}
      <TopologyMetadataPanel topologyData={topologyData} isLoading={topology.isLoading} />

      {/* Link to readiness page */}
      <div className="flex justify-end">
        <Link href="/super-admin/governance/readiness"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline transition-colors">
          View full Readiness assessment <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Safety annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        {TOPOLOGY_UI_SAFETY_CONTRACT.superAdminOnly && (
          <>
            Governance console - read-only topology review
            {" · "}No boundary auto-fix
            {" · "}No snapshot persistence
            {" · "}No diff execution
            {" · "}No legal conclusions
          </>
        )}
      </p>

    </div>
  );
}
