/**
 * @phase P15-C / Commercial simplification - operational invoices UI
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canPerformPlatformAction,
  hasPlatformPermissionClient,
  type MinimalPlatformUser,
} from "../platform-access";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("invoice permission gating", () => {
  const finance: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "finance_admin",
    isRootOwner: false,
  };
  const sales: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "sales_admin",
    isRootOwner: false,
  };
  const auditor: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "auditor",
    isRootOwner: false,
  };
  const support: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "support_admin",
    isRootOwner: false,
  };

  it("finance_admin has full invoice + document access", () => {
    expect(hasPlatformPermissionClient(finance, "commercial.invoices.read")).toBe(true);
    expect(canPerformPlatformAction(finance, "commercial.invoices.update")).toBe(true);
    expect(hasPlatformPermissionClient(finance, "commercial.invoiceDocuments.read")).toBe(true);
    expect(canPerformPlatformAction(finance, "commercial.invoiceDocuments.upload")).toBe(true);
  });

  it("sales_admin can read invoices and documents but not upload", () => {
    expect(hasPlatformPermissionClient(sales, "commercial.invoices.read")).toBe(true);
    expect(canPerformPlatformAction(sales, "commercial.invoices.update")).toBe(false);
    expect(hasPlatformPermissionClient(sales, "commercial.invoiceDocuments.read")).toBe(true);
    expect(canPerformPlatformAction(sales, "commercial.invoiceDocuments.upload")).toBe(false);
  });

  it("auditor can read invoices and documents only", () => {
    expect(hasPlatformPermissionClient(auditor, "commercial.invoices.read")).toBe(true);
    expect(canPerformPlatformAction(auditor, "commercial.invoices.update")).toBe(false);
    expect(hasPlatformPermissionClient(auditor, "commercial.invoiceDocuments.read")).toBe(true);
    expect(canPerformPlatformAction(auditor, "commercial.invoiceDocuments.upload")).toBe(false);
  });

  it("support_admin can read invoices but not documents", () => {
    expect(hasPlatformPermissionClient(support, "commercial.invoices.read")).toBe(true);
    expect(hasPlatformPermissionClient(support, "commercial.invoiceDocuments.read")).toBe(false);
    expect(canPerformPlatformAction(support, "commercial.invoiceDocuments.upload")).toBe(false);
  });
});

describe("operational invoices panel static safety", () => {
  const consolePage = readSrc("components/commercial/CommercialConsole.tsx");
  const panel = readSrc("components/commercial/OperationalInvoicesPanel.tsx");

  it("gates OperationalInvoicesPanel with canReadInvoices", () => {
    expect(consolePage).toContain("canReadInvoices &&");
    expect(consolePage).toContain("<OperationalInvoicesPanel");
  });

  it("exposes invoice test ids", () => {
    expect(panel).toContain('data-testid="operational-invoices-panel"');
    expect(panel).toContain("Add invoice record");
    expect(panel).toContain("CommercialPdfActions");
  });

  it("does not implement forbidden features", () => {
    const lower = panel.toLowerCase();
    for (const term of [
      "stripe",
      "generate invoice",
      "zatca",
      "checkout",
      "delete invoice",
      "send email",
      "amount",
      "due date",
      "invoice status",
      "collection",
    ]) {
      expect(lower.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
