import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { commercialAccountsTable } from "./commercial-accounts";
import { commercialInvoicesTable } from "./commercial-invoices";

/**
 * @file   schema/commercial-payment-records.ts
 * @phase  P15-E - Manual Payment & Collection Tracking
 *
 * SAFETY: manual off-platform payments only - no gateway, card, or bank API fields.
 */

export const commercialPaymentRecordsTable = pgTable(
  "commercial_payment_records",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    commercialAccountId: integer("commercial_account_id")
      .notNull()
      .references(() => commercialAccountsTable.id, { onDelete: "cascade" }),

    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => commercialInvoicesTable.id, { onDelete: "cascade" }),

    paymentReference: text("payment_reference").notNull(),
    paymentDate: date("payment_date").notNull(),

    receivedAmount: numeric("received_amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),

    paymentMethod: text("payment_method").notNull(),
    // bank_transfer | cheque | cash | internal_adjustment | other

    collectionStatus: text("collection_status").notNull().default("pending_verification"),
    // pending_verification | verified | rejected | partially_applied | reversed

    recordedByUserId: integer("recorded_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),

    verifiedByUserId: integer("verified_by_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    verificationDate: timestamp("verification_date", { withTimezone: true }),

    internalNotes: text("internal_notes"),
    rejectionReason: text("rejection_reason"),

    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    updatedBy: integer("updated_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("commercial_payment_records_workspace_id_idx").on(table.workspaceId),
    index("commercial_payment_records_invoice_id_idx").on(table.invoiceId),
    index("commercial_payment_records_account_id_idx").on(table.commercialAccountId),
    index("commercial_payment_records_status_idx").on(table.collectionStatus),
    index("commercial_payment_records_payment_date_idx").on(table.paymentDate),
  ],
);
