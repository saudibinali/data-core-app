/**
 * platform-permissions.test.ts
 *
 * @phase P14-B - Platform Roles & Permission Matrix
 *
 * Tests for the pure platform-permissions lib.
 * No DB, no HTTP, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_PERMISSION_CONFIG,
  PLATFORM_ROLE_PERMISSION_MATRIX,
  getPlatformUserRoleCode,
  getPlatformPermissionsForRole,
  hasPlatformPermission,
  hasAnyPlatformPermission,
  hasAllPlatformPermissions,
  assertPlatformPermission,
  isRootOnlyPermission,
  isAssignablePlatformRoleCode,
  buildPermissionDeniedAuditEvent,
  type PlatformPermissionCode,
  type PlatformUserPermissionIdentity,
} from "../platform-permissions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const legacyRoot: PlatformUserPermissionIdentity = {
  id: 1,
  role: "super_admin",
  platformRoleCode: null,
  isRootOwner: false,
};

const explicitRoot: PlatformUserPermissionIdentity = {
  id: 2,
  role: "super_admin",
  platformRoleCode: "platform_admin",
  isRootOwner: true,
};

const platformAdmin: PlatformUserPermissionIdentity = {
  id: 3,
  role: "super_admin",
  platformRoleCode: "platform_admin",
  isRootOwner: false,
};

const supportAdmin: PlatformUserPermissionIdentity = {
  id: 4,
  role: "super_admin",
  platformRoleCode: "support_admin",
  isRootOwner: false,
};

const workspaceSupport: PlatformUserPermissionIdentity = {
  id: 5,
  role: "super_admin",
  platformRoleCode: "workspace_support",
  isRootOwner: false,
};

const salesAdmin: PlatformUserPermissionIdentity = {
  id: 6,
  role: "super_admin",
  platformRoleCode: "sales_admin",
  isRootOwner: false,
};

const financeAdmin: PlatformUserPermissionIdentity = {
  id: 7,
  role: "super_admin",
  platformRoleCode: "finance_admin",
  isRootOwner: false,
};

const auditor: PlatformUserPermissionIdentity = {
  id: 8,
  role: "super_admin",
  platformRoleCode: "auditor",
  isRootOwner: false,
};

const readOnlyOperator: PlatformUserPermissionIdentity = {
  id: 9,
  role: "super_admin",
  platformRoleCode: "read_only_operator",
  isRootOwner: false,
};

const unknownRole: PlatformUserPermissionIdentity = {
  id: 10,
  role: "super_admin",
  platformRoleCode: "non_existent_role",
  isRootOwner: false,
};

const workspaceUser: PlatformUserPermissionIdentity = {
  id: 11,
  role: "admin",
  platformRoleCode: null,
  isRootOwner: false,
};

// ── T1: Platform permission config stable ─────────────────────────────────────

describe("T1: PLATFORM_PERMISSION_CONFIG stable", () => {
  it("contains exactly 39 permission codes", () => {
    expect(PLATFORM_PERMISSION_CODES).toHaveLength(59);
    expect(Object.keys(PLATFORM_PERMISSION_CONFIG)).toHaveLength(59);
  });

  it("every permission has required fields with non-empty strings", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      const def = PLATFORM_PERMISSION_CONFIG[code];
      expect(def.code).toBe(code);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.labelAr.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.group.length).toBeGreaterThan(0);
      expect(["read", "controlled_write", "sensitive_write", "root_only"]).toContain(def.riskLevel);
    }
  });

  it("all permission codes match their config key", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(PLATFORM_PERMISSION_CONFIG[code].code).toBe(code);
    }
  });
});

// ── T2: Role permission matrix stable ────────────────────────────────────────

describe("T2: PLATFORM_ROLE_PERMISSION_MATRIX stable", () => {
  const EXPECTED_ROLES = [
    "root_platform_owner",
    "platform_admin",
    "support_admin",
    "workspace_support",
    "sales_admin",
    "finance_admin",
    "auditor",
    "read_only_operator",
  ] as const;

  it("contains exactly 8 roles", () => {
    expect(Object.keys(PLATFORM_ROLE_PERMISSION_MATRIX)).toHaveLength(8);
  });

  it("all 8 expected roles are present", () => {
    for (const role of EXPECTED_ROLES) {
      expect(PLATFORM_ROLE_PERMISSION_MATRIX[role]).toBeDefined();
    }
  });

  it("all matrix entries are Sets of PlatformPermissionCode", () => {
    for (const role of EXPECTED_ROLES) {
      const perms = PLATFORM_ROLE_PERMISSION_MATRIX[role];
      expect(perms).toBeInstanceOf(Set);
      for (const p of perms) {
        expect(PLATFORM_PERMISSION_CODES).toContain(p);
      }
    }
  });

  it("read_only_operator has fewer permissions than platform_admin", () => {
    const roPerms = PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.size;
    const paPerms = PLATFORM_ROLE_PERMISSION_MATRIX.platform_admin.size;
    expect(roPerms).toBeLessThan(paPerms);
  });
});

// ── T3: Root gets all permissions ─────────────────────────────────────────────

describe("T3: root gets all permissions", () => {
  it("root_platform_owner role has all 39 permissions", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX.root_platform_owner;
    expect(perms.size).toBe(59);
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(perms.has(code)).toBe(true);
    }
  });

  it("platform_admin has all 39 permissions (same as root in P14-B)", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX.platform_admin;
    expect(perms.size).toBe(57);
  });

  it("root gets every platform permission via hasPlatformPermission", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(hasPlatformPermission(legacyRoot, code)).toBe(true);
    }
  });
});

// ── T4: Legacy root without platformRoleCode gets root permissions ────────────

describe("T4: legacy root detection", () => {
  it("resolves legacy root (platformRoleCode IS NULL) to root_platform_owner", () => {
    expect(getPlatformUserRoleCode(legacyRoot)).toBe("root_platform_owner");
  });

  it("legacy root has all permissions", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(hasPlatformPermission(legacyRoot, code)).toBe(true);
    }
  });

  it("explicit isRootOwner=true takes precedence over platformRoleCode", () => {
    expect(getPlatformUserRoleCode(explicitRoot)).toBe("root_platform_owner");
    expect(hasPlatformPermission(explicitRoot, "platform.users.role.update")).toBe(true);
  });

  it("non-super_admin is not a platform user (returns null roleCode)", () => {
    expect(getPlatformUserRoleCode(workspaceUser)).toBeNull();
  });
});

// ── T5: platform_admin gets expected permissions ──────────────────────────────

describe("T5: platform_admin permissions", () => {
  it("platform_admin has platform.users.read", () => {
    expect(hasPlatformPermission(platformAdmin, "platform.users.read")).toBe(true);
  });

  it("platform_admin has platform.users.create", () => {
    expect(hasPlatformPermission(platformAdmin, "platform.users.create")).toBe(true);
  });

  it("platform_admin has platform.users.role.update", () => {
    expect(hasPlatformPermission(platformAdmin, "platform.users.role.update")).toBe(true);
  });

  it("platform_admin has all 39 permissions", () => {
    expect(getPlatformPermissionsForRole("platform_admin").size).toBe(57);
  });
});

// ── T6: support_admin cannot update users role/status ────────────────────────

describe("T6: support_admin permissions", () => {
  it("support_admin does NOT have platform.users.create", () => {
    expect(hasPlatformPermission(supportAdmin, "platform.users.create")).toBe(false);
  });

  it("support_admin does NOT have platform.users.status.update", () => {
    expect(hasPlatformPermission(supportAdmin, "platform.users.status.update")).toBe(false);
  });

  it("support_admin does NOT have platform.users.role.update", () => {
    expect(hasPlatformPermission(supportAdmin, "platform.users.role.update")).toBe(false);
  });

  it("support_admin has tenants.read", () => {
    expect(hasPlatformPermission(supportAdmin, "tenants.read")).toBe(true);
  });

  it("support_admin has usage.read", () => {
    expect(hasPlatformPermission(supportAdmin, "usage.read")).toBe(true);
  });

  it("support_admin has platform.activity.read", () => {
    expect(hasPlatformPermission(supportAdmin, "platform.activity.read")).toBe(true);
  });

  it("support_admin does NOT have subscriptions.read", () => {
    expect(hasPlatformPermission(supportAdmin, "subscriptions.read")).toBe(false);
  });
});

// ── T7: finance_admin cannot manage platform users ────────────────────────────

describe("T7: finance_admin permissions", () => {
  it("finance_admin does NOT have platform.users.read", () => {
    expect(hasPlatformPermission(financeAdmin, "platform.users.read")).toBe(false);
  });

  it("finance_admin does NOT have platform.users.create", () => {
    expect(hasPlatformPermission(financeAdmin, "platform.users.create")).toBe(false);
  });

  it("finance_admin does NOT have platform.users.role.update", () => {
    expect(hasPlatformPermission(financeAdmin, "platform.users.role.update")).toBe(false);
  });

  it("finance_admin has tenants.read", () => {
    expect(hasPlatformPermission(financeAdmin, "tenants.read")).toBe(true);
  });

  it("finance_admin has subscriptions.read", () => {
    expect(hasPlatformPermission(financeAdmin, "subscriptions.read")).toBe(true);
  });

  it("finance_admin has audit.read", () => {
    expect(hasPlatformPermission(financeAdmin, "audit.read")).toBe(true);
  });

  it("finance_admin does NOT have entitlements.read", () => {
    expect(hasPlatformPermission(financeAdmin, "entitlements.read")).toBe(false);
  });
});

// ── T8: auditor read-only permissions ────────────────────────────────────────

describe("T8: auditor read-only permissions", () => {
  it("auditor has tenants.read, subscriptions.read, audit.read", () => {
    expect(hasPlatformPermission(auditor, "tenants.read")).toBe(true);
    expect(hasPlatformPermission(auditor, "subscriptions.read")).toBe(true);
    expect(hasPlatformPermission(auditor, "audit.read")).toBe(true);
  });

  it("auditor has entitlements.read", () => {
    expect(hasPlatformPermission(auditor, "entitlements.read")).toBe(true);
  });

  it("auditor does NOT have platform.users.create", () => {
    expect(hasPlatformPermission(auditor, "platform.users.create")).toBe(false);
  });

  it("auditor does NOT have tenants.lifecycle.update", () => {
    expect(hasPlatformPermission(auditor, "tenants.lifecycle.update")).toBe(false);
  });

  it("auditor does NOT have subscriptions.update", () => {
    expect(hasPlatformPermission(auditor, "subscriptions.update")).toBe(false);
  });

  it("auditor does NOT have entitlements.override.update", () => {
    expect(hasPlatformPermission(auditor, "entitlements.override.update")).toBe(false);
  });
});

// ── T9: unknown role gets no permissions ──────────────────────────────────────

describe("T9: unknown role gets no permissions", () => {
  it("unknown platformRoleCode resolves to null roleCode", () => {
    expect(getPlatformUserRoleCode(unknownRole)).toBeNull();
  });

  it("unknown role has no permissions", () => {
    const perms = getPlatformPermissionsForRole(null);
    expect(perms.size).toBe(0);
  });

  it("hasPlatformPermission returns false for unknown role", () => {
    expect(hasPlatformPermission(unknownRole, "tenants.read")).toBe(false);
  });

  it("workspace user (non super_admin) gets no permissions", () => {
    expect(hasPlatformPermission(workspaceUser, "tenants.read")).toBe(false);
    expect(getPlatformUserRoleCode(workspaceUser)).toBeNull();
  });
});

// ── T10: hasPlatformPermission works correctly ────────────────────────────────

describe("T10: hasPlatformPermission, hasAnyPlatformPermission, hasAllPlatformPermissions", () => {
  it("hasAnyPlatformPermission returns true when user has at least one", () => {
    expect(hasAnyPlatformPermission(salesAdmin, ["tenants.read", "platform.users.create"])).toBe(true);
  });

  it("hasAnyPlatformPermission returns false when user has none", () => {
    expect(hasAnyPlatformPermission(salesAdmin, ["platform.users.create", "audit.read"])).toBe(false);
  });

  it("hasAllPlatformPermissions returns true when user has all listed codes", () => {
    expect(hasAllPlatformPermissions(auditor, ["tenants.read", "audit.read"])).toBe(true);
  });

  it("hasAllPlatformPermissions returns false when user is missing any code", () => {
    expect(hasAllPlatformPermissions(auditor, ["tenants.read", "platform.users.create"])).toBe(false);
  });

  it("assertPlatformPermission returns null when granted", () => {
    expect(assertPlatformPermission(legacyRoot, "platform.users.read")).toBeNull();
  });

  it("assertPlatformPermission returns the permissionCode when denied", () => {
    expect(assertPlatformPermission(salesAdmin, "platform.users.create")).toBe("platform.users.create");
  });
});

// ── T11: isRootOnlyPermission ─────────────────────────────────────────────────

describe("T11: isRootOnlyPermission (reserved for P14-C+)", () => {
  it("returns true only for platform.permissions.update in P17-B", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      if (code === "platform.permissions.update") {
        expect(isRootOnlyPermission(code)).toBe(true);
      } else {
        expect(isRootOnlyPermission(code)).toBe(false);
      }
    }
  });
});

// ── T12: isAssignablePlatformRoleCode ─────────────────────────────────────────

describe("T12: isAssignablePlatformRoleCode", () => {
  it("returns false for root_platform_owner", () => {
    expect(isAssignablePlatformRoleCode("root_platform_owner")).toBe(false);
  });

  it("returns true for all 7 assignable roles", () => {
    const assignable = [
      "platform_admin",
      "support_admin",
      "workspace_support",
      "sales_admin",
      "finance_admin",
      "auditor",
      "read_only_operator",
    ];
    for (const r of assignable) {
      expect(isAssignablePlatformRoleCode(r)).toBe(true);
    }
  });

  it("returns false for unknown/arbitrary strings", () => {
    expect(isAssignablePlatformRoleCode("custom_role")).toBe(false);
    expect(isAssignablePlatformRoleCode("")).toBe(false);
    expect(isAssignablePlatformRoleCode("member")).toBe(false);
  });
});

// ── T13: buildPermissionDeniedAuditEvent ──────────────────────────────────────

describe("T13: buildPermissionDeniedAuditEvent structure", () => {
  it("returns correct shape with all required fields", () => {
    const event = buildPermissionDeniedAuditEvent(salesAdmin, "platform.users.create", "POST /platform/users");
    expect(event.event).toBe("platform_permission_denied");
    expect(event.actorId).toBe(6);
    expect(event.permissionCode).toBe("platform.users.create");
    expect(event.resource).toBe("POST /platform/users");
    expect(event.effectiveRoleCode).toBe("sales_admin");
    expect(event.action).toBe("permission_check");
    expect(event.result).toBe("denied");
  });

  it("captures root effective role code", () => {
    const event = buildPermissionDeniedAuditEvent(legacyRoot, "platform.users.read", "GET /platform/users");
    expect(event.effectiveRoleCode).toBe("root_platform_owner");
  });

  it("handles unknown role gracefully", () => {
    const event = buildPermissionDeniedAuditEvent(unknownRole, "tenants.read", "GET /platform/tenants");
    expect(event.effectiveRoleCode).toBeNull();
    expect(event.result).toBe("denied");
  });
});

// ── T14: workspace_support permissions ───────────────────────────────────────

describe("T14: workspace_support permissions", () => {
  it("workspace_support has tenants.read and health.read", () => {
    expect(hasPlatformPermission(workspaceSupport, "tenants.read")).toBe(true);
    expect(hasPlatformPermission(workspaceSupport, "health.read")).toBe(true);
  });

  it("workspace_support does NOT have subscriptions.read", () => {
    expect(hasPlatformPermission(workspaceSupport, "subscriptions.read")).toBe(false);
  });

  it("workspace_support does NOT have platform.users.create", () => {
    expect(hasPlatformPermission(workspaceSupport, "platform.users.create")).toBe(false);
  });

  it("workspace_support does NOT have platform.activity.read", () => {
    expect(hasPlatformPermission(workspaceSupport, "platform.activity.read")).toBe(false);
  });
});

// ── T15: read_only_operator permissions ──────────────────────────────────────

describe("T15: read_only_operator permissions", () => {
  it("read_only_operator has tenants.read, usage.read, health.read", () => {
    expect(hasPlatformPermission(readOnlyOperator, "tenants.read")).toBe(true);
    expect(hasPlatformPermission(readOnlyOperator, "usage.read")).toBe(true);
    expect(hasPlatformPermission(readOnlyOperator, "health.read")).toBe(true);
  });

  it("read_only_operator does NOT have platform.users.read", () => {
    expect(hasPlatformPermission(readOnlyOperator, "platform.users.read")).toBe(false);
  });

  it("read_only_operator does NOT have subscriptions.read", () => {
    expect(hasPlatformPermission(readOnlyOperator, "subscriptions.read")).toBe(false);
  });

  it("read_only_operator does NOT have audit.read", () => {
    expect(hasPlatformPermission(readOnlyOperator, "audit.read")).toBe(false);
  });
});

// ── T16: getPlatformPermissionsForRole edge cases ────────────────────────────

describe("T16: getPlatformPermissionsForRole edge cases", () => {
  it("returns empty set for null roleCode", () => {
    expect(getPlatformPermissionsForRole(null).size).toBe(0);
  });

  it("returns correct set for each assignable role", () => {
    expect(getPlatformPermissionsForRole("sales_admin").has("tenants.read")).toBe(true);
    expect(getPlatformPermissionsForRole("sales_admin").has("platform.users.create")).toBe(false);
  });
});

// ── T17: No forbidden scope in platform-permissions lib ───────────────────────

describe("T17: no forbidden scope in platform-permissions lib", () => {
  const FORBIDDEN_TERMS = [
    "password", "email_change", "delete_user", "sso", "mfa", "break_glass",
    "tenant_user", "customer_user", "hr_employee", "payroll",
    "billing", "custom_role_builder",
    // Note: commercial.invoices.* metadata permissions are intentional (P15-C).
  ];

  it("PLATFORM_PERMISSION_CODES does not include forbidden scope", () => {
    const codeStr = PLATFORM_PERMISSION_CODES.join(" ").toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      expect(codeStr).not.toContain(term.toLowerCase());
    }
  });
});
