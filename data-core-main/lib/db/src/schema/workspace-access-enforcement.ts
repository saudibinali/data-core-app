import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { workspaceSubscriptionsTable } from "./workspace-subscriptions";

/**
 * @file   schema/workspace-access-enforcement.ts
 * @phase  P16-E - Commercial-to-Workspace Enforcement (read-only mode)
 */

export const workspaceAccessEnforcementTable = pgTable(
  "workspace_access_enforcement",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    subscriptionId: integer("subscription_id").references(() => workspaceSubscriptionsTable.id, {
      onDelete: "set null",
    }),

    enforcementStatus: text("enforcement_status").notNull().default("normal"),
    // normal | read_only | restricted | suspended_view_only | terminated_view_only

    enforcementReason: text("enforcement_reason"),
    source: text("source").notNull().default("manual"),
    // manual | subscription_policy | commercial_risk | contract_expiry | system_recommendation

    appliedBy: integer("applied_by").references(() => usersTable.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    allowLogin: boolean("allow_login").notNull().default(true),
    allowRead: boolean("allow_read").notNull().default(true),
    allowCreate: boolean("allow_create").notNull().default(true),
    allowUpdate: boolean("allow_update").notNull().default(true),
    allowDelete: boolean("allow_delete").notNull().default(true),
    allowExport: boolean("allow_export").notNull().default(true),
    allowAdminAccess: boolean("allow_admin_access").notNull().default(true),

    internalNotes: text("internal_notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspace_access_enforcement_workspace_uidx").on(table.workspaceId),
    index("workspace_access_enforcement_workspace_id_idx").on(table.workspaceId),
  ],
);

export type WorkspaceAccessEnforcement = typeof workspaceAccessEnforcementTable.$inferSelect;
export type InsertWorkspaceAccessEnforcement = typeof workspaceAccessEnforcementTable.$inferInsert;
