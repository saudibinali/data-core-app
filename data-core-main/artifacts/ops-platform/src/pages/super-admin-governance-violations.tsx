/**
 * @file   pages/super-admin-governance-violations.tsx
 * @phase  P12-C - Policy Violations UI & Evidence Review Foundations
 *
 * Policy Violations section - full violation review experience.
 * Read-only - no create/dismiss/resolve/escalate controls.
 *
 * Sections:
 *   1. Overview risk banner (overallRiskLevel + severity counts)
 *   2. Severity summary cards (5 severity levels)
 *   3. Active violations list (filterable, expandable rows)
 *   4. Policy registry table (all 8 governance policies)
 */

import { useState, useMemo } from "react";
import {
  AlertTriangle, ShieldCheck, ShieldX, Filter, Search,
  ChevronDown, ChevronUp, ExternalLink, Copy, Info,
  BookOpen, Clock, Tag, User, Hash,
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
import { useGovernanceViolations, useGovernancePolicies } from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceEvidenceReferenceList } from "@/components/governance/governance-evidence-reference-list";
import {
  VIOLATION_SEVERITY_MAP,
  VIOLATION_SEVERITY_ORDER_DESC,
  VIOLATION_SEVERITY_FILTER_OPTIONS,
  VIOLATION_TYPE_FILTER_OPTIONS,
  POLICY_REGISTRY_COLUMNS,
  VIOLATIONS_EMPTY_STATE,
  FORENSIC_CONTEXT_GUIDANCE,
  VIOLATIONS_UI_SAFETY_CONTRACT,
  type ViolationSeverityKey,
} from "@/lib/governance-console-config";
import { Link } from "wouter";

// ── Severity badge ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity?: string }) {
  const key  = (severity ?? "") as ViolationSeverityKey;
  const info = key in VIOLATION_SEVERITY_MAP ? VIOLATION_SEVERITY_MAP[key] : null;

  if (!info) return <Badge variant="outline" className="text-xs">{severity ?? "unknown"}</Badge>;

  const colours: Record<string, string> = {
    critical:      "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
    high:          "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400 border-0",
    medium:        "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
    low:           "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0",
    informational: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0",
  };

  const icons: Record<string, JSX.Element> = {
    critical:      <ShieldX className="w-3 h-3" />,
    high:          <AlertTriangle className="w-3 h-3" />,
    medium:        <AlertTriangle className="w-3 h-3" />,
    low:           <Info className="w-3 h-3" />,
    informational: <Info className="w-3 h-3" />,
  };

  return (
    <Badge className={`text-xs gap-1 ${colours[key] ?? ""}`} title={info.description}>
      {icons[key]}
      {info.label}
    </Badge>
  );
}

// ── Left-border colour by severity ────────────────────────────────────────

function severityBorderClass(severity?: string): string {
  if (severity === "critical")      return "border-l-red-400 dark:border-l-red-600";
  if (severity === "high")          return "border-l-orange-400 dark:border-l-orange-600";
  if (severity === "medium")        return "border-l-amber-400 dark:border-l-amber-600";
  if (severity === "low")           return "border-l-blue-400 dark:border-l-blue-600";
  if (severity === "informational") return "border-l-slate-300 dark:border-l-slate-600";
  return "border-l-border";
}

// ── Date formatter ────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

// ── Copy-to-clipboard helper (no toast - plain clipboard write) ───────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, id: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }
  return { copy, copied };
}

// ── Violation row (expandable) ─────────────────────────────────────────────

function ViolationRow({
  violation,
  index,
}: {
  violation: Record<string, unknown>;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const { copy, copied } = useCopy();

  const severity     = typeof violation.severity     === "string" ? violation.severity     : undefined;
  const violationType= typeof violation.violationType=== "string" ? violation.violationType: undefined;
  const violationId  = typeof violation.violationId  === "string" ? violation.violationId  : `v-${index}`;
  const policyId     = typeof violation.policyId     === "string" ? violation.policyId     : undefined;
  const entityId     = typeof violation.entityId     === "string" ? violation.entityId     : undefined;
  const entityType   = typeof violation.entityType   === "string" ? violation.entityType   : undefined;
  const workspaceId  = typeof violation.workspaceId  === "string" ? violation.workspaceId  : undefined;
  const detectedAt   = typeof violation.detectedAt   === "string" ? violation.detectedAt   : undefined;
  const status       = typeof violation.violationStatus === "string" ? violation.violationStatus : undefined;
  const operatorId   = typeof violation.operatorId   === "string" ? violation.operatorId   : undefined;

  const evidenceRefs: Record<string, unknown>[] = Array.isArray(violation.evidenceReferences)
    ? violation.evidenceReferences as Record<string, unknown>[]
    : [];

  const auditChainIds: string[] = Array.isArray(violation.auditChainIds)
    ? (violation.auditChainIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const executionIds: string[] = Array.isArray(violation.executionIds)
    ? (violation.executionIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  return (
    <div
      className={`border-l-4 ${severityBorderClass(severity)} border border-border rounded-md overflow-hidden mb-2`}
      data-testid={`violation-row-${index}`}
    >
      {/* Collapsed header */}
      <button
        type="button"
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="shrink-0 pt-0.5">
          <SeverityBadge severity={severity} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {violationType?.replace(/_/g, " ") ?? "Unknown violation type"}
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {policyId ?? "-"} · {entityId ?? workspaceId ?? "-"}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {status && <Badge variant="outline" className="text-xs">{status}</Badge>}
          <span className="text-muted-foreground">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t bg-muted/20 px-4 py-4 space-y-4">

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <DetailField icon={<Hash className="w-3 h-3" />}  label="Violation ID" value={violationId} mono copyId={violationId} onCopy={copy} copied={copied} />
            {policyId     && <DetailField icon={<BookOpen className="w-3 h-3" />}  label="Policy"        value={policyId}     mono copyId={policyId}     onCopy={copy} copied={copied} />}
            {workspaceId  && <DetailField icon={<Tag className="w-3 h-3" />}       label="Workspace"     value={workspaceId}  mono copyId={workspaceId}  onCopy={copy} copied={copied} />}
            {entityType   && <DetailField icon={<Tag className="w-3 h-3" />}       label="Entity Type"   value={entityType}                                                               />}
            {entityId     && <DetailField icon={<Hash className="w-3 h-3" />}      label="Entity ID"     value={entityId}     mono copyId={entityId}     onCopy={copy} copied={copied} />}
            {operatorId   && <DetailField icon={<User className="w-3 h-3" />}      label="Operator"      value={operatorId}   mono                                                        />}
            {detectedAt   && <DetailField icon={<Clock className="w-3 h-3" />}     label="Detected"      value={fmtDate(detectedAt)}                                                      />}
            {violationType&& <DetailField icon={<Info className="w-3 h-3" />}      label="Type"          value={violationType.replace(/_/g, " ")}                                        />}
          </div>

          {/* Severity description */}
          {(() => {
            const k = (severity ?? "") as ViolationSeverityKey;
            const m = k in VIOLATION_SEVERITY_MAP ? VIOLATION_SEVERITY_MAP[k] : null;
            if (!m) return null;
            return (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-blue-500" />
                <span>{m.description}</span>
              </div>
            );
          })()}

          {/* Linked chain IDs */}
          {auditChainIds.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Linked Audit Chain IDs</p>
              <div className="space-y-1">
                {auditChainIds.map(id => (
                  <div key={id} className="flex items-center gap-2 text-xs font-mono bg-muted rounded px-2 py-1">
                    <Hash className="w-3 h-3 text-muted-foreground" />
                    <span className="flex-1 truncate">{id}</span>
                    <button
                      type="button"
                      onClick={() => copy(id, `chain-${id}`)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy chain ID"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked execution IDs */}
          {executionIds.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Linked Execution Records</p>
              <div className="space-y-1">
                {executionIds.map(id => (
                  <div key={id} className="flex items-center gap-2 text-xs font-mono bg-muted rounded px-2 py-1">
                    <Hash className="w-3 h-3 text-muted-foreground" />
                    <span className="flex-1 truncate">{id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence references */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Evidence References
              {evidenceRefs.length > 0 && <span className="ml-1 text-muted-foreground">({evidenceRefs.length})</span>}
            </p>
            <GovernanceEvidenceReferenceList
              references={evidenceRefs.map(r => ({
                type:        typeof r.type         === "string" ? r.type        : undefined,
                referenceId: typeof r.referenceId  === "string" ? r.referenceId : typeof r.id === "string" ? r.id : undefined,
                source:      typeof r.source       === "string" ? r.source      : undefined,
                layer:       typeof r.layer        === "string" ? r.layer       : undefined,
                description: typeof r.description  === "string" ? r.description : undefined,
              }))}
              data-testid={`evidence-refs-${index}`}
            />
          </div>

          {/* Forensic context */}
          {entityId && (
            <div className="border border-dashed rounded-md p-3 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Search className="w-3 h-3 text-blue-500" />
                Forensic Context
                <Badge className="ml-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0">Read-Only</Badge>
              </p>
              <p className="text-xs text-muted-foreground">{FORENSIC_CONTEXT_GUIDANCE.description}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground">{entityId}</code>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => copy(entityId, `entity-${violationId}`)}
                  title="Copy entity ID"
                >
                  <Copy className="w-3 h-3" />
                  {copied === `entity-${violationId}` ? "Copied!" : FORENSIC_CONTEXT_GUIDANCE.copyText}
                </button>
                <Link
                  href="/super-admin/governance/audit-integrity"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {FORENSIC_CONTEXT_GUIDANCE.linkText}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail field sub-component ────────────────────────────────────────────

function DetailField({
  icon, label, value, mono, copyId, onCopy, copied,
}: {
  icon:     React.ReactNode;
  label:    string;
  value:    string;
  mono?:    boolean;
  copyId?:  string;
  onCopy?:  (text: string, id: string) => void;
  copied?:  string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="font-medium w-24 shrink-0">{label}:</span>
      <span className={`flex-1 truncate text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
      {copyId && onCopy && (
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onCopy(value, copyId)}
          title={`Copy ${label}`}
        >
          <Copy className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Policy row ────────────────────────────────────────────────────────────

function PolicyRow({ policy, violationCounts }: { policy: Record<string, unknown>; violationCounts: Map<string, number> }) {
  const policyId    = typeof policy.policyId === "string" ? policy.policyId : (typeof policy.id === "string" ? policy.id : "-");
  const name        = typeof policy.name     === "string" ? policy.name     : typeof policy.policyName === "string" ? policy.policyName : "-";
  const severity    = typeof policy.defaultSeverity === "string" ? policy.defaultSeverity : typeof policy.severity === "string" ? policy.severity : undefined;
  const enabled     = policy.enabled !== false && policy.active !== false;
  const lastDet     = typeof policy.lastDetectedAt === "string" ? policy.lastDetectedAt : undefined;
  const count       = violationCounts.get(policyId) ?? 0;
  const description = typeof policy.description === "string" ? policy.description : undefined;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted transition-colors text-xs border-b border-border last:border-0">
      <span className={`${POLICY_REGISTRY_COLUMNS[0].width} shrink-0 font-mono text-muted-foreground truncate`}>
        {policyId}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate" title={description}>{name}</p>
        {description && <p className="text-muted-foreground truncate mt-0.5">{description}</p>}
      </div>
      <span className={`${POLICY_REGISTRY_COLUMNS[2].width} shrink-0`}>
        <SeverityBadge severity={severity} />
      </span>
      <span className={`${POLICY_REGISTRY_COLUMNS[3].width} shrink-0`}>
        <Badge
          variant={enabled ? "default" : "secondary"}
          className={`text-xs ${enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0" : ""}`}
        >
          {enabled ? "Active" : "Inactive"}
        </Badge>
      </span>
      <span className={`${POLICY_REGISTRY_COLUMNS[4].width} shrink-0 text-right`}>
        {count > 0
          ? <span className="font-bold text-red-600">{count}</span>
          : <span className="text-muted-foreground">0</span>
        }
      </span>
      <span className={`${POLICY_REGISTRY_COLUMNS[5].width} shrink-0 text-muted-foreground font-mono hidden lg:block`}>
        {fmtDate(lastDet)}
      </span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceViolations() {
  const [workspaceIdInput, setWorkspaceIdInput] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const violations = useGovernanceViolations(activeWorkspaceId);
  const policies   = useGovernancePolicies();

  const violationList: Record<string, unknown>[] = ((violations.data as any)?.violations ?? []) as Record<string, unknown>[];
  const summary: Record<string, unknown>         = ((violations.data as any)?.summary ?? {}) as Record<string, unknown>;
  const policyList: Record<string, unknown>[]    = ((policies.data as any)?.policies ?? []) as Record<string, unknown>[];

  // Violation counts per policy (for the registry table)
  const violationCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of violationList) {
      const pid = typeof v.policyId === "string" ? v.policyId : null;
      if (pid) m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [violationList]);

  // Sort violations: highest severity first, then by detectedAt desc
  const sortedViolations = useMemo(() => {
    return [...violationList].sort((a, b) => {
      const aOrder = VIOLATION_SEVERITY_MAP[(a.severity ?? "") as ViolationSeverityKey]?.order ?? -1;
      const bOrder = VIOLATION_SEVERITY_MAP[(b.severity ?? "") as ViolationSeverityKey]?.order ?? -1;
      if (bOrder !== aOrder) return bOrder - aOrder; // highest first
      const aDate = typeof a.detectedAt === "string" ? new Date(a.detectedAt).getTime() : 0;
      const bDate = typeof b.detectedAt === "string" ? new Date(b.detectedAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [violationList]);

  // Client-side filters
  const filteredViolations = useMemo(() => {
    return sortedViolations.filter(v => {
      if (severityFilter && v.severity !== severityFilter) return false;
      if (typeFilter     && v.violationType !== typeFilter) return false;
      return true;
    });
  }, [sortedViolations, severityFilter, typeFilter]);

  const hasActiveFilters = !!(severityFilter || typeFilter || activeWorkspaceId);
  const activeFilterCount = [severityFilter, typeFilter, activeWorkspaceId].filter(Boolean).length;

  function applyWorkspaceFilter() {
    const trimmed = workspaceIdInput.trim();
    setActiveWorkspaceId(trimmed || undefined);
  }

  function clearAllFilters() {
    setSeverityFilter("");
    setTypeFilter("");
    setWorkspaceIdInput("");
    setActiveWorkspaceId(undefined);
  }

  // Severity summary counts from the live violation list
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of violationList) {
      const s = typeof v.severity === "string" ? v.severity : "unknown";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [violationList]);

  // Overall risk level background
  const riskLevel = typeof summary?.overallRiskLevel === "string" ? summary.overallRiskLevel : null;
  const riskBannerClass: Record<string, string> = {
    critical: "border-red-400 bg-red-50 dark:bg-red-950/20",
    high:     "border-orange-400 bg-orange-50 dark:bg-orange-950/20",
    medium:   "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
    low:      "border-blue-200 bg-blue-50 dark:bg-blue-950/20",
    none:     "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20",
  };

  return (
    <div className="space-y-6" data-testid="governance-violations-page">

      <GovernanceSectionHeader
        icon={AlertTriangle}
        title="Policy Violations"
        description="8-policy governance evaluation - detects deviations from audit completeness, execution integrity, retention compliance, and forensic coverage standards."
      />

      <GovernanceReadOnlyNotice />

      {violations.isError && (
        <GovernanceErrorState message="Could not load policy violation data from the governance API." />
      )}

      {/* ── Risk banner ── */}
      {!violations.isLoading && (
        <Card className={`border-2 ${riskBannerClass[riskLevel ?? "none"] ?? ""}`}>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                {riskLevel && riskLevel !== "none"
                  ? <AlertTriangle className="w-5 h-5 text-muted-foreground" />
                  : <ShieldCheck className="w-5 h-5 text-emerald-500" />
                }
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overall Risk Level</p>
                  <p className="text-lg font-bold capitalize">
                    {riskLevel ?? (violationList.length === 0 ? "None" : "Unknown")}
                  </p>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap gap-4 text-right text-sm">
                {VIOLATION_SEVERITY_ORDER_DESC.map(sev => {
                  const count = (summary as any)?.[`${sev}Count`] ?? severityCounts[sev] ?? 0;
                  if (count === 0 && sev === "informational") return null;
                  return (
                    <div key={sev}>
                      <p className="text-xs text-muted-foreground capitalize">{sev}</p>
                      <p className={`font-bold ${count > 0 ? (
                        sev === "critical" ? "text-red-600" :
                        sev === "high"     ? "text-orange-600" :
                        sev === "medium"   ? "text-amber-600" :
                        sev === "low"      ? "text-blue-600" : "text-slate-500"
                      ) : "text-muted-foreground"}`}>
                        {count}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {violations.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}

      {/* ── Severity summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {VIOLATION_SEVERITY_ORDER_DESC.map(sev => {
          const info  = VIOLATION_SEVERITY_MAP[sev];
          const count = severityCounts[sev] ?? 0;
          const colors: Record<string, string> = {
            critical:      "text-red-600",
            high:          "text-orange-600",
            medium:        "text-amber-600",
            low:           "text-blue-600",
            informational: "text-slate-500",
          };
          return (
            <Card key={sev} className={`cursor-pointer transition-colors hover:bg-muted/50 ${severityFilter === sev ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSeverityFilter(f => f === sev ? "" : sev)}
            >
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-medium text-muted-foreground">{info.label}</p>
                {violations.isLoading
                  ? <Skeleton className="h-6 w-8 mt-1" />
                  : <p className={`text-xl font-bold mt-1 ${colors[sev]}`}>{count}</p>
                }
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Click a card to filter by severity.</p>

      {/* ── Active violations list ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Active Violations
            <Badge variant="outline" className="ml-auto text-xs">
              {violations.isLoading ? "..." : `${filteredViolations.length} / ${violationList.length}`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium">Filter:</span>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-7 text-xs w-[160px]" data-testid="filter-severity">
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent>
                {VIOLATION_SEVERITY_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[200px]" data-testid="filter-violation-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                {VIOLATION_TYPE_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Workspace filter */}
            <div className="flex items-center gap-1">
              <Input
                value={workspaceIdInput}
                onChange={e => setWorkspaceIdInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") applyWorkspaceFilter(); }}
                placeholder="Workspace ID..."
                className="h-7 text-xs w-[160px] font-mono"
                data-testid="filter-workspace-id"
              />
              <Button
                variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={applyWorkspaceFilter}
                disabled={!workspaceIdInput.trim() && !activeWorkspaceId}
              >
                <Search className="w-3 h-3" />
              </Button>
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={clearAllFilters}
                data-testid="clear-violation-filters"
              >
                Clear ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Workspace filter indicator */}
          {activeWorkspaceId && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
              <Search className="w-3 h-3" />
              Scoped to workspace: <code className="font-mono">{activeWorkspaceId}</code>
            </div>
          )}

          {/* List */}
          {violations.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          )}

          {!violations.isLoading && filteredViolations.length === 0 && (
            <div className="text-center py-10 text-muted-foreground" data-testid="violations-empty">
              <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-emerald-500 opacity-60" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {hasActiveFilters
                  ? VIOLATIONS_EMPTY_STATE.noFilterMatch.title
                  : VIOLATIONS_EMPTY_STATE.noViolations.title}
              </p>
              <p className="text-xs mt-1">
                {hasActiveFilters
                  ? VIOLATIONS_EMPTY_STATE.noFilterMatch.description
                  : VIOLATIONS_EMPTY_STATE.noViolations.description}
              </p>
              {hasActiveFilters && (
                <button
                  className="text-xs mt-2 underline text-muted-foreground hover:text-foreground transition-colors"
                  onClick={clearAllFilters}
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {!violations.isLoading && filteredViolations.length > 0 && (
            <div>
              {filteredViolations.map((v, i) => (
                <ViolationRow key={(v.violationId as string) ?? `v-${i}`} violation={v} index={i} />
              ))}
            </div>
          )}

        </CardContent>
      </Card>

      <Separator />

      {/* ── Policy registry ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Governance Policy Registry
            <Badge variant="outline" className="ml-auto text-xs">
              {policies.isLoading ? "..." : `${policyList.length} policies`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {policies.isError && (
            <GovernanceErrorState message="Could not load governance policy registry." />
          )}

          {policies.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
            </div>
          )}

          {!policies.isLoading && policyList.length === 0 && !policies.isError && (
            <div className="text-center py-8 text-muted-foreground" data-testid="policy-registry-empty">
              <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-20" />
              <p className="text-sm">{VIOLATIONS_EMPTY_STATE.policyRegistryEmpty.title}</p>
              <p className="text-xs mt-1">{VIOLATIONS_EMPTY_STATE.policyRegistryEmpty.description}</p>
            </div>
          )}

          {!policies.isLoading && policyList.length > 0 && (
            <div>
              {/* Column headers */}
              <div className="flex items-center gap-3 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b mb-1">
                <span className="w-28 shrink-0">Policy ID</span>
                <span className="flex-1">Name</span>
                <span className="w-28 shrink-0">Severity</span>
                <span className="w-20 shrink-0">Status</span>
                <span className="w-24 shrink-0 text-right">Violations</span>
                <span className="w-36 shrink-0 hidden lg:block">Last Detected</span>
              </div>
              {policyList
                .slice()
                .sort((a, b) => {
                  const aOrder = VIOLATION_SEVERITY_MAP[(a.defaultSeverity ?? a.severity ?? "") as ViolationSeverityKey]?.order ?? -1;
                  const bOrder = VIOLATION_SEVERITY_MAP[(b.defaultSeverity ?? b.severity ?? "") as ViolationSeverityKey]?.order ?? -1;
                  return bOrder - aOrder;
                })
                .map((p, i) => (
                  <PolicyRow key={(p.policyId as string) ?? `policy-${i}`} policy={p} violationCounts={violationCounts} />
                ))
              }
            </div>
          )}
        </CardContent>
      </Card>

      {/* Read-only annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        Governance console - read-only review · {VIOLATIONS_UI_SAFETY_CONTRACT.noViolationCreation && "No create"} · {VIOLATIONS_UI_SAFETY_CONTRACT.noViolationDismissal && "No dismiss"} · {VIOLATIONS_UI_SAFETY_CONTRACT.noLegalConclusions && "No legal conclusions"}
      </p>

    </div>
  );
}
