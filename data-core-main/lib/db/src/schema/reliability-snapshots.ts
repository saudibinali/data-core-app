import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  json,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * reliability_domain_snapshots - P10-B Reliability History Storage
 *
 * Append-only log of per-workspace reliability domain evaluations.
 * Each snapshot records the full P10-A domain state for one workspace at a
 * specific point in time. Never updated; only inserted (append-only).
 *
 * Grouped by captureId: every call to POST /platform/reliability/capture
 * creates one snapshot per workspace, all sharing the same captureId.
 *
 * Safety guarantees:
 *   - Records are never updated or deleted (append-only audit log)
 *   - workspaceId FK cascade-deletes when workspace is removed
 *   - capturedAt is always a server-side timestamp (UTC)
 */
export const reliabilityDomainSnapshotsTable = pgTable(
  "reliability_domain_snapshots",
  {
    id:                    serial("id").primaryKey(),
    /** Unique snapshot identifier. Format: "snap:<ms>-<workspaceId>" */
    snapshotId:            text("snapshot_id").notNull().unique(),
    /**
     * Groups all workspace snapshots taken in the same capture call.
     * Format: "cap:<ms>-<seq>"
     */
    captureId:             text("capture_id").notNull(),
    /** FK to workspaces.id - cascade-deleted when workspace is removed. */
    workspaceId:           integer("workspace_id")
                             .notNull()
                             .references(() => workspacesTable.id, { onDelete: "cascade" }),
    /** Source P10-A domain identifier (from ReliabilityDomain.domainId). */
    domainId:              text("domain_id").notNull(),
    /** Overall degradation classification at capture time. */
    degradationStatus:     text("degradation_status").notNull(),
    /** Failure propagation risk at capture time. */
    propagationRisk:       text("propagation_risk").notNull(),
    /** Containment boundary health at capture time. */
    containmentLevel:      text("containment_level").notNull(),
    /** Observability quality at capture time. */
    observabilityHealth:   text("observability_health").notNull(),
    /** Normalized blast radius score (0-100) at capture time. */
    blastRadiusScore:      integer("blast_radius_score").notNull(),
    /** Whether an advisory storm was detected at capture time. */
    advisoryStormDetected: boolean("advisory_storm_detected").notNull().default(false),
    /**
     * JSON array of DomainType strings - subsystems showing degraded or worse.
     * Stored as JSON; empty array when domain is healthy.
     */
    affectedSubsystems:    json("affected_subsystems").$type<string[]>().notNull().default([]),
    /** Server UTC timestamp when this snapshot was captured. */
    capturedAt:            timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reliability_snapshots_workspace_captured_idx").on(t.workspaceId, t.capturedAt),
    index("reliability_snapshots_capture_idx").on(t.captureId),
    index("reliability_snapshots_degradation_idx").on(t.degradationStatus),
  ],
);

export type ReliabilityDomainSnapshotRow = typeof reliabilityDomainSnapshotsTable.$inferSelect;
export type InsertReliabilityDomainSnapshot  = typeof reliabilityDomainSnapshotsTable.$inferInsert;

/**
 * reliability_incidents - P10-B Incident Lifecycle Storage
 *
 * Tracks the lifecycle of reliability incidents - periods when a workspace's
 * degradationStatus escalates to "severely_degraded" or worse.
 *
 * Incident lifecycle:
 *   created (active)  → lastObservedAt updated on each snapshot capture
 *   active            → recovering (status drops to "degraded")
 *   recovering        → resolved   (status returns to "healthy")
 *   recovering        → active     (re-escalation before resolution)
 *
 * One active incident per workspace at most. A new incident starts only after
 * the previous one resolves.
 *
 * Safety guarantees:
 *   - Only one "active" or "recovering" incident per workspace at a time
 *   - resolvedAt is set only when incidentStatus → "resolved"
 *   - snapshotCount is incremented on each capture while incident is open
 */
export const reliabilityIncidentsTable = pgTable(
  "reliability_incidents",
  {
    id:                  serial("id").primaryKey(),
    /** Unique incident identifier. Format: "inc:<workspaceId>-<ms>" */
    incidentId:          text("incident_id").notNull().unique(),
    /** FK to workspaces.id - cascade-deleted when workspace is removed. */
    workspaceId:         integer("workspace_id")
                           .notNull()
                           .references(() => workspacesTable.id, { onDelete: "cascade" }),
    /** UTC timestamp when this incident was first detected. */
    startedAt:           timestamp("started_at", { withTimezone: true }).notNull(),
    /** UTC timestamp of the most recent snapshot where incident was open. */
    lastObservedAt:      timestamp("last_observed_at", { withTimezone: true }).notNull(),
    /** UTC timestamp when status transitioned to "resolved". Null if open. */
    resolvedAt:          timestamp("resolved_at", { withTimezone: true }),
    /** Worst degradationStatus seen during this incident. */
    highestSeverity:     text("highest_severity").notNull(),
    /** Worst propagationRisk seen during this incident. */
    peakPropagationRisk: text("peak_propagation_risk").notNull(),
    /**
     * Current lifecycle status.
     *   "active"     - incident is ongoing (severity >= severely_degraded)
     *   "recovering" - severity dropped to degraded; not yet resolved
     *   "resolved"   - severity returned to healthy
     */
    incidentStatus:      text("incident_status").notNull().default("active"),
    /** Number of advisory storms detected during this incident. */
    advisoryStormCount:  integer("advisory_storm_count").notNull().default(0),
    /** Number of snapshots captured while this incident was open. */
    snapshotCount:       integer("snapshot_count").notNull().default(1),
    createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("reliability_incidents_workspace_status_idx").on(t.workspaceId, t.incidentStatus),
    index("reliability_incidents_started_idx").on(t.startedAt),
  ],
);

export type ReliabilityIncidentRow    = typeof reliabilityIncidentsTable.$inferSelect;
export type InsertReliabilityIncident = typeof reliabilityIncidentsTable.$inferInsert;
