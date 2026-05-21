/**
 * @phase P15-E - Collection summary computation
 */

import { describe, it, expect } from "vitest";
import { computeInvoiceCollectionSummary } from "../invoice-collection-summary";

describe("computeInvoiceCollectionSummary", () => {
  const invoiceAmount = "1000.00";

  it("unpaid when no verified payments", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "200.00", collectionStatus: "pending_verification" },
    ]);
    expect(s.collectionState).toBe("unpaid");
    expect(s.totalRecordedPayments).toBe("200.00");
    expect(s.totalVerifiedPayments).toBe("0.00");
    expect(s.outstandingAmount).toBe("1000.00");
  });

  it("partially_paid when verified below invoice amount", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "400.00", collectionStatus: "verified" },
    ]);
    expect(s.collectionState).toBe("partially_paid");
    expect(s.totalVerifiedPayments).toBe("400.00");
    expect(s.outstandingAmount).toBe("600.00");
  });

  it("paid when verified equals invoice amount", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "600.00", collectionStatus: "verified" },
      { receivedAmount: "400.00", collectionStatus: "partially_applied" },
    ]);
    expect(s.collectionState).toBe("paid");
    expect(s.totalVerifiedPayments).toBe("1000.00");
    expect(s.outstandingAmount).toBe("0.00");
  });

  it("overpaid when verified exceeds invoice amount", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "1200.00", collectionStatus: "verified" },
    ]);
    expect(s.collectionState).toBe("overpaid");
    expect(s.outstandingAmount).toBe("0.00");
  });

  it("excludes rejected and reversed from verified totals", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "500.00", collectionStatus: "verified" },
      { receivedAmount: "300.00", collectionStatus: "rejected" },
      { receivedAmount: "200.00", collectionStatus: "reversed" },
    ]);
    expect(s.totalVerifiedPayments).toBe("500.00");
    expect(s.totalRecordedPayments).toBe("500.00");
  });

  it("disputed when rejected exists and not fully paid", () => {
    const s = computeInvoiceCollectionSummary(1, invoiceAmount, "SAR", [
      { receivedAmount: "100.00", collectionStatus: "rejected" },
      { receivedAmount: "200.00", collectionStatus: "verified" },
    ]);
    expect(s.collectionState).toBe("disputed");
  });
});
