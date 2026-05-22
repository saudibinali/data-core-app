import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { commercialContractTermsTable } from "./commercial-contract-terms";
import { usersTable } from "./users";

/** Final signed contract PDF — one document per contract record. */
export const commercialContractDocumentsTable = pgTable(
  "commercial_contract_documents",
  {
    id: serial("id").primaryKey(),

    contractId: integer("contract_id")
      .notNull()
      .references(() => commercialContractTermsTable.id, { onDelete: "cascade" }),

    fileName: text("file_name").notNull(),
    originalFileName: text("original_file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),

    storageKey: text("storage_key").notNull(),
    checksum: text("checksum"),

    uploadedBy: integer("uploaded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("commercial_contract_documents_contract_id_uidx").on(table.contractId),
    index("commercial_contract_documents_storage_key_idx").on(table.storageKey),
  ],
);

export type CommercialContractDocument =
  typeof commercialContractDocumentsTable.$inferSelect;
