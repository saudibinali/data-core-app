/**
 * @phase P15-D - Tenant billing config & safety contract
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_BILLING_PERMISSIONS,
  TENANT_BILLING_SAFETY_CONTRACT,
  TENANT_VISIBLE_INVOICE_STATUSES,
} from "../tenant-billing-config";

describe("TENANT_BILLING_PERMISSIONS", () => {
  it("defines read and download keys", () => {
    expect(TENANT_BILLING_PERMISSIONS.INVOICES_READ).toBe("tenant.billing.invoices.read");
    expect(TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD).toBe(
      "tenant.billing.invoiceDocuments.download",
    );
  });
});

describe("TENANT_BILLING_SAFETY_CONTRACT", () => {
  it("all properties are true", () => {
    for (const [key, value] of Object.entries(TENANT_BILLING_SAFETY_CONTRACT)) {
      expect(value, key).toBe(true);
    }
  });

  it("has expected guard flags", () => {
    expect(TENANT_BILLING_SAFETY_CONTRACT.noElectronicPayment).toBe(true);
    expect(TENANT_BILLING_SAFETY_CONTRACT.protectedPdfDownload).toBe(true);
    expect(TENANT_BILLING_SAFETY_CONTRACT.enforceWorkspaceIsolation).toBe(true);
    expect(TENANT_BILLING_SAFETY_CONTRACT.auditTenantInvoiceAccess).toBe(true);
  });
});

describe("TENANT_VISIBLE_INVOICE_STATUSES", () => {
  it("excludes draft", () => {
    expect(TENANT_VISIBLE_INVOICE_STATUSES).not.toContain("draft");
  });
});
