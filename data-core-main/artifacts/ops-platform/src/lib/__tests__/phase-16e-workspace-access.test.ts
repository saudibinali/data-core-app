/**
 * @phase P16-E - Workspace access enforcement tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT } from "../workspace-access-enforcement-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canPerformPlatformAction,
  hasPlatformPermissionClient,
} from "../platform-access";
import { tenantWorkspaceAccessKeys } from "@/hooks/use-workspace-access";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const sales = { role: "super_admin", platformRoleCode: "sales_admin" };

describe("WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("has workspace access permissions (45 total)", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.workspaceAccess.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.workspaceAccess.update");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.workspaceAccess.evaluate");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("finance_admin read and evaluate only for workspace access", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin);
    expect(perms.has("platform.workspaceAccess.read")).toBe(true);
    expect(perms.has("platform.workspaceAccess.evaluate")).toBe(true);
    expect(perms.has("platform.workspaceAccess.update")).toBe(false);
  });

  it("sales_admin read and evaluate only", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin);
    expect(perms.has("platform.workspaceAccess.read")).toBe(true);
    expect(perms.has("platform.workspaceAccess.update")).toBe(false);
  });
});

describe("UI safety", () => {
  const panel = read("src/components/subscription/WorkspaceAccessControlPanel.tsx");
  const banner = read("src/components/workspace/WorkspaceReadOnlyBanner.tsx");

  it("forbidden terms absent from super admin panel", () => {
    for (const term of [
      "Block Login",
      "Delete Workspace",
      "Purge Data",
      "Pay Now",
      "Stripe",
      "Checkout",
      "Send Email",
      "Auto Charge",
      "Auto Suspend",
    ]) {
      expect(panel.includes(term)).toBe(false);
    }
    expect(panel).toContain("workspace-access-control-panel");
  });

  it("banner mentions read-only subscription", () => {
    expect(banner).toContain("workspace-read-only-banner");
    expect(banner).toContain("read-only mode due to subscription status");
  });
});

describe("react query keys", () => {
  it("workspace access keys", () => {
    expect(tenantWorkspaceAccessKeys.access("1")).toEqual([
      "platform",
      "tenants",
      "1",
      "workspace-access",
    ]);
  });
});

describe("platform action gating", () => {
  it("update requires platform.workspaceAccess.update", () => {
    expect(canPerformPlatformAction(finance, "tenant.workspace_access.update")).toBe(false);
  });
});


