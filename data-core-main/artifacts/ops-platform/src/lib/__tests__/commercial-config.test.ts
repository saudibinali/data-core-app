/**
 * commercial-config.test.ts
 *
 * @phase P15-A - Commercial Accounts & Billing Contacts
 *
 * Unit tests for the frontend commercial-config module.
 * Tests the safety contract, status configs, contact role configs,
 * and validation constants.
 *
 * Pure vitest unit tests - no React, no network, no DB.
 */

import { describe, it, expect } from "vitest";
import {
  COMMERCIAL_SAFETY_CONTRACT,
  COMMERCIAL_ACCOUNT_STATUS_CONFIG,
  COMMERCIAL_ACCOUNT_STATUS_CODES,
  BILLING_CONTACT_ROLE_CONFIG,
  BILLING_CONTACT_ROLE_CODES,
  COMMERCIAL_PERMISSION_CONFIG,
  COMMERCIAL_VALIDATION,
  COMMERCIAL_INVOICE_STATUS_CONFIG,
  COMMERCIAL_INVOICE_STATUS_CODES,
} from "../commercial-config";

// ── Safety Contract ───────────────────────────────────────────────────────────

describe("COMMERCIAL_SAFETY_CONTRACT", () => {
  it("every property is true", () => {
    for (const [key, value] of Object.entries(COMMERCIAL_SAFETY_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("noElectronicPayment is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noElectronicPayment).toBe(true);
  });

  it("noStripe is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noStripe).toBe(true);
  });

  it("noTaxCalculation is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noTaxCalculation).toBe(true);
  });

  it("noDeleteContact is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noDeleteContact).toBe(true);
  });

  it("noEmailSending is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noEmailSending).toBe(true);
  });

  it("noTenantSideVisibility is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noTenantSideVisibility).toBe(true);
  });

  it("uploadedInvoicePdfOnly is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.uploadedInvoicePdfOnly).toBe(true);
  });

  it("noHardDeleteInvoice is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.noHardDeleteInvoice).toBe(true);
  });

  it("protectedPdfDownload is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.protectedPdfDownload).toBe(true);
  });

  it("pdfOnlyUpload is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.pdfOnlyUpload).toBe(true);
  });

  it("auditInvoiceChanges is true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.auditInvoiceChanges).toBe(true);
  });

  it("P15-F risk read-only flags are true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.commercialRiskReadOnly).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noAutomatedDunning).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.auditRiskDetailViews).toBe(true);
  });

  it("P15-G console integration flags are true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.commercialConsoleReadOnlyIntegration).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.riskReadOnlyIntegrated).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.sectionPermissionGated).toBe(true);
  });
});

// ── Commercial Account Status Config ─────────────────────────────────────────

describe("COMMERCIAL_ACCOUNT_STATUS_CONFIG", () => {
  const EXPECTED_STATUSES = ["draft", "active", "under_review", "inactive"] as const;

  it("contains exactly 4 statuses", () => {
    expect(COMMERCIAL_ACCOUNT_STATUS_CODES.length).toBe(4);
  });

  it.each(EXPECTED_STATUSES)("status '%s' is defined", (status) => {
    expect(COMMERCIAL_ACCOUNT_STATUS_CONFIG[status]).toBeDefined();
  });

  it.each(EXPECTED_STATUSES)("status '%s' has required fields", (status) => {
    const cfg = COMMERCIAL_ACCOUNT_STATUS_CONFIG[status];
    expect(cfg.code).toBe(status);
    expect(typeof cfg.label).toBe("string");
    expect(typeof cfg.labelAr).toBe("string");
    expect(typeof cfg.description).toBe("string");
    expect(["default", "secondary", "destructive", "outline"]).toContain(cfg.variant);
  });

  it("draft status uses 'secondary' variant", () => {
    expect(COMMERCIAL_ACCOUNT_STATUS_CONFIG.draft.variant).toBe("secondary");
  });

  it("active status uses 'default' variant", () => {
    expect(COMMERCIAL_ACCOUNT_STATUS_CONFIG.active.variant).toBe("default");
  });

  it("inactive status uses 'destructive' variant", () => {
    expect(COMMERCIAL_ACCOUNT_STATUS_CONFIG.inactive.variant).toBe("destructive");
  });
});

// ── Billing Contact Role Config ───────────────────────────────────────────────

describe("BILLING_CONTACT_ROLE_CONFIG", () => {
  const EXPECTED_ROLES = [
    "finance_contact",
    "procurement_contact",
    "contract_owner",
    "executive_sponsor",
    "other",
  ] as const;

  it("contains exactly 5 roles", () => {
    expect(BILLING_CONTACT_ROLE_CODES.length).toBe(5);
  });

  it.each(EXPECTED_ROLES)("role '%s' is defined", (role) => {
    expect(BILLING_CONTACT_ROLE_CONFIG[role]).toBeDefined();
  });

  it.each(EXPECTED_ROLES)("role '%s' has required fields", (role) => {
    const cfg = BILLING_CONTACT_ROLE_CONFIG[role];
    expect(cfg.code).toBe(role);
    expect(typeof cfg.label).toBe("string");
    expect(typeof cfg.labelAr).toBe("string");
    expect(typeof cfg.description).toBe("string");
  });

  it("'other' role exists as the fallback", () => {
    expect(BILLING_CONTACT_ROLE_CONFIG.other).toBeDefined();
    expect(BILLING_CONTACT_ROLE_CONFIG.other.code).toBe("other");
  });
});

// ── Commercial Permission Config ──────────────────────────────────────────────

describe("COMMERCIAL_PERMISSION_CONFIG", () => {
  const EXPECTED_CODES = [
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
  ] as const;

  it.each(EXPECTED_CODES)("permission '%s' is defined", (code) => {
    expect(COMMERCIAL_PERMISSION_CONFIG[code]).toBeDefined();
  });

  it.each(EXPECTED_CODES)("permission '%s' has required fields", (code) => {
    const cfg = COMMERCIAL_PERMISSION_CONFIG[code];
    expect(cfg.code).toBe(code);
    expect(typeof cfg.label).toBe("string");
    expect(typeof cfg.labelAr).toBe("string");
    expect(typeof cfg.description).toBe("string");
  });
});

// ── Validation Constants ──────────────────────────────────────────────────────

describe("COMMERCIAL_VALIDATION", () => {
  it("commercialAccountName.maxLength is 200", () => {
    expect(COMMERCIAL_VALIDATION.commercialAccountName.maxLength).toBe(200);
  });

  it("legalEntityName.maxLength is 200", () => {
    expect(COMMERCIAL_VALIDATION.legalEntityName.maxLength).toBe(200);
  });

  it("commercialNotes.maxLength is 2000", () => {
    expect(COMMERCIAL_VALIDATION.commercialNotes.maxLength).toBe(2000);
  });

  it("contactName.maxLength is 150", () => {
    expect(COMMERCIAL_VALIDATION.contactName.maxLength).toBe(150);
  });

  it("contactPhone.maxLength is 30", () => {
    expect(COMMERCIAL_VALIDATION.contactPhone.maxLength).toBe(30);
  });
});

describe("COMMERCIAL_INVOICE_STATUS_CONFIG", () => {
  const EXPECTED = ["draft", "issued", "shared", "paid", "overdue", "cancelled"] as const;

  it("contains exactly 6 invoice statuses", () => {
    expect(COMMERCIAL_INVOICE_STATUS_CODES.length).toBe(6);
  });

  it.each(EXPECTED)("status '%s' is defined", (status) => {
    expect(COMMERCIAL_INVOICE_STATUS_CONFIG[status]).toBeDefined();
  });
});
