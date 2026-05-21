/**
 * @phase P15-F - Commercial risk engine unit tests
 */

import { describe, it, expect } from "vitest";
import {
  computeTenantCommercialRisk,
  RECOMMENDED_ACTION_CODES,
  RISK_REASON_CODES,
} from "../commercial-risk-engine";

const AS_OF = new Date("2026-05-18T12:00:00.000Z");

function baseInput(overrides: Partial<Parameters<typeof computeTenantCommercialRisk>[0]> = {}) {
  return {
    tenantId: 1,
    tenantName: "Acme",
    contracts: [],
    billingContactCount: 1,
    invoices: [],
    payments: [],
    ...overrides,
  };
}

describe("computeTenantCommercialRisk", () => {
  it("no active contract → critical / no_active_contract / blocked readiness", () => {
    const r = computeTenantCommercialRisk(baseInput(), AS_OF);
    expect(r.riskLevel).toBe("critical");
    expect(r.renewalReadinessStatus).toBe("no_active_contract");
    expect(r.reasons).toContain("active_contract_missing");
    expect(r.signals.activeContractExists).toBe(false);
  });

  it("expired active contract → critical / blocked", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2026-01-01",
            renewalDate: "2026-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
      }),
      AS_OF,
    );
    expect(r.riskLevel).toBe("critical");
    expect(r.renewalReadinessStatus).toBe("blocked");
    expect(r.reasons).toContain("contract_expired");
  });

  it("overdue invoices increase risk to high", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
        invoices: [
          {
            status: "overdue",
            invoiceAmount: "500.00",
            invoiceDate: "2026-01-01",
            hasDocument: true,
            payments: [],
          },
        ],
      }),
      AS_OF,
    );
    expect(r.riskLevel).toBe("high");
    expect(r.reasons).toContain("overdue_invoices_present");
    expect(r.signals.hasOverdueInvoices).toBe(true);
  });

  it("outstanding amount adds reason and affects risk", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
        invoices: [
          {
            status: "issued",
            invoiceAmount: "250.00",
            invoiceDate: "2026-04-01",
            hasDocument: true,
            payments: [],
          },
        ],
      }),
      AS_OF,
    );
    expect(r.reasons).toContain("outstanding_amount_present");
    expect(Number(r.signals.outstandingAmount)).toBeGreaterThan(0);
  });

  it("renewal notice window + not committed → at_risk", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2026-06-01",
            renewalNoticeDays: 60,
            renewalCommitmentStatus: "pending",
          },
        ],
      }),
      AS_OF,
    );
    expect(r.renewalReadinessStatus).toBe("at_risk");
    expect(r.reasons).toContain("renewal_notice_window_open");
    expect(r.reasons).toContain("renewal_commitment_not_committed");
  });

  it("missing billing contact → attention_needed reason", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        billingContactCount: 0,
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
      }),
      AS_OF,
    );
    expect(r.renewalReadinessStatus).toBe("attention_needed");
    expect(r.reasons).toContain("billing_contact_missing");
  });

  it("missing invoice PDF on issued invoice → attention_needed reason", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
        invoices: [
          {
            status: "issued",
            invoiceAmount: "100.00",
            invoiceDate: "2026-04-01",
            hasDocument: false,
            payments: [],
          },
        ],
      }),
      AS_OF,
    );
    expect(r.reasons).toContain("invoice_pdf_missing");
    expect(r.recommendedActions).toContain("upload_missing_invoice_pdf");
  });

  it("rejected payments add reason", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
        payments: [{ paymentDate: "2026-04-01", collectionStatus: "rejected" }],
      }),
      AS_OF,
    );
    expect(r.reasons).toContain("rejected_payment_present");
  });

  it("recommended actions are keys only from known set", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        billingContactCount: 0,
        invoices: [
          {
            status: "overdue",
            invoiceAmount: "100.00",
            invoiceDate: "2026-01-01",
            hasDocument: false,
            payments: [],
          },
        ],
      }),
      AS_OF,
    );
    for (const a of r.recommendedActions) {
      expect(RECOMMENDED_ACTION_CODES).toContain(a);
    }
    for (const reason of r.reasons) {
      expect(RISK_REASON_CODES).toContain(reason);
    }
  });

  it("healthy tenant → low / ready", () => {
    const r = computeTenantCommercialRisk(
      baseInput({
        contracts: [
          {
            status: "active",
            contractEndDate: "2027-12-31",
            renewalDate: "2027-06-01",
            renewalNoticeDays: 30,
            renewalCommitmentStatus: "committed",
          },
        ],
        invoices: [
          {
            status: "paid",
            invoiceAmount: "100.00",
            invoiceDate: "2026-01-01",
            hasDocument: true,
            payments: [
              {
                receivedAmount: "100.00",
                collectionStatus: "verified",
              },
            ],
          },
        ],
      }),
      AS_OF,
    );
    expect(r.riskLevel).toBe("low");
    expect(r.renewalReadinessStatus).toBe("ready");
  });
});
