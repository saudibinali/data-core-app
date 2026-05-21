/**
 * @file   components/governance/governance-evidence-section-coverage-grid.tsx
 * @phase  P12-G - Evidence Packages UI & Controlled Package Review Foundations
 *
 * Read-only evidence section coverage grid.
 * Shows all 7 canonical sections ordered by EVIDENCE_SECTION_ORDER.
 * Missing sections are always visible (not hidden).
 *
 * SAFETY CONTRACT: read-only - no section editing, no package mutation.
 */

import { CheckCircle2, XCircle, HelpCircle, FileText, Hash } from "lucide-react";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EVIDENCE_SECTION_MAP,
  EVIDENCE_SECTION_ORDER,
  TOPOLOGY_LAYER_MAP,
  type EvidenceSectionKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EvidenceSectionEntry {
  sectionKey?:      string;
  section?:         string;
  included?:        boolean;
  evidenceCount?:   number;
  notes?:           string;
}

interface GovernanceEvidenceSectionCoverageGridProps {
  includedSections?: string[];
  sectionEntries?:   EvidenceSectionEntry[];
  isLoading?:        boolean;
  "data-testid"?:    string;
}

// ── Status icon ────────────────────────────────────────────────────────────

function SectionStatusIcon({ included }: { included?: boolean }) {
  if (included === true)  return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (included === false) return <XCircle      className="w-4 h-4 text-red-400 shrink-0"     />;
  return                         <HelpCircle   className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function SectionStatusBadge({ included }: { included?: boolean }) {
  if (included === true)  return <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0 py-0">Included</Badge>;
  if (included === false) return <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0 py-0">Missing</Badge>;
  return <Badge variant="outline" className="text-xs py-0">Unknown</Badge>;
}

// ── Source layer label ─────────────────────────────────────────────────────

function SourceLayerBadge({ layerKey }: { layerKey?: string }) {
  const key = (layerKey ?? "") as keyof typeof TOPOLOGY_LAYER_MAP;
  const info = key in TOPOLOGY_LAYER_MAP ? TOPOLOGY_LAYER_MAP[key] : null;
  return (
    <span className="text-xs text-muted-foreground">
      {info?.label ?? layerKey ?? "-"}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceEvidenceSectionCoverageGrid({
  includedSections,
  sectionEntries,
  isLoading = false,
  "data-testid": testId = "evidence-section-coverage-grid",
}: GovernanceEvidenceSectionCoverageGridProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid={`${testId}-loading`}>
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  // Build a lookup by sectionKey / section label
  const lookup = new Map<string, EvidenceSectionEntry>();
  if (sectionEntries) {
    for (const e of sectionEntries) {
      if (e.sectionKey) lookup.set(e.sectionKey, e);
      if (e.section)    lookup.set(e.section, e);
    }
  }

  // If includedSections string[] is provided (from raw API), derive inclusion
  const includedSet = includedSections
    ? new Set(includedSections.map(s => s.toLowerCase()))
    : null;

  const resolveIncluded = (key: EvidenceSectionKey): boolean | undefined => {
    const liveEntry = lookup.get(key);
    if (liveEntry !== undefined) return liveEntry.included;
    if (includedSet !== null)    return includedSet.has(key) || includedSet.has(EVIDENCE_SECTION_MAP[key].label.toLowerCase());
    return undefined;
  };

  const hasAnyData = includedSections !== undefined || sectionEntries !== undefined;

  return (
    <div data-testid={testId}>
      {/* Header row */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b">
        <span>Section</span>
        <span>Source Layer</span>
        <span>Status</span>
      </div>

      {EVIDENCE_SECTION_ORDER.map((key, idx) => {
        const def      = EVIDENCE_SECTION_MAP[key];
        const liveEntry = lookup.get(key);
        const included  = resolveIncluded(key);
        const count     = liveEntry?.evidenceCount;
        const isMissing = included === false;

        return (
          <div
            key={key}
            className={`grid grid-cols-[1fr_1fr_auto] gap-3 px-3 py-2.5 text-xs border-b border-border last:border-0 items-start
              ${isMissing ? "bg-red-50 dark:bg-red-950/10 border-l-2 border-l-red-400" : ""}`}
            data-testid={`section-row-${idx}`}
          >
            {/* Section name + description */}
            <div className="flex items-start gap-1.5">
              <SectionStatusIcon included={included} />
              <div>
                <p className="font-medium text-foreground">{def.label}</p>
                <p className="text-muted-foreground mt-0.5 leading-snug">{def.reviewMeaning}</p>
                {liveEntry?.notes && (
                  <p className="text-muted-foreground italic mt-0.5">{liveEntry.notes}</p>
                )}
              </div>
            </div>

            {/* Source layer */}
            <div className="pt-0.5">
              <SourceLayerBadge layerKey={def.expectedSourceLayer} />
            </div>

            {/* Status + count */}
            <div className="flex flex-col items-end gap-1 pt-0.5">
              {hasAnyData
                ? <SectionStatusBadge included={included} />
                : <Badge variant="outline" className="text-xs py-0">-</Badge>
              }
              {count !== undefined && (
                <span className="text-muted-foreground flex items-center gap-0.5">
                  <Hash className="w-3 h-3" />{count}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground mt-2 px-1">
        Missing sections highlighted in red · Read-only
      </p>
    </div>
  );
}
