import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

/**
 * @file   schema/commercial-accounts.ts
 * @phase  P15-A - Commercial Accounts & Billing Contacts
 *
 * Two tables:
 *   commercial_accounts         - one-to-one with workspace tenant
 *   commercial_billing_contacts - many contacts per commercial account
 *
 * SAFETY CONTRACT:
 *   - No payment provider IDs, card data, invoice IDs, tax fields.
 *   - No auto-charge, gateway, or Stripe references.
 *   - No tenant-side visibility - Platform Administration only.
 *   - companyTaxNumberPlaceholder is a plain text placeholder only - no calculation.
 *   - One commercial account per workspace (unique constraint on workspaceId).
 *   - Cascades on workspace delete.
 */

// ── commercial_accounts ───────────────────────────────────────────────────────

export const commercialAccountsTable = pgTable(
  "commercial_accounts",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .unique()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    commercialAccountName: text("commercial_account_name"),
    legalEntityName:       text("legal_entity_name"),

    accountManagerUserId: integer("account_manager_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    financeOwnerUserId: integer("finance_owner_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    contractOwnerName:  text("contract_owner_name"),
    contractOwnerEmail: text("contract_owner_email"),

    billingEmail: text("billing_email"),
    billingPhone: text("billing_phone"),

    companyTaxNumberPlaceholder: text("company_tax_number_placeholder"),

    commercialNotes: text("commercial_notes"),

    status: text("status").notNull().default("draft"),

    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    updatedBy: integer("updated_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("commercial_accounts_workspace_id_idx").on(t.workspaceId),
  ],
);

export type CommercialAccount = typeof commercialAccountsTable.$inferSelect;
export type InsertCommercialAccount = typeof commercialAccountsTable.$inferInsert;

// ── commercial_billing_contacts ───────────────────────────────────────────────

export const commercialBillingContactsTable = pgTable(
  "commercial_billing_contacts",
  {
    id: serial("id").primaryKey(),

    commercialAccountId: integer("commercial_account_id")
      .notNull()
      .references(() => commercialAccountsTable.id, { onDelete: "cascade" }),

    contactName:  text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    contactRole:  text("contact_role").notNull().default("other"),

    isPrimary: boolean("is_primary").notNull().default(false),
    notes:     text("notes"),

    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    updatedBy: integer("updated_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("commercial_billing_contacts_account_id_idx").on(t.commercialAccountId),
  ],
);

export type CommercialBillingContact = typeof commercialBillingContactsTable.$inferSelect;
export type InsertCommercialBillingContact = typeof commercialBillingContactsTable.$inferInsert;
