/**
 * @phase P15-D - Frontend tenant billing config
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_BILLING_PERMISSIONS,
  TENANT_BILLING_SAFETY_CONTRACT,
} from "../tenant-billing-config";

describe("TENANT_BILLING_PERMISSIONS", () => {
  it("matches backend permission keys", () => {
    expect(TENANT_BILLING_PERMISSIONS.INVOICES_READ).toBe("tenant.billing.invoices.read");
    expect(TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD).toBe(
      "tenant.billing.invoiceDocuments.download",
    );
  });
});

describe("TENANT_BILLING_SAFETY_CONTRACT", () => {
  it("all safety contract properties are true", () => {
    for (const [key, value] of Object.entries(TENANT_BILLING_SAFETY_CONTRACT)) {
      expect(value, key).toBe(true);
    }
  });
});
