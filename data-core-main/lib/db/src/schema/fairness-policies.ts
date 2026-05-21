import { pgTable, text, serial, integer, boolean, timestamp, real, index } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * scheduler_fairness_policies - P9-E Fairness Orchestration Policy Storage
 *
 * Persists scheduler fairness adjustment policies created by super-admins.
 * Each policy targets a single workspace and moves through a defined lifecycle:
 *
 *   pending → active       (operator approval)
 *   pending → rejected     (operator rejection - currently via validation)
 *   pending → expired      (expiresAt passed without approval)
 *   active  → rolled_back  (explicit operator rollback action)
 *   active  → expired      (expiresAt passed while active)
 *
 * Safety guarantees:
 *   - targetSchedulerWeight is always in {0.25, 0.50, 0.75, 1.00}
 *   - No workspace can have more than one pending/active policy at a time
 *   - rollbackEligible is preserved for the lifetime of the policy
 */
export const schedulerFairnessPoliciesTable = pgTable(
  "scheduler_fairness_policies",
  {
    id:                      serial("id").primaryKey(),
    /** Unique policy identifier. Format: "fp:<workspaceId>-<ms>-<seq>" */
    policyId:                text("policy_id").notNull().unique(),
    /** FK to workspaces.id - cascade-deleted when workspace is removed. */
    workspaceId:             integer("workspace_id")
                               .notNull()
                               .references(() => workspacesTable.id, { onDelete: "cascade" }),
    /**
     * Desired scheduler weight after policy approval (0.25 | 0.50 | 0.75 | 1.00).
     * NEVER below 0.25 - starvation floor guarantee.
     */
    targetSchedulerWeight:   real("target_scheduler_weight").notNull(),
    /**
     * Scheduler weight recorded at policy creation time.
     * This is the rollback weight - restored when policy is rolled back.
     */
    previousSchedulerWeight: real("previous_scheduler_weight").notNull(),
    /** Human-readable rationale for the adjustment. Required at creation. */
    adjustmentReason:        text("adjustment_reason").notNull(),
    /** Super-admin userId or display name who created this policy. */
    requestedBy:             text("requested_by").notNull(),
    /** Super-admin who approved this policy. Null until approved. */
    approvedBy:              text("approved_by"),
    /** Timestamp when this policy was approved. Null until approved. */
    approvedAt:              timestamp("approved_at", { withTimezone: true }),
    /** Policy becomes expired after this timestamp. Required at creation. */
    expiresAt:               timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * Whether an active policy can be rolled back.
     * Set to false after rollback to prevent double-rollback.
     */
    rollbackEligible:        boolean("rollback_eligible").notNull().default(true),
    /**
     * Lifecycle status of this policy.
     * Values: "pending" | "active" | "expired" | "rolled_back" | "rejected"
     */
    policyStatus:            text("policy_status").notNull().default("pending"),
    createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_sfp_workspace_id").on(t.workspaceId),
    index("idx_sfp_policy_status").on(t.policyStatus),
    index("idx_sfp_workspace_status").on(t.workspaceId, t.policyStatus),
    index("idx_sfp_expires_at").on(t.expiresAt),
  ],
);

export type SchedulerFairnessPolicyRow = typeof schedulerFairnessPoliciesTable.$inferSelect;
export type InsertSchedulerFairnessPolicy = typeof schedulerFairnessPoliciesTable.$inferInsert;
