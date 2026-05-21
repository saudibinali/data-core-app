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
 * @file   schema/workspace-quota-limits.ts
 * @phase  P16-C - Workspace Limits & Quotas
 *
 * Per-workspace quota limits. Indicators only - no enforcement in P16-C.
 */

export const workspaceQuotaLimitsTable = pgTable(
  "workspace_quota_limits",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    subscriptionId: integer("subscription_id").references(() => workspaceSubscriptionsTable.id, {
      onDelete: "set null",
    }),

    quotaKey: text("quota_key").notNull(),

    /** null = unlimited (when explicitly disabled / uncapped) */
    limitValue: integer("limit_value"),

    warningThresholdPercent: integer("warning_threshold_percent").notNull().default(80),

    isHardLimit: boolean("is_hard_limit").notNull().default(false),

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
    index("workspace_quota_limits_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("workspace_quota_limits_workspace_quota_uidx").on(
      table.workspaceId,
      table.quotaKey,
    ),
  ],
);

export type WorkspaceQuotaLimit = typeof workspaceQuotaLimitsTable.$inferSelect;
export type InsertWorkspaceQuotaLimit = typeof workspaceQuotaLimitsTable.$inferInsert;
