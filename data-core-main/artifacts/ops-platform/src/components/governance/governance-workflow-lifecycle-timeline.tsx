/**
 * @file   components/governance/governance-workflow-lifecycle-timeline.tsx
 * @phase  P12-D - Governance Workflows UI & Human Review Lifecycle Foundations
 *
 * Read-only lifecycle timeline for a single governance workflow.
 *
 * SAFETY CONTRACT:
 *   - Displays lifecycle events only - no acknowledge, escalate, or resolve actions.
 *   - Never creates or modifies any workflow state.
 *   - Accessible to super_admin only (enforced at route level).
 */

import { Clock, CheckCircle2, ArrowUp, Archive, Play, Eye, Search } from "lucide-react";
import { WORKFLOW_LIFECYCLE_EVENT_ORDER, type WorkflowLifecycleEventKey } from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowLifecycleEvent {
  key:           WorkflowLifecycleEventKey;
  label:         string;
  timestamp?:    string;
  actorId?:      string;
  note?:         string;
  evidenceRef?:  string;
}

interface GovernanceWorkflowLifecycleTimelineProps {
  events:          WorkflowLifecycleEvent[];
  compact?:        boolean;
  "data-testid"?:  string;
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

// ── Icon per lifecycle key ────────────────────────────────────────────────

function LifecycleIcon({ eventKey }: { eventKey: WorkflowLifecycleEventKey }) {
  const cls = "w-3.5 h-3.5 shrink-0";
  if (eventKey === "createdAt")               return <Play className={`${cls} text-blue-500`} />;
  if (eventKey === "acknowledgedAt")          return <Eye className={`${cls} text-sky-500`} />;
  if (eventKey === "investigationStartedAt")  return <Search className={`${cls} text-violet-500`} />;
  if (eventKey === "escalatedAt")             return <ArrowUp className={`${cls} text-orange-500`} />;
  if (eventKey === "resolvedAt")              return <CheckCircle2 className={`${cls} text-emerald-500`} />;
  if (eventKey === "closedAt")               return <Archive className={`${cls} text-zinc-500`} />;
  return <Clock className={`${cls} text-muted-foreground`} />;
}

// ── Dot colour per lifecycle key ──────────────────────────────────────────

function dotClass(eventKey: WorkflowLifecycleEventKey, hasTimestamp: boolean): string {
  if (!hasTimestamp) return "bg-muted border-border";
  if (eventKey === "createdAt")               return "bg-blue-500 border-blue-300";
  if (eventKey === "acknowledgedAt")          return "bg-sky-500 border-sky-300";
  if (eventKey === "investigationStartedAt")  return "bg-violet-500 border-violet-300";
  if (eventKey === "escalatedAt")             return "bg-orange-500 border-orange-300";
  if (eventKey === "resolvedAt")              return "bg-emerald-500 border-emerald-300";
  if (eventKey === "closedAt")               return "bg-zinc-400 border-zinc-300";
  return "bg-primary border-primary/30";
}

// ── Single lifecycle event node ───────────────────────────────────────────

function LifecycleNode({
  event,
  isLast,
  compact,
}: {
  event:   WorkflowLifecycleEvent;
  isLast:  boolean;
  compact: boolean;
}) {
  const hasTs = !!event.timestamp;

  return (
    <div className="flex gap-3">
      {/* Spine */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full border-2 mt-0.5 shrink-0 ${dotClass(event.key, hasTs)}`} />
        {!isLast && <div className={`w-px flex-1 mt-1 ${hasTs ? "bg-border" : "bg-border/30"}`} style={{ minHeight: compact ? "12px" : "20px" }} />}
      </div>

      {/* Content */}
      <div className={`pb-${compact ? "2" : "4"} min-w-0 flex-1`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <LifecycleIcon eventKey={event.key} />
          <span className={`text-xs font-medium ${hasTs ? "text-foreground" : "text-muted-foreground/50"}`}>
            {event.label}
          </span>
          {hasTs && (
            <span className="text-xs text-muted-foreground font-mono ml-auto">
              {fmtDate(event.timestamp)}
            </span>
          )}
          {!hasTs && (
            <span className="text-xs text-muted-foreground/40 ml-auto italic">not recorded</span>
          )}
        </div>

        {!compact && hasTs && (
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground pl-5">
            {event.actorId && (
              <div>
                <span className="font-medium">Operator: </span>
                <span className="font-mono">{event.actorId}</span>
              </div>
            )}
            {event.note && (
              <div>
                <span className="font-medium">Note: </span>
                <span>{event.note}</span>
              </div>
            )}
            {event.evidenceRef && (
              <div>
                <span className="font-medium">Evidence: </span>
                <span className="font-mono">{event.evidenceRef}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceWorkflowLifecycleTimeline({
  events,
  compact = false,
  "data-testid": testId = "workflow-lifecycle-timeline",
}: GovernanceWorkflowLifecycleTimelineProps) {
  // Chronological order is fixed by WORKFLOW_LIFECYCLE_EVENT_ORDER index
  const ordered = [...events].sort(
    (a, b) =>
      WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf(a.key) -
      WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf(b.key)
  );

  const recorded = ordered.filter(e => !!e.timestamp);

  if (recorded.length === 0 && !compact) {
    return (
      <div className="text-center py-5 text-muted-foreground" data-testid={`${testId}-empty`}>
        <Clock className="w-5 h-5 mx-auto mb-2 opacity-20" />
        <p className="text-xs">No lifecycle events recorded for this workflow.</p>
      </div>
    );
  }

  // In compact mode show only recorded events; in full mode show all slots
  const displayEvents = compact ? recorded : ordered;

  return (
    <div data-testid={testId} className="pt-1">
      {displayEvents.map((event, i) => (
        <LifecycleNode
          key={event.key}
          event={event}
          isLast={i === displayEvents.length - 1}
          compact={compact}
        />
      ))}
      {!compact && (
        <p className="text-xs text-muted-foreground text-right mt-1">
          {recorded.length} / {ordered.length} lifecycle events recorded - read-only
        </p>
      )}
    </div>
  );
}

// ── Utility: build lifecycle events from a raw workflow object ─────────────

export function buildLifecycleEvents(
  workflow: Record<string, unknown>
): WorkflowLifecycleEvent[] {
  const events: WorkflowLifecycleEvent[] = [
    {
      key:       "createdAt",
      label:     "Workflow Initiated",
      timestamp: typeof workflow.createdAt === "string" ? workflow.createdAt : undefined,
      actorId:   typeof workflow.initiatedBy === "string" ? workflow.initiatedBy : undefined,
    },
    {
      key:       "acknowledgedAt",
      label:     "Acknowledged",
      timestamp: typeof workflow.acknowledgedAt === "string" ? workflow.acknowledgedAt : undefined,
      actorId:   typeof workflow.assignedOperatorId === "string" ? workflow.assignedOperatorId : undefined,
    },
    {
      key:       "investigationStartedAt",
      label:     "Investigation Started",
      timestamp: typeof workflow.investigationStartedAt === "string" ? workflow.investigationStartedAt : undefined,
      actorId:   typeof workflow.assignedOperatorId === "string" ? workflow.assignedOperatorId : undefined,
    },
    {
      key:       "escalatedAt",
      label:     "Escalated",
      timestamp: typeof workflow.escalatedAt === "string" ? workflow.escalatedAt : undefined,
      actorId:   typeof workflow.escalatedBy === "string" ? workflow.escalatedBy : undefined,
      note:      typeof workflow.escalationReason === "string" ? workflow.escalationReason : undefined,
    },
    {
      key:       "resolvedAt",
      label:     "Resolved",
      timestamp: typeof workflow.resolvedAt === "string" ? workflow.resolvedAt : undefined,
      actorId:   typeof workflow.resolvedBy === "string" ? workflow.resolvedBy : undefined,
      note:      typeof workflow.resolutionNotes === "string" ? workflow.resolutionNotes : undefined,
    },
    {
      key:       "closedAt",
      label:     "Closed",
      timestamp: typeof workflow.closedAt === "string" ? workflow.closedAt : undefined,
    },
    {
      key:       "updatedAt",
      label:     "Last Updated",
      timestamp: typeof workflow.updatedAt === "string" ? workflow.updatedAt : undefined,
    },
  ];

  // Deduplicate updatedAt if it equals createdAt (nothing happened since creation)
  const created = events.find(e => e.key === "createdAt")?.timestamp;
  const updated = events.find(e => e.key === "updatedAt");
  if (updated && updated.timestamp && updated.timestamp === created) {
    updated.timestamp = undefined;
  }

  return events;
}
