/**
 * @phase P16-F / Canonical cleanup - TenantCommercialConsole
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CONSOLE_PRIMARY_TABS,
  CONSOLE_MORE_TABS,
  CONSOLE_TAB_CONFIG,
  dedupeConsoleTabs,
  parseConsoleTabParam,
  partitionVisibleConsoleTabs,
} from "../tenant-admin-console-config";
import { canViewTenantConsoleTab, hasPlatformPermissionClient } from "../platform-access";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };

describe("TenantCommercialConsole", () => {
  const consoleTsx = read("src/components/subscription/TenantCommercialConsole.tsx");
  const tenantsPage = read("src/pages/super-admin-tenants.tsx");

  it("renders canonical sections only", () => {
    expect(consoleTsx).toContain('data-testid="tenant-commercial-console"');
    expect(consoleTsx).toContain("SubscriptionStatePanel");
    expect(consoleTsx).toContain("ProductModulesPanel");
    expect(consoleTsx).toContain("WorkspaceAccessControlPanel");
    expect(consoleTsx).toContain('data-testid="subscription-empty-state"');
    expect(consoleTsx).not.toContain("EntitlementsFeaturesPanel");
    expect(consoleTsx).not.toContain("LimitsQuotasPanel");
    expect(consoleTsx).not.toContain("GraceSuspensionPolicyPanel");
    expect(consoleTsx).not.toContain("SubscriptionConsoleSummaryCards");
  });

  it("super-admin tenants wire TenantCommercialConsole on subscription tab", () => {
    expect(tenantsPage).toContain("<TenantCommercialConsole");
    expect(tenantsPage).toContain('data-testid="console-tab-content-subscription"');
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

  it("dedupeConsoleTabs removes entitlements when subscription visible", () => {
    const tabs = dedupeConsoleTabs(["overview", "subscription", "entitlements", "health"]);
    expect(tabs).not.toContain("entitlements");
    expect(tabs).toContain("subscription");
  });

  it("parseConsoleTabParam maps legacy deep links to subscription", () => {
    expect(parseConsoleTabParam("subscription_entitlements")).toBe("subscription");
    expect(parseConsoleTabParam("entitlements")).toBe("subscription");
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
  const consoleTsx = read("src/components/subscription/TenantCommercialConsole.tsx");

  it("sections gated by canRead* flags", () => {
    expect(consoleTsx).toContain("canReadSubscription");
    expect(consoleTsx).toContain("canReadProductModules");
    expect(consoleTsx).toContain("canReadWorkspaceAccess");
  });

  it("finance_admin can view subscription tab", () => {
    expect(hasPlatformPermissionClient(finance, "platform.subscriptions.read")).toBe(true);
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
  });
});

describe("no parallel backend routers", () => {
  const apiIndex = readFileSync(
    resolve(root, "../api-server/src/routes/index.ts"),
    "utf8",
  );

  it("does not register legacy entitlement/quota/policy routers", () => {
    expect(apiIndex).not.toContain("workspaceEntitlementsRouter");
    expect(apiIndex).not.toContain("workspaceQuotasRouter");
    expect(apiIndex).not.toContain("workspaceSubscriptionPoliciesRouter");
    expect(apiIndex).toContain("tenantProductModulesRouter");
  });
});
