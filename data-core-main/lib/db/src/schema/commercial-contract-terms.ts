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

/**
 * @file   schema/commercial-contract-terms.ts
 * @phase  P15-B - Contract Terms & Renewal Commitments
 *
 * SAFETY CONTRACT:
 *   - No invoice records, PDF uploads, payment, tax, or accounting fields.
 *   - No contract file attachments.
 *   - Platform Administration only (workspace-scoped tenant data).
 */

export const commercialContractTermsTable = pgTable(
  "commercial_contract_terms",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    commercialAccountId: integer("commercial_account_id")
      .notNull()
      .references(() => commercialAccountsTable.id, { onDelete: "cascade" }),

    contractNumber: text("contract_number"),
    contractTitle:  text("contract_title"),

    companyName: text("company_name"),
    responsiblePersonName:  text("responsible_person_name"),
    responsiblePersonPhone: text("responsible_person_phone"),
    responsiblePersonEmail: text("responsible_person_email"),
    notes: text("notes"),

    contractStartDate: date("contract_start_date"),
    contractEndDate:   date("contract_end_date"),
    renewalDate:       date("renewal_date"),

    renewalNoticeDays:  integer("renewal_notice_days"),
    contractTermMonths: integer("contract_term_months"),

    renewalType: text("renewal_type").notNull().default("manual"),
  // manual | auto_renewal | non_renewing | under_negotiation

    renewalCommitmentStatus: text("renewal_commitment_status").notNull().default("not_started"),
  // not_started | pending_customer | pending_internal | committed | declined | expired

    contractValue: numeric("contract_value", { precision: 14, scale: 2 }),
    currency:      text("currency"),

    billingCycle:  text("billing_cycle"),
  // monthly | quarterly | semi_annual | annual | custom

    paymentTerms: text("payment_terms"),
  // due_on_receipt | net_15 | net_30 | net_45 | net_60 | custom

    internalOwnerUserId: integer("internal_owner_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    customerDecisionMakerName:  text("customer_decision_maker_name"),
    customerDecisionMakerEmail: text("customer_decision_maker_email"),

    renewalNotes: text("renewal_notes"),

    status: text("status").notNull().default("draft"),
  // draft | active | expired | terminated | archived

    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    updatedBy: integer("updated_by")
      .references(() => usersTable.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("commercial_contract_terms_workspace_id_idx").on(t.workspaceId),
    index("commercial_contract_terms_account_id_idx").on(t.commercialAccountId),
    index("commercial_contract_terms_status_idx").on(t.workspaceId, t.status),
  ],
);

export type CommercialContractTerm = typeof commercialContractTermsTable.$inferSelect;
export type InsertCommercialContractTerm = typeof commercialContractTermsTable.$inferInsert;
