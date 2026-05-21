/**
 * @phase P16-C - Quota model static tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { QUOTA_MODEL_SAFETY_CONTRACT } from "../quota-model-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canPerformPlatformAction,
  canViewTenantConsoleTab,
  hasPlatformPermissionClient,
} from "../platform-access";
import { workspaceQuotaKeys } from "@/hooks/use-workspace-quotas";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const sales = { role: "super_admin", platformRoleCode: "sales_admin" };
const workspaceSupport = { role: "super_admin", platformRoleCode: "workspace_support" };

describe("QUOTA_MODEL_SAFETY_CONTRACT", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(QUOTA_MODEL_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("has platform.quotas.read and update", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.quotas.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.quotas.update");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("finance_admin has read and update", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin);
    expect(perms.has("platform.quotas.read")).toBe(true);
    expect(perms.has("platform.quotas.update")).toBe(true);
  });

  it("sales_admin read only", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin);
    expect(perms.has("platform.quotas.read")).toBe(true);
    expect(perms.has("platform.quotas.update")).toBe(false);
  });

  it("workspace_support has no platform quotas", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "platform.quotas.read")).toBe(false);
  });
});

describe("console and hooks", () => {
  it("subscription tab visible with quotas read", () => {
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
    expect(canViewTenantConsoleTab(sales, "subscription")).toBe(true);
  });

  it("update action gated", () => {
    expect(canPerformPlatformAction(finance, "tenant.workspace_quotas.update")).toBe(true);
    expect(canPerformPlatformAction(sales, "tenant.workspace_quotas.update")).toBe(false);
  });

  it("react query keys", () => {
    expect(workspaceQuotaKeys.catalog("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "quotas",
      "catalog",
    ]);
    expect(workspaceQuotaKeys.usage("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "quotas",
      "usage",
    ]);
  });
});

describe("UI safety", () => {
  const panel = read("src/components/subscription/LimitsQuotasPanel.tsx");
  const consoleFile = read("src/components/subscription/SubscriptionConsole.tsx");

  it("forbidden terms absent", () => {
    for (const term of [
      "Stripe",
      "checkout",
      "Pay Now",
      "Auto Suspend",
      "Block Login",
      "Delete quota",
      "Cleanup data",
    ]) {
      expect(panel.includes(term)).toBe(false);
    }
    expect(consoleFile).toContain("limits-quotas-section");
  });
});

describe("routes", () => {
  const routes = readFileSync(
    resolve(__dirname, "../../../../api-server/src/routes/workspace-quotas.ts"),
    "utf8",
  );

  it("no DELETE and no tenant paths", () => {
    expect(routes).not.toMatch(/router\.delete\(/);
    expect(routes).not.toMatch(/\/tenant\//);
  });
});


