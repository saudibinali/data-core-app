import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  json,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * compliance_audit_chains - P11-A Immutable Audit Integrity Architecture
 *
 * Append-only log of compliance-grade audit chain entries.
 * Each row represents a single immutable audit event in a hash-linked chain
 * that allows forensic reconstruction and tamper detection.
 *
 * Chain model:
 *   Each entry stores:
 *     - the previous entry's hash (previousAuditHash) - null for the genesis entry
 *     - a deterministic hash of the current entry (currentAuditHash)
 *   This creates a verifiable linked list per (entityType, entityId).
 *
 * Hash computation:
 *   SHA-256 of: PREV_HASH|eventType|entityId|operatorId|occurredAt.toISO()|JSON.stringify(payload)
 *   "GENESIS" is used as the PREV_HASH string for the first entry in a chain.
 *
 * Integrity statuses (set at write time; re-verified on read):
 *   verified            - hash chain is intact, continuity confirmed
 *   warning             - minor anomaly (e.g., time ordering gap > threshold)
 *   compromised         - hash mismatch detected (possible tampering)
 *   orphaned            - previousAuditHash references a non-existent entry
 *   incomplete          - expected chain entries are missing (sequence gap)
 *
 * Retention classifications (set deterministically from entityType + eventType):
 *   operational          - day-to-day operational events (captures, progressions)
 *   governance           - policy, configuration, orchestration creation events
 *   compliance_sensitive - confirmation, approval, access decision events
 *   forensic_critical    - rollbacks, abandonments, integrity failures
 *
 * Safety guarantees:
 *   - Records are NEVER updated or deleted
 *   - operatorId is MANDATORY - anonymous audit entries are rejected at engine level
 *   - previousAuditHash is verified before new entries are accepted
 *   - currentAuditHash is recomputed on every read-path integrity check
 *   - workspaceId may be NULL for platform-level (cross-workspace) audit events
 */
export const complianceAuditChainsTable = pgTable(
  "compliance_audit_chains",
  {
    id: serial("id").primaryKey(),

    /**
     * Unique audit chain entry identifier.
     * Format: "audit:<entityType>:<entityId>-<recordedAtMs>"
     */
    chainId: text("chain_id").notNull().unique(),

    /**
     * Type of the entity being audited.
     * One of: incident | recommendation | orchestration_action |
     *         execution_attempt | platform_event
     */
    entityType: text("entity_type").notNull(),

    /**
     * ID of the specific entity instance (e.g., incidentId, executionId).
     * Multiple audit entries share the same entityId to form a chain.
     */
    entityId: text("entity_id").notNull(),

    /**
     * Optional FK to workspaces.id - null for platform-level events.
     * Cascade-deleted when workspace is removed (workspace-scoped audit data).
     */
    workspaceId: integer("workspace_id").references(() => workspacesTable.id, {
      onDelete: "cascade",
    }),

    /**
     * Hash of the immediately preceding audit entry for this (entityType, entityId).
     * NULL for the genesis (first) entry of a chain.
     * Stores the previousEntry.currentAuditHash value verbatim.
     */
    previousAuditHash: text("previous_audit_hash"),

    /**
     * Deterministic SHA-256 hash of this entry's content.
     * Computed as: SHA256("PREV|eventType|entityId|operatorId|occurredAt.ISO|payload_json")
     * Recomputed on every integrity verification.
     */
    currentAuditHash: text("current_audit_hash").notNull(),

    /**
     * The type of event that triggered this audit entry.
     * Examples: execution_confirmed, orchestration_resolved, rollback_recorded,
     *           recommendation_acknowledged, integrity_anomaly_detected
     */
    eventType: text("event_type").notNull(),

    /**
     * Operator who performed the action. MUST be non-empty.
     * This is the attribution anchor for forensic reconstruction.
     */
    operatorId: text("operator_id").notNull(),

    /**
     * JSON snapshot of event-specific contextual data.
     * Frozen at write time - never updated after recording.
     */
    payload: json("payload").$type<Record<string, unknown>>().notNull(),

    /**
     * When the underlying event occurred in the source system.
     * May differ from recordedAt if audit recording is slightly delayed.
     */
    occurredAt: timestamp("occurred_at").notNull(),

    /**
     * When this audit entry was written to the DB.
     * Immutable - set at INSERT time only, never updated.
     */
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),

    /**
     * Integrity classification of this entry, set at write time.
     * Re-verified against recomputed hash on every audit verification run.
     */
    integrityStatus: text("integrity_status").notNull().default("verified"),

    /**
     * Retention governance classification.
     * Determines how long this record must be preserved under compliance policies.
     * Set deterministically from entityType + eventType at write time.
     */
    retentionClassification: text("retention_classification")
      .notNull()
      .default("operational"),
  },
  table => ({
    entityIdIdx:         index("audit_entity_id_idx").on(table.entityId),
    entityTypeIdIdx:     index("audit_entity_type_id_idx").on(table.entityType, table.entityId),
    workspaceIdx:        index("audit_workspace_idx").on(table.workspaceId),
    recordedAtIdx:       index("audit_recorded_at_idx").on(table.recordedAt),
    retentionIdx:        index("audit_retention_idx").on(table.retentionClassification),
    integrityStatusIdx:  index("audit_integrity_status_idx").on(table.integrityStatus),
  }),
);
