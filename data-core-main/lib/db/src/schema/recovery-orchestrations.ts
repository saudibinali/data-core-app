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
 * recovery_orchestration_actions - P10-D Human-In-The-Loop Remediation Tracking
 *
 * Append-only log of operator-triggered recovery orchestration actions.
 * Each action represents a deliberate, human-initiated remediation decision
 * linked to a specific workspace incident and (optionally) a recommendation.
 *
 * Lifecycle (strict state machine):
 *   initiated     → acknowledged   (operator acknowledges the action)
 *   initiated     → cancelled      (operator cancels before review)
 *   acknowledged  → in_review      (operator begins active investigation)
 *   acknowledged  → cancelled      (operator cancels after acknowledgement)
 *   in_review     → resolved       (operator concludes investigation positively)
 *   in_review     → rolled_back    (operator undoes the action)
 *   in_review     → cancelled      (operator abandons mid-review)
 *
 * Terminal states: resolved, rolled_back, cancelled
 *
 * Safety guarantees:
 *   - initiatedBy MUST be populated (operator attribution is mandatory)
 *   - No workspace may have more than one non-terminal orchestration of the
 *     same orchestrationType at a time (duplicate prevention)
 *   - rollbackEligible is set to false after rollback (no double-rollback)
 *   - Records are never deleted - only status is updated (append-only audit)
 *   - No automatic or autonomous execution ever - human-triggered only
 */
export const recoveryOrchestrationActionsTable = pgTable(
  "recovery_orchestration_actions",
  {
    id:                   serial("id").primaryKey(),
    /** Unique action identifier. Format: "orch:<workspaceId>-<ms>-<seq>" */
    actionId:             text("action_id").notNull().unique(),
    /** FK to workspaces.id - cascade-deleted when workspace is removed. */
    workspaceId:          integer("workspace_id")
                            .notNull()
                            .references(() => workspacesTable.id, { onDelete: "cascade" }),
    /**
     * Reference to the incident that this orchestration targets.
     * Soft reference - incidentId from reliability_incidents.incident_id.
     */
    incidentId:           text("incident_id").notNull(),
    /**
     * Optional reference to the recommendation that prompted this action.
     * Soft reference - recommendationId from the advisory engine.
     */
    recommendationId:     text("recommendation_id"),
    /**
     * One of 8 orchestration types:
     *   scheduler_pressure_review | fairness_policy_review | containment_audit |
     *   noisy_tenant_investigation | advisory_threshold_review |
     *   recovery_stability_validation | escalation_monitoring | operational_watch
     */
    orchestrationType:    text("orchestration_type").notNull(),
    /** Display name or userId of the operator who initiated this action. Required. */
    initiatedBy:          text("initiated_by").notNull(),
    initiatedAt:          timestamp("initiated_at", { withTimezone: true }).notNull(),
    /**
     * Lifecycle status.
     *   initiated | acknowledged | in_review | resolved | rolled_back | cancelled
     */
    orchestrationStatus:  text("orchestration_status").notNull().default("initiated"),
    /** Operator who acknowledged. Null until acknowledged. */
    acknowledgedBy:       text("acknowledged_by"),
    acknowledgedAt:       timestamp("acknowledged_at", { withTimezone: true }),
    /** Operator who resolved. Null until resolved. */
    resolvedBy:           text("resolved_by"),
    resolvedAt:           timestamp("resolved_at", { withTimezone: true }),
    /**
     * Whether this action can be rolled back.
     * Set to false after rollback to prevent double-rollback.
     * Also set to false on resolution - resolved actions are not retroactively undone.
     */
    rollbackEligible:     boolean("rollback_eligible").notNull().default(true),
    /** Operator who rolled back. Null unless status = rolled_back. */
    rolledBackBy:         text("rolled_back_by"),
    rolledBackAt:         timestamp("rolled_back_at", { withTimezone: true }),
    /** Operator who cancelled. Null unless status = cancelled. */
    cancelledBy:          text("cancelled_by"),
    cancelledAt:          timestamp("cancelled_at", { withTimezone: true }),
    /**
     * Evidence signals that informed this orchestration decision.
     * JSON array of strings (signal codes from the advisory engine).
     */
    relatedSignals:       json("related_signals").$type<string[]>().notNull().default([]),
    /** Optional free-text notes from the operator about this action. */
    executionNotes:       text("execution_notes"),
    createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("recovery_orch_workspace_status_idx").on(t.workspaceId, t.orchestrationStatus),
    index("recovery_orch_incident_idx").on(t.incidentId),
    index("recovery_orch_type_status_idx").on(t.orchestrationType, t.orchestrationStatus),
    index("recovery_orch_initiated_idx").on(t.initiatedAt),
  ],
);

export type RecoveryOrchestrationActionRow    = typeof recoveryOrchestrationActionsTable.$inferSelect;
export type InsertRecoveryOrchestrationAction = typeof recoveryOrchestrationActionsTable.$inferInsert;
