/**
 * @phase P15-E - Collection tracking UI static safety
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMERCIAL_SAFETY_CONTRACT } from "../commercial-config";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("COMMERCIAL_SAFETY_CONTRACT P15-E", () => {
  it("manual payment flags are true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.manualPaymentsOnly).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noTenantPaymentActions).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noHardDeletePayment).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.auditPaymentActions).toBe(true);
  });
});

describe("collection tracking UI", () => {
  const panel = readSrc("components/commercial/CollectionTrackingPanel.tsx");
  const invoices = readSrc("components/commercial/InvoicesSection.tsx");
  const tenants = readSrc("pages/super-admin-tenants.tsx");
  const hooks = readSrc("hooks/use-commercial-payments.ts");

  it("panel visible with collection test id", () => {
    expect(panel).toContain("commercial-collection-tracking-panel");
    expect(panel).toContain("Collection Tracking");
  });

  it("buttons gated by record and verify props", () => {
    expect(panel).toContain("canRecord");
    expect(panel).toContain("canVerify");
    expect(panel).toContain("commercial-record-payment-btn");
  });

  it("invoices section wires collection", () => {
    expect(invoices).toContain("canReadPayments");
    expect(invoices).toContain("CollectionTrackingPanel");
    expect(invoices).toContain("commercial-invoice-collection-");
  });

  it("super-admin passes payment permissions", () => {
    expect(tenants).toContain("commercial.payments.read");
    expect(tenants).toContain("canRecordCommercialPayments");
    expect(tenants).toContain("canVerifyCommercialPayments");
  });

  it("react query keys match contract", () => {
    expect(hooks).toContain('["platform", "tenants", tenantId, "commercial-payments"');
    expect(hooks).toContain('"collection-summary"');
  });

  it("no forbidden payment UI", () => {
    const lower = (panel + invoices).toLowerCase();
    for (const term of ["pay now", "stripe", "checkout", "delete payment", "send email", "card number"]) {
      expect(lower.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
