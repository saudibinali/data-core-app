import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * @file   schema/tenant-entitlement-overrides.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Stores per-workspace entitlement overrides applied on top of the plan's
 * default module set and feature limits.
 *
 * SAFETY CONTRACT:
 *   - Super-admin only. No payment, invoice, billing, or HR execution columns.
 *   - reason is NOT NULL - every override must be justified.
 *   - createdBy is NOT NULL - every override is traceable to an actor.
 *   - overrideType is constrained to: "enable" | "disable" | "limit_override".
 *   - limitCode is nullable - null means the override targets module access, not a limit.
 *   - limitValue is nullable - null means "unlimited" when limit_override and the
 *     limit definition declares nullableMeansUnlimited = true.
 *   - Uniqueness enforced at the application layer via DELETE + INSERT pattern.
 *   - Cascades on workspace delete - override data is irrelevant without the workspace.
 */

export const tenantEntitlementOverridesTable = pgTable(
  "tenant_entitlement_overrides",
  {
    id:           serial("id").primaryKey(),

    workspaceId:  integer("workspace_id")
                    .notNull()
                    .references(() => workspacesTable.id, { onDelete: "cascade" }),

    moduleCode:   text("module_code").notNull(),
    overrideType: text("override_type").notNull(), // "enable" | "disable" | "limit_override"
    limitCode:    text("limit_code"),              // null for enable/disable overrides
    limitValue:   integer("limit_value"),          // null means unlimited (when allowed)

    reason:       text("reason").notNull(),
    createdBy:    integer("created_by").notNull(),

    metadataJson: jsonb("metadata_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
                 .notNull()
                 .defaultNow()
                 .$onUpdate(() => new Date()),
  },
  (table) => [
    index("tenant_entitlement_overrides_workspace_id_idx").on(table.workspaceId),
    index("tenant_entitlement_overrides_workspace_module_idx").on(
      table.workspaceId,
      table.moduleCode,
    ),
  ],
);

export type TenantEntitlementOverride       = typeof tenantEntitlementOverridesTable.$inferSelect;
export type InsertTenantEntitlementOverride = typeof tenantEntitlementOverridesTable.$inferInsert;
