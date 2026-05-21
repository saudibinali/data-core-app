/**
 * @phase P16-D - Grace & Suspension Policy static tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT } from "../subscription-policy-model-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canPerformPlatformAction,
  canViewTenantConsoleTab,
  hasPlatformPermissionClient,
} from "../platform-access";
import { tenantSubscriptionPolicyKeys } from "@/hooks/use-tenant-subscription-policy";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const sales = { role: "super_admin", platformRoleCode: "sales_admin" };
const support = { role: "super_admin", platformRoleCode: "support_admin" };
const workspaceSupport = { role: "super_admin", platformRoleCode: "workspace_support" };

describe("SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("has subscription policy permissions", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptionPolicies.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptionPolicies.update");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.subscriptionPolicies.evaluate");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("finance_admin has read update evaluate", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin);
    expect(perms.has("platform.subscriptionPolicies.read")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.update")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.evaluate")).toBe(true);
  });

  it("sales_admin read and evaluate only", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin);
    expect(perms.has("platform.subscriptionPolicies.read")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.evaluate")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.update")).toBe(false);
  });

  it("support_admin read and evaluate only", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.support_admin);
    expect(perms.has("platform.subscriptionPolicies.read")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.evaluate")).toBe(true);
    expect(perms.has("platform.subscriptionPolicies.update")).toBe(false);
  });

  it("workspace_support has no policy permissions", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "platform.subscriptionPolicies.read")).toBe(
      false,
    );
  });
});

describe("console and hooks", () => {
  it("subscription tab visible with policy read", () => {
    expect(canViewTenantConsoleTab(finance, "subscription")).toBe(true);
    expect(canViewTenantConsoleTab(sales, "subscription")).toBe(true);
  });

  it("update action gated", () => {
    expect(
      canPerformPlatformAction(finance, "tenant.workspace_subscription_policies.update"),
    ).toBe(true);
    expect(
      canPerformPlatformAction(sales, "tenant.workspace_subscription_policies.update"),
    ).toBe(false);
  });

  it("react query keys", () => {
    expect(tenantSubscriptionPolicyKeys.policy("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "subscription-policy",
    ]);
    expect(tenantSubscriptionPolicyKeys.evaluation("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "subscription-policy",
      "evaluation",
    ]);
  });
});

describe("UI safety", () => {
  const panel = read("src/components/subscription/GraceSuspensionPolicyPanel.tsx");
  const consoleFile = read("src/components/subscription/SubscriptionConsole.tsx");

  it("forbidden terms absent", () => {
    for (const term of [
      "Stripe",
      "checkout",
      "Pay Now",
      "Auto Suspend Now",
      "Block Login",
      "Disable Modules",
      "Send Email",
      "Delete Policy",
    ]) {
      expect(panel.includes(term)).toBe(false);
    }
    expect(consoleFile).toContain("grace-suspension-policy-section");
  });
});

describe("routes", () => {
  const routes = readFileSync(
    resolve(__dirname, "../../../../api-server/src/routes/workspace-subscription-policies.ts"),
    "utf8",
  );

  it("no DELETE and no tenant paths", () => {
    expect(routes).not.toMatch(/router\.delete\(/);
    expect(routes).not.toMatch(/\/tenant\//);
  });
});


