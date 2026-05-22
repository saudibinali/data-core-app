/**
 * Operational commercial DTOs and reminder derivation (super-admin only).
 */
import type {
  CommercialContractTerm,
  CommercialInvoice,
  CommercialContractDocument,
  CommercialInvoiceDocument,
} from "@workspace/db";

export type ReminderUrgency = "none" | "upcoming" | "due" | "overdue";

export type OperationalReminder = {
  code: string;
  label: string;
  urgency: ReminderUrgency;
  relatedDate: string | null;
};

const DAY_MS = 86400000;

function utcDay(isoDate: string, asOf: Date): number {
  const target = new Date(`${isoDate}T00:00:00.000Z`);
  const today = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

function urgencyFromDays(daysUntil: number): ReminderUrgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 7) return "due";
  if (daysUntil <= 30) return "upcoming";
  return "none";
}

export function deriveDateReminder(
  code: string,
  label: string,
  isoDate: string | null | undefined,
  asOf: Date,
): OperationalReminder | null {
  if (!isoDate) return null;
  const days = utcDay(isoDate, asOf);
  const urgency = urgencyFromDays(days);
  if (urgency === "none") return null;
  return { code, label, urgency, relatedDate: isoDate };
}

export function pickPrimaryReminder(reminders: OperationalReminder[]): OperationalReminder | null {
  const order: ReminderUrgency[] = ["overdue", "due", "upcoming", "none"];
  for (const u of order) {
    const hit = reminders.find((r) => r.urgency === u);
    if (hit) return hit;
  }
  return null;
}

export type OperationalContract = {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractNumber: string | null;
  contractTitle: string | null;
  companyName: string | null;
  responsiblePersonName: string | null;
  responsiblePersonPhone: string | null;
  responsiblePersonEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalReminderDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  reminders: OperationalReminder[];
  primaryReminder: OperationalReminder | null;
  createdAt: string;
  updatedAt: string;
};

export function toOperationalContract(
  row: CommercialContractTerm,
  doc: CommercialContractDocument | null | undefined,
  asOf = new Date(),
): OperationalContract {
  const startDate = row.contractStartDate ?? null;
  const endDate = row.contractEndDate ?? null;
  const renewalReminderDate = row.renewalDate ?? null;

  const reminders = [
    deriveDateReminder("contract_end", "Contract ending", endDate, asOf),
    deriveDateReminder("renewal", "Renewal reminder", renewalReminderDate, asOf),
  ].filter((r): r is OperationalReminder => r !== null);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    commercialAccountId: row.commercialAccountId,
    contractNumber: row.contractNumber,
    contractTitle: row.contractTitle,
    companyName:
      row.companyName ??
      null,
    responsiblePersonName:
      row.responsiblePersonName ?? row.customerDecisionMakerName ?? null,
    responsiblePersonPhone: row.responsiblePersonPhone ?? null,
    responsiblePersonEmail:
      row.responsiblePersonEmail ?? row.customerDecisionMakerEmail ?? null,
    startDate,
    endDate,
    renewalReminderDate,
    notes: row.notes ?? row.renewalNotes ?? null,
    hasDocument: !!doc,
    reminders,
    primaryReminder: pickPrimaryReminder(reminders),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type OperationalInvoice = {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractTermId: number | null;
  invoiceNumber: string;
  responsiblePersonName: string | null;
  responsiblePersonPhone: string | null;
  responsiblePersonEmail: string | null;
  reminderDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  uploadedAt: string | null;
  uploadedBy: number | null;
  reminders: OperationalReminder[];
  primaryReminder: OperationalReminder | null;
  createdAt: string;
  updatedAt: string;
};

export function toOperationalInvoice(
  row: CommercialInvoice,
  doc: CommercialInvoiceDocument | null | undefined,
  asOf = new Date(),
): OperationalInvoice {
  const reminderDate = row.reminderDate ?? row.dueDate ?? null;
  const reminders = [
    deriveDateReminder("payment_reminder", "Payment reminder", reminderDate, asOf),
    !doc ? { code: "missing_pdf", label: "PDF not uploaded", urgency: "due" as const, relatedDate: null } : null,
  ].filter((r): r is OperationalReminder => r !== null);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    commercialAccountId: row.commercialAccountId,
    contractTermId: row.contractTermId,
    invoiceNumber: row.invoiceNumber,
    responsiblePersonName: row.responsiblePersonName ?? null,
    responsiblePersonPhone: row.responsiblePersonPhone ?? null,
    responsiblePersonEmail: row.responsiblePersonEmail ?? null,
    reminderDate,
    notes: row.notes ?? null,
    hasDocument: !!doc,
    uploadedAt: doc?.uploadedAt?.toISOString() ?? null,
    uploadedBy: doc?.uploadedBy ?? null,
    reminders,
    primaryReminder: pickPrimaryReminder(reminders),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
