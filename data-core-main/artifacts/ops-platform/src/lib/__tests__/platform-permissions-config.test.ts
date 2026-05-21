/**
 * platform-permissions-config.test.ts
 *
 * @phase P14-B - Platform Roles & Permission Matrix
 *
 * Tests for the frontend platform-permissions-config module.
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_PERMISSION_CONFIG,
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
  PLATFORM_ROLE_PERMISSION_SUMMARY,
  PLATFORM_PERMISSION_GROUPS,
  PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT,
  ASSIGNABLE_PLATFORM_ROLE_KEYS,
} from "../platform-permissions-config";

// ── T1: Permission config stable ──────────────────────────────────────────────

describe("T1: PLATFORM_PERMISSION_CONFIG stable", () => {
  it("permission catalog matches config entries", () => {
    const n = PLATFORM_PERMISSION_CODES.length;
    expect(n).toBeGreaterThan(0);
    expect(Object.keys(PLATFORM_PERMISSION_CONFIG)).toHaveLength(n);
  });

  it("every permission has required fields", () => {
    for (const code of PLATFORM_PERMISSION_CODES) {
      const def = PLATFORM_PERMISSION_CONFIG[code];
      expect(def.code).toBe(code);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.labelAr.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.group.length).toBeGreaterThan(0);
    }
  });

  it("all riskLevels are valid", () => {
    const validLevels = ["read", "controlled_write", "sensitive_write", "root_only"];
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(validLevels).toContain(PLATFORM_PERMISSION_CONFIG[code].riskLevel);
    }
  });
});

// ── T2: Role permission matrix stable ────────────────────────────────────────

describe("T2: PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG stable", () => {
  it("contains exactly 8 roles", () => {
    expect(Object.keys(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG)).toHaveLength(8);
  });

  it("root_platform_owner has all platform permissions", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.root_platform_owner).toHaveLength(
      PLATFORM_PERMISSION_CODES.length,
    );
  });

  it("platform_admin has all permissions except root-only overrides", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.platform_admin).toHaveLength(
      PLATFORM_PERMISSION_CODES.length - 2,
    );
  });

  it("support_admin has fewer permissions than platform_admin", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.support_admin.length).toBeLessThan(
      PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.platform_admin.length,
    );
  });

  it("all permission codes in matrix are valid", () => {
    for (const [, perms] of Object.entries(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG)) {
      for (const p of perms) {
        expect(PLATFORM_PERMISSION_CODES).toContain(p);
      }
    }
  });

  it("support_admin includes tenants.read and health.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.support_admin).toContain("tenants.read");
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.support_admin).toContain("health.read");
  });

  it("finance_admin includes audit.read but not entitlements.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin).toContain("audit.read");
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin).not.toContain("entitlements.read");
  });
});

// ── T3: Safety contract all true ─────────────────────────────────────────────

describe("T3: PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT all true", () => {
  it("contains all required keys", () => {
    const requiredKeys = [
      "fixedRoleMatrix",
      "noCustomRoles",
      "noRootAssignmentFromUi",
      "noPermissionEditor",
      "noTenantUsers",
      "noCustomerUsers",
      "noHrUsers",
      "noPasswordReset",
      "noDeleteUser",
      "noSso",
      "noMfa",
      "auditRoleChanges",
      "auditPermissionDenied",
      "preserveRootProtection",
    ];
    for (const key of requiredKeys) {
      expect(PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT).toHaveProperty(key);
    }
  });

  it("all 14 safety contract properties are true", () => {
    for (const [key, val] of Object.entries(PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT)) {
      expect(val).toBe(true, `Safety contract key "${key}" must be true`);
    }
  });

  it("has exactly 14 safety contract properties", () => {
    expect(Object.keys(PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT)).toHaveLength(14);
  });
});

// ── T4: ASSIGNABLE_PLATFORM_ROLE_KEYS excludes root ──────────────────────────

describe("T4: ASSIGNABLE_PLATFORM_ROLE_KEYS excludes root", () => {
  it("does not include root_platform_owner", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).not.toContain("root_platform_owner");
  });

  it("contains exactly 7 assignable roles", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).toHaveLength(7);
  });

  it("contains all expected assignable roles", () => {
    const expected = [
      "platform_admin",
      "support_admin",
      "workspace_support",
      "sales_admin",
      "finance_admin",
      "auditor",
      "read_only_operator",
    ];
    for (const role of expected) {
      expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).toContain(role);
    }
  });
});

// ── T5: PLATFORM_ROLE_PERMISSION_SUMMARY stable ───────────────────────────────

describe("T5: PLATFORM_ROLE_PERMISSION_SUMMARY stable", () => {
  it("contains 8 role summaries", () => {
    expect(PLATFORM_ROLE_PERMISSION_SUMMARY).toHaveLength(8);
  });

  it("root_platform_owner is not assignable from UI", () => {
    const root = PLATFORM_ROLE_PERMISSION_SUMMARY.find(r => r.roleCode === "root_platform_owner");
    expect(root?.assignableFromUi).toBe(false);
  });

  it("all other 7 roles are assignable from UI", () => {
    const assignable = PLATFORM_ROLE_PERMISSION_SUMMARY.filter(r => r.roleCode !== "root_platform_owner");
    expect(assignable).toHaveLength(7);
    for (const r of assignable) {
      expect(r.assignableFromUi).toBe(true);
    }
  });

  it("every summary has label, labelAr, permissionCount", () => {
    for (const summary of PLATFORM_ROLE_PERMISSION_SUMMARY) {
      expect(summary.label.length).toBeGreaterThan(0);
      expect(summary.labelAr.length).toBeGreaterThan(0);
      expect(summary.permissionCount).toBeGreaterThan(0);
    }
  });
});

// ── T6: PLATFORM_PERMISSION_GROUPS covers all permissions ────────────────────

describe("T6: PLATFORM_PERMISSION_GROUPS covers all permissions", () => {
  it("contains exactly 11 groups", () => {
    expect(PLATFORM_PERMISSION_GROUPS).toHaveLength(11);
  });

  it("all permission codes appear in exactly one group", () => {
    const allGrouped: string[] = [];
    for (const group of PLATFORM_PERMISSION_GROUPS) {
      for (const code of group.permissions) {
        allGrouped.push(code);
      }
    }
    expect(allGrouped).toHaveLength(PLATFORM_PERMISSION_CODES.length);
    expect(new Set(allGrouped).size).toBe(PLATFORM_PERMISSION_CODES.length);
    for (const code of PLATFORM_PERMISSION_CODES) {
      expect(allGrouped).toContain(code);
    }
  });

  it("every group has label, labelAr, and non-empty permissions", () => {
    for (const group of PLATFORM_PERMISSION_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.labelAr.length).toBeGreaterThan(0);
      expect(group.permissions.length).toBeGreaterThan(0);
    }
  });
});

// ── T7: Role matrix renders grouped permissions correctly ─────────────────────

describe("T7: role matrix grouped permissions", () => {
  it("Platform Users group includes lifecycle, permissions, review, and invitations", () => {
    const group = PLATFORM_PERMISSION_GROUPS.find(g => g.group === "Platform Users");
    expect(group?.permissions).toContain("platform.users.read");
    expect(group?.permissions).toContain("platform.invitations.read");
    expect(group?.permissions).toContain("platform.accessReview.read");
    expect(group?.permissions.length).toBeGreaterThanOrEqual(10);
  });

  it("Tenants group contains tenants.read and tenants.lifecycle.update", () => {
    const group = PLATFORM_PERMISSION_GROUPS.find(g => g.group === "Tenants");
    expect(group?.permissions).toContain("tenants.read");
    expect(group?.permissions).toContain("tenants.lifecycle.update");
  });

  it("Audit group contains audit.read", () => {
    const group = PLATFORM_PERMISSION_GROUPS.find(g => g.group === "Audit");
    expect(group?.permissions).toContain("audit.read");
  });
});

// ── T8: Role change UI excludes root ─────────────────────────────────────────

describe("T8: frontend role change excludes root_platform_owner", () => {
  it("ASSIGNABLE_PLATFORM_ROLE_KEYS never includes root", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS.includes("root_platform_owner" as never)).toBe(false);
  });

  it("PLATFORM_ROLE_PERMISSION_SUMMARY assignable subset has no root", () => {
    const assignable = PLATFORM_ROLE_PERMISSION_SUMMARY.filter(r => r.assignableFromUi);
    const codes = assignable.map(r => r.roleCode);
    expect(codes).not.toContain("root_platform_owner");
  });
});

// ── T9: No forbidden scope in frontend config ─────────────────────────────────

describe("T9: no forbidden scope in platform-permissions-config", () => {
  const FORBIDDEN_TERMS = [
    "password",
    "delete_user",
    "sso",
    "mfa",
    "tenant_user",
    "customer_user",
    "hr_employee",
    "payroll",
    "custom_role_builder",
    // Note: commercial.invoices.* metadata permissions are intentional (P15-C).
  ];

  it("PLATFORM_PERMISSION_CODES does not include forbidden scope", () => {
    const codeStr = PLATFORM_PERMISSION_CODES.join(" ").toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      expect(codeStr).not.toContain(term.toLowerCase());
    }
  });
});
