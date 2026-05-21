/**
 * @file   pages/super-admin-governance-evidence.tsx
 * @phase  P12-G - Evidence Packages UI & Controlled Package Review Foundations
 *
 * Full evidence package review page - read-only, super_admin only.
 * Sections:
 *   1. Header + GovernanceReadOnlyNotice
 *   2. Evidence readiness overview banner
 *   3. Package integrity summary cards (counts by status)
 *   4. Scope selector + filter bar (scope, integrityStatus, workspaceId, section)
 *   5. Package list with expandable detail rows
 *      Expanded: metadata, summaries, section coverage grid,
 *                integrity panel, evidence reference list
 *   6. Export placeholder notice
 *
 * SAFETY CONTRACT: read-only - no package generation, no export, no external
 *   submission, no verify/repair, no notarization, no legal conclusions.
 */

import { useState, useMemo } from "react";
import {
  Package, ShieldCheck, ShieldAlert, AlertTriangle,
  ChevronDown, ChevronUp, Filter, Info, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGovernanceEvidencePackages,
  useGovernanceEvidenceReadiness,
} from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceEvidenceReferenceList }
  from "@/components/governance/governance-evidence-reference-list";
import { GovernanceEvidenceSectionCoverageGrid }
  from "@/components/governance/governance-evidence-section-coverage-grid";
import { GovernancePackageIntegrityPanel, type PackageIntegrityInfo }
  from "@/components/governance/governance-package-integrity-panel";
import {
  EVIDENCE_PACKAGE_SCOPE_MAP,
  EVIDENCE_PACKAGE_SCOPE_ORDER,
  PACKAGE_INTEGRITY_STATUS_MAP,
  EVIDENCE_SCOPE_FILTER_OPTIONS,
  EVIDENCE_INTEGRITY_FILTER_OPTIONS,
  EVIDENCE_PACKAGE_SAFETY_CONTRACT,
  EVIDENCE_PACKAGE_EMPTY_STATE,
  type PackageIntegrityStatusKey,
  type EvidencePackageScopeKey,
} from "@/lib/governance-console-config";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null): string {
  if (!s) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
  } catch { return s; }
}

function truncate(s?: string | null, n = 16): string {
  if (!s) return "-";
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

// ── Badge components ───────────────────────────────────────────────────────

function IntegrityBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as PackageIntegrityStatusKey;
  const info = key in PACKAGE_INTEGRITY_STATUS_MAP ? PACKAGE_INTEGRITY_STATUS_MAP[key] : null;
  if (!info) return status
    ? <Badge variant="outline" className="text-xs">{status.replace(/_/g, " ")}</Badge>
    : <Badge variant="outline" className="text-xs">-</Badge>;
  return <Badge className={`text-xs ${info.badgeClass}`} title={info.description}>{info.label}</Badge>;
}

function ScopeBadge({ scope }: { scope?: string }) {
  const key  = (scope ?? "") as EvidencePackageScopeKey;
  const info = key in EVIDENCE_PACKAGE_SCOPE_MAP ? EVIDENCE_PACKAGE_SCOPE_MAP[key] : null;
  return <Badge variant="outline" className="text-xs capitalize">{info?.label ?? scope ?? "-"}</Badge>;
}

// ── Evidence readiness banner ──────────────────────────────────────────────

function EvidenceReadinessBanner({ readinessData, isLoading }: { readinessData: any; isLoading: boolean }) {
  const pkg           = readinessData;
  const hasData       = !!pkg;
  const isCompromised = (pkg?.compromisedCount ?? pkg?.compromisedPkgs ?? 0) > 0;
  const bannerClass   = isCompromised
    ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : "border-border bg-card";

  return (
    <div className={`rounded-md border-2 p-4 ${bannerClass}`} data-testid="evidence-readiness-banner">
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex items-center gap-2">
          {isCompromised
            ? <ShieldAlert className="w-5 h-5 text-red-500" />
            : <ShieldCheck className="w-5 h-5 text-emerald-500" />}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
              Evidence Package Readiness
            </p>
            {isLoading
              ? <Skeleton className="h-5 w-32" />
              : hasData
                ? <IntegrityBadge status={pkg.integrityStatus ?? pkg.overallReadiness} />
                : <span className="text-xs text-muted-foreground">
                    {EVIDENCE_PACKAGE_EMPTY_STATE.noReadinessData.description}
                  </span>
            }
          </div>
        </div>

        {!isLoading && hasData && (
          <>
            {([
              { label: "Total Packages",   value: pkg.packageCount       ?? pkg.totalPackages },
              { label: "Incomplete",       value: pkg.incompleteCount    ?? pkg.incompletePkgs,  urgent: (pkg.incompleteCount ?? 0) > 0 },
              { label: "Compromised",      value: pkg.compromisedCount   ?? pkg.compromisedPkgs, urgent: isCompromised },
              { label: "Missing Evidence", value: pkg.missingEvidenceCount ?? pkg.missingCount },
            ] as { label: string; value?: number; urgent?: boolean }[]).map(({ label, value, urgent }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold tabular-nums ${urgent ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                  {value ?? "-"}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Integrity summary cards ────────────────────────────────────────────────

function IntegritySummaryCards({ packages, isLoading }: { packages: any[]; isLoading: boolean }) {
  const counts = useMemo(() => {
    const c: Record<PackageIntegrityStatusKey, number> = {
      verified: 0, warning: 0, incomplete: 0, compromised: 0, unknown: 0,
    };
    for (const p of packages) {
      const s = (p.integrityStatus ?? "unknown") as PackageIntegrityStatusKey;
      if (s in c) c[s]++;
      else         c.unknown++;
    }
    return c;
  }, [packages]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="integrity-summary-cards">
      {(["verified", "warning", "incomplete", "compromised", "unknown"] as PackageIntegrityStatusKey[]).map(key => {
        const info  = PACKAGE_INTEGRITY_STATUS_MAP[key];
        const count = counts[key];
        const alertClass = key === "compromised" && count > 0 ? "border-red-400 border-2" : "";
        const numClass   = key === "compromised" && count > 0 ? "text-red-600 dark:text-red-400 font-bold"
          : key === "warning" && count > 0 ? "text-amber-600 dark:text-amber-400"
          : key === "verified" ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground";
        return (
          <Card key={key} className={alertClass}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">{info.label}</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${numClass}`}>{count}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Filter types ───────────────────────────────────────────────────────────

interface Filters {
  scope:           string;
  integrityStatus: string;
  workspaceId:     string;
  section:         string;
}

// ── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          Filters
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-4">

          {/* Scope */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Scope</label>
            <div className="flex flex-wrap gap-1.5">
              {EVIDENCE_SCOPE_FILTER_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  variant={filters.scope === opt.value ? "default" : "outline"}
                  size="sm" className="h-7 text-xs px-2.5"
                  onClick={() => onChange({ ...filters, scope: opt.value })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Integrity status */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Integrity</label>
            <div className="flex flex-wrap gap-1.5">
              {EVIDENCE_INTEGRITY_FILTER_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  variant={filters.integrityStatus === opt.value ? "default" : "outline"}
                  size="sm" className="h-7 text-xs px-2.5"
                  onClick={() => onChange({ ...filters, integrityStatus: opt.value })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

        </div>

        <div className="flex flex-wrap gap-3">
          {/* Workspace ID */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Workspace ID</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={filters.workspaceId}
                onChange={e => onChange({ ...filters, workspaceId: e.target.value })}
                placeholder="Filter by workspace ID..."
                className="h-7 text-xs pl-6 w-52"
              />
            </div>
          </div>

          {/* Section */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Section</label>
            <Input
              value={filters.section}
              onChange={e => onChange({ ...filters, section: e.target.value })}
              placeholder="Filter by section..."
              className="h-7 text-xs w-40"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Package row (expandable) ───────────────────────────────────────────────

function PackageRow({ pkg, index, expanded, onToggle }: {
  pkg: any; index: number; expanded: boolean; onToggle: () => void;
}) {
  const isCompromised = pkg.integrityStatus === "compromised";
  const rowClass = isCompromised ? "border-l-2 border-l-red-400 bg-red-50 dark:bg-red-950/10" : "";

  const includedSections: string[] = pkg.includedSections ?? [];
  const evidenceRefs: any[]        = pkg.evidenceReferences ?? pkg.evidenceRefs ?? [];

  const summaries = [
    { key: "auditChainSummary",  label: "Audit Chain" },
    { key: "violationSummary",   label: "Violations"  },
    { key: "workflowSummary",    label: "Workflows"   },
    { key: "analyticsSummary",   label: "Analytics"   },
    { key: "topologySummary",    label: "Topology"    },
    { key: "readinessSummary",   label: "Readiness"   },
  ].filter(({ key }) => pkg[key]);

  const integrityInfo: PackageIntegrityInfo = {
    packageIntegrityHash: pkg.packageIntegrityHash,
    integrityStatus:      pkg.integrityStatus,
    generatedAt:          pkg.generatedAt,
    warnings:             pkg.warnings,
    hashAlgorithm:        pkg.hashAlgorithm,
    serializationNotes:   pkg.serializationNotes,
    readinessNotes:       pkg.readinessNotes,
  };

  return (
    <div className={`border rounded-md overflow-hidden ${rowClass}`}
      data-testid={`package-row-${index}`}>

      {/* Header row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors text-sm"
        onClick={onToggle} role="button" tabIndex={0} aria-expanded={expanded}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
      >
        <Package className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-mono text-xs text-muted-foreground w-28 truncate shrink-0"
          title={pkg.packageId}>{truncate(pkg.packageId, 14)}</span>
        <ScopeBadge scope={pkg.packageScope ?? pkg.scope} />
        <IntegrityBadge status={pkg.integrityStatus} />
        <span className="flex-1 text-xs text-muted-foreground truncate hidden sm:block">
          {fmtDate(pkg.generatedAt)}
        </span>
        {pkg.workspaceId && (
          <span className="text-xs text-muted-foreground font-mono truncate hidden md:block max-w-[100px]">
            {truncate(pkg.workspaceId, 10)}
          </span>
        )}
        <span className="text-muted-foreground ml-auto shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t bg-muted/20 p-4 space-y-5">

          {/* Metadata */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Package Metadata
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs">
              {[
                { label: "Package ID",        value: pkg.packageId },
                { label: "Scope",             value: pkg.packageScope ?? pkg.scope },
                { label: "Workspace ID",      value: pkg.workspaceId },
                { label: "Entity ID",         value: pkg.entityId },
                { label: "Generated By",      value: pkg.generatedBy },
                { label: "Generated At",      value: fmtDate(pkg.generatedAt) },
                { label: "Integrity Status",  value: pkg.integrityStatus?.replace(/_/g, " ") },
                { label: "Readiness Status",  value: pkg.readinessStatus?.replace(/_/g, " ") },
                { label: "Sections",          value: includedSections.join(", ") || "-" },
              ].map(({ label, value }) => (
                <div key={label}
                  className="flex justify-between py-1 border-b border-border last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{value ?? "-"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Summaries */}
          {summaries.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Package Summaries
              </p>
              <div className="space-y-2">
                {summaries.map(({ key, label }) => (
                  <div key={key} className="rounded-md bg-muted px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">{label}: </span>
                    <span className="text-muted-foreground">{String(pkg[key])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section coverage */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Section Coverage
            </p>
            <GovernanceEvidenceSectionCoverageGrid
              includedSections={includedSections}
              data-testid={`section-coverage-${index}`}
            />
          </div>

          {/* Integrity panel */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Package Integrity
            </p>
            <GovernancePackageIntegrityPanel
              info={integrityInfo}
              data-testid={`integrity-panel-${index}`}
            />
          </div>

          {/* Evidence references */}
          {evidenceRefs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Evidence References ({evidenceRefs.length})
              </p>
              <GovernanceEvidenceReferenceList
                references={evidenceRefs}
                data-testid={`evidence-refs-${index}`}
              />
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Package list ───────────────────────────────────────────────────────────

function PackageList({ packages, isLoading, filters }: {
  packages: any[]; isLoading: boolean; filters: Filters;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const filtered = useMemo(() => packages.filter(p => {
    if (filters.scope && (p.packageScope ?? p.scope) !== filters.scope) return false;
    if (filters.integrityStatus && p.integrityStatus !== filters.integrityStatus) return false;
    if (filters.workspaceId && !String(p.workspaceId ?? "").toLowerCase().includes(filters.workspaceId.toLowerCase())) return false;
    if (filters.section) {
      const secs = (p.includedSections ?? []).map((s: string) => s.toLowerCase());
      if (!secs.some((s: string) => s.includes(filters.section.toLowerCase()))) return false;
    }
    return true;
  }), [packages, filters]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground"
        data-testid="package-list-empty">
        <Package className="w-6 h-6 mb-2 opacity-20" />
        <p className="text-sm">{
          packages.length === 0
            ? EVIDENCE_PACKAGE_EMPTY_STATE.noPackages.description
            : EVIDENCE_PACKAGE_EMPTY_STATE.noFilterMatch.description
        }</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="package-list">
      {filtered.map((pkg, i) => (
        <PackageRow
          key={pkg.packageId ?? i}
          pkg={pkg}
          index={i}
          expanded={expandedIdx === i}
          onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
        />
      ))}
      <p className="text-xs text-muted-foreground text-right pt-1">
        {filtered.length} package{filtered.length !== 1 ? "s" : ""} · Read-only
      </p>
    </div>
  );
}

// ── Scope selector ─────────────────────────────────────────────────────────

function ScopeTabs({ scope, onChange }: { scope: string; onChange: (s: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          Evidence Scope
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {EVIDENCE_PACKAGE_SCOPE_ORDER.map(key => {
            const info = EVIDENCE_PACKAGE_SCOPE_MAP[key];
            return (
              <Button
                key={key}
                variant={scope === key ? "default" : "outline"}
                size="sm" className="h-7 text-xs"
                onClick={() => onChange(key)}
              >
                {info.label}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {EVIDENCE_PACKAGE_SCOPE_MAP[scope as EvidencePackageScopeKey]?.displayHint
            ?? "Select a scope to load a package."}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceEvidence() {
  const [selectedScope, setSelectedScope] = useState<EvidencePackageScopeKey>("platform");
  const [filters, setFilters] = useState<Filters>({
    scope: "", integrityStatus: "", workspaceId: "", section: "",
  });

  const evidenceQuery  = useGovernanceEvidencePackages(selectedScope);
  const readinessQuery = useGovernanceEvidenceReadiness();

  const rawPkg        = (evidenceQuery.data  as any)?.package;
  const readinessData = (readinessQuery.data as any)?.package;

  const packages: any[] = useMemo(() => {
    if (!rawPkg) return [];
    return Array.isArray(rawPkg) ? rawPkg : [rawPkg];
  }, [rawPkg]);

  return (
    <div className="space-y-6" data-testid="governance-evidence-page">

      <GovernanceSectionHeader
        icon={Package}
        title="Evidence Packages"
        description="Read-only inspection of governance evidence packages - integrity hashes, section coverage, and evidence references. No package generation, no export, no external submission."
      />

      <GovernanceReadOnlyNotice data-testid="governance-read-only-notice" />

      {(evidenceQuery.isError || readinessQuery.isError) && (
        <GovernanceErrorState message="Could not load evidence package data from the governance API." />
      )}

      {/* Evidence readiness banner */}
      <EvidenceReadinessBanner
        readinessData={readinessData}
        isLoading={readinessQuery.isLoading}
      />

      {/* Integrity summary cards */}
      <IntegritySummaryCards packages={packages} isLoading={evidenceQuery.isLoading} />

      {/* Scope selector */}
      <ScopeTabs scope={selectedScope} onChange={s => setSelectedScope(s as EvidencePackageScopeKey)} />

      {/* Filter bar */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Package list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            Evidence Packages
            {!evidenceQuery.isLoading && packages.length > 0 && (
              <Badge variant="outline" className="ml-auto text-xs">{packages.length}</Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Expand a row to inspect sections, integrity hash, and evidence references
          </p>
        </CardHeader>
        <CardContent>
          <PackageList
            packages={packages}
            isLoading={evidenceQuery.isLoading}
            filters={filters}
          />
        </CardContent>
      </Card>

      {/* Export placeholder */}
      <Card className="border-dashed" data-testid="export-placeholder">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Structured Package Review - Not Available</p>
              <p className="mt-1">
                PDF and structured rendering requires a separate controlled review layer
                with scoped access tokens and human-authorised delivery controls.
                This will be implemented in a future phase.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Safety annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        {EVIDENCE_PACKAGE_SAFETY_CONTRACT.superAdminOnly && (
          <>
            Governance console - read-only evidence package review
            {" · "}No package generation
            {" · "}No export
            {" · "}No legal conclusions
          </>
        )}
      </p>

    </div>
  );
}
