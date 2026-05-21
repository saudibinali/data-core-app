import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { commercialAccountsTable } from "./commercial-accounts";
import { commercialContractTermsTable } from "./commercial-contract-terms";

/**
 * @file   schema/commercial-invoices.ts
 * @phase  P15-C - Invoice Records (metadata only; PDF in commercial_invoice_documents)
 *
 * SAFETY: no invoice generation, tax, payment, or accounting fields.
 */

export const commercialInvoicesTable = pgTable(
  "commercial_invoices",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    commercialAccountId: integer("commercial_account_id")
      .notNull()
      .references(() => commercialAccountsTable.id, { onDelete: "cascade" }),

    contractTermId: integer("contract_term_id")
      .references(() => commercialContractTermsTable.id, { onDelete: "set null" }),

    invoiceNumber: text("invoice_number").notNull(),
    invoiceTitle:  text("invoice_title"),

    invoiceDate: date("invoice_date"),
    dueDate:     date("due_date"),

    invoiceAmount: numeric("invoice_amount", { precision: 14, scale: 2 }),
    currency:      text("currency"),

    billingPeriodStart: date("billing_period_start"),
    billingPeriodEnd:   date("billing_period_end"),

    status: text("status").notNull().default("draft"),
    // draft | issued | shared | paid | overdue | cancelled

    externalAccountingSystemName: text("external_accounting_system_name"),
    externalAccountingReference:  text("external_accounting_reference"),

    notes: text("notes"),

    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    updatedBy: integer("updated_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("commercial_invoices_workspace_id_idx").on(table.workspaceId),
    index("commercial_invoices_account_id_idx").on(table.commercialAccountId),
    index("commercial_invoices_contract_term_id_idx").on(table.contractTermId),
    uniqueIndex("commercial_invoices_workspace_invoice_number_uidx").on(
      table.workspaceId,
      table.invoiceNumber,
    ),
  ],
);
