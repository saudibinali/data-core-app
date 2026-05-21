/**
 * @phase P16-F - Subscription Console integration tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT,
  SUBSCRIPTION_CONSOLE_FORBIDDEN_UI_TERMS,
} from "../subscription-console-config";
import {
  CONSOLE_PRIMARY_TABS,
  CONSOLE_MORE_TABS,
  CONSOLE_TAB_CONFIG,
  dedupeConsoleTabs,
  normalizeConsoleTab,
  parseConsoleTabParam,
  partitionVisibleConsoleTabs,
} from "../tenant-admin-console-config";
import { canViewTenantConsoleTab, hasPlatformPermissionClient } from "../platform-access";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };

describe("SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT", () => {
  it("all flags are true", () => {
    for (const [key, value] of Object.entries(SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT)) {
      if (key === "contractVersion") {
        expect(value).toBe("1.0.0-P16-F");
        continue;
      }
      expect(value, key).toBe(true);
    }
  });
});

describe("unified Subscription Console", () => {
  const consoleTsx = read("src/components/subscription/SubscriptionConsole.tsx");
  const summary = read("src/components/subscription/SubscriptionConsoleSummaryCards.tsx");
  const tenantsPage = read("src/pages/super-admin-tenants.tsx");

  it("renders console with summary cards and P16 sections", () => {
    expect(consoleTsx).toContain('legacyConsoleTestId = "subscription-console"');
    expect(consoleTsx).toContain("data-testid={legacyConsoleTestId}");
    expect(consoleTsx).toContain("SubscriptionConsoleSummaryCards");
    expect(consoleTsx).toContain("SubscriptionConsoleOverviewSection");
    expect(consoleTsx).toContain("SubscriptionStatePanel");
    expect(consoleTsx).toContain("EntitlementsFeaturesPanel");
    expect(consoleTsx).toContain("LimitsQuotasPanel");
    expect(consoleTsx).toContain("GraceSuspensionPolicyPanel");
    expect(consoleTsx).toContain("WorkspaceAccessControlPanel");
    expect(consoleTsx).toContain('data-testid="subscription-state-section"');
    expect(consoleTsx).toContain('data-testid="entitlements-features-section"');
    expect(consoleTsx).toContain('data-testid="limits-quotas-section"');
    expect(consoleTsx).toContain('data-testid="grace-suspension-policy-section"');
    expect(consoleTsx).toContain('data-testid="workspace-access-control-section"');
  });

  it("summary cards use existing hooks only", () => {
    expect(summary).toContain("useTenantSubscription");
    expect(summary).toContain("useTenantEntitlements");
    expect(summary).toContain("useTenantQuotaUsage");
    expect(summary).toContain("useTenantSubscriptionPolicyEvaluation");
    expect(summary).toContain("useTenantWorkspaceAccess");
    expect(summary).toContain('data-testid="subscription-console-summary-cards"');
  });

  it("super-admin tenants wire SubscriptionConsole on subscription tab", () => {
    expect(tenantsPage).toContain("<SubscriptionConsole");
    expect(tenantsPage).toContain('data-testid="console-tab-content-subscription"');
    expect(tenantsPage).not.toContain('effectiveTab === "subscription_entitlements"');
  });

  it("forbidden UI terms absent from subscription console files", () => {
    const bundle = [consoleTsx, summary, read("src/components/subscription/SubscriptionConsoleOverviewSection.tsx")].join(
      "\n",
    );
    for (const term of SUBSCRIPTION_CONSOLE_FORBIDDEN_UI_TERMS) {
      expect(bundle).not.toContain(term);
    }
  });
});

describe("navigation cleanup", () => {
  it("primary tabs order: Overview, Lifecycle, Commercial, Subscription, Health", () => {
    expect([...CONSOLE_PRIMARY_TABS]).toEqual([
      "overview",
      "lifecycle",
      "commercial",
      "subscription",
      "health",
    ]);
  });

  it("subscription_entitlements not in More menu", () => {
    expect(CONSOLE_MORE_TABS).not.toContain("subscription_entitlements");
  });

  it("no duplicate Subscription & Entitlements primary label", () => {
    const primaryLabels = CONSOLE_PRIMARY_TABS.map((t) => CONSOLE_TAB_CONFIG[t].label);
    const subscriptionLabels = primaryLabels.filter((l) => /subscription/i.test(l));
    expect(subscriptionLabels).toEqual(["Subscription"]);
  });

  it("dedupeConsoleTabs removes subscription_entitlements when subscription visible", () => {
    const tabs = dedupeConsoleTabs(["overview", "subscription", "subscription_entitlements", "health"]);
    expect(tabs).not.toContain("subscription_entitlements");
    expect(tabs).toContain("subscription");
  });

  it("parseConsoleTabParam maps legacy deep link to subscription", () => {
    expect(parseConsoleTabParam("subscription_entitlements")).toBe("subscription");
    expect(normalizeConsoleTab("subscription_entitlements")).toBe("subscription");
  });

  it("More dropdown still partitions secondary tabs", () => {
    const { moreTabs } = partitionVisibleConsoleTabs([
      "overview",
      "lifecycle",
      "commercial",
      "subscription",
      "health",
      "usage",
      "renewal",
    ]);
    expect(moreTabs).toContain("usage");
    expect(moreTabs).toContain("renewal");
    expect(moreTabs).not.toContain("subscription");
  });
});

describe("permission gating", () => {
  const consoleTsx = read("src/components/subscription/SubscriptionConsole.tsx");

  it("sections render only when canRead* flags set", () => {
    expect(consoleTsx).toContain("{canReadSubscription &&");
    expect(consoleTsx).toContain("{canReadEntitlements &&");
    expect(consoleTsx).toContain("{canReadQuotas &&");
    expect(consoleTsx).toContain("{canReadSubscriptionPolicies &&");
    expect(consoleTsx).toContain("{canReadWorkspaceAccess &&");
  });

  it("finance_admin can view unified subscription tab", () => {
    expect(hasPlatformPermissionClient(finance, "platform.subscriptions.read")).toBe(true);
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
  });
});

describe("no new backend enforcement routes", () => {
  const apiIndex = readFileSync(
    resolve(root, "../api-server/src/routes/index.ts"),
    "utf8",
  );

  it("does not add subscription-overview aggregation route", () => {
    expect(apiIndex).not.toContain("subscription-overview");
  });
});
