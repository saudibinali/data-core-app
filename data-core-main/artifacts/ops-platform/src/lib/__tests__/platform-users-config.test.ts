/**
 * platform-users-config.test.ts
 * P14-A - Frontend config unit tests
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_USER_SAFETY_CONTRACT,
  ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG,
  PLATFORM_USER_STATUS_CONFIG,
  INITIAL_PLATFORM_ROLE_CONFIG,
  PLATFORM_USER_ACTION_CONFIG,
  ASSIGNABLE_PLATFORM_ROLE_KEYS,
  ALL_INITIAL_PLATFORM_ROLE_KEYS,
  ALL_PLATFORM_USER_STATUS_KEYS,
  PLATFORM_USER_EMPTY_STATE,
  PLATFORM_USER_FORBIDDEN_WORDING,
  PLATFORM_USER_API_PATHS,
  type PlatformUserStatus,
  type InitialPlatformRoleCode,
} from "../platform-users-config";

// ── T1: Platform user status config stable ────────────────────────────────────

describe("T1 - PLATFORM_USER_STATUS_CONFIG stable", () => {
  it("has all lifecycle statuses", () => {
    const keys = ALL_PLATFORM_USER_STATUS_KEYS;
    expect(keys).toContain("invited");
    expect(keys).toContain("active");
    expect(keys).toContain("disabled");
    expect(keys).toContain("suspended");
    expect(keys).toContain("locked");
    expect(keys).toHaveLength(ALL_PLATFORM_USER_STATUS_KEYS.length);
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });

  it("each status has label, labelAr, description, badgeClass, tier", () => {
    for (const key of ALL_PLATFORM_USER_STATUS_KEYS) {
      const cfg = PLATFORM_USER_STATUS_CONFIG[key];
      expect(cfg.label, `${key}.label`).toBeTruthy();
      expect(cfg.labelAr, `${key}.labelAr`).toBeTruthy();
      expect(cfg.description, `${key}.description`).toBeTruthy();
      expect(cfg.badgeClass, `${key}.badgeClass`).toBeTruthy();
      expect(cfg.tier, `${key}.tier`).toBeTruthy();
    }
  });

  it("invited tier is neutral", () => {
    expect(PLATFORM_USER_STATUS_CONFIG.invited.tier).toBe("neutral");
  });

  it("active tier is good", () => {
    expect(PLATFORM_USER_STATUS_CONFIG.active.tier).toBe("good");
  });

  it("disabled tier is attention", () => {
    expect(PLATFORM_USER_STATUS_CONFIG.disabled.tier).toBe("attention");
  });

  it("locked tier is critical", () => {
    expect(PLATFORM_USER_STATUS_CONFIG.locked.tier).toBe("critical");
  });
});

// ── T2: Initial platform role config stable ────────────────────────────────────

describe("T2 - INITIAL_PLATFORM_ROLE_CONFIG stable", () => {
  it("has all 8 roles", () => {
    const keys = ALL_INITIAL_PLATFORM_ROLE_KEYS;
    expect(keys).toContain("root_platform_owner");
    expect(keys).toContain("platform_admin");
    expect(keys).toContain("support_admin");
    expect(keys).toContain("workspace_support");
    expect(keys).toContain("sales_admin");
    expect(keys).toContain("finance_admin");
    expect(keys).toContain("auditor");
    expect(keys).toContain("read_only_operator");
    expect(keys).toHaveLength(8);
  });

  it("each role has label, labelAr, description, badgeClass, privilegeOrder", () => {
    for (const key of ALL_INITIAL_PLATFORM_ROLE_KEYS) {
      const cfg = INITIAL_PLATFORM_ROLE_CONFIG[key];
      expect(cfg.label, `${key}.label`).toBeTruthy();
      expect(cfg.labelAr, `${key}.labelAr`).toBeTruthy();
      expect(cfg.description, `${key}.description`).toBeTruthy();
      expect(cfg.badgeClass, `${key}.badgeClass`).toBeTruthy();
      expect(typeof cfg.privilegeOrder).toBe("number");
    }
  });

  it("root_platform_owner has highest privilege order 0", () => {
    expect(INITIAL_PLATFORM_ROLE_CONFIG.root_platform_owner.privilegeOrder).toBe(0);
  });

  it("root_platform_owner is NOT assignable from UI", () => {
    expect(INITIAL_PLATFORM_ROLE_CONFIG.root_platform_owner.assignableFromUi).toBe(false);
  });

  it("all non-root roles are assignable from UI", () => {
    const assignable = ALL_INITIAL_PLATFORM_ROLE_KEYS.filter(k => k !== "root_platform_owner");
    for (const key of assignable) {
      expect(INITIAL_PLATFORM_ROLE_CONFIG[key].assignableFromUi, `${key}.assignableFromUi`).toBe(true);
    }
  });
});

// ── T3: Platform user safety contract all true ────────────────────────────────

describe("T3 - PLATFORM_USER_SAFETY_CONTRACT all true", () => {
  it("has all properties set to true", () => {
    for (const [key, value] of Object.entries(PLATFORM_USER_SAFETY_CONTRACT)) {
      expect(value, `contract.${key}`).toBe(true);
    }
  });

  it("has all required contract keys", () => {
    const required = [
      "superAdminOnly",
      "controlledPlatformUserCreation",
      "noTenantUserManagement",
      "noCustomerUserManagement",
      "noHrEmployeeUserManagement",
      "noPasswordReset",
      "noEmailInviteSending",
      "noSso",
      "noMfa",
      "noDeleteUser",
      "noRootCreationFromUi",
      "noRootRoleAssignmentFromUi",
      "noRootPasswordResetFromAdminUi",
      "noRootEmailChangeFromAdminUi",
      "noRootDisableOrLock",
      "noSelfPromotion",
      "noManageEqualOrHigherPrivilege",
      "auditBlockedAttempts",
    ];
    for (const key of required) {
      expect(PLATFORM_USER_SAFETY_CONTRACT).toHaveProperty(key);
      expect((PLATFORM_USER_SAFETY_CONTRACT as Record<string, boolean>)[key], key).toBe(true);
    }
  });

  it("has at least 18 contract properties", () => {
    expect(Object.keys(PLATFORM_USER_SAFETY_CONTRACT).length).toBeGreaterThanOrEqual(18);
  });
});

// ── T4: Root protection policy config all true ────────────────────────────────

describe("T4 - ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG all true", () => {
  it("has all properties set to true", () => {
    for (const [key, value] of Object.entries(ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG)) {
      expect(value, `policy.${key}`).toBe(true);
    }
  });

  it("has all 14 required policy keys", () => {
    const required = [
      "root_platform_owner",
      "protected_account",
      "immutable_role",
      "non_deletable",
      "non_disableable",
      "non_lockable",
      "password_reset_blocked_from_admin_ui",
      "email_change_blocked",
      "self_promotion_blocked",
      "root_role_assignment_blocked",
      "cannot_manage_equal_or_higher_privilege",
      "cannot_disable_last_root_owner",
      "requires_break_glass_recovery",
      "audit_required",
    ];
    for (const key of required) {
      expect(ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG).toHaveProperty(key);
    }
  });
});

// ── T5: Assignable roles exclude root ────────────────────────────────────────

describe("T5 - ASSIGNABLE_PLATFORM_ROLE_KEYS", () => {
  it("does not include root_platform_owner", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).not.toContain("root_platform_owner");
  });

  it("has 7 assignable roles", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).toHaveLength(7);
  });

  it("all assignable roles exist in INITIAL_PLATFORM_ROLE_CONFIG", () => {
    for (const key of ASSIGNABLE_PLATFORM_ROLE_KEYS) {
      expect(INITIAL_PLATFORM_ROLE_CONFIG).toHaveProperty(key);
    }
  });
});

// ── T6: Action config stable ──────────────────────────────────────────────────

describe("T6 - PLATFORM_USER_ACTION_CONFIG", () => {
  it("has activate, disable, lock actions", () => {
    expect(PLATFORM_USER_ACTION_CONFIG).toHaveProperty("activate");
    expect(PLATFORM_USER_ACTION_CONFIG).toHaveProperty("disable");
    expect(PLATFORM_USER_ACTION_CONFIG).toHaveProperty("lock");
  });

  it("all actions require reason and confirmation", () => {
    for (const [key, cfg] of Object.entries(PLATFORM_USER_ACTION_CONFIG)) {
      expect(cfg.requiresReason, `${key}.requiresReason`).toBe(true);
      expect(cfg.requiresConfirmation, `${key}.requiresConfirmation`).toBe(true);
    }
  });

  it("activate targets active status", () => {
    expect(PLATFORM_USER_ACTION_CONFIG.activate.targetStatus).toBe("active");
  });

  it("disable targets disabled status", () => {
    expect(PLATFORM_USER_ACTION_CONFIG.disable.targetStatus).toBe("disabled");
  });

  it("lock targets locked status", () => {
    expect(PLATFORM_USER_ACTION_CONFIG.lock.targetStatus).toBe("locked");
  });
});

// ── T7: Protected notice present ──────────────────────────────────────────────

describe("T7 - PLATFORM_USER_EMPTY_STATE", () => {
  it("has protectedNotice mentioning root", () => {
    expect(PLATFORM_USER_EMPTY_STATE.protectedNotice.toLowerCase()).toContain("root");
  });

  it("has Arabic protected notice", () => {
    expect(PLATFORM_USER_EMPTY_STATE.protectedNoticeAr).toBeTruthy();
  });

  it("has safety banner about platform accounts only", () => {
    expect(PLATFORM_USER_EMPTY_STATE.safetyBanner.toLowerCase()).toContain("platform");
  });
});

// ── T8: Forbidden wording list ────────────────────────────────────────────────

describe("T8 - PLATFORM_USER_FORBIDDEN_WORDING", () => {
  it("contains password reset, delete user, SSO, MFA", () => {
    const lower = PLATFORM_USER_FORBIDDEN_WORDING.map(w => w.toLowerCase());
    expect(lower.some(w => w.includes("password reset"))).toBe(true);
    expect(lower.some(w => w.includes("delete user"))).toBe(true);
    expect(lower.some(w => w.includes("sso"))).toBe(true);
    expect(lower.some(w => w.includes("mfa"))).toBe(true);
  });

  it("contains tenant user and HR employee", () => {
    const lower = PLATFORM_USER_FORBIDDEN_WORDING.map(w => w.toLowerCase());
    expect(lower.some(w => w.includes("tenant user"))).toBe(true);
    expect(lower.some(w => w.includes("hr employee"))).toBe(true);
  });
});

// ── T9: API paths correct ─────────────────────────────────────────────────────

describe("T9 - PLATFORM_USER_API_PATHS", () => {
  it("list() returns correct path", () => {
    expect(PLATFORM_USER_API_PATHS.list()).toBe("/api/platform/users");
  });

  it("get(123) returns correct path", () => {
    expect(PLATFORM_USER_API_PATHS.get(123)).toBe("/api/platform/users/123");
  });

  it("create() returns correct path", () => {
    expect(PLATFORM_USER_API_PATHS.create()).toBe("/api/platform/users");
  });

  it("updateStatus(456) returns correct path", () => {
    expect(PLATFORM_USER_API_PATHS.updateStatus(456)).toBe("/api/platform/users/456/status");
  });
});

// ── T10: No forbidden scope in config file ────────────────────────────────────

describe("T10 - Config file has no forbidden scope", () => {
  it("PLATFORM_USER_FORBIDDEN_WORDING: no invite sending items", () => {
    const allText = JSON.stringify({
      PLATFORM_USER_ACTION_CONFIG,
      PLATFORM_USER_EMPTY_STATE,
    });
    expect(allText).not.toContain("password reset");
    expect(allText).not.toContain("delete user");
    expect(allText).not.toContain("SSO");
    expect(allText).not.toContain("sendInvite");
  });
});
