import { pgTable, serial, text, integer, timestamp, json } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * governance_workflow_actions
 *
 * Append-only record of every governance workflow action initiated for a
 * GovernanceViolation (detected by P11-B). Each row represents one workflow
 * lifecycle (open → acknowledged → escalated → resolved / dismissed).
 *
 * Safety:
 *   - No row is ever deleted or overwritten.
 *   - Status transitions are enforced at the application layer.
 *   - Terminal states (resolved, dismissed) have no further transitions.
 *   - Each active violationId has at most one non-terminal workflow at any time
 *     (enforced at the application layer - not a DB constraint).
 *
 * workspaceId is nullable: platform-level violations (workspaceId=null in
 * GovernanceViolation) produce workflows with workspaceId=null.
 * ON DELETE CASCADE: if a workspace is deleted, its workflow records are removed.
 */
export const governanceWorkflowActionsTable = pgTable("governance_workflow_actions", {
  id:                       serial("id").primaryKey(),
  workflowActionId:         text("workflow_action_id").notNull().unique(),
  violationId:              text("violation_id").notNull(),
  policyId:                 text("policy_id").notNull(),
  workspaceId:              integer("workspace_id").references(
    () => workspacesTable.id,
    { onDelete: "cascade" },
  ),
  assignedOperatorId:       text("assigned_operator_id"),
  initiatedBy:              text("initiated_by").notNull(),
  workflowStatus:           text("workflow_status").notNull().default("open"),
  escalationLevel:          text("escalation_level").notNull().default("informational"),
  resolutionClassification: text("resolution_classification"),
  resolutionNote:           text("resolution_note"),
  evidenceReferences:       json("evidence_references")
    .$type<string[]>()
    .notNull()
    .default([]),
  acknowledgedBy:           text("acknowledged_by"),
  acknowledgedAt:           timestamp("acknowledged_at"),
  escalatedBy:              text("escalated_by"),
  escalatedAt:              timestamp("escalated_at"),
  resolvedBy:               text("resolved_by"),
  resolvedAt:               timestamp("resolved_at"),
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
});
