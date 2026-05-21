/**
 * @file   pages/super-admin-governance-readiness.tsx
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * Full governance readiness review page - read-only, super_admin only.
 * Sections:
 *   1. Header + GovernanceReadOnlyNotice
 *   2. Readiness overview banner (overallStatus, coverageScore, criticalGaps count)
 *   3. GovernanceReadinessDimensionGrid (8 dimensions, blocked/partial prominent)
 *   4. Readiness blockers panel (criticalGaps list)
 *   5. Readiness inputs/outputs reference table
 *   6. Future readiness notes
 *   7. Link back to topology page
 *
 * SAFETY CONTRACT: read-only - no readiness override, no auto-remediation,
 *   no snapshot persistence, no export, no AI, no legal conclusions.
 */

import {
  ShieldCheck, AlertTriangle, CheckCircle2, ArrowLeft,
  Info, XCircle, BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link }     from "wouter";
import {
  useGovernanceReadiness,
} from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceReadinessDimensionGrid, type ReadinessDimensionEntry }
  from "@/components/governance/governance-readiness-dimension-grid";
import {
  READINESS_STATUS_MAP,
  READINESS_DIMENSION_MAP,
  READINESS_DIMENSION_ORDER,
  READINESS_UI_SAFETY_CONTRACT,
  TOPOLOGY_EMPTY_STATE,
  type ReadinessStatusKey,
} from "@/lib/governance-console-config";

// ── Helpers ────────────────────────────────────────────────────────────────

function ReadinessBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as ReadinessStatusKey;
  const info = key in READINESS_STATUS_MAP ? READINESS_STATUS_MAP[key] : null;
  if (!info) return (
    <Badge variant="outline" className="capitalize">{status?.replace(/_/g, " ") ?? "Unknown"}</Badge>
  );
  return (
    <Badge className={`${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Overview banner ────────────────────────────────────────────────────────

function ReadinessOverviewBanner({
  readinessData, isLoading,
}: {
  readinessData: any;
  isLoading: boolean;
}) {
  const overallStatus = readinessData?.overallStatus;
  const gapCount      = (readinessData?.criticalGaps as string[] | undefined)?.length ?? 0;
  const isBlocked     = overallStatus === "not_ready" || overallStatus === "blocked";
  const isPartial     = overallStatus === "partial";

  const bannerClass = isBlocked ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : isPartial ? "border-amber-400 bg-amber-50 dark:bg-amber-950/10"
    : "border-border bg-card";

  return (
    <div className={`rounded-md border-2 p-4 ${bannerClass}`}
      data-testid="readiness-overview-banner">
      <div className="flex flex-wrap items-start gap-5">

        <div className="flex items-center gap-3">
          <ShieldCheck className={`w-6 h-6 ${isBlocked ? "text-red-500" : isPartial ? "text-amber-500" : "text-emerald-500"}`} />
          <div>
            {isLoading
              ? <Skeleton className="h-6 w-32" />
              : (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                    Platform Governance Readiness
                  </p>
                  <ReadinessBadge status={overallStatus} />
                </div>
              )
            }
          </div>
        </div>

        {!isLoading && readinessData?.coverageScore && (
          <div>
            <p className="text-xs text-muted-foreground">Coverage Score</p>
            <p className="text-lg font-bold capitalize">
              {String(readinessData.coverageScore).replace(/_/g, " ")}
            </p>
          </div>
        )}

        {!isLoading && gapCount > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Critical Gaps</p>
            <p className={`text-lg font-bold ${isBlocked ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {gapCount}
            </p>
          </div>
        )}

        {!isLoading && gapCount === 0 && overallStatus !== undefined && (
          <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 ml-auto">
            <CheckCircle2 className="w-3.5 h-3.5" />
            No critical gaps recorded
          </div>
        )}

      </div>
    </div>
  );
}

// ── Blockers panel ─────────────────────────────────────────────────────────

function BlockersPanel({ readinessData, isLoading }: { readinessData: any; isLoading: boolean }) {
  const gaps: string[] = readinessData?.criticalGaps ?? [];
  if (isLoading || gaps.length === 0) return null;

  return (
    <Card className="border-2 border-red-400" data-testid="readiness-blockers-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
          <XCircle className="w-4 h-4" />
          Critical Gaps ({gaps.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          These gaps must be addressed before full readiness can be confirmed.
          This panel is read-only - no remediation controls are available here.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {gaps.map((gap, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span>{gap}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Inputs/outputs reference table ─────────────────────────────────────────

function ReadinessReferenceTable() {
  return (
    <Card data-testid="readiness-reference-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          Dimension Input / Output Reference
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What each dimension expects as input and what its readiness score means
        </p>
      </CardHeader>
      <CardContent>
        <div>
          {/* Header */}
          <div className="grid grid-cols-[1fr_2fr_2fr] gap-3 px-2 py-1.5 text-xs font-medium text-muted-foreground border-b">
            <span>Dimension</span>
            <span>Expected Inputs</span>
            <span>Output Meaning</span>
          </div>
          {/* Rows from static config */}
          {READINESS_DIMENSION_ORDER.map(key => {
            const d = READINESS_DIMENSION_MAP[key];
            return (
              <div key={key}
                className="grid grid-cols-[1fr_2fr_2fr] gap-3 px-2 py-2 text-xs border-b border-border last:border-0 items-start hover:bg-muted/30 transition-colors"
                data-testid={`readiness-ref-row-${d.order}`}>
                <span className="font-medium text-foreground">{d.label}</span>
                <span className="text-muted-foreground">{d.expectedInputs}</span>
                <span className="text-muted-foreground">{d.outputMeaning}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Future readiness notes ─────────────────────────────────────────────────

function FutureReadinessNotes() {
  return (
    <Card className="border-dashed" data-testid="future-readiness-notes">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Info className="w-4 h-4" />
          Readiness Review Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Readiness dimensions reflect the current governance data profile.
            Readiness scores are computed from available workflow, violation, and analytics data.
          </p>
          <p>
            A "partial" or "blocked" status on any dimension does not constitute a compliance
            finding or legal conclusion - it indicates that the governance data inputs for that
            dimension are incomplete or unavailable at this time.
          </p>
          <p>
            No readiness override, auto-remediation, or export is available from this view.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Map readiness API data to dimension entries ────────────────────────────

function mapDimensionEntries(readinessData: any): ReadinessDimensionEntry[] {
  if (!readinessData) return [];

  // API may return dimensions array, or individual dimension-keyed fields
  const rawDimensions: any[] = readinessData.dimensions ?? [];
  if (rawDimensions.length > 0) {
    return rawDimensions.map((d: any): ReadinessDimensionEntry => ({
      dimensionKey: d.dimensionKey ?? d.dimension,
      dimension:    d.dimension,
      status:       d.status ?? d.readinessStatus,
      score:        d.score,
      blockers:     d.blockers ?? [],
      warnings:     d.warnings ?? [],
      notes:        d.notes,
    }));
  }

  // Fallback: use coverage score as a single dimension entry
  return [];
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceReadiness() {
  const readinessQuery = useGovernanceReadiness();
  const readinessData  = (readinessQuery.data as any)?.readiness;
  const isLoading      = readinessQuery.isLoading;

  const dimensionEntries = mapDimensionEntries(readinessData);

  return (
    <div className="space-y-6" data-testid="governance-readiness-page">

      <div className="flex items-center gap-3">
        <Link href="/super-admin/governance/topology"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" /> Topology
        </Link>
      </div>

      <GovernanceSectionHeader
        icon={ShieldCheck}
        title="Governance Readiness"
        description="Platform readiness assessment across 8 governance dimensions - from audit integrity to frontend operability. Read-only review."
      />

      <GovernanceReadOnlyNotice data-testid="governance-read-only-notice" />

      {readinessQuery.isError && (
        <GovernanceErrorState message={TOPOLOGY_EMPTY_STATE.noReadinessData.description} />
      )}

      {/* Overview banner */}
      <ReadinessOverviewBanner readinessData={readinessData} isLoading={isLoading} />

      {/* Blockers panel */}
      <BlockersPanel readinessData={readinessData} isLoading={isLoading} />

      {/* Dimension grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            Readiness Dimensions
            {!isLoading && dimensionEntries.length > 0 && (
              <Badge variant="outline" className="ml-auto text-xs">
                {dimensionEntries.length} / 8 dimensions
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Blocked and partial dimensions highlighted · Read-only
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : (
            <GovernanceReadinessDimensionGrid
              dimensions={dimensionEntries}
              data-testid="readiness-dimension-grid"
            />
          )}
        </CardContent>
      </Card>

      {/* Inputs / outputs reference */}
      <ReadinessReferenceTable />

      {/* Future notes */}
      <FutureReadinessNotes />

      {/* Back link */}
      <div className="flex justify-start">
        <Link href="/super-admin/governance/topology"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline transition-colors">
          <ArrowLeft className="w-3 h-3" /> Back to Topology
        </Link>
      </div>

      {/* Safety annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        {READINESS_UI_SAFETY_CONTRACT.superAdminOnly && (
          <>
            Governance console - read-only readiness review
            {" · "}No readiness override
            {" · "}No auto-remediation
            {" · "}No legal conclusions
          </>
        )}
      </p>

    </div>
  );
}
