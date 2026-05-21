/**
 * @phase P15-G - Unified commercial console integration (static)
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
    expect(COMMERCIAL_SAFETY_CONTRACT.riskReadOnlyIntegrated).toBe(true);
  });
});

describe("unified commercial console", () => {
  const consoleSrc = readSrc("components/commercial/CommercialConsole.tsx");
  const tenants = readSrc("pages/super-admin-tenants.tsx");
  const riskPage = readSrc("pages/super-admin-commercial-risk.tsx");
  const overview = readSrc("components/commercial/CommercialOverviewSummary.tsx");
  const riskSection = readSrc("components/commercial/CommercialRiskSection.tsx");
  const invoices = readSrc("components/commercial/InvoicesSection.tsx");

  it("CommercialConsole renders with test id and accordion sections", () => {
    expect(consoleSrc).toContain('data-testid="commercial-console"');
    expect(consoleSrc).toContain("commercial-console-sections");
    expect(consoleSrc).toContain("commercial-console-section-account");
    expect(consoleSrc).toContain("commercial-console-section-risk");
    expect(consoleSrc).toContain("commercial-console-section-collection");
  });

  it("tenant registry uses CommercialConsole not CommercialPanel", () => {
    expect(tenants).toContain("CommercialConsole");
    expect(tenants).not.toContain("function CommercialPanel");
    expect(tenants).toContain("console-tab-content-commercial");
  });

  it("overview summary cards", () => {
    expect(overview).toContain("commercial-overview-summary");
    expect(overview).toContain("Account Status");
    expect(overview).toContain("Risk Level");
  });

  it("risk section gated and integrated", () => {
    expect(consoleSrc).toContain("canReadRisk");
    expect(riskSection).toContain("commercial-open-full-risk-view");
    expect(riskSection).toContain("/super-admin/commercial-risk");
  });

  it("deep link from risk page to tenant commercial tab", () => {
    expect(riskPage).toContain("tab=commercial");
    expect(riskPage).toContain("tenantId=");
    expect(riskPage).toContain("commercial-risk-open-tenant-console");
  });

  it("registry parses tab=commercial deep link", () => {
    expect(tenants).toContain("parseRegistryDeepLink");
    // Implementation detail: parsing is delegated to parseConsoleTabParam.
    expect(tenants).toContain("parseConsoleTabParam");
  });

  it("invoices support external collection panel", () => {
    expect(invoices).toContain("hideInlineCollectionPanel");
    expect(invoices).toContain("onOpenCollection");
  });

  it("permission props passed to console", () => {
    expect(tenants).toContain("canReadRisk={canReadCommercialRisk}");
    expect(tenants).toContain("commercial.risk.read");
    expect(tenants).toContain("commercial.invoices.read");
    expect(tenants).toContain("commercial.payments.read");
  });

  it("no forbidden UI terms in console components", () => {
    const blob = (consoleSrc + overview + riskSection + invoices).toLowerCase();
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
    ]) {
      expect(blob.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });

  it("activity section uses tenant feed", () => {
    expect(consoleSrc).toContain("CommercialActivitySection");
    const activity = readSrc("components/commercial/CommercialActivitySection.tsx");
    expect(activity).toContain("commercial-activity-list");
    expect(activity).toContain("useTenantCommercialActivity");
  });
});
