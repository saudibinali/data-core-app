/**
 * platform-me.test.ts
 *
 * @phase P14-C - Platform Access Boundary & Route Guards
 *
 * Pure unit tests for GET /platform/me business logic.
 * No DB, no Express - tests the permission derivation helpers used by the endpoint.
 *
 * T1: GET /platform/me returns effectivePlatformRoleCode + permissions for legacy root
 * T2: GET /platform/me denies workspace users (403 logic verified via role check)
 */

import { describe, it, expect } from "vitest";
import {
  getPlatformUserRoleCode,
  getPlatformPermissionsForRole,
  hasPlatformPermission,
  PLATFORM_PERMISSION_CODES,
} from "../platform-permissions";
import { isPlatformScopeUser, canAccessPlatformSelfManagement } from "../platform-scope";

// ── T1: Legacy root (platformRoleCode IS NULL) ────────────────────────────────

describe("T1 - legacy root user gets full effective role and all permissions", () => {
  const legacyRoot = {
    role: "super_admin",
    platformRoleCode: null,
    isRootOwner: false,
  };

  it("resolves to root_platform_owner effectiveRoleCode", () => {
    const code = getPlatformUserRoleCode(legacyRoot);
    expect(code).toBe("root_platform_owner");
  });

  it("gets all 28 permissions as permissions[]", () => {
    const roleCode = getPlatformUserRoleCode(legacyRoot)!;
    const permSet = getPlatformPermissionsForRole(roleCode);
    const permissions = [...permSet];
    expect(permissions).toHaveLength(PLATFORM_PERMISSION_CODES.length);
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(permSet.has(code)).toBe(true);
    }
  });

  it("platform/me response shape would include isRootOwner=false, effectivePlatformRoleCode=root_platform_owner", () => {
    const roleCode = getPlatformUserRoleCode(legacyRoot)!;
    const permSet = getPlatformPermissionsForRole(roleCode);
    const payload = {
      role: legacyRoot.role,
      platformRoleCode: legacyRoot.platformRoleCode,
      effectivePlatformRoleCode: roleCode,
      isRootOwner: legacyRoot.isRootOwner,
      permissions: [...permSet],
    };
    expect(payload.effectivePlatformRoleCode).toBe("root_platform_owner");
    expect(payload.platformRoleCode).toBeNull();
    expect(payload.permissions).toHaveLength(PLATFORM_PERMISSION_CODES.length);
  });
});

// ── T1b: isRootOwner=true user also gets all permissions ─────────────────────

describe("T1b - isRootOwner=true gets all permissions", () => {
  const rootOwner = {
    role: "super_admin",
    platformRoleCode: "platform_admin",
    isRootOwner: true,
  };

  it("resolves to root_platform_owner despite having platformRoleCode set", () => {
    const code = getPlatformUserRoleCode(rootOwner);
    expect(code).toBe("root_platform_owner");
  });

  it("has all platform permissions", () => {
    const code = getPlatformUserRoleCode(rootOwner)!;
    const permSet = getPlatformPermissionsForRole(code);
    expect([...permSet]).toHaveLength(PLATFORM_PERMISSION_CODES.length);
  });
});

// ── T2: Workspace user (403 logic) ────────────────────────────────────────────

describe("T2 - platform scope guard (GET /platform/me)", () => {
  it("a workspace user (role=admin, workspaceId=5) is blocked", () => {
    expect(isPlatformScopeUser({ role: "admin", workspaceId: 5 })).toBe(false);
  });

  it("a member user is blocked", () => {
    expect(isPlatformScopeUser({ role: "member", workspaceId: 1 })).toBe(false);
  });

  it("a super_admin with a workspace is blocked (tenant admin)", () => {
    expect(isPlatformScopeUser({ role: "super_admin", workspaceId: 3 })).toBe(false);
  });

  it("platform super_admin with workspaceId null is allowed", () => {
    expect(isPlatformScopeUser({ role: "super_admin", workspaceId: null })).toBe(true);
  });

  it("legacy root after requireAuth (workspaceId undefined) is allowed", () => {
    expect(isPlatformScopeUser({ role: "super_admin", workspaceId: undefined })).toBe(true);
  });
});

describe("T2b - canAccessPlatformSelfManagement (/platform/me/*)", () => {
  it("allows any super_admin including tenant-scoped workspaceId", () => {
    expect(canAccessPlatformSelfManagement({ role: "super_admin", workspaceId: 5 })).toBe(true);
  });

  it("allows legacy root with undefined workspaceId", () => {
    expect(canAccessPlatformSelfManagement({ role: "super_admin", workspaceId: undefined })).toBe(true);
  });

  it("blocks workspace admin", () => {
    expect(canAccessPlatformSelfManagement({ role: "admin", workspaceId: 1 })).toBe(false);
  });
});

// ── T3: Platform role code derivation ────────────────────────────────────────

describe("T3 - getPlatformUserRoleCode correctness", () => {
  it("read_only_operator gets correct role code", () => {
    const user = { role: "super_admin", platformRoleCode: "read_only_operator", isRootOwner: false };
    expect(getPlatformUserRoleCode(user)).toBe("read_only_operator");
  });

  it("auditor gets correct role code", () => {
    const user = { role: "super_admin", platformRoleCode: "auditor", isRootOwner: false };
    expect(getPlatformUserRoleCode(user)).toBe("auditor");
  });

  it("non-super_admin returns null", () => {
    const user = { role: "admin", platformRoleCode: null, isRootOwner: false };
    expect(getPlatformUserRoleCode(user)).toBeNull();
  });
});

// ── T4: Specific role permissions ────────────────────────────────────────────

describe("T4 - role-specific permissions for /platform/me response", () => {
  it("platform_admin has platform.users.read and platform.users.create (all permissions)", () => {
    const code = getPlatformUserRoleCode({
      role: "super_admin", platformRoleCode: "platform_admin", isRootOwner: false,
    })!;
    const perms = getPlatformPermissionsForRole(code);
    expect(perms.has("platform.users.read")).toBe(true);
    expect(perms.has("platform.users.create")).toBe(true);
  });

  it("support_admin has tenants.read but NOT platform.users.read (not a user manager)", () => {
    const code = getPlatformUserRoleCode({
      role: "super_admin", platformRoleCode: "support_admin", isRootOwner: false,
    })!;
    const perms = getPlatformPermissionsForRole(code);
    expect(perms.has("tenants.read")).toBe(true);
    expect(perms.has("platform.users.read")).toBe(false);
    expect(perms.has("platform.users.create")).toBe(false);
  });

  it("finance_admin has subscriptions.read but not platform.users.read", () => {
    const code = getPlatformUserRoleCode({
      role: "super_admin", platformRoleCode: "finance_admin", isRootOwner: false,
    })!;
    const perms = getPlatformPermissionsForRole(code);
    expect(perms.has("subscriptions.read")).toBe(true);
    expect(perms.has("platform.users.read")).toBe(false);
  });

  it("read_only_operator has only read-class permissions", () => {
    const code = getPlatformUserRoleCode({
      role: "super_admin", platformRoleCode: "read_only_operator", isRootOwner: false,
    })!;
    const perms = getPlatformPermissionsForRole(code);
    const writePerms = [
      "platform.users.create",
      "platform.users.status.update",
      "platform.users.role.update",
      "tenants.lifecycle.update",
      "subscriptions.update",
      "entitlements.override.update",
    ] as const;
    for (const wp of writePerms) {
      expect(perms.has(wp)).toBe(false);
    }
  });
});

// ── T5: hasPlatformPermission helper ─────────────────────────────────────────

describe("T5 - hasPlatformPermission used in requirePlatformPermission middleware", () => {
  it("root user passes all permission checks", () => {
    const root = { role: "super_admin", platformRoleCode: null, isRootOwner: false };
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(hasPlatformPermission(root, code)).toBe(true);
    }
  });

  it("workspace user fails all platform permission checks", () => {
    const wUser = { role: "admin", platformRoleCode: null, isRootOwner: false };
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(hasPlatformPermission(wUser, code)).toBe(false);
    }
  });
});
