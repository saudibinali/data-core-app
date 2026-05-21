/**
 * @phase P15-D - Tenant billing invoices (embedded in subscription status)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("tenant billing invoices wiring", () => {
  const app = readSrc("App.tsx");
  const subscription = readSrc("pages/subscription-status.tsx");
  const section = readSrc("components/subscription/TenantBillingInvoicesSection.tsx");
  const redirect = readSrc("pages/billing-invoices.tsx");
  const hooks = readSrc("hooks/use-tenant-billing.ts");

  it("redirects legacy /billing/invoices to subscription status", () => {
    expect(app).toContain('/billing/invoices');
    expect(app).toContain('Redirect to="/subscription/status"');
    expect(redirect).toContain('Redirect to="/subscription/status"');
  });

  it("subscription page embeds invoices when billing permission granted", () => {
    expect(subscription).toContain("TenantBillingInvoicesSection");
    expect(subscription).toContain("TENANT_BILLING_PERMISSIONS.INVOICES_READ");
    expect(section).toContain('data-testid="tenant-subscription-invoices-section"');
  });

  it("invoice section gated by download permission for PDF", () => {
    expect(section).toContain("TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD");
    expect(section).toContain("canDownload");
    expect(section).toContain("tenant-billing-download-");
  });

  it("react query keys match contract", () => {
    expect(hooks).toContain('["tenant", "billing", "invoices"');
    expect(hooks).toContain('["tenant", "billing", "invoices", invoiceId]');
  });

  it("does not implement forbidden features", () => {
    const lower = (section + subscription + app).toLowerCase();
    for (const term of [
      "pay now",
      "stripe",
      "checkout",
      "upload invoice",
      "edit invoice",
      "delete invoice",
      "generate invoice",
      "send email",
    ]) {
      expect(lower.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
