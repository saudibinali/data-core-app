/**
 * @phase P15-F - Commercial Risk & Renewal Readiness (computed, read-only)
 */

import {
  computeInvoiceCollectionSummary,
  type PaymentAmountRow,
} from "./invoice-collection-summary";

export type CommercialRiskLevel = "low" | "medium" | "high" | "critical";

export type RenewalReadinessStatus =
  | "ready"
  | "attention_needed"
  | "at_risk"
  | "blocked"
  | "no_active_contract";

export const RISK_REASON_CODES = [
  "active_contract_missing",
  "contract_expired",
  "renewal_notice_window_open",
  "renewal_commitment_not_committed",
  "overdue_invoices_present",
  "outstanding_amount_present",
  "rejected_payment_present",
  "billing_contact_missing",
  "invoice_pdf_missing",
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

export const RECOMMENDED_ACTION_CODES = [
  "review_contract_terms",
  "contact_customer_owner",
  "verify_collection_status",
  "upload_missing_invoice_pdf",
  "update_renewal_commitment",
  "review_billing_contacts",
] as const;

export type RecommendedActionCode = (typeof RECOMMENDED_ACTION_CODES)[number];

export interface CommercialRiskSignals {
  activeContractExists: boolean;
  daysUntilContractEnd: number | null;
  daysUntilRenewalDate: number | null;
  renewalCommitmentStatus: string | null;
  renewalNoticeDays: number | null;
  unpaidInvoiceCount: number;
  overdueInvoiceCount: number;
  outstandingAmount: string;
  disputedPaymentCount: number;
  hasRejectedPayments: boolean;
  hasOverdueInvoices: boolean;
  hasExpiredContract: boolean;
  hasMissingBillingContact: boolean;
  hasMissingInvoicePdf: boolean;
  lastPaymentDate: string | null;
  lastInvoiceDate: string | null;
  contractEndDate: string | null;
  renewalDate: string | null;
}

export interface TenantCommercialRiskInput {
  tenantId: number;
  tenantName: string;
  contracts: Array<{
    status: string;
    contractEndDate: string | null;
    renewalDate: string | null;
    renewalNoticeDays: number | null;
    renewalCommitmentStatus: string;
  }>;
  billingContactCount: number;
  invoices: Array<{
    status: string;
    invoiceAmount: string | null;
    invoiceDate: string | null;
    hasDocument: boolean;
    payments: PaymentAmountRow[];
  }>;
  payments: Array<{ paymentDate: string; collectionStatus: string }>;
}

export interface CommercialRiskAssessment {
  tenantId: number;
  tenantName: string;
  riskLevel: CommercialRiskLevel;
  renewalReadinessStatus: RenewalReadinessStatus;
  signals: CommercialRiskSignals;
  reasons: RiskReasonCode[];
  recommendedActions: RecommendedActionCode[];
}

const COMMITTED_STATUSES = new Set(["committed"]);
const VISIBLE_INVOICE_STATUSES = new Set(["issued", "shared", "paid", "overdue", "cancelled"]);

function parseAmount(v: string | null | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(fromIso: string, toDate: Date): number {
  const d = new Date(`${fromIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return NaN;
  return Math.floor((d.getTime() - toDate.getTime()) / 86400000);
}

function pickActiveContract(contracts: TenantCommercialRiskInput["contracts"]) {
  return contracts.find(c => c.status === "active") ?? null;
}

export function computeTenantCommercialRisk(
  input: TenantCommercialRiskInput,
  asOf: Date = new Date(),
): CommercialRiskAssessment {
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const active = pickActiveContract(input.contracts);

  let unpaidInvoiceCount = 0;
  let overdueInvoiceCount = 0;
  let totalOutstanding = 0;
  let disputedPaymentCount = 0;
  let hasRejectedPayments = false;
  let hasMissingInvoicePdf = false;
  let lastInvoiceDate: string | null = null;
  let lastPaymentDate: string | null = null;

  for (const inv of input.invoices) {
    if (!VISIBLE_INVOICE_STATUSES.has(inv.status) && inv.status !== "draft") continue;
    if (inv.invoiceDate) {
      if (!lastInvoiceDate || inv.invoiceDate > lastInvoiceDate) lastInvoiceDate = inv.invoiceDate;
    }
    if (inv.status === "overdue") overdueInvoiceCount += 1;

    const summary = computeInvoiceCollectionSummary(0, inv.invoiceAmount, null, inv.payments);
    if (summary.collectionState === "unpaid" || summary.collectionState === "partially_paid") {
      unpaidInvoiceCount += 1;
    }
    totalOutstanding += parseAmount(summary.outstandingAmount);
    if (summary.hasRejectedPayments) disputedPaymentCount += 1;
    if (summary.collectionState === "disputed") disputedPaymentCount += 1;

    if ((inv.status === "issued" || inv.status === "shared") && !inv.hasDocument) {
      hasMissingInvoicePdf = true;
    }
  }

  for (const p of input.payments) {
    if (p.collectionStatus === "rejected") hasRejectedPayments = true;
    if (!lastPaymentDate || p.paymentDate > lastPaymentDate) lastPaymentDate = p.paymentDate;
  }

  const activeContractExists = !!active;
  const contractEndDate = active?.contractEndDate ?? null;
  const renewalDate = active?.renewalDate ?? null;
  const renewalNoticeDays = active?.renewalNoticeDays ?? null;
  const renewalCommitmentStatus = active?.renewalCommitmentStatus ?? null;

  const daysUntilContractEnd =
    contractEndDate && !Number.isNaN(daysBetween(contractEndDate, today))
      ? daysBetween(contractEndDate, today)
      : null;
  const daysUntilRenewalDate =
    renewalDate && !Number.isNaN(daysBetween(renewalDate, today))
      ? daysBetween(renewalDate, today)
      : null;

  const hasExpiredContract =
    !!active
    && (
      active.status === "expired"
      || (daysUntilContractEnd !== null && daysUntilContractEnd < 0)
    );

  const inRenewalNoticeWindow =
    !!active
    && renewalNoticeDays !== null
    && renewalNoticeDays > 0
    && (
      (daysUntilRenewalDate !== null && daysUntilRenewalDate >= 0 && daysUntilRenewalDate <= renewalNoticeDays)
      || (daysUntilContractEnd !== null && daysUntilContractEnd >= 0 && daysUntilContractEnd <= renewalNoticeDays)
    );

  const commitmentNotCommitted =
    !!active
    && renewalCommitmentStatus !== null
    && !COMMITTED_STATUSES.has(renewalCommitmentStatus);

  const hasMissingBillingContact = input.billingContactCount === 0;
  const hasOverdueInvoices = overdueInvoiceCount > 0;
  const outstandingAmount = totalOutstanding.toFixed(2);

  const signals: CommercialRiskSignals = {
    activeContractExists,
    daysUntilContractEnd,
    daysUntilRenewalDate,
    renewalCommitmentStatus,
    renewalNoticeDays,
    unpaidInvoiceCount,
    overdueInvoiceCount,
    outstandingAmount,
    disputedPaymentCount,
    hasRejectedPayments,
    hasOverdueInvoices,
    hasExpiredContract,
    hasMissingBillingContact,
    hasMissingInvoicePdf,
    lastPaymentDate,
    lastInvoiceDate,
    contractEndDate,
    renewalDate,
  };

  const reasons: RiskReasonCode[] = [];
  const recommendedActions: RecommendedActionCode[] = [];

  if (!activeContractExists) {
    reasons.push("active_contract_missing");
    recommendedActions.push("review_contract_terms");
  }
  if (hasExpiredContract) {
    reasons.push("contract_expired");
    recommendedActions.push("review_contract_terms");
    recommendedActions.push("contact_customer_owner");
  }
  if (inRenewalNoticeWindow) {
    reasons.push("renewal_notice_window_open");
  }
  if (inRenewalNoticeWindow && commitmentNotCommitted) {
    reasons.push("renewal_commitment_not_committed");
    recommendedActions.push("update_renewal_commitment");
    recommendedActions.push("contact_customer_owner");
  }
  if (hasOverdueInvoices) {
    reasons.push("overdue_invoices_present");
    recommendedActions.push("verify_collection_status");
  }
  if (parseAmount(outstandingAmount) > 0) {
    reasons.push("outstanding_amount_present");
    recommendedActions.push("verify_collection_status");
  }
  if (hasRejectedPayments || disputedPaymentCount > 0) {
    reasons.push("rejected_payment_present");
    recommendedActions.push("verify_collection_status");
  }
  if (hasMissingBillingContact) {
    reasons.push("billing_contact_missing");
    recommendedActions.push("review_billing_contacts");
  }
  if (hasMissingInvoicePdf) {
    reasons.push("invoice_pdf_missing");
    recommendedActions.push("upload_missing_invoice_pdf");
  }

  const uniqueReasons = [...new Set(reasons)];
  const uniqueActions = [...new Set(recommendedActions)];

  let renewalReadinessStatus: RenewalReadinessStatus;
  if (!activeContractExists) {
    renewalReadinessStatus = "no_active_contract";
  } else if (hasExpiredContract) {
    renewalReadinessStatus = "blocked";
  } else if (inRenewalNoticeWindow && commitmentNotCommitted) {
    renewalReadinessStatus = "at_risk";
  } else if (
    hasMissingBillingContact
    || hasMissingInvoicePdf
    || hasRejectedPayments
    || hasOverdueInvoices
    || parseAmount(outstandingAmount) > 0
  ) {
    renewalReadinessStatus = "attention_needed";
  } else {
    renewalReadinessStatus = "ready";
  }

  let riskLevel: CommercialRiskLevel = "low";
  if (!activeContractExists || hasExpiredContract) {
    riskLevel = "critical";
  } else if (
    overdueInvoiceCount >= 2
    || (overdueInvoiceCount >= 1 && parseAmount(outstandingAmount) >= 1000)
    || (disputedPaymentCount > 0 && parseAmount(outstandingAmount) >= 1000)
  ) {
    riskLevel = "critical";
  } else if (
    hasOverdueInvoices
    || parseAmount(outstandingAmount) > 0
    || hasRejectedPayments
    || disputedPaymentCount > 0
  ) {
    riskLevel = "high";
  } else if (
    renewalReadinessStatus === "at_risk"
    || renewalReadinessStatus === "attention_needed"
    || inRenewalNoticeWindow
  ) {
    riskLevel = "medium";
  }

  return {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    riskLevel,
    renewalReadinessStatus,
    signals,
    reasons: uniqueReasons,
    recommendedActions: uniqueActions,
  };
}

export interface CommercialRiskPlatformSummary {
  totalTenants: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  readyRenewalsCount: number;
  attentionNeededCount: number;
  atRiskRenewalsCount: number;
  blockedRenewalsCount: number;
  totalOutstandingAmount: string;
  overdueInvoiceCount: number;
  upcomingRenewalsCount: number;
}

export function aggregateCommercialRiskSummary(
  assessments: CommercialRiskAssessment[],
): CommercialRiskPlatformSummary {
  let low = 0;
  let medium = 0;
  let high = 0;
  let critical = 0;
  let ready = 0;
  let attention = 0;
  let atRisk = 0;
  let blocked = 0;
  let totalOutstanding = 0;
  let overdueInvoices = 0;
  let upcomingRenewals = 0;

  for (const a of assessments) {
    if (a.riskLevel === "low") low += 1;
    if (a.riskLevel === "medium") medium += 1;
    if (a.riskLevel === "high") high += 1;
    if (a.riskLevel === "critical") critical += 1;
    if (a.renewalReadinessStatus === "ready") ready += 1;
    if (a.renewalReadinessStatus === "attention_needed") attention += 1;
    if (a.renewalReadinessStatus === "at_risk") atRisk += 1;
    if (a.renewalReadinessStatus === "blocked" || a.renewalReadinessStatus === "no_active_contract") {
      blocked += 1;
    }
    totalOutstanding += parseAmount(a.signals.outstandingAmount);
    overdueInvoices += a.signals.overdueInvoiceCount;
    const d = a.signals.daysUntilRenewalDate;
    if (d !== null && d >= 0 && d <= 90) upcomingRenewals += 1;
  }

  return {
    totalTenants: assessments.length,
    lowRiskCount: low,
    mediumRiskCount: medium,
    highRiskCount: high,
    criticalRiskCount: critical,
    readyRenewalsCount: ready,
    attentionNeededCount: attention,
    atRiskRenewalsCount: atRisk,
    blockedRenewalsCount: blocked,
    totalOutstandingAmount: totalOutstanding.toFixed(2),
    overdueInvoiceCount: overdueInvoices,
    upcomingRenewalsCount: upcomingRenewals,
  };
}
