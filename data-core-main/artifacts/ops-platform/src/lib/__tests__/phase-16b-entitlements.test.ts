/**
 * @phase P16-B - Entitlement model static tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ENTITLEMENT_MODEL_SAFETY_CONTRACT } from "../entitlement-model-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canPerformPlatformAction,
  canViewTenantConsoleTab,
  hasPlatformPermissionClient,
} from "../platform-access";
import { workspaceEntitlementKeys } from "@/hooks/use-workspace-entitlements";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const sales = { role: "super_admin", platformRoleCode: "sales_admin" };
const support = { role: "super_admin", platformRoleCode: "support_admin" };
const workspaceSupport = { role: "super_admin", platformRoleCode: "workspace_support" };

describe("ENTITLEMENT_MODEL_SAFETY_CONTRACT", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(ENTITLEMENT_MODEL_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("has platform.entitlements.read and update", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.entitlements.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.entitlements.update");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("finance_admin has read and update", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin);
    expect(perms.has("platform.entitlements.read")).toBe(true);
    expect(perms.has("platform.entitlements.update")).toBe(true);
  });

  it("sales_admin read only", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin);
    expect(perms.has("platform.entitlements.read")).toBe(true);
    expect(perms.has("platform.entitlements.update")).toBe(false);
  });

  it("workspace_support has no platform entitlements", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "platform.entitlements.read")).toBe(false);
  });
});

describe("console and hooks", () => {
  it("subscription tab visible with entitlements read permission", () => {
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
    expect(canViewTenantConsoleTab(sales, "subscription")).toBe(true);
  });

  it("update action gated", () => {
    expect(canPerformPlatformAction(finance, "tenant.workspace_entitlements.update")).toBe(true);
    expect(canPerformPlatformAction(sales, "tenant.workspace_entitlements.update")).toBe(false);
    expect(canPerformPlatformAction(support, "tenant.workspace_entitlements.update")).toBe(false);
  });

  it("react query keys", () => {
    expect(workspaceEntitlementKeys.catalog("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "entitlements",
      "catalog",
    ]);
    expect(workspaceEntitlementKeys.list("1")).toEqual(["platform", "tenants", "1", "entitlements"]);
  });
});

describe("UI safety", () => {
  const panel = read("src/components/subscription/EntitlementsFeaturesPanel.tsx");
  const consoleFile = read("src/components/subscription/SubscriptionConsole.tsx");

  it("forbidden terms absent", () => {
    for (const term of ["Stripe", "checkout", "Pay Now", "block login", "upgrade plan", "Delete"]) {
      expect(panel.includes(term)).toBe(false);
    }
    expect(consoleFile).toContain("entitlements-features-section");
  });

  it("core lock indicator present", () => {
    expect(panel).toContain("core-lock");
  });
});

describe("routes", () => {
  const routes = readFileSync(
    resolve(__dirname, "../../../../api-server/src/routes/workspace-entitlements.ts"),
    "utf8",
  );

  it("no DELETE and no tenant paths", () => {
    expect(routes).not.toMatch(/router\.delete\(/);
    expect(routes).not.toMatch(/\/tenant\//);
  });
});


