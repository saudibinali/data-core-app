import {
  pgTable, text, serial, integer, jsonb, boolean,
  timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const approvalProcessPoliciesTable = pgTable(
  "approval_process_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    routingType: text("routing_type").notNull().default("direct_manager"),
    chainDepth: integer("chain_depth").notNull().default(1),
    timeoutHours: integer("timeout_hours").notNull().default(48),
    onTimeout: text("on_timeout").notNull().default("escalate"),
    parallelMode: text("parallel_mode"),
    conditions: jsonb("conditions"),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_approval_process_policies_ws_code").on(t.workspaceId, t.code),
    index("idx_approval_process_policies_ws").on(t.workspaceId),
  ],
);

export const approvalInstancesTable = pgTable(
  "approval_instances",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    processCode: text("process_code").notNull(),
    requesterEmployeeId: integer("requester_employee_id"),
    requesterUserId: integer("requester_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    currentStepOrder: integer("current_step_order").notNull().default(1),
    context: jsonb("context"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_approval_instances_ws_status").on(t.workspaceId, t.status),
    index("idx_approval_instances_entity").on(t.entityType, t.entityId),
  ],
);

export const approvalStepsTable = pgTable(
  "approval_steps",
  {
    id: serial("id").primaryKey(),
    instanceId: integer("instance_id")
      .notNull()
      .references(() => approvalInstancesTable.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull().default(1),
    routingSource: text("routing_source").notNull().default("direct_manager"),
    approverEmployeeId: integer("approver_employee_id"),
    approverUserId: integer("approver_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    delegatedFromEmployeeId: integer("delegated_from_employee_id"),
    legacyLeaveStepId: integer("legacy_leave_step_id"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_approval_steps_instance").on(t.instanceId, t.stepOrder),
    index("idx_approval_steps_approver_pending").on(t.approverUserId, t.status),
  ],
);

export type ApprovalProcessPolicy = typeof approvalProcessPoliciesTable.$inferSelect;
export type ApprovalInstance = typeof approvalInstancesTable.$inferSelect;
export type ApprovalStep = typeof approvalStepsTable.$inferSelect;
