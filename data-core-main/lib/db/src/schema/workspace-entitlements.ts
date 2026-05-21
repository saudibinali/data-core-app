import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { workspaceSubscriptionsTable } from "./workspace-subscriptions";

/**
 * @file   schema/workspace-entitlements.ts
 * @phase  P16-B - Entitlement & Feature Access Model
 *
 * Per-workspace module/feature entitlements linked optionally to subscription.
 * No enforcement columns - P16-C+ applies access rules.
 *
 * Module-level rows use empty string for feature_key (API exposes null).
 */

export const workspaceEntitlementsTable = pgTable(
  "workspace_entitlements",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    subscriptionId: integer("subscription_id").references(() => workspaceSubscriptionsTable.id, {
      onDelete: "set null",
    }),

    moduleKey: text("module_key").notNull(),
    featureKey: text("feature_key").notNull().default(""),

    isEnabled: boolean("is_enabled").notNull().default(true),

    source: text("source").notNull().default("system_default"),
    // manual | subscription_plan | contract_override | trial | system_default

    effectiveFrom: date("effective_from"),
    effectiveUntil: date("effective_until"),

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
    index("workspace_entitlements_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("workspace_entitlements_workspace_module_feature_uidx").on(
      table.workspaceId,
      table.moduleKey,
      table.featureKey,
    ),
  ],
);

export type WorkspaceEntitlement = typeof workspaceEntitlementsTable.$inferSelect;
export type InsertWorkspaceEntitlement = typeof workspaceEntitlementsTable.$inferInsert;
