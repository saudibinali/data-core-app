/**
 * @file   components/governance/governance-forensic-timeline.tsx
 * @phase  P12-B - Audit Integrity UI & Forensic Timeline Review Foundations
 *
 * Read-only forensic event timeline component.
 *
 * SAFETY CONTRACT:
 *   - Displays events only - no mutation, repair, delete, or export actions.
 *   - Never hides compromised/orphaned events.
 *   - Never makes legal compliance conclusions.
 *   - Accessible to super_admin only (enforced at route level).
 */

import { ShieldCheck, ShieldAlert, ShieldX, Clock, User, Tag, Hash, AlertTriangle, Unlink, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  INTEGRITY_STATUS_MAP,
  RETENTION_CLASSIFICATION_MAP,
  type IntegrityStatusKey,
  type RetentionClassificationKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ForensicEvent {
  id?:                    string;
  eventType?:             string;
  entityType?:            string;
  entityId?:              string;
  operatorId?:            string;
  occurredAt?:            string;
  recordedAt?:            string;
  integrityStatus?:       string;
  retentionClassification?: string;
  hashPreview?:           string;
  evidenceRef?:           string;
  chainId?:               string;
  parentChainId?:         string;
}

export interface GovernanceForensicTimelineProps {
  events:     ForensicEvent[];
  isLoading?: boolean;
  isError?:   boolean;
  errorMessage?: string;
  "data-testid"?: string;
}

// ── Integrity status badge ─────────────────────────────────────────────────

function IntegrityStatusBadge({ status }: { status?: string }) {
  const key = status as IntegrityStatusKey | undefined;
  const info = key && key in INTEGRITY_STATUS_MAP ? INTEGRITY_STATUS_MAP[key] : null;

  if (!info) {
    return (
      <Badge variant="outline" className="text-xs gap-1">
        <ShieldAlert className="w-3 h-3" />
        Unknown
      </Badge>
    );
  }

  if (info.tier === "healthy") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0 text-xs gap-1">
        <ShieldCheck className="w-3 h-3" />
        {info.label}
      </Badge>
    );
  }

  if (info.tier === "critical") {
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0 text-xs gap-1">
        <ShieldX className="w-3 h-3" />
        {info.label}
      </Badge>
    );
  }

  return (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0 text-xs gap-1">
      <FileWarning className="w-3 h-3" />
      {info.label}
    </Badge>
  );
}

// ── Retention classification badge ────────────────────────────────────────

function RetentionBadge({ classification }: { classification?: string }) {
  const key = classification as RetentionClassificationKey | undefined;
  const info = key && key in RETENTION_CLASSIFICATION_MAP ? RETENTION_CLASSIFICATION_MAP[key] : null;

  if (!info) {
    return <Badge variant="outline" className="text-xs">{classification ?? "-"}</Badge>;
  }

  if (key === "forensic_critical") {
    return (
      <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400 border-0 text-xs" title={info.helper}>
        {info.label}
      </Badge>
    );
  }
  if (key === "compliance_sensitive") {
    return (
      <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400 border-0 text-xs" title={info.helper}>
        {info.label}
      </Badge>
    );
  }
  if (key === "governance") {
    return (
      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0 text-xs" title={info.helper}>
        {info.label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs" title={info.helper}>
      {info.label}
    </Badge>
  );
}

// ── Integrity tier left-border color ──────────────────────────────────────

function tierBorderClass(status?: string): string {
  const key = status as IntegrityStatusKey | undefined;
  const info = key && key in INTEGRITY_STATUS_MAP ? INTEGRITY_STATUS_MAP[key] : null;
  if (!info) return "border-l-border";
  if (info.tier === "healthy")   return "border-l-emerald-400 dark:border-l-emerald-600";
  if (info.tier === "critical")  return "border-l-red-400 dark:border-l-red-600";
  return "border-l-amber-400 dark:border-l-amber-600";
}

// ── Date formatter ────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ── Single event card ─────────────────────────────────────────────────────

function ForensicEventCard({ event, index }: { event: ForensicEvent; index: number }) {
  const key        = (event.integrityStatus ?? "") as IntegrityStatusKey;
  const statusInfo = key in INTEGRITY_STATUS_MAP ? INTEGRITY_STATUS_MAP[key as IntegrityStatusKey] : null;

  return (
    <div
      className={`border-l-4 pl-4 py-3 space-y-2 ${tierBorderClass(event.integrityStatus)}`}
      data-testid={`forensic-event-${index}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-xs font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
          {event.eventType ?? "unknown_event"}
        </span>
        <IntegrityStatusBadge status={event.integrityStatus} />
        <RetentionBadge classification={event.retentionClassification} />
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          #{String(index + 1).padStart(3, "0")}
        </span>
      </div>

      {/* Integrity description if not healthy */}
      {statusInfo && statusInfo.tier !== "healthy" && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
          <span>{statusInfo.description}</span>
        </div>
      )}

      {/* Entity row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {event.entityType && (
          <span className="flex items-center gap-1">
            <Tag className="w-3 h-3" />
            <span className="font-medium text-foreground">{event.entityType}</span>
          </span>
        )}
        {event.entityId && (
          <span className="flex items-center gap-1 font-mono">
            <span className="text-foreground truncate max-w-[180px]">{event.entityId}</span>
          </span>
        )}
        {event.operatorId && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            <span className="font-mono truncate max-w-[120px]">{event.operatorId}</span>
          </span>
        )}
      </div>

      {/* Timestamps */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Occurred: <span className="text-foreground ml-1 font-mono">{fmtDate(event.occurredAt)}</span>
        </span>
        {event.recordedAt && (
          <span className="flex items-center gap-1">
            Recorded: <span className="text-foreground ml-1 font-mono">{fmtDate(event.recordedAt)}</span>
          </span>
        )}
      </div>

      {/* Hash / chain info */}
      {(event.hashPreview || event.chainId) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {event.chainId && (
            <span className="flex items-center gap-1">
              <Unlink className="w-3 h-3" />
              Chain: <span className="font-mono ml-1 text-foreground truncate max-w-[160px]">{event.chainId}</span>
            </span>
          )}
          {event.hashPreview && (
            <span className="flex items-center gap-1">
              <Hash className="w-3 h-3" />
              Hash: <span className="font-mono ml-1 text-foreground">{event.hashPreview}</span>
            </span>
          )}
        </div>
      )}

      {/* Evidence ref */}
      {event.evidenceRef && (
        <div className="text-xs text-muted-foreground font-mono truncate">
          Evidence: <span className="text-foreground">{event.evidenceRef}</span>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceForensicTimeline({
  events,
  isLoading,
  isError,
  errorMessage,
  "data-testid": testId = "forensic-timeline",
}: GovernanceForensicTimelineProps) {
  if (isLoading) {
    return (
      <div className="space-y-3" data-testid={`${testId}-loading`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-l-4 border-l-border pl-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5" data-testid={`${testId}-error`}>
        <CardContent className="pt-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Unable to load forensic timeline</p>
            <p className="text-xs text-muted-foreground mt-1">
              {errorMessage ?? "The forensic timeline API returned an error. Check that the entity ID is valid and the governance stack is operational."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid={`${testId}-empty`}>
        <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm font-medium">No forensic events found for this entity</p>
        <p className="text-xs mt-1 max-w-sm mx-auto">
          Either no audit events have been recorded for this entity ID, or it falls outside the current retention window.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-border" data-testid={testId}>
      {events.map((event, i) => (
        <div key={event.id ?? `event-${i}`} className="py-1">
          <ForensicEventCard event={event} index={i} />
        </div>
      ))}
      <div className="pt-3 text-xs text-muted-foreground text-center">
        {events.length} event{events.length !== 1 ? "s" : ""} - ordered by occurrence time, earliest first
      </div>
    </div>
  );
}
