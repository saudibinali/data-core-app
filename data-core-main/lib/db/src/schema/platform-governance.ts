import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const workspaceLifecycleEventsTable = pgTable(
  "workspace_lifecycle_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    reason: text("reason").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_workspace_lifecycle_events_ws").on(t.workspaceId, t.createdAt)],
);

export const platformGovernanceAuditLogsTable = pgTable(
  "platform_governance_audit_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    scope: text("scope").notNull().default("platform"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: integer("resource_id"),
    metadataJson: text("metadata_json"),
    governanceSignature: text("governance_signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_platform_gov_audit_ws").on(t.workspaceId, t.createdAt),
    index("idx_platform_gov_audit_actor").on(t.actorUserId, t.createdAt),
  ],
);

export const supportImpersonationSessionsTable = pgTable(
  "support_impersonation_sessions",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    targetWorkspaceId: integer("target_workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    targetUserId: integer("target_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    scopesJson: text("scopes_json").notNull(),
    breakGlass: boolean("break_glass").notNull().default(false),
    consentReference: text("consent_reference"),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadataJson: text("metadata_json"),
  },
  (t) => [
    index("idx_support_impersonation_actor").on(t.actorUserId, t.status),
    index("idx_support_impersonation_target_ws").on(t.targetWorkspaceId, t.status),
  ],
);

export type WorkspaceLifecycleEvent = typeof workspaceLifecycleEventsTable.$inferSelect;
export type PlatformGovernanceAuditLog = typeof platformGovernanceAuditLogsTable.$inferSelect;
export type SupportImpersonationSession = typeof supportImpersonationSessionsTable.$inferSelect;
