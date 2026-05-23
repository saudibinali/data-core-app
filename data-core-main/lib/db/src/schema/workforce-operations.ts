import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { employeesTable } from "./hr";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Workforce Operations Runtime
// ─────────────────────────────────────────────────────────────────────────────

export const employeeMovementsTable = pgTable(
  "employee_movements",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    movementType: text("movement_type").notNull(),
    effectiveDate: date("effective_date").notNull(),
    fromOrgUnitId: integer("from_org_unit_id"),
    toOrgUnitId: integer("to_org_unit_id"),
    fromManagerId: integer("from_manager_id"),
    toManagerId: integer("to_manager_id"),
    fromJobTitleId: integer("from_job_title_id"),
    toJobTitleId: integer("to_job_title_id"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reason: text("reason"),
    notes: text("notes"),
    lifecycleEventId: integer("lifecycle_event_id"),
    approvalInstanceId: integer("approval_instance_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_employee_movements_employee").on(t.employeeId, t.effectiveDate),
    index("idx_employee_movements_workspace").on(t.workspaceId, t.createdAt),
  ],
);

export const workforceLifecycleEventsTable = pgTable(
  "workforce_lifecycle_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("pending"),
    effectiveDate: date("effective_date"),
    payload: jsonb("payload"),
    approvalInstanceId: integer("approval_instance_id"),
    movementId: integer("movement_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_workforce_lifecycle_employee").on(t.employeeId, t.createdAt),
    index("idx_workforce_lifecycle_status").on(t.workspaceId, t.status),
  ],
);

export const workforceTimelineEventsTable = pgTable(
  "workforce_timeline_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    eventCategory: text("event_category").notNull(),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    correlationId: text("correlation_id"),
    sourceTable: text("source_table"),
    sourceId: integer("source_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_workforce_timeline_employee").on(t.employeeId, t.occurredAt),
  ],
);

export const workforceAuditLogTable = pgTable(
  "workforce_audit_log",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_workforce_audit_entity").on(t.entityType, t.entityId, t.createdAt),
  ],
);

export type EmployeeMovement = typeof employeeMovementsTable.$inferSelect;
export type WorkforceLifecycleEvent = typeof workforceLifecycleEventsTable.$inferSelect;
export type WorkforceTimelineEvent = typeof workforceTimelineEventsTable.$inferSelect;
export type WorkforceAuditLogEntry = typeof workforceAuditLogTable.$inferSelect;
