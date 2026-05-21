/**
 * @phase P16-A - Subscription State Model (static / config tests)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  SUBSCRIPTION_STATE_SAFETY_CONTRACT,
  WORKSPACE_SUBSCRIPTION_STATUS_CODES,
} from "../subscription-state-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canViewTenantConsoleTab,
  canPerformPlatformAction,
  hasPlatformPermissionClient,
} from "../platform-access";
import { tenantSubscriptionKeys } from "@/hooks/use-tenant-subscription";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const sales = { role: "super_admin", platformRoleCode: "sales_admin" };
const support = { role: "super_admin", platformRoleCode: "support_admin" };
const auditor = { role: "super_admin", platformRoleCode: "auditor" };
const workspaceSupport = { role: "super_admin", platformRoleCode: "workspace_support" };

describe("SUBSCRIPTION_STATE_SAFETY_CONTRACT", () => {
  it("all flags are true", () => {
    for (const [key, value] of Object.entries(SUBSCRIPTION_STATE_SAFETY_CONTRACT)) {
      expect(value, key).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("defines three platform.subscriptions.* codes", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptions.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptions.update");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptions.status.change");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("finance_admin has read, update, and status.change", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin);
    expect(perms.has("platform.subscriptions.read")).toBe(true);
    expect(perms.has("platform.subscriptions.update")).toBe(true);
    expect(perms.has("platform.subscriptions.status.change")).toBe(true);
  });

  it("sales_admin has read only (no update/status)", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin);
    expect(perms.has("platform.subscriptions.read")).toBe(true);
    expect(perms.has("platform.subscriptions.update")).toBe(false);
    expect(perms.has("platform.subscriptions.status.change")).toBe(false);
  });

  it("support_admin and auditor are read-only for workspace subscription", () => {
    expect(hasPlatformPermissionClient(support, "platform.subscriptions.read")).toBe(true);
    expect(hasPlatformPermissionClient(support, "platform.subscriptions.update")).toBe(false);
    expect(hasPlatformPermissionClient(auditor, "platform.subscriptions.read")).toBe(true);
    expect(hasPlatformPermissionClient(auditor, "platform.subscriptions.status.change")).toBe(false);
  });

  it("workspace_support has no platform.subscriptions permissions", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "platform.subscriptions.read")).toBe(false);
  });
});

describe("console tab and actions", () => {
  it("subscription tab visible with platform.subscriptions.read", () => {
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
    expect(canViewTenantConsoleTab(workspaceSupport, "subscription")).toBe(false);
  });

  it("buttons gated by update and status.change", () => {
    expect(canPerformPlatformAction(finance, "tenant.workspace_subscription.update")).toBe(true);
    expect(canPerformPlatformAction(finance, "tenant.workspace_subscription.status.change")).toBe(true);
    expect(canPerformPlatformAction(sales, "tenant.workspace_subscription.update")).toBe(false);
    expect(canPerformPlatformAction(sales, "tenant.workspace_subscription.status.change")).toBe(false);
  });
});

describe("React Query keys", () => {
  it("uses platform tenant subscription key", () => {
    expect(tenantSubscriptionKeys.detail("42")).toEqual([
      "platform",
      "tenants",
      "42",
      "subscription",
    ]);
  });
});

describe("status enum", () => {
  it("lists seven statuses", () => {
    expect(WORKSPACE_SUBSCRIPTION_STATUS_CODES).toHaveLength(7);
  });
});

describe("SubscriptionStatePanel UI safety", () => {
  const panel = read("src/components/subscription/SubscriptionStatePanel.tsx");

  it("does not include forbidden payment or enforcement terms", () => {
    const forbidden = [
      "Stripe",
      "Pay Now",
      "checkout",
      "Block login",
      "Suspend workspace access",
      "Enable/Disable modules",
      "Send Email",
    ];
    for (const term of forbidden) {
      expect(panel.includes(term)).toBe(false);
    }
  });

  it("includes gated action test ids", () => {
    expect(panel).toContain('data-testid="subscription-create-btn"');
    expect(panel).toContain('data-testid="subscription-status-btn"');
  });
});

describe("routes file", () => {
  const routes = readFileSync(
    resolve(__dirname, "../../../../api-server/src/routes/workspace-subscriptions.ts"),
    "utf8",
  );

  it("has no DELETE handler", () => {
    expect(routes).not.toMatch(/router\.delete\(/);
  });

  it("has no tenant-side subscription paths", () => {
    expect(routes).not.toMatch(/\/tenant\//);
  });
});


