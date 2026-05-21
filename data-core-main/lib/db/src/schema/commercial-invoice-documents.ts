import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { commercialInvoicesTable } from "./commercial-invoices";
import { usersTable } from "./users";

/**
 * @file   schema/commercial-invoice-documents.ts
 * @phase  P15-C - Uploaded official invoice PDF (one primary document per invoice)
 */

export const commercialInvoiceDocumentsTable = pgTable(
  "commercial_invoice_documents",
  {
    id: serial("id").primaryKey(),

    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => commercialInvoicesTable.id, { onDelete: "cascade" }),

    fileName:         text("file_name").notNull(),
    originalFileName: text("original_file_name").notNull(),
    fileSize:         integer("file_size").notNull(),
    mimeType:         text("mime_type").notNull(),

    storageKey: text("storage_key").notNull(),
    checksum:   text("checksum"),

    uploadedBy: integer("uploaded_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("commercial_invoice_documents_invoice_id_uidx").on(table.invoiceId),
    index("commercial_invoice_documents_storage_key_idx").on(table.storageKey),
  ],
);
