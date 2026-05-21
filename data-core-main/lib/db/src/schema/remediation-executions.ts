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
 * remediation_execution_attempts - P10-E Controlled Remediation Execution Tracking
 *
 * Append-only log of operator-confirmed remediation execution attempts.
 * Each record represents a single tracked execution attempt tied to a
 * recovery orchestration action, with full confirmation and rollback semantics.
 *
 * Key design constraint: confirmationMode is always "explicit".
 * No automatic confirmation, no automatic execution, no unattended remediation.
 *
 * Lifecycle (strict state machine):
 *   pending_confirmation → confirmed       (operator explicitly confirms intent)
 *   pending_confirmation → abandoned       (operator abandons before confirming)
 *   confirmed            → executing       (operator marks as actively executing)
 *   confirmed            → abandoned       (operator abandons after confirming)
 *   executing            → completed       (operator marks execution complete)
 *   executing            → rolled_back     (operator records rollback)
 *   executing            → abandoned       (operator abandons mid-execution)
 *
 * Terminal states: completed, rolled_back, abandoned
 *
 * Safety guarantees:
 *   - initiatedBy MUST be non-empty (operator attribution is mandatory)
 *   - confirmedBy MUST be non-empty for confirmation transition
 *   - No actionId may have more than one non-terminal execution at a time
 *   - rollbackStatus tracks the outcome of a rollback action separately
 *   - Records are NEVER deleted - status transitions update the existing row
 *   - confirmationMode = "explicit" is an invariant - no other value is accepted
 */
export const remediationExecutionAttemptsTable = pgTable(
  "remediation_execution_attempts",
  {
    id:                serial("id").primaryKey(),
    /** Unique execution identifier. Format: "exec:<workspaceId>-<ms>-<seq>" */
    executionId:       text("execution_id").notNull().unique(),
    /**
     * Soft reference to the orchestration action that triggered this execution.
     * Links to recovery_orchestration_actions.action_id.
     */
    actionId:          text("action_id").notNull(),
    /** FK to workspaces.id - cascade-deleted when workspace is removed. */
    workspaceId:       integer("workspace_id")
                         .notNull()
                         .references(() => workspacesTable.id, { onDelete: "cascade" }),
    /**
     * One of 8 execution types:
     *   scheduler_configuration_review | fairness_weight_adjustment |
     *   containment_boundary_reconfiguration | advisory_threshold_tuning |
     *   workload_pressure_investigation | recovery_validation_execution |
     *   escalation_stabilization | operational_intervention
     */
    executionType:     text("execution_type").notNull(),
    /**
     * Always "explicit" - no other value is accepted by the pure engine.
     * Records that this execution was explicitly confirmed by a human operator.
     * Future extensions that introduce different modes require a schema migration
     * and a deliberate design decision.
     */
    confirmationMode:  text("confirmation_mode").notNull().default("explicit"),
    /** Operator who initiated the execution attempt. Required. */
    initiatedBy:       text("initiated_by").notNull(),
    /** Operator who confirmed the execution. Null until confirmed. */
    confirmedBy:       text("confirmed_by"),
    confirmedAt:       timestamp("confirmed_at", { withTimezone: true }),
    /** Timestamp when execution was marked "executing". Null until then. */
    executedAt:        timestamp("executed_at", { withTimezone: true }),
    /**
     * Lifecycle status.
     *   pending_confirmation | confirmed | executing |
     *   completed | rolled_back | abandoned
     */
    executionStatus:   text("execution_status").notNull().default("pending_confirmation"),
    /**
     * Tracks the outcome of a rollback action (independent of executionStatus).
     *   not_applicable - execution was not rolled back
     *   pending        - rollback initiated, outcome not yet recorded
     *   completed      - rollback completed successfully
     *   failed         - rollback attempt failed; manual recovery needed
     */
    rollbackStatus:    text("rollback_status").notNull().default("not_applicable"),
    /**
     * Operator-provided evidence codes and references for this execution.
     * JSON string array - e.g. ["fairness_weight_changed:0.7→0.9", "backlog_depth:42"]
     * Append-only: route handlers always extend, never replace.
     */
    executionEvidence: json("execution_evidence").$type<string[]>().notNull().default([]),
    /** Optional operator notes about this execution attempt. */
    executionNotes:    text("execution_notes"),
    completedAt:       timestamp("completed_at", { withTimezone: true }),
    rolledBackAt:      timestamp("rolled_back_at", { withTimezone: true }),
    abandonedAt:       timestamp("abandoned_at", { withTimezone: true }),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("remediation_exec_action_status_idx").on(t.actionId, t.executionStatus),
    index("remediation_exec_workspace_idx").on(t.workspaceId, t.executionStatus),
    index("remediation_exec_type_idx").on(t.executionType, t.executionStatus),
    index("remediation_exec_created_idx").on(t.createdAt),
  ],
);

export type RemediationExecutionAttemptRow    = typeof remediationExecutionAttemptsTable.$inferSelect;
export type InsertRemediationExecutionAttempt = typeof remediationExecutionAttemptsTable.$inferInsert;
