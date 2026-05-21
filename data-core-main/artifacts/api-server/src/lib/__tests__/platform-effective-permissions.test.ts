/**
 * @phase P17-B - Effective platform permission resolver tests
 */

import { describe, it, expect } from "vitest";
import {
  computeEffectivePermissionsFromRoleAndOverrides,
  isPlatformPermissionCatalogCode,
} from "../platform-effective-permissions";

const platformAdmin = {
  role: "super_admin",
  platformRoleCode: "platform_admin",
  isRootOwner: false,
};

const rootUser = {
  role: "super_admin",
  isRootOwner: true,
  platformRoleCode: null,
};

describe("computeEffectivePermissionsFromRoleAndOverrides", () => {
  it("root gets full catalog and ignores overrides", () => {
    const r = computeEffectivePermissionsFromRoleAndOverrides(rootUser, [
      { permissionCode: "platform.users.read", effect: "deny", reason: "test" },
    ]);
    expect(r.restrictedByProtection).toBe(true);
    expect(r.deniedOverrides).toHaveLength(0);
    expect(r.effectivePermissions).toContain("platform.permissions.update");
    expect(r.effectivePermissions.length).toBeGreaterThan(48);
  });

  it("deny wins over role grant", () => {
    const r = computeEffectivePermissionsFromRoleAndOverrides(platformAdmin, [
      { permissionCode: "tenants.read", effect: "deny", reason: "test deny" },
    ]);
    expect(r.rolePermissions).toContain("tenants.read");
    expect(r.deniedOverrides).toContain("tenants.read");
    expect(r.effectivePermissions).not.toContain("tenants.read");
  });

  it("grant adds permission not in role", () => {
    const r = computeEffectivePermissionsFromRoleAndOverrides(
      { role: "super_admin", platformRoleCode: "auditor", isRootOwner: false },
      [{ permissionCode: "platform.users.create", effect: "grant", reason: "x" }],
    );
    expect(r.grantedOverrides).toContain("platform.users.create");
    expect(r.effectivePermissions).toContain("platform.users.create");
  });

  it("rejects unknown catalog codes in override rows", () => {
    const r = computeEffectivePermissionsFromRoleAndOverrides(platformAdmin, [
      { permissionCode: "tenant.secret.permission", effect: "grant", reason: "bad" },
    ]);
    expect(r.grantedOverrides).toHaveLength(0);
  });
});

describe("isPlatformPermissionCatalogCode", () => {
  it("accepts platform.permissions.read", () => {
    expect(isPlatformPermissionCatalogCode("platform.permissions.read")).toBe(true);
  });

  it("rejects workspace.tickets.read", () => {
    expect(isPlatformPermissionCatalogCode("workspace.tickets.read")).toBe(false);
  });
});
