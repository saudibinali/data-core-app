/**
 * Tenant detail tab navigation - primary tabs + More dropdown
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CONSOLE_PRIMARY_TABS,
  CONSOLE_MORE_TABS,
  CONSOLE_TABS,
  CONSOLE_TAB_CONTENT_TEST_IDS,
  CONSOLE_TAB_CONFIG,
  partitionVisibleConsoleTabs,
  dedupeConsoleTabs,
  isConsoleMoreTab,
  parseConsoleTabParam,
} from "../tenant-admin-console-config";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("partitionVisibleConsoleTabs", () => {
  const allVisible = [...CONSOLE_TABS];

  it("keeps primary tabs in bar order", () => {
    const { primaryTabs, moreTabs } = partitionVisibleConsoleTabs(allVisible);
    expect(primaryTabs).toEqual([...CONSOLE_PRIMARY_TABS]);
    expect(moreTabs).toEqual([...CONSOLE_MORE_TABS]);
  });

  it("subscription_entitlements is legacy alias deduped from visible tabs", () => {
    const deduped = dedupeConsoleTabs([...CONSOLE_TABS]);
    expect(deduped).not.toContain("subscription_entitlements");
    expect(deduped).toContain("subscription");
    expect(isConsoleMoreTab("overview")).toBe(false);
  });

  it("permission-filtered tabs only appear when visible", () => {
    const visible = ["overview", "health", "usage"] as typeof CONSOLE_TABS;
    const { primaryTabs, moreTabs } = partitionVisibleConsoleTabs(visible);
    expect(primaryTabs).toEqual(["overview", "health"]);
    expect(moreTabs).toEqual(["usage"]);
  });
});

describe("tab bar UI wiring", () => {
  const tabBar = read("src/components/tenant/TenantConsoleTabBar.tsx");
  const tenantsPage = read("src/pages/super-admin-tenants.tsx");

  it("primary tab test ids render in tab bar component", () => {
    expect(tabBar).toContain("data-testid={cfg.testId}");
    for (const tab of CONSOLE_PRIMARY_TABS) {
      expect(CONSOLE_TAB_CONFIG[tab].testId).toMatch(/^console-tab-/);
    }
  });

  it("secondary tabs use More dropdown items not inline bar overflow", () => {
    expect(tabBar).toContain('data-testid="console-tab-more-trigger"');
    expect(tabBar).toContain('data-testid="console-tab-more-menu"');
    expect(tabBar).toContain("data-testid={`console-tab-more-item-${tab}`}");
    expect(tabBar).not.toContain("overflow-x-auto");
    expect(tabBar).toContain("overflow-hidden");
  });

  it("More menu highlights active secondary tab", () => {
    expect(tabBar).toContain("moreMenuActive");
    expect(tabBar).toContain("selected &&");
  });

  it("TenantAdminConsole uses TenantConsoleTabBar without tab-bar horizontal scroll", () => {
    expect(tenantsPage).toContain("<TenantConsoleTabBar");
    expect(tenantsPage).not.toMatch(/console-tab-bar[\s\S]{0,200}overflow-x-auto/);
  });

  it("all tab content panels remain in super-admin-tenants", () => {
    for (const testId of CONSOLE_TAB_CONTENT_TEST_IDS) {
      expect(tenantsPage).toContain(testId);
    }
  });

  it("parseConsoleTabParam supports deep-link query tabs", () => {
    expect(parseConsoleTabParam("subscription_entitlements")).toBe("subscription");
    expect(parseConsoleTabParam("commercial")).toBe("commercial");
    expect(parseConsoleTabParam("invalid")).toBeNull();
  });
});

describe("selecting More item changes active tab", () => {
  it("onTabChange is passed from console to tab bar", () => {
    const tenantsPage = read("src/pages/super-admin-tenants.tsx");
    const tabBar = read("src/components/tenant/TenantConsoleTabBar.tsx");
    expect(tenantsPage).toContain("onTabChange={setActiveTab}");
    expect(tabBar).toContain("onSelect={() => onTabChange(tab)}");
  });
});
