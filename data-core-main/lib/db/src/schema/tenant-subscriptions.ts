import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * @file   schema/tenant-subscriptions.ts
 * @phase  P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * Stores subscription metadata for each workspace tenant.
 * Independent domain from workspace identity - deliberately a separate table.
 *
 * SAFETY CONTRACT:
 *   - No payment provider customer IDs, invoice IDs, card data, or tax fields.
 *   - No entitlement enforcement columns - P13-D is responsible for that.
 *   - All date fields are nullable - no subscription record is valid by default.
 *   - workspaceId is UNIQUE - one subscription record per workspace.
 *   - cascades on workspace delete (workspace data already gone = subscription irrelevant).
 */

export const tenantSubscriptionsTable = pgTable(
  "tenant_subscriptions",
  {
    id:                   serial("id").primaryKey(),

    workspaceId:          integer("workspace_id")
                            .notNull()
                            .unique()
                            .references(() => workspacesTable.id, { onDelete: "cascade" }),

    planCode:             text("plan_code"),
    subscriptionStatus:   text("subscription_status").notNull().default("unknown"),

    billingPeriodStart:   timestamp("billing_period_start",    { withTimezone: true }),
    billingPeriodEnd:     timestamp("billing_period_end",      { withTimezone: true }),
    renewalDueAt:         timestamp("renewal_due_at",          { withTimezone: true }),
    trialStartedAt:       timestamp("trial_started_at",        { withTimezone: true }),
    trialEndsAt:          timestamp("trial_ends_at",           { withTimezone: true }),
    gracePeriodStartedAt: timestamp("grace_period_started_at", { withTimezone: true }),
    gracePeriodEndsAt:    timestamp("grace_period_ends_at",    { withTimezone: true }),
    cancelledAt:          timestamp("cancelled_at",            { withTimezone: true }),
    suspendedAt:          timestamp("suspended_at",            { withTimezone: true }),

    metadataJson:         jsonb("metadata_json"),

    reason:               text("reason"),
    updatedBy:            integer("updated_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
                 .notNull()
                 .defaultNow()
                 .$onUpdate(() => new Date()),
  },
  (table) => [
    index("tenant_subscriptions_workspace_id_idx").on(table.workspaceId),
  ],
);

export type TenantSubscription       = typeof tenantSubscriptionsTable.$inferSelect;
export type InsertTenantSubscription = typeof tenantSubscriptionsTable.$inferInsert;
