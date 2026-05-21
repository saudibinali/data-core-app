/**
 * @phase P15-H - Phase 15 final closure QA (static)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMMERCIAL_SAFETY_CONTRACT } from "../commercial-config";
import { PLATFORM_PERMISSION_CODES } from "../platform-permissions-config";

const ROOT = resolve(import.meta.dirname, "../..");
const API_ROUTES = resolve(import.meta.dirname, "../../../../api-server/src/routes");
const DOC_CANDIDATES = [
  resolve(import.meta.dirname, "../../../../../docs/commercial-administration.md"),
  resolve(import.meta.dirname, "../../../../docs/commercial-administration.md"),
];
const DOC = DOC_CANDIDATES.find(p => existsSync(p)) ?? DOC_CANDIDATES[0];

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function readRoute(name: string): string {
  return readFileSync(resolve(API_ROUTES, name), "utf8");
}

const PLATFORM_COMMERCIAL_PERMS = [
  "commercial.accounts.read",
  "commercial.accounts.update",
  "commercial.contacts.read",
  "commercial.contacts.update",
  "commercial.contracts.read",
  "commercial.contracts.update",
  "commercial.invoices.read",
  "commercial.invoices.update",
  "commercial.invoiceDocuments.read",
  "commercial.invoiceDocuments.upload",
  "commercial.payments.read",
  "commercial.payments.record",
  "commercial.payments.verify",
  "commercial.risk.read",
] as const;

const TENANT_BILLING_PERMS = [
  "tenant.billing.invoices.read",
  "tenant.billing.invoiceDocuments.download",
] as const;

const SAFETY_FLAGS = [
  "noElectronicPayment",
  "noStripe",
  "noCheckout",
  "noCardStorage",
  "noAutoCharge",
  "noPaymentGateway",
  "noInvoiceGenerationEngine",
  "uploadedInvoicePdfOnly",
  "noTaxCalculation",
  "noZatcaIntegration",
  "noAccountingLedger",
  "noEmailSending",
  "manualPaymentsOnly",
  "noBankApiIntegration",
  "noTenantPaymentActions",
  "noCustomerPaymentPortal",
  "commercialRiskReadOnly",
  "noAutomatedDunning",
  "noAutomatedRenewalActions",
  "noAutoStatusChanges",
  "commercialConsoleReadOnlyIntegration",
  "noDestructiveCommercialActions",
  "sectionPermissionGated",
] as const;

describe("P15-H documentation", () => {
  it("commercial-administration.md exists", () => {
    expect(existsSync(DOC)).toBe(true);
    const doc = readFileSync(DOC, "utf8");
    expect(doc).toContain("Commercial Administration");
    expect(doc).toContain("does **not**");
  });
});

describe("P15-H permissions final list", () => {
  it("platform permission catalog length is stable", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBeGreaterThanOrEqual(55);
  });

  it.each(PLATFORM_COMMERCIAL_PERMS)("%s is in platform permissions", code => {
    expect(PLATFORM_PERMISSION_CODES).toContain(code);
  });

  it("tenant billing permissions exist in tenant-billing-config", () => {
    const cfg = read("lib/tenant-billing-config.ts");
    for (const code of TENANT_BILLING_PERMS) {
      expect(cfg).toContain(code);
    }
  });
});

describe("P15-H safety contract", () => {
  it.each(SAFETY_FLAGS)("%s is true", flag => {
    expect(COMMERCIAL_SAFETY_CONTRACT[flag]).toBe(true);
  });
});

describe("P15-H backend forbidden patterns", () => {
  const commercialRoutes = [
    "commercial.ts",
    "commercial-contracts.ts",
    "commercial-invoices.ts",
    "commercial-payments.ts",
    "commercial-risk.ts",
    "commercial-activity.ts",
    "tenant-billing.ts",
  ].map(readRoute).join("\n");

  it("commercial safety contract enforced in config", () => {
    const cfg = read("lib/commercial-config.ts");
    expect(cfg).toContain("noStripe");
    expect(cfg).toContain("noPaymentGateway");
    expect(commercialRoutes).not.toMatch(/from\s+["']stripe["']/i);
  });

  it("risk and tenant billing are GET-focused", () => {
    expect(readRoute("commercial-risk.ts")).not.toMatch(/router\.(post|patch|delete)\(/i);
    expect(readRoute("tenant-billing.ts")).not.toMatch(/router\.(post|patch|delete)\(/i);
  });

  it("commercial-activity route exists and is GET", () => {
    expect(readRoute("commercial-activity.ts")).toContain("/commercial-activity");
    expect(readRoute("commercial-activity.ts")).toContain("requireAnyPlatformPermission");
  });
});

describe("P15-H frontend smoke", () => {
  const consoleSrc = read("components/commercial/CommercialConsole.tsx");
  const riskPage = read("pages/super-admin-commercial-risk.tsx");
  const billing = read("components/subscription/TenantBillingInvoicesSection.tsx");
  const activity = read("components/commercial/CommercialActivitySection.tsx");

  it("commercial console integrated", () => {
    expect(consoleSrc).toContain("commercial-console");
    expect(consoleSrc).toContain("CommercialActivitySection");
  });

  it("risk deep link to tenant commercial tab", () => {
    expect(riskPage).toContain("tab=commercial");
    expect(riskPage).toContain("tenantId=");
  });

  it("tenant billing read-only cues", () => {
    expect(billing).toContain("tenant-subscription-invoices-section");
    const lower = billing.toLowerCase();
    expect(lower.includes("pay now")).toBe(false);
    expect(lower.includes("stripe")).toBe(false);
  });

  it("activity section wired", () => {
    expect(activity).toContain("commercial-activity-list");
    expect(activity).toContain("useTenantCommercialActivity");
  });

  it("forbidden UI terms absent in commercial surfaces", () => {
    const blob = (consoleSrc + riskPage + billing + activity).toLowerCase();
    for (const term of [
      "pay now",
      "stripe",
      "checkout",
      "generate invoice",
      "zatca",
      "tax calculation",
      "send email",
      "auto collect",
      "auto renew",
    ]) {
      expect(blob.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});

describe("P15-A through P15-G component presence", () => {
  it("core commercial modules exist", () => {
    expect(existsSync(resolve(ROOT, "components/commercial/CommercialAccountSection.tsx"))).toBe(true);
    expect(existsSync(resolve(ROOT, "components/commercial/ContractTermsSection.tsx"))).toBe(true);
    expect(existsSync(resolve(ROOT, "components/commercial/InvoicesSection.tsx"))).toBe(true);
    expect(existsSync(resolve(ROOT, "components/commercial/CollectionTrackingPanel.tsx"))).toBe(true);
    expect(existsSync(resolve(ROOT, "components/commercial/CommercialRiskSection.tsx"))).toBe(true);
    expect(existsSync(resolve(ROOT, "components/subscription/TenantBillingInvoicesSection.tsx"))).toBe(true);
  });
});
