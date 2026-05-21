/**
 * @phase P17-B - Custom permission assignment static tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT,
  P17B_FORBIDDEN_UI_TERMS,
} from "../platform-permission-assignment-config";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
} from "../platform-permissions-config";
import { hasPlatformPermissionClient } from "../platform-access";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readFromRepo(rel: string) {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

function readFromOps(rel: string) {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

const root = { role: "super_admin", isRootOwner: true, platformRoleCode: null };
const platformAdmin = { role: "super_admin", platformRoleCode: "platform_admin", isRootOwner: false };
const auditor = { role: "super_admin", platformRoleCode: "auditor", isRootOwner: false };

describe("safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions (50 total)", () => {
  it("includes platform.permissions.read and update", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.permissions.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.permissions.update");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("root has update; platform_admin read only for assignment", () => {
    expect(hasPlatformPermissionClient(root, "platform.permissions.update")).toBe(true);
    expect(hasPlatformPermissionClient(platformAdmin, "platform.permissions.read")).toBe(true);
    expect(hasPlatformPermissionClient(platformAdmin, "platform.permissions.update")).toBe(false);
  });

  it("auditor has catalog read only", () => {
    expect(hasPlatformPermissionClient(auditor, "platform.permissions.read")).toBe(true);
    expect(hasPlatformPermissionClient(auditor, "platform.permissions.update")).toBe(false);
  });
});

describe("backend routes", () => {
  const routes = readFromRepo("artifacts/api-server/src/routes/platform-user-permissions.ts");

  it("defines catalog and user permission routes", () => {
    expect(routes).toContain('"/platform/permissions/catalog"');
    expect(routes).toContain('"/platform/users/:userId/permissions"');
    expect(routes).toContain('"/platform/users/:userId/permissions/overrides"');
  });

  it("no tenant assignment routes", () => {
    expect(routes).not.toContain("/tenant/");
    expect(routes).not.toMatch(/workspace.*permissions\/overrides/);
  });
});

describe("frontend", () => {
  const panel = readFromOps("src/components/platform-users/CustomPermissionsSection.tsx");
  const page = readFromOps("src/pages/super-admin-platform-users.tsx");

  it("renders custom permissions section", () => {
    const drawer = readFromOps("src/components/platform-users/PlatformUserDetailDrawer.tsx");
    expect(drawer).toContain("CustomPermissionsSection");
    expect(panel).toContain('data-testid="custom-permissions-section"');
    expect(panel).toContain('data-testid="custom-permissions-reason"');
  });

  it("permission gated controls", () => {
    expect(panel).toContain("platform.permissions.read");
    expect(panel).toContain("platform.permissions.update");
    expect(panel).toContain("data-testid={`grant-override-${code}`}");
    expect(panel).toContain("data-testid={`deny-override-${code}`}");
    expect(panel).toContain("data-testid={`clear-override-${code}`}");
  });

  it("forbidden UI terms absent from panel", () => {
    const lower = panel.toLowerCase();
    for (const term of P17B_FORBIDDEN_UI_TERMS) {
      expect(lower.includes(term), term).toBe(false);
    }
  });
});

describe("resolver wired", () => {
  it("requireAuth uses effective permissions", () => {
    const mw = readFromRepo("artifacts/api-server/src/middlewares/requireAuth.ts");
    expect(mw).toContain("resolveActorEffectivePermissionSet");
    expect(mw).toContain("hasEffectivePlatformPermission");
  });

  it("platform/me uses resolver", () => {
    const me = readFromRepo("artifacts/api-server/src/routes/platform-me.ts");
    expect(me).toContain("resolvePlatformUserEffectivePermissions");
  });
});
