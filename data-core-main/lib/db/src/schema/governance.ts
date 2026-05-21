import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

// ── Governance Snapshots (P7-A) ───────────────────────────────────────────────
//
// Append-only historical record of tenant health evaluations.
//
// IMMUTABILITY CONTRACT:
//   Every row is written once by captureGovernanceSnapshot() and NEVER modified.
//   There is intentionally no application code path that UPDATEs or DELETEs
//   rows from this table - historical governance data is write-once audit data.
//
// PURPOSE:
//   Point-in-time governance evaluations are computed by evaluateTenantHealth()
//   but were previously discarded after the HTTP response.  This table persists
//   each evaluation result so the platform can provide:
//     • Severity history (how has health changed over time?)
//     • Metric trends (error rate, backlog growth, stuck count)
//     • Alert frequency intelligence (which GOV-* codes appear most often?)
//     • Chronic degradation detection (is this workspace persistently unhealthy?)
//
// SCHEMA VERSION:
//   schema_version = 1.  Increment when the JSONB shape of metrics_snapshot,
//   indicators, or alert_summary changes in a breaking way, so future readers
//   can migrate legacy rows.
//
// RETENTION (recommendation, not enforced by the DB):
//   Raw rows:    keep 30 days  (≈ 8,640 rows at 5-min capture interval)
//   Hourly agg:  keep 90 days  (prune raw, keep 1/hour)
//   Daily agg:   keep 365 days (prune hourly, keep 1/day)
//   Pruning is NOT implemented in P7-A - left for a background sweep task.
//
// INDEXING STRATEGY:
//   Primary access pattern: "give me all snapshots for workspace W since T"
//   → workspace_id + captured_at covers both filtering and ordering.
//   Secondary pattern: severity-filtered queries for trend analysis
//   → workspace_id + severity + captured_at.

// ── Governance Snapshot Rollups (P7-C) ───────────────────────────────────────
//
// Compressed long-term analytics store.  Raw governance_snapshots are kept for
// 30 days; this table extends analytics coverage to 90 days (hourly granularity)
// and 365 days (daily granularity).
//
// IMMUTABILITY CONTRACT:
//   Every row is written once (INSERT ... ON CONFLICT DO NOTHING) and NEVER
//   modified.  The unique constraint on (workspace_id, granularity, bucket_start)
//   ensures that re-running the rollup pipeline for the same bucket is idempotent.
//
// GRANULARITY TIERS:
//   'hourly' - one row per clock-hour per workspace (90-day retention)
//     Source: raw governance_snapshots for that hour
//   'daily'  - one row per UTC calendar-day per workspace (365-day retention)
//     Source: hourly rollup rows for that day
//
// AGGREGATION SEMANTICS:
//   dominant_severity - worst severity seen across all source records
//   avg_error_rate    - arithmetic mean of workflowErrorRate (0.0-1.0)
//   avg_approval_backlog - mean approvalBacklogCount (raw) or avgApprovalBacklog (hourly)
//   avg_delay_backlog    - mean delayBacklogCount
//   avg_stuck_count      - mean stuckCount
//   chronic_alert_codes  - GOV-* codes appearing in > 50% of source records
//   storm_frequency      - fraction of source records with storm (0.0-1.0)
//
// QUERY CASCADE:
//   ≤ 30  days back → governance_snapshots (raw)
//    30-90 days back → governance_snapshot_rollups WHERE granularity='hourly'
//   90-365 days back → governance_snapshot_rollups WHERE granularity='daily'

export const governanceSnapshotRollupsTable = pgTable(
  "governance_snapshot_rollups",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // 'hourly' or 'daily'
    granularity: text("granularity").notNull(),

    // Inclusive start of this time bucket (e.g. 2026-01-15T10:00:00Z for hourly).
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),

    // Exclusive end of this time bucket (start + 1h for hourly, start + 24h for daily).
    bucketEnd: timestamp("bucket_end", { withTimezone: true }).notNull(),

    // Number of source records aggregated into this rollup.
    snapshotCount: integer("snapshot_count").notNull().default(0),

    // Arithmetic mean of workflowErrorRate across source records (0.0-1.0).
    avgErrorRate: real("avg_error_rate").notNull().default(0),

    // Arithmetic mean of approvalBacklogCount / avgApprovalBacklog across sources.
    avgApprovalBacklog: real("avg_approval_backlog").notNull().default(0),

    // Arithmetic mean of delayBacklogCount / avgDelayBacklog across sources.
    avgDelayBacklog: real("avg_delay_backlog").notNull().default(0),

    // Arithmetic mean of stuckCount / avgStuckCount across sources.
    avgStuckCount: real("avg_stuck_count").notNull().default(0),

    // Worst severity seen across all source records.
    // "healthy" | "warning" | "degraded" | "critical"
    dominantSeverity: text("dominant_severity").notNull(),

    // GOV-* codes appearing in > 50% of source records.
    // For hourly: percentage of raw snapshots; for daily: percentage of hourly rollups.
    chronicAlertCodes: jsonb("chronic_alert_codes").$type<string[]>().notNull().$default(() => []),

    // Fraction of source records with storm (stormSeverity != 'none') - 0.0 to 1.0.
    stormFrequency: real("storm_frequency").notNull().default(0),

    // Schema version for future JSONB migration support.
    schemaVersion: integer("schema_version").notNull().default(1),

    // Row creation time (not the bucket time).
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unique bucket constraint - makes INSERT ... ON CONFLICT DO NOTHING idempotent.
    // Also serves as the primary query index for trend queries.
    uniqueIndex("idx_gov_rollup_unique_bucket").on(t.workspaceId, t.granularity, t.bucketStart),
    // Severity-filtered rollup queries.
    index("idx_gov_rollup_severity").on(t.workspaceId, t.granularity, t.dominantSeverity, t.bucketStart),
  ],
);

// ── Governance Snapshots (P7-A) ───────────────────────────────────────────────
//
export const governanceSnapshotsTable = pgTable(
  "governance_snapshots",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // When this snapshot was captured (wall-clock at capture time, not now()).
    // This is the authoritative timestamp for trend ordering.
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Overall health severity at capture time.
    // "healthy" | "warning" | "degraded" | "critical"
    severity: text("severity").notNull(),

    // Serialized subset of OperationalMetricsSnapshot.
    // Shape: SnapshotMetrics (see governance-history.ts).
    // Stored as JSONB to allow schema evolution without migrations.
    metricsSnapshot: jsonb("metrics_snapshot").notNull(),

    // Per-dimension health indicators at capture time.
    // Shape: SnapshotIndicators (see governance-history.ts).
    // Fields: executionPressure, errorConcentration, approvalPressure,
    //         delayPressure, stormPressure.
    indicators: jsonb("indicators").notNull(),

    // Array of GOV-* alert codes active at capture time.
    // Stored as a JSONB string[] for portability.
    // Example: ["GOV-02", "GOV-04", "GOV-07"]
    // Used for alert frequency intelligence without unpacking full alert objects.
    alertCodes: jsonb("alert_codes").$type<string[]>().notNull().$default(() => []),

    // Alert count summary at capture time.
    // Shape: { total, critical, warning, info }
    alertSummary: jsonb("alert_summary").notNull(),

    // Stuck execution count at capture time (length of stuckExecutions array).
    stuckCount: integer("stuck_count").notNull().default(0),

    // Storm severity at capture time.
    // "none" | "warning" | "critical"
    stormSeverity: text("storm_severity").notNull(),

    // Schema version for future JSONB migration support.
    schemaVersion: integer("schema_version").notNull().default(1),
  },
  (t) => [
    // Primary trend query index: workspace + time window
    index("idx_gov_snap_workspace_time").on(t.workspaceId, t.capturedAt),
    // Severity-filtered trend queries (e.g. "how often was this workspace critical?")
    index("idx_gov_snap_workspace_severity").on(
      t.workspaceId,
      t.severity,
      t.capturedAt,
    ),
  ],
);
