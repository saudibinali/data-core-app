/**
 * @phase P17-A - Platform User Directory & Lifecycle (static tests)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT,
  P17_FORBIDDEN_UI_TERMS,
} from "../platform-user-directory-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import {
  canPerformPlatformAction,
  hasPlatformPermissionClient,
} from "../platform-access";
import { PLATFORM_USER_API_PATHS } from "../platform-users-config";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readFromOps(rel: string): string {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

function readFromRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const platformAdmin = { role: "super_admin", platformRoleCode: "platform_admin" };
const finance = { role: "super_admin", platformRoleCode: "finance_admin" };
const workspaceSupport = { role: "super_admin", platformRoleCode: "workspace_support" };

describe("P17-A safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions (48 total after P17-A)", () => {
  it("defines platform.users.update/disable/reactivate", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.users.update");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.users.disable");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.users.reactivate");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("platform_admin has directory write permissions", () => {
    const perms = new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.platform_admin);
    expect(perms.has("platform.users.update")).toBe(true);
    expect(perms.has("platform.users.disable")).toBe(true);
    expect(perms.has("platform.users.reactivate")).toBe(true);
  });

  it("finance_admin has no platform.users.* (unchanged)", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin;
    expect(perms.some((p) => p.startsWith("platform.users."))).toBe(false);
  });

  it("workspace_support has no platform.users.*", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.workspace_support;
    expect(perms.some((p) => p.startsWith("platform.users."))).toBe(false);
  });
});

describe("platform access actions", () => {
  it("gates create/update/disable/reactivate for platform_admin", () => {
    expect(canPerformPlatformAction(platformAdmin, "platform.user.create")).toBe(true);
    expect(canPerformPlatformAction(platformAdmin, "platform.user.update")).toBe(true);
    expect(canPerformPlatformAction(platformAdmin, "platform.user.disable")).toBe(true);
    expect(canPerformPlatformAction(platformAdmin, "platform.user.reactivate")).toBe(true);
  });

  it("finance cannot create platform users", () => {
    expect(canPerformPlatformAction(finance, "platform.user.create")).toBe(false);
    expect(hasPlatformPermissionClient(finance, "platform.users.read")).toBe(false);
  });

  it("workspace_support has no platform user permissions", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "platform.users.read")).toBe(false);
  });
});

describe("API paths", () => {
  it("includes PATCH profile route, no DELETE", () => {
    expect(PLATFORM_USER_API_PATHS.update(1)).toBe("/api/platform/users/1");
    const routes = readFromRepo("artifacts/api-server/src/routes/platform-users.ts");
    expect(routes).toContain('router.patch(\n  "/platform/users/:userId"');
    expect(routes).not.toMatch(/router\.delete\(\s*["']\/platform\/users/);
  });

  it("list supports query params", () => {
    const url = PLATFORM_USER_API_PATHS.list({ search: "a", status: "active", userType: "platform_admin", page: 2 });
    expect(url).toContain("search=a");
    expect(url).toContain("status=active");
    expect(url).toContain("userType=platform_admin");
    expect(url).toContain("page=2");
  });
});

describe("frontend page", () => {
  const page = readFromOps("src/pages/super-admin-platform-users.tsx");

  it("renders platform users table and filters", () => {
    const table = readFromOps("src/components/platform-users/PlatformUsersTable.tsx");
    expect(page).toContain('data-testid="platform-users-page"');
    expect(page).toContain("PlatformUsersTable");
    expect(table).toContain('data-testid="platform-users-table"');
    expect(table).toContain('data-testid="platform-users-search"');
    expect(table).toContain('data-testid="platform-users-status-filter"');
    expect(table).toContain('data-testid="platform-users-type-filter"');
  });

  it("has permission-gated create and edit", () => {
    expect(page).toContain("platform.user.create");
    expect(page).toContain("platform.user.update");
    expect(page).toContain('data-testid="edit-platform-user-dialog"');
  });

  it("forbidden UI terms absent", () => {
    const lower = page.toLowerCase();
    for (const term of P17_FORBIDDEN_UI_TERMS) {
      expect(lower.includes(term), `found forbidden term: ${term}`).toBe(false);
    }
  });
});

