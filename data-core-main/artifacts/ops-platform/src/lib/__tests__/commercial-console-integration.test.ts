/**
 * @phase P15-G / Commercial simplification - operational console integration (static)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMERCIAL_SAFETY_CONTRACT } from "../commercial-config";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("COMMERCIAL_SAFETY_CONTRACT P15-G", () => {
  it("integration flags are true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.commercialConsoleReadOnlyIntegration).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noDestructiveCommercialActions).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.sectionPermissionGated).toBe(true);
  });
});

describe("unified operational commercial console", () => {
  const consoleSrc = readSrc("components/commercial/CommercialConsole.tsx");
  const tenants = readSrc("pages/super-admin-tenants.tsx");
  const contracts = readSrc("components/commercial/OperationalContractsPanel.tsx");
  const invoices = readSrc("components/commercial/OperationalInvoicesPanel.tsx");

  it("CommercialConsole renders with test id and operational sections", () => {
    expect(consoleSrc).toContain('data-testid="commercial-console"');
    expect(consoleSrc).toContain("commercial-console-section-contracts");
    expect(consoleSrc).toContain("commercial-console-section-invoices");
    expect(consoleSrc).toContain("<OperationalContractsPanel");
    expect(consoleSrc).toContain("<OperationalInvoicesPanel");
  });

  it("tenant registry uses CommercialConsole not CommercialPanel", () => {
    expect(tenants).toContain("CommercialConsole");
    expect(tenants).not.toContain("function CommercialPanel");
    expect(tenants).toContain("console-tab-content-commercial");
  });

  it("no collection or payment props on commercial tab", () => {
    const commercialBlock = tenants.slice(
      tenants.indexOf('effectiveTab === "commercial"'),
      tenants.indexOf('effectiveTab === "commercial"') + 1200,
    );
    expect(commercialBlock).not.toContain("canReadPayments");
    expect(commercialBlock).not.toContain("CollectionTrackingPanel");
    expect(consoleSrc).not.toContain("CommercialCollectionSection");
    expect(consoleSrc).not.toContain("CommercialRiskSection");
  });

  it("deep link from risk page to tenant commercial tab still supported", () => {
    const riskPage = readSrc("pages/super-admin-commercial-risk.tsx");
    expect(riskPage).toContain("tab=commercial");
    expect(riskPage).toContain("tenantId=");
  });

  it("registry parses tab=commercial deep link", () => {
    expect(tenants).toContain("parseRegistryDeepLink");
    expect(tenants).toContain("parseConsoleTabParam");
  });

  it("operational panels expose PDF upload/download", () => {
    expect(contracts).toContain("Upload PDF");
    expect(contracts).toContain("Download PDF");
    expect(invoices).toContain("Upload PDF");
    expect(invoices).toContain("Download PDF");
  });

  it("permission props passed to console", () => {
    expect(tenants).toContain("canReadContracts={canReadCommercialContracts}");
    expect(tenants).toContain("commercial.invoices.read");
    expect(tenants).toContain("canUploadDocuments={canUploadInvoiceDocuments}");
  });

  it("no forbidden UI terms in console components", () => {
    const blob = (consoleSrc + contracts + invoices).toLowerCase();
    for (const term of [
      "pay now",
      "stripe",
      "checkout",
      "generate invoice",
      "calculate tax",
      "zatca",
      "send email",
      "auto renew",
      "auto collect",
      "collection tracking",
    ]) {
      expect(blob.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
