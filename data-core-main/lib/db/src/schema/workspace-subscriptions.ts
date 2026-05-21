import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { commercialAccountsTable } from "./commercial-accounts";
import { commercialContractTermsTable } from "./commercial-contract-terms";

/**
 * @file   schema/workspace-subscriptions.ts
 * @phase  P16-A - Subscription State Model
 *
 * Commercially linked subscription state per workspace tenant.
 * No enforcement, payment, or entitlement columns.
 *
 * SAFETY CONTRACT:
 *   - No payment provider IDs, card data, tax, or invoice engine fields.
 *   - No module access blocking or login enforcement columns.
 *   - workspaceId UNIQUE - one subscription record per workspace (archived, not deleted).
 *   - subscriptionCode unique per workspace (composite index).
 */

export const workspaceSubscriptionsTable = pgTable(
  "workspace_subscriptions",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .unique()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    commercialAccountId: integer("commercial_account_id").references(
      () => commercialAccountsTable.id,
      { onDelete: "set null" },
    ),

    activeContractTermId: integer("active_contract_term_id").references(
      () => commercialContractTermsTable.id,
      { onDelete: "set null" },
    ),

    subscriptionCode: text("subscription_code").notNull(),
    subscriptionName: text("subscription_name").notNull(),

    status: text("status").notNull().default("trial"),
    // trial | active | grace_period | past_due | suspended | terminated | archived

    statusReason: text("status_reason"),

    startDate: date("start_date"),
    endDate: date("end_date"),
    renewalDate: date("renewal_date"),

    gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
    suspensionStartedAt: timestamp("suspension_started_at", { withTimezone: true }),
    terminationDate: date("termination_date"),

    planName: text("plan_name"),
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
    index("workspace_subscriptions_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("workspace_subscriptions_code_workspace_uidx").on(
      table.workspaceId,
      table.subscriptionCode,
    ),
  ],
);

export type WorkspaceSubscription = typeof workspaceSubscriptionsTable.$inferSelect;
export type InsertWorkspaceSubscription = typeof workspaceSubscriptionsTable.$inferInsert;
