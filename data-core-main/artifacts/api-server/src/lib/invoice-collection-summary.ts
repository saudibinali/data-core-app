/**
 * @phase P15-E - Computed invoice collection summary (not persisted)
 */

export const PAYMENT_METHODS = [
  "bank_transfer",
  "cheque",
  "cash",
  "internal_adjustment",
  "other",
] as const;

export const COLLECTION_STATUSES = [
  "pending_verification",
  "verified",
  "rejected",
  "partially_applied",
  "reversed",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export type CollectionState =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "disputed";

/** Counts toward verified balance. */
export const VERIFIED_COLLECTION_STATUSES: ReadonlySet<string> = new Set([
  "verified",
  "partially_applied",
]);

/** Counts toward recorded (pipeline) total - excludes rejected and reversed. */
export const RECORDED_COLLECTION_STATUSES: ReadonlySet<string> = new Set([
  "pending_verification",
  "verified",
  "partially_applied",
]);

export interface PaymentAmountRow {
  receivedAmount: string | null;
  collectionStatus: string;
}

export interface InvoiceCollectionSummary {
  invoiceId: number;
  invoiceAmount: string | null;
  currency: string | null;
  totalRecordedPayments: string;
  totalVerifiedPayments: string;
  outstandingAmount: string;
  collectionState: CollectionState;
  paymentCount: number;
  verifiedPaymentCount: number;
  hasRejectedPayments: boolean;
}

function parseAmount(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmount(n: number): string {
  return n.toFixed(2);
}

export function computeInvoiceCollectionSummary(
  invoiceId: number,
  invoiceAmount: string | null,
  currency: string | null,
  payments: PaymentAmountRow[],
): InvoiceCollectionSummary {
  let totalRecorded = 0;
  let totalVerified = 0;
  let verifiedPaymentCount = 0;
  let hasRejected = false;

  for (const p of payments) {
    const amt = parseAmount(p.receivedAmount);
    if (p.collectionStatus === "rejected") {
      hasRejected = true;
      continue;
    }
    if (p.collectionStatus === "reversed") {
      continue;
    }
    if (RECORDED_COLLECTION_STATUSES.has(p.collectionStatus)) {
      totalRecorded += amt;
    }
    if (VERIFIED_COLLECTION_STATUSES.has(p.collectionStatus)) {
      totalVerified += amt;
      verifiedPaymentCount += 1;
    }
  }

  const invoiceAmt = parseAmount(invoiceAmount);
  const outstanding = Math.max(0, invoiceAmt - totalVerified);

  let collectionState: CollectionState;
  if (hasRejected && totalVerified < invoiceAmt) {
    collectionState = "disputed";
  } else if (totalVerified <= 0) {
    collectionState = "unpaid";
  } else if (invoiceAmt > 0 && totalVerified > invoiceAmt) {
    collectionState = "overpaid";
  } else if (invoiceAmt > 0 && totalVerified >= invoiceAmt) {
    collectionState = "paid";
  } else if (invoiceAmt > 0 && totalVerified < invoiceAmt) {
    collectionState = "partially_paid";
  } else if (totalVerified > 0) {
    collectionState = "paid";
  } else {
    collectionState = "unpaid";
  }

  return {
    invoiceId,
    invoiceAmount,
    currency,
    totalRecordedPayments: fmtAmount(totalRecorded),
    totalVerifiedPayments: fmtAmount(totalVerified),
    outstandingAmount: fmtAmount(outstanding),
    collectionState,
    paymentCount: payments.length,
    verifiedPaymentCount,
    hasRejectedPayments: hasRejected,
  };
}
