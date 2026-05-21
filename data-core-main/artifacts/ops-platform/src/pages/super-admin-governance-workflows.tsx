/**
 * @file   pages/super-admin-governance-workflows.tsx
 * @phase  P12-D - Governance Workflows UI & Human Review Lifecycle Foundations
 *
 * Governance Workflows section - full read-only lifecycle review experience.
 * No acknowledge / escalate / resolve / create / dismiss controls.
 *
 * Sections:
 *   1. Lifecycle overview banner (active count + escalated warning)
 *   2. Status summary cards (canonical 5 statuses, clickable filter)
 *   3. Escalation level summary cards
 *   4. Workflow list (5-axis filters, expandable rows)
 */

import { useState, useMemo } from "react";
import {
  GitBranch, Clock, CheckCircle2, AlertTriangle,
  Filter, Search, ChevronDown, ChevronUp,
  Copy, Info, User, Tag, Hash, BookOpen, ArrowUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useGovernanceWorkflows } from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice }  from "@/components/governance/governance-read-only-notice";
import { GovernanceSectionHeader }   from "@/components/governance/governance-section-header";
import { GovernanceErrorState }      from "@/components/governance/governance-error-state";
import { GovernanceEvidenceReferenceList } from "@/components/governance/governance-evidence-reference-list";
import {
  GovernanceWorkflowLifecycleTimeline,
  buildLifecycleEvents,
} from "@/components/governance/governance-workflow-lifecycle-timeline";
import {
  WORKFLOW_STATUS_MAP,
  WORKFLOW_STATUS_ORDER,
  ESCALATION_LEVEL_MAP,
  ESCALATION_LEVEL_ORDER,
  RESOLUTION_CLASSIFICATION_MAP,
  WORKFLOW_STATUS_FILTER_OPTIONS,
  ESCALATION_LEVEL_FILTER_OPTIONS,
  RESOLUTION_CLASSIFICATION_FILTER_OPTIONS,
  WORKFLOWS_EMPTY_STATE,
  WORKFLOWS_UI_SAFETY_CONTRACT,
  FORENSIC_CONTEXT_GUIDANCE,
  type WorkflowStatusKey,
  type EscalationLevelKey,
  type ResolutionClassificationKey,
} from "@/lib/governance-console-config";
import { Link } from "wouter";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, id: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }
  return { copy, copied };
}

// ── Status badge ───────────────────────────────────────────────────────────

function WorkflowStatusBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as WorkflowStatusKey;
  const info = key in WORKFLOW_STATUS_MAP ? WORKFLOW_STATUS_MAP[key] : null;

  if (!info) return <Badge variant="outline" className="text-xs">{status ?? "unknown"}</Badge>;

  const colours: Record<string, string> = {
    active:   "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0",
    elevated: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400 border-0",
    closed:   "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-0",
  };

  return (
    <Badge className={`text-xs ${colours[info.tier] ?? ""}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Escalation badge ───────────────────────────────────────────────────────

function EscalationBadge({ level }: { level?: string }) {
  const key  = (level ?? "") as EscalationLevelKey;
  const info = key in ESCALATION_LEVEL_MAP ? ESCALATION_LEVEL_MAP[key] : null;

  if (!info) return level ? <span className="text-xs text-muted-foreground">{level}</span> : null;

  const colours: Record<string, string> = {
    low:      "text-blue-600 dark:text-blue-400",
    medium:   "text-amber-600 dark:text-amber-400",
    high:     "text-orange-600 dark:text-orange-400",
    critical: "text-red-600 dark:text-red-400",
  };

  return (
    <span className={`text-xs font-medium ${colours[info.tier] ?? "text-muted-foreground"}`}
      title={info.description}>
      {info.label}
    </span>
  );
}

// ── Resolution badge ───────────────────────────────────────────────────────

function ResolutionBadge({ classification }: { classification?: string }) {
  const key  = (classification ?? "") as ResolutionClassificationKey;
  const info = key in RESOLUTION_CLASSIFICATION_MAP ? RESOLUTION_CLASSIFICATION_MAP[key] : null;

  if (!info) return classification ? <Badge variant="outline" className="text-xs">{classification}</Badge> : null;

  const colours: Record<string, string> = {
    finding:   "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
    cleared:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
    exception: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
    gap:       "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400 border-0",
    pending:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0",
  };

  return (
    <Badge className={`text-xs ${colours[info.tier] ?? ""}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Left border colour by status tier ────────────────────────────────────

function statusBorderClass(status?: string): string {
  const key  = (status ?? "") as WorkflowStatusKey;
  const info = key in WORKFLOW_STATUS_MAP ? WORKFLOW_STATUS_MAP[key] : null;
  if (!info) return "border-l-border";
  if (info.tier === "elevated") return "border-l-orange-400 dark:border-l-orange-600";
  if (info.tier === "active")   return "border-l-blue-400 dark:border-l-blue-600";
  return "border-l-zinc-300 dark:border-l-zinc-600";
}

// ── Detail field ──────────────────────────────────────────────────────────

function DetailField({
  icon, label, value, mono, copyId, onCopy, copied,
}: {
  icon:    React.ReactNode;
  label:   string;
  value:   string;
  mono?:   boolean;
  copyId?: string;
  onCopy?: (v: string, id: string) => void;
  copied?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="font-medium w-28 shrink-0">{label}:</span>
      <span className={`flex-1 truncate text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
      {copyId && onCopy && (
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onCopy(value, copyId)}
          title={`Copy ${label}`}
        >
          {copied === copyId ? <span className="text-emerald-600 text-xs">✓</span> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

// ── Workflow row (expandable) ──────────────────────────────────────────────

function WorkflowRow({
  workflow,
  index,
}: {
  workflow: Record<string, unknown>;
  index:    number;
}) {
  const [open, setOpen] = useState(false);
  const { copy, copied } = useCopy();

  const wfId         = typeof workflow.workflowActionId    === "string" ? workflow.workflowActionId    : `wf-${index}`;
  const violationId  = typeof workflow.violationId         === "string" ? workflow.violationId         : undefined;
  const policyId     = typeof workflow.policyId            === "string" ? workflow.policyId            : undefined;
  const workspaceId  = typeof workflow.workspaceId         === "string" ? workflow.workspaceId         : undefined;
  const operatorId   = typeof workflow.assignedOperatorId  === "string" ? workflow.assignedOperatorId  : undefined;
  const initiatedBy  = typeof workflow.initiatedBy         === "string" ? workflow.initiatedBy         : undefined;
  const status       = typeof workflow.workflowStatus      === "string" ? workflow.workflowStatus      : undefined;
  const escalation   = typeof workflow.escalationLevel     === "string" ? workflow.escalationLevel     : undefined;
  const resolution   = typeof workflow.resolutionClassification === "string" ? workflow.resolutionClassification : undefined;
  const createdAt    = typeof workflow.createdAt           === "string" ? workflow.createdAt           : undefined;
  const updatedAt    = typeof workflow.updatedAt           === "string" ? workflow.updatedAt           : undefined;
  const entityId     = typeof workflow.entityId            === "string" ? workflow.entityId            : undefined;

  const evidenceRefs: Record<string, unknown>[] = Array.isArray(workflow.evidenceReferences)
    ? workflow.evidenceReferences as Record<string, unknown>[]
    : [];

  const lifecycleEvents = buildLifecycleEvents(workflow);

  return (
    <div
      className={`border-l-4 ${statusBorderClass(status)} border border-border rounded-md overflow-hidden mb-2`}
      data-testid={`workflow-row-${index}`}
    >
      {/* Collapsed header */}
      <button
        type="button"
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="shrink-0 pt-0.5"><WorkflowStatusBadge status={status} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-foreground truncate">{wfId}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {violationId ?? "-"} · {policyId ?? "-"}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <EscalationBadge level={escalation} />
          {resolution && <ResolutionBadge classification={resolution} />}
          <span className="text-muted-foreground">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t bg-muted/20 px-4 py-4 space-y-5">

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            <DetailField icon={<Hash className="w-3 h-3" />}     label="Workflow ID"   value={wfId}        mono copyId={wfId}        onCopy={copy} copied={copied} />
            {violationId && <DetailField icon={<AlertTriangle className="w-3 h-3" />} label="Violation"    value={violationId} mono copyId={violationId}  onCopy={copy} copied={copied} />}
            {policyId    && <DetailField icon={<BookOpen className="w-3 h-3" />}      label="Policy"       value={policyId}    mono copyId={policyId}     onCopy={copy} copied={copied} />}
            {workspaceId && <DetailField icon={<Tag className="w-3 h-3" />}           label="Workspace"    value={workspaceId} mono copyId={workspaceId}  onCopy={copy} copied={copied} />}
            {operatorId  && <DetailField icon={<User className="w-3 h-3" />}          label="Assigned To"  value={operatorId}  mono />}
            {initiatedBy && <DetailField icon={<User className="w-3 h-3" />}          label="Initiated By" value={initiatedBy} mono />}
            {createdAt   && <DetailField icon={<Clock className="w-3 h-3" />}         label="Created"      value={fmtDate(createdAt)} />}
            {updatedAt   && <DetailField icon={<Clock className="w-3 h-3" />}         label="Last Updated" value={fmtDate(updatedAt)} />}
          </div>

          {/* Status + escalation description */}
          {(() => {
            const sKey = (status ?? "") as WorkflowStatusKey;
            const sInfo = sKey in WORKFLOW_STATUS_MAP ? WORKFLOW_STATUS_MAP[sKey] : null;
            const eKey = (escalation ?? "") as EscalationLevelKey;
            const eInfo = eKey in ESCALATION_LEVEL_MAP ? ESCALATION_LEVEL_MAP[eKey] : null;
            if (!sInfo && !eInfo) return null;
            return (
              <div className="space-y-1">
                {sInfo && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="w-3 h-3 shrink-0 mt-0.5 text-blue-500" />
                    <span><span className="font-medium">Status:</span> {sInfo.description}</span>
                  </div>
                )}
                {eInfo && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <ArrowUp className="w-3 h-3 shrink-0 mt-0.5 text-orange-500" />
                    <span><span className="font-medium">Escalation:</span> {eInfo.description}</span>
                  </div>
                )}
                {resolution && (() => {
                  const rKey = resolution as ResolutionClassificationKey;
                  const rInfo = rKey in RESOLUTION_CLASSIFICATION_MAP ? RESOLUTION_CLASSIFICATION_MAP[rKey] : null;
                  if (!rInfo) return null;
                  return (
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-500" />
                      <span><span className="font-medium">Resolution:</span> {rInfo.description}</span>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          <Separator />

          {/* Lifecycle timeline */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Lifecycle Timeline</p>
            <GovernanceWorkflowLifecycleTimeline
              events={lifecycleEvents}
              data-testid={`workflow-lifecycle-${index}`}
            />
          </div>

          {/* Evidence references */}
          {evidenceRefs.length >= 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Evidence References
                {evidenceRefs.length > 0 && <span className="ml-1">({evidenceRefs.length})</span>}
              </p>
              <GovernanceEvidenceReferenceList
                references={evidenceRefs.map(r => ({
                  type:        typeof r.type         === "string" ? r.type        : undefined,
                  referenceId: typeof r.referenceId  === "string" ? r.referenceId : typeof r.id === "string" ? r.id : undefined,
                  source:      typeof r.source       === "string" ? r.source      : undefined,
                  layer:       typeof r.layer        === "string" ? r.layer       : undefined,
                  description: typeof r.description  === "string" ? r.description : undefined,
                }))}
                data-testid={`workflow-evidence-${index}`}
              />
            </div>
          )}

          {/* Forensic context link if entityId present */}
          {entityId && (
            <div className="border border-dashed rounded-md p-3 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Search className="w-3 h-3 text-blue-500" />
                Forensic Context
                <Badge className="ml-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0">Read-Only</Badge>
              </p>
              <p className="text-xs text-muted-foreground">{FORENSIC_CONTEXT_GUIDANCE.description}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{entityId}</code>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => copy(entityId, `entity-${wfId}`)}
                >
                  <Copy className="w-3 h-3" />
                  {copied === `entity-${wfId}` ? "Copied!" : FORENSIC_CONTEXT_GUIDANCE.copyText}
                </button>
                <Link
                  href="/super-admin/governance/audit-integrity"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors"
                >
                  {FORENSIC_CONTEXT_GUIDANCE.linkText}
                </Link>
              </div>
            </div>
          )}

          {/* Violation context read-only identifiers */}
          {(violationId || policyId) && (
            <div className="border border-dashed rounded-md p-3 space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                Linked Violation Context
                <Badge className="ml-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0">Read-Only</Badge>
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Use the identifiers below to cross-reference on the Policy Violations page.
              </p>
              {violationId && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-20 shrink-0">Violation ID:</span>
                  <code className="font-mono bg-muted px-2 py-0.5 rounded flex-1 truncate">{violationId}</code>
                  <button type="button" onClick={() => copy(violationId, `vid-${wfId}`)} className="text-muted-foreground hover:text-foreground">
                    {copied === `vid-${wfId}` ? <span className="text-emerald-600">✓</span> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {policyId && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-20 shrink-0">Policy ID:</span>
                  <code className="font-mono bg-muted px-2 py-0.5 rounded flex-1 truncate">{policyId}</code>
                  <button type="button" onClick={() => copy(policyId, `pid-${wfId}`)} className="text-muted-foreground hover:text-foreground">
                    {copied === `pid-${wfId}` ? <span className="text-emerald-600">✓</span> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              <Link
                href="/super-admin/governance/violations"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors mt-1"
              >
                View Policy Violations
              </Link>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernanceWorkflows() {
  const [statusFilter,         setStatusFilter]         = useState("");
  const [escalationFilter,     setEscalationFilter]     = useState("");
  const [resolutionFilter,     setResolutionFilter]     = useState("");
  const [operatorInput,        setOperatorInput]        = useState("");
  const [activeOperatorFilter, setActiveOperatorFilter] = useState("");
  const [workspaceInput,       setWorkspaceInput]       = useState("");
  const [activeWorkspaceFilter,setActiveWorkspaceFilter]= useState("");

  // Fetch all workflows (no server-side filter in base call - all client-side except workspace)
  const workflows = useGovernanceWorkflows({ limit: 50 });
  const allList: Record<string, unknown>[] = ((workflows.data as any)?.workflows ?? []) as Record<string, unknown>[];

  // Status counts
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of allList) {
      const s = typeof w.workflowStatus === "string" ? w.workflowStatus : "unknown";
      m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [allList]);

  // Escalation counts
  const escalationCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of allList) {
      const e = typeof w.escalationLevel === "string" ? w.escalationLevel : "unknown";
      m[e] = (m[e] ?? 0) + 1;
    }
    return m;
  }, [allList]);

  // Sort: escalated first, then by createdAt desc
  const sorted = useMemo(() => {
    return [...allList].sort((a, b) => {
      const aEscalated = typeof a.workflowStatus === "string" && a.workflowStatus === "escalated" ? 1 : 0;
      const bEscalated = typeof b.workflowStatus === "string" && b.workflowStatus === "escalated" ? 1 : 0;
      if (bEscalated !== aEscalated) return bEscalated - aEscalated;
      const aDate = typeof a.createdAt === "string" ? new Date(a.createdAt).getTime() : 0;
      const bDate = typeof b.createdAt === "string" ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [allList]);

  // Client-side filters
  const filtered = useMemo(() => {
    return sorted.filter(w => {
      if (statusFilter         && w.workflowStatus          !== statusFilter)     return false;
      if (escalationFilter     && w.escalationLevel         !== escalationFilter) return false;
      if (resolutionFilter     && w.resolutionClassification !== resolutionFilter) return false;
      if (activeOperatorFilter && w.assignedOperatorId      !== activeOperatorFilter) return false;
      if (activeWorkspaceFilter && w.workspaceId            !== activeWorkspaceFilter) return false;
      return true;
    });
  }, [sorted, statusFilter, escalationFilter, resolutionFilter, activeOperatorFilter, activeWorkspaceFilter]);

  const hasActiveFilters = !!(statusFilter || escalationFilter || resolutionFilter || activeOperatorFilter || activeWorkspaceFilter);
  const activeFilterCount = [statusFilter, escalationFilter, resolutionFilter, activeOperatorFilter, activeWorkspaceFilter].filter(Boolean).length;

  function clearAllFilters() {
    setStatusFilter(""); setEscalationFilter(""); setResolutionFilter("");
    setOperatorInput(""); setActiveOperatorFilter("");
    setWorkspaceInput(""); setActiveWorkspaceFilter("");
  }

  const escalatedCount = allList.filter(w => typeof w.workflowStatus === "string" && w.workflowStatus === "escalated").length;
  const activeCount    = allList.filter(w => {
    const s = typeof w.workflowStatus === "string" ? w.workflowStatus : "";
    return s === "initiated" || s === "investigating" || s === "open" || s === "under_review" || s === "acknowledged";
  }).length;

  return (
    <div className="space-y-6" data-testid="governance-workflows-page">

      <GovernanceSectionHeader
        icon={GitBranch}
        title="Governance Workflows"
        description="Human-governed investigation lifecycle for policy violations. Every state transition requires explicit operator attribution - no automatic escalation or resolution."
      />

      <GovernanceReadOnlyNotice />

      {workflows.isError && (
        <GovernanceErrorState message="Could not load governance workflow data from the API." />
      )}

      {/* ── Lifecycle overview banner ── */}
      {!workflows.isLoading && (
        <Card className={escalatedCount > 0 ? "border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20" : "border"}>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <GitBranch className={`w-5 h-5 ${escalatedCount > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workflow Overview</p>
                  <p className="text-lg font-bold">
                    {allList.length} total · {activeCount} active
                    {escalatedCount > 0 && <span className="text-orange-600 ml-2">· {escalatedCount} escalated</span>}
                  </p>
                </div>
              </div>
              <div className="ml-auto flex gap-4 text-right text-sm">
                {WORKFLOW_STATUS_ORDER.map(s => {
                  const count = statusCounts[s] ?? 0;
                  const info = WORKFLOW_STATUS_MAP[s];
                  return (
                    <div key={s}>
                      <p className="text-xs text-muted-foreground">{info.label}</p>
                      <p className={`font-bold ${count > 0 && info.tier === "elevated" ? "text-orange-600" : count > 0 ? "text-primary" : "text-muted-foreground"}`}>
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
      {workflows.isLoading && <Skeleton className="h-20 w-full rounded-lg" />}

      {/* ── Status summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {WORKFLOW_STATUS_ORDER.map(s => {
          const info  = WORKFLOW_STATUS_MAP[s];
          const count = statusCounts[s] ?? 0;
          const activeClass = statusFilter === s ? "ring-2 ring-primary" : "";
          return (
            <Card
              key={s}
              className={`cursor-pointer hover:bg-muted/50 transition-colors ${activeClass}`}
              onClick={() => setStatusFilter(f => f === s ? "" : s)}
            >
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-medium text-muted-foreground">{info.label}</p>
                {workflows.isLoading
                  ? <Skeleton className="h-6 w-8 mt-1" />
                  : <p className={`text-xl font-bold mt-1 ${info.tier === "elevated" ? "text-orange-600" : info.tier === "active" ? "text-blue-600" : "text-muted-foreground"}`}>
                      {count}
                    </p>
                }
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Click a card to filter by status.</p>

      {/* ── Escalation level summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ESCALATION_LEVEL_ORDER.map(e => {
          const info  = ESCALATION_LEVEL_MAP[e];
          const count = escalationCounts[e] ?? 0;
          const colors: Record<string, string> = {
            low:      "text-blue-600",
            medium:   "text-amber-600",
            high:     "text-orange-600",
            critical: "text-red-600",
          };
          const activeClass = escalationFilter === e ? "ring-2 ring-primary" : "";
          return (
            <Card
              key={e}
              className={`cursor-pointer hover:bg-muted/50 transition-colors ${activeClass}`}
              onClick={() => setEscalationFilter(f => f === e ? "" : e)}
            >
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-medium text-muted-foreground">{info.label}</p>
                {workflows.isLoading
                  ? <Skeleton className="h-6 w-8 mt-1" />
                  : <p className={`text-xl font-bold mt-1 ${colors[info.tier] ?? "text-muted-foreground"}`}>{count}</p>
                }
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Click a card to filter by escalation level.</p>

      {/* ── Workflow list ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Governance Workflows
            <Badge variant="outline" className="ml-auto text-xs">
              {workflows.isLoading ? "..." : `${filtered.length} / ${allList.length}`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium">Filter:</span>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 text-xs w-[160px]" data-testid="filter-workflow-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_STATUS_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={escalationFilter} onValueChange={setEscalationFilter}>
              <SelectTrigger className="h-7 text-xs w-[170px]" data-testid="filter-escalation-level">
                <SelectValue placeholder="All Levels" />
              </SelectTrigger>
              <SelectContent>
                {ESCALATION_LEVEL_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resolutionFilter} onValueChange={setResolutionFilter}>
              <SelectTrigger className="h-7 text-xs w-[200px]" data-testid="filter-resolution">
                <SelectValue placeholder="All Classifications" />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_CLASSIFICATION_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value || "__all__"} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Operator filter */}
            <div className="flex items-center gap-1">
              <Input
                value={operatorInput}
                onChange={e => setOperatorInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setActiveOperatorFilter(operatorInput.trim() || ""); } }}
                placeholder="Operator ID..."
                className="h-7 text-xs w-[140px] font-mono"
                data-testid="filter-operator-id"
              />
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={() => setActiveOperatorFilter(operatorInput.trim())}
                disabled={!operatorInput.trim() && !activeOperatorFilter}
              >
                <User className="w-3 h-3" />
              </Button>
            </div>

            {/* Workspace filter */}
            <div className="flex items-center gap-1">
              <Input
                value={workspaceInput}
                onChange={e => setWorkspaceInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setActiveWorkspaceFilter(workspaceInput.trim() || ""); } }}
                placeholder="Workspace ID..."
                className="h-7 text-xs w-[140px] font-mono"
                data-testid="filter-workflow-workspace"
              />
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={() => setActiveWorkspaceFilter(workspaceInput.trim())}
                disabled={!workspaceInput.trim() && !activeWorkspaceFilter}
              >
                <Search className="w-3 h-3" />
              </Button>
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={clearAllFilters}
                data-testid="clear-workflow-filters"
              >
                Clear ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Active filter indicators */}
          {(activeOperatorFilter || activeWorkspaceFilter) && (
            <div className="flex flex-wrap gap-3 text-xs text-blue-600 dark:text-blue-400">
              {activeOperatorFilter && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" /> Operator: <code className="font-mono">{activeOperatorFilter}</code>
                </span>
              )}
              {activeWorkspaceFilter && (
                <span className="flex items-center gap-1">
                  <Search className="w-3 h-3" /> Workspace: <code className="font-mono">{activeWorkspaceFilter}</code>
                </span>
              )}
            </div>
          )}

          {/* List */}
          {workflows.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          )}

          {!workflows.isLoading && filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground" data-testid="workflows-empty">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500 opacity-60" />
              <p className="text-sm font-medium">
                {hasActiveFilters
                  ? WORKFLOWS_EMPTY_STATE.noFilterMatch.title
                  : WORKFLOWS_EMPTY_STATE.noWorkflows.title}
              </p>
              <p className="text-xs mt-1">
                {hasActiveFilters
                  ? WORKFLOWS_EMPTY_STATE.noFilterMatch.description
                  : WORKFLOWS_EMPTY_STATE.noWorkflows.description}
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

          {!workflows.isLoading && filtered.length > 0 && (
            <div>
              {filtered.map((w, i) => (
                <WorkflowRow
                  key={(w.workflowActionId as string) ?? `wf-${i}`}
                  workflow={w}
                  index={i}
                />
              ))}
            </div>
          )}

        </CardContent>
      </Card>

      {/* Read-only annotation */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        Governance console - read-only lifecycle review
        · {WORKFLOWS_UI_SAFETY_CONTRACT.noAcknowledgeButton && "No acknowledge"}
        · {WORKFLOWS_UI_SAFETY_CONTRACT.noEscalateButton    && "No escalate"}
        · {WORKFLOWS_UI_SAFETY_CONTRACT.noResolveButton     && "No resolve"}
        · {WORKFLOWS_UI_SAFETY_CONTRACT.noLegalConclusions  && "No legal conclusions"}
      </p>

    </div>
  );
}
