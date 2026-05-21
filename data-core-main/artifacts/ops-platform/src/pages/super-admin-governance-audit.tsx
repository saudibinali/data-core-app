/**
 * @file   pages/super-admin-governance-audit.tsx
 * @phase  P12-B - Audit Integrity UI & Forensic Timeline Review Foundations
 *
 * Audit Integrity section - full forensic review experience.
 * Read-only - no mutation controls, no repair actions, no legal conclusions.
 *
 * Sections:
 *   1. Summary stat cards (totalEntries, verified, compromised, forensicCritical)
 *   2. Overall integrity status card
 *   3. Audit chain browser (filterable table - client-side filters)
 *   4. Forensic entity investigation (entityId input → timeline)
 */

import { useState, useMemo } from "react";
import {
  LinkIcon, ShieldCheck, ShieldX, AlertTriangle, Search, Filter,
  Hash, Tag, Clock, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  useGovernanceAuditIntegrity,
  useGovernanceAuditChains,
  useGovernanceForensicTimeline,
} from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice } from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader } from "@/components/governance/governance-section-header";
import { GovernanceErrorState } from "@/components/governance/governance-error-state";
import { GovernanceForensicTimeline } from "@/components/governance/governance-forensic-timeline";
import {
  INTEGRITY_STATUS_MAP,
  RETENTION_CLASSIFICATION_MAP,
  AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS,
  AUDIT_RETENTION_FILTER_OPTIONS,
  AUDIT_ENTITY_TYPE_FILTER_OPTIONS,
  FORENSIC_ENTITY_TYPE_OPTIONS,
  FORENSIC_EMPTY_STATE,
  type IntegrityStatusKey,
  type RetentionClassificationKey,
} from "@/lib/governance-console-config";

// ── Integrity status badge (local - keeps page self-contained) ─────────────

function IntegrityBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as IntegrityStatusKey;
  const info = key in INTEGRITY_STATUS_MAP ? INTEGRITY_STATUS_MAP[key] : null;
  if (!info) return <Badge variant="outline" className="text-xs">Unknown</Badge>;

  if (info.tier === "healthy")
    return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0 text-xs gap-1"><ShieldCheck className="w-3 h-3" />{info.label}</Badge>;
  if (info.tier === "critical")
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0 text-xs gap-1"><ShieldX className="w-3 h-3" />{info.label}</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0 text-xs gap-1"><AlertTriangle className="w-3 h-3" />{info.label}</Badge>;
}

function RetentionBadge({ cls }: { cls?: string }) {
  const key  = (cls ?? "") as RetentionClassificationKey;
  const info = key in RETENTION_CLASSIFICATION_MAP ? RETENTION_CLASSIFICATION_MAP[key] : null;
  if (!info) return <Badge variant="outline" className="text-xs">{cls ?? "-"}</Badge>;

  if (key === "forensic_critical")
    return <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400 border-0 text-xs" title={info.helper}>{info.label}</Badge>;
  if (key === "compliance_sensitive")
    return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400 border-0 text-xs" title={info.helper}>{info.label}</Badge>;
  if (key === "governance")
    return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0 text-xs" title={info.helper}>{info.label}</Badge>;
  return <Badge variant="secondary" className="text-xs" title={info.helper}>{info.label}</Badge>;
}

function fmtDate(iso?: string) {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

// ── Audit chain row ────────────────────────────────────────────────────────

function AuditChainRow({ entry }: { entry: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const hash = typeof entry.hash === "string"
    ? entry.hash.slice(0, 12) + "..."
    : typeof entry.hashPreview === "string"
      ? entry.hashPreview
      : null;

  return (
    <div className="border rounded-md mb-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className="shrink-0 w-24 font-medium text-foreground truncate">
          {typeof entry.entityType === "string" ? entry.entityType : "-"}
        </span>
        <span className="flex-1 font-mono truncate text-muted-foreground">
          {typeof entry.entityId === "string" ? entry.entityId : "-"}
        </span>
        <span className="shrink-0">
          <IntegrityBadge status={typeof entry.integrityStatus === "string" ? entry.integrityStatus : undefined} />
        </span>
        <span className="shrink-0">
          <RetentionBadge cls={typeof entry.retentionClassification === "string" ? entry.retentionClassification : undefined} />
        </span>
        <span className="shrink-0 text-muted-foreground hidden sm:block">
          {fmtDate(typeof entry.occurredAt === "string" ? entry.occurredAt : undefined)}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>

      {open && (
        <div className="border-t bg-muted/30 px-4 py-3 text-xs space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {entry.chainId && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <LinkIcon className="w-3 h-3 shrink-0" />
                <span className="font-medium">Chain ID:</span>
                <span className="font-mono truncate text-foreground">{String(entry.chainId)}</span>
              </div>
            )}
            {entry.eventType && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Tag className="w-3 h-3 shrink-0" />
                <span className="font-medium">Event:</span>
                <span className="font-mono text-foreground">{String(entry.eventType)}</span>
              </div>
            )}
            {entry.operatorId && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="font-medium">Operator:</span>
                <span className="font-mono truncate text-foreground">{String(entry.operatorId)}</span>
              </div>
            )}
            {entry.recordedAt && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                <span className="font-medium">Recorded:</span>
                <span className="font-mono text-foreground">{fmtDate(String(entry.recordedAt))}</span>
              </div>
            )}
            {hash && (
              <div className="flex items-center gap-1.5 text-muted-foreground col-span-full">
                <Hash className="w-3 h-3 shrink-0" />
                <span className="font-medium">Hash preview:</span>
                <span className="font-mono text-foreground">{hash}</span>
              </div>
            )}
          </div>
          {/* Integrity description for non-healthy */}
          {(() => {
            const k = (typeof entry.integrityStatus === "string" ? entry.integrityStatus : "") as IntegrityStatusKey;
            const m = k in INTEGRITY_STATUS_MAP ? INTEGRITY_STATUS_MAP[k] : null;
            if (!m || m.tier === "healthy") return null;
            return (
              <div className="flex items-start gap-1.5 mt-2 text-muted-foreground">
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
                <span>{m.description}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceAudit() {
  const integrity = useGovernanceAuditIntegrity();
  const chains    = useGovernanceAuditChains({ limit: 50 });

  // Filter state
  const [statusFilter,     setStatusFilter]     = useState("");
  const [retentionFilter,  setRetentionFilter]  = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");

  // Forensic entity review state
  const [entityIdInput,   setEntityIdInput]   = useState("");
  const [activeEntityId,  setActiveEntityId]  = useState<string | undefined>(undefined);

  const forensic = useGovernanceForensicTimeline(activeEntityId);

  const report  = (integrity.data as any)?.report;
  const summary = (integrity.data as any)?.summary;
  const overallStatus: string | undefined = report?.overallStatus;

  // Client-side filter of audit chain entries
  const rawEntries: Record<string, unknown>[] =
    ((chains.data as any)?.entries ?? []) as Record<string, unknown>[];

  const filteredEntries = useMemo(() => {
    return rawEntries.filter(e => {
      if (statusFilter    && e.integrityStatus       !== statusFilter)    return false;
      if (retentionFilter && e.retentionClassification !== retentionFilter) return false;
      if (entityTypeFilter && e.entityType            !== entityTypeFilter) return false;
      return true;
    });
  }, [rawEntries, statusFilter, retentionFilter, entityTypeFilter]);

  const hasActiveFilters = !!(statusFilter || retentionFilter || entityTypeFilter);
  const activeFilterCount = [statusFilter, retentionFilter, entityTypeFilter].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setRetentionFilter("");
    setEntityTypeFilter("");
  }

  function handleReviewTimeline() {
    const trimmed = entityIdInput.trim();
    if (trimmed) setActiveEntityId(trimmed);
  }

  function handleClearTimeline() {
    setActiveEntityId(undefined);
    setEntityIdInput("");
  }

  const forensicEvents = ((forensic.data as any)?.timeline ?? []) as Record<string, unknown>[];

  return (
    <div className="space-y-6" data-testid="governance-audit-page">

      <GovernanceSectionHeader
        icon={LinkIcon}
        title="Audit Integrity"
        description="SHA-256 hash-linked audit chain verification and forensic timeline reconstruction. Append-only - no records can be modified or deleted."
      />

      <GovernanceReadOnlyNotice />

      {integrity.isError && (
        <GovernanceErrorState message="Could not load audit integrity data from the governance API." />
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Entries",         key: "totalEntries",            color: "text-blue-600" },
          { label: "Verified",              key: "verifiedEntries",         color: "text-emerald-600" },
          { label: "Compromised / Orphaned",key: "compromisedEntries",      color: "text-red-600" },
          { label: "Forensic Critical",     key: "forensicCriticalEntries", color: "text-violet-600" },
        ].map(({ label, key, color }) => (
          <Card key={key}>
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              {integrity.isLoading
                ? <Skeleton className="h-7 w-12 mt-1" />
                : <p className={`text-2xl font-bold mt-1 ${color}`}>{(summary as any)?.[key] ?? "-"}</p>
              }
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Overall integrity status ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Overall Integrity Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {integrity.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex items-center gap-3">
                <IntegrityBadge status={overallStatus} />
                <span className="text-sm text-muted-foreground">
                  {(() => {
                    const k = (overallStatus ?? "") as IntegrityStatusKey;
                    return k in INTEGRITY_STATUS_MAP
                      ? INTEGRITY_STATUS_MAP[k].description
                      : "Integrity check pending or insufficient data.";
                  })()}
                </span>
              </div>
              {/* Status legend */}
              <div className="ml-auto hidden lg:flex flex-wrap gap-2">
                {(Object.entries(INTEGRITY_STATUS_MAP) as [IntegrityStatusKey, typeof INTEGRITY_STATUS_MAP[IntegrityStatusKey]][]).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <IntegrityBadge status={k} />
                    <span>= {v.tier}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Audit chain browser ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            Audit Chain Entries
            <Badge variant="outline" className="ml-auto text-xs">
              {chains.isLoading ? "..." : `${filteredEntries.length} / ${rawEntries.length}`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium">Filter:</span>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 text-xs w-[160px]" data-testid="filter-integrity-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={retentionFilter} onValueChange={setRetentionFilter}>
              <SelectTrigger className="h-7 text-xs w-[180px]" data-testid="filter-retention">
                <SelectValue placeholder="All Classifications" />
              </SelectTrigger>
              <SelectContent>
                {AUDIT_RETENTION_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[140px]" data-testid="filter-entity-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                {AUDIT_ENTITY_TYPE_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={clearFilters}
                data-testid="clear-filters"
              >
                Clear ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Entry list */}
          {chains.isLoading && (
            <div className="space-y-1">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
            </div>
          )}

          {chains.isError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Could not load audit chain entries.
            </div>
          )}

          {!chains.isLoading && !chains.isError && (
            <>
              {filteredEntries.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground" data-testid="chains-empty">
                  <LinkIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">
                    {hasActiveFilters
                      ? "No entries match the current filters."
                      : "No audit chain entries recorded yet."}
                  </p>
                  {hasActiveFilters && (
                    <button
                      className="text-xs mt-2 underline text-muted-foreground hover:text-foreground transition-colors"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {/* Column headers */}
                  <div className="flex items-center gap-3 px-3 py-1 text-xs font-medium text-muted-foreground border-b mb-1">
                    <span className="w-24 shrink-0">Entity Type</span>
                    <span className="flex-1">Entity ID</span>
                    <span className="shrink-0">Integrity</span>
                    <span className="shrink-0">Retention</span>
                    <span className="shrink-0 hidden sm:block">Occurred</span>
                    <span className="w-4" />
                  </div>
                  {filteredEntries.map((entry, i) => (
                    <AuditChainRow key={(entry.id as string) ?? `e-${i}`} entry={entry} />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* ── Forensic Entity Investigation ── */}
      <Card data-testid="forensic-investigation-section">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4" />
            Forensic Entity Investigation
            <Badge className="ml-auto text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0">
              Read-Only
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Entity search form */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <Input
                value={entityIdInput}
                onChange={e => setEntityIdInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleReviewTimeline(); }}
                placeholder="Enter entity ID (workspace ID, user ID, ticket ID...)"
                className="h-8 text-sm font-mono"
                data-testid="forensic-entity-id-input"
              />
            </div>
            <Select
              value={entityIdInput ? undefined : ""}
              onValueChange={v => {
                if (v && v !== "__all__") {
                  setEntityIdInput(prev => prev);
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="forensic-entity-type-select">
                <SelectValue placeholder="Entity type (optional)" />
              </SelectTrigger>
              <SelectContent>
                {FORENSIC_ENTITY_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs px-4 shrink-0"
              onClick={handleReviewTimeline}
              disabled={!entityIdInput.trim()}
              data-testid="review-timeline-button"
            >
              <Search className="w-3 h-3 mr-1" />
              Review Timeline
            </Button>
            {activeEntityId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs px-3 shrink-0"
                onClick={handleClearTimeline}
                data-testid="clear-timeline-button"
              >
                Clear
              </Button>
            )}
          </div>

          {/* Guidance text */}
          <p className="text-xs text-muted-foreground">
            Reconstructs the chronological audit event history for a single entity.
            Only reads - no records are written, repaired, or modified by this action.
          </p>

          {/* No entity selected state */}
          {!activeEntityId && (
            <div className="text-center py-10 text-muted-foreground border rounded-md border-dashed" data-testid="forensic-no-entity">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">{FORENSIC_EMPTY_STATE.noEntitySelected.title}</p>
              <p className="text-xs mt-1 max-w-sm mx-auto">{FORENSIC_EMPTY_STATE.noEntitySelected.description}</p>
            </div>
          )}

          {/* Active entity - show timeline */}
          {activeEntityId && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs font-mono gap-1">
                  <Search className="w-3 h-3" />
                  {activeEntityId}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {forensic.isLoading ? "Loading forensic timeline..." :
                   forensic.isError   ? "Error loading timeline" :
                   `${forensicEvents.length} event${forensicEvents.length !== 1 ? "s" : ""} found`}
                </span>
              </div>

              <GovernanceForensicTimeline
                events={forensicEvents.map(e => ({
                  id:                    typeof e.id === "string" ? e.id : undefined,
                  eventType:             typeof e.eventType === "string" ? e.eventType : undefined,
                  entityType:            typeof e.entityType === "string" ? e.entityType : undefined,
                  entityId:              typeof e.entityId === "string" ? e.entityId : undefined,
                  operatorId:            typeof e.operatorId === "string" ? e.operatorId : undefined,
                  occurredAt:            typeof e.occurredAt === "string" ? e.occurredAt : undefined,
                  recordedAt:            typeof e.recordedAt === "string" ? e.recordedAt : undefined,
                  integrityStatus:       typeof e.integrityStatus === "string" ? e.integrityStatus : undefined,
                  retentionClassification: typeof e.retentionClassification === "string" ? e.retentionClassification : undefined,
                  hashPreview:           typeof e.hash === "string" ? e.hash.slice(0, 16) + "..." : typeof e.hashPreview === "string" ? e.hashPreview : undefined,
                  evidenceRef:           typeof e.evidenceRef === "string" ? e.evidenceRef : undefined,
                  chainId:               typeof e.chainId === "string" ? e.chainId : undefined,
                  parentChainId:         typeof e.parentChainId === "string" ? e.parentChainId : undefined,
                }))}
                isLoading={forensic.isLoading}
                isError={forensic.isError}
                errorMessage={
                  forensic.isError
                    ? `Could not load forensic timeline for entity "${activeEntityId}". Check that the ID is valid and the compliance API is reachable.`
                    : undefined
                }
                data-testid="forensic-timeline"
              />
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
