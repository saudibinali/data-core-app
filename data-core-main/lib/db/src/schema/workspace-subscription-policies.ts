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
 * @file   schema/workspace-subscription-policies.ts
 * @phase  P16-D - Grace Period & Suspension Rules (policy model only)
 */

export const workspaceSubscriptionPoliciesTable = pgTable(
  "workspace_subscription_policies",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    subscriptionId: integer("subscription_id").references(() => workspaceSubscriptionsTable.id, {
      onDelete: "set null",
    }),

    policyName: text("policy_name").notNull(),

    gracePeriodDays: integer("grace_period_days").notNull().default(7),
    pastDueAfterDays: integer("past_due_after_days").notNull().default(14),
    suspensionAfterDays: integer("suspension_after_days").notNull().default(30),
    terminationAfterDays: integer("termination_after_days"),

    allowReadOnlyDuringSuspension: boolean("allow_read_only_during_suspension")
      .notNull()
      .default(true),
    allowAdminAccessDuringSuspension: boolean("allow_admin_access_during_suspension")
      .notNull()
      .default(true),
    allowDataExportDuringSuspension: boolean("allow_data_export_during_suspension")
      .notNull()
      .default(true),

    enforcementMode: text("enforcement_mode").notNull().default("advisory_only"),
    // advisory_only | manual_required | automatic_recommended

    isActive: boolean("is_active").notNull().default(true),

    reason: text("reason"),
    internalNotes: text("internal_notes"),

    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspace_subscription_policies_workspace_uidx").on(table.workspaceId),
    index("workspace_subscription_policies_workspace_id_idx").on(table.workspaceId),
  ],
);

export type WorkspaceSubscriptionPolicy = typeof workspaceSubscriptionPoliciesTable.$inferSelect;
export type InsertWorkspaceSubscriptionPolicy =
  typeof workspaceSubscriptionPoliciesTable.$inferInsert;
