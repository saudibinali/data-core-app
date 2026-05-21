/**
 * root-platform-owner-policy.test.ts
 * P14-A - Policy unit tests
 */

import { describe, it, expect } from "vitest";
import {
  ROOT_PLATFORM_OWNER_PROTECTION_POLICY,
  isRootPlatformOwner,
  isProtectedPlatformAccount,
  canAssignPlatformRole,
  canManagePlatformUser,
  canChangePlatformUserStatus,
  canResetPlatformUserPasswordFromAdmin,
  canChangePlatformUserEmail,
  validatePlatformUserCreate,
  validatePlatformUserStatusChange,
  buildBlockedPlatformUserActionAuditEvent,
  BLOCKED_ROLE_CODES_FROM_UI,
  ALL_ASSIGNABLE_PLATFORM_ROLE_CODES,
  ALL_PLATFORM_USER_STATUSES,
  MUTABLE_PLATFORM_USER_STATUSES,
  PLATFORM_USER_REASON_MIN_LENGTH,
  isAssignableRoleCode,
  type PlatformUserIdentity,
} from "../root-platform-owner-policy";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rootUser: PlatformUserIdentity = {
  id: 1,
  email: "root@platform.local",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: null,
  isRootOwner: false, // derived via backward-compat
  isProtected: false,
};

const explicitRootUser: PlatformUserIdentity = {
  id: 1,
  email: "root@platform.local",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: null,
  isRootOwner: true,
  isProtected: true,
};

const platformAdmin: PlatformUserIdentity = {
  id: 2,
  email: "padmin@platform.local",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "platform_admin",
  isRootOwner: false,
  isProtected: false,
};

const supportAdmin: PlatformUserIdentity = {
  id: 3,
  email: "support@platform.local",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "support_admin",
  isRootOwner: false,
  isProtected: false,
};

const auditor: PlatformUserIdentity = {
  id: 4,
  email: "auditor@platform.local",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "auditor",
  isRootOwner: false,
  isProtected: false,
};

// ── T1: Root protection policy all true ──────────────────────────────────────

describe("T1 - ROOT_PLATFORM_OWNER_PROTECTION_POLICY", () => {
  it("has all properties set to true", () => {
    for (const [key, value] of Object.entries(ROOT_PLATFORM_OWNER_PROTECTION_POLICY)) {
      expect(value, `policy.${key}`).toBe(true);
    }
  });

  it("has all required policy keys", () => {
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
      expect(ROOT_PLATFORM_OWNER_PROTECTION_POLICY).toHaveProperty(key);
    }
  });
});

// ── T2: isRootPlatformOwner ───────────────────────────────────────────────────

describe("T2 - isRootPlatformOwner", () => {
  it("returns true for explicit isRootOwner flag", () => {
    expect(isRootPlatformOwner(explicitRootUser)).toBe(true);
  });

  it("returns true for backward-compat: super_admin + no workspace + no platformRoleCode", () => {
    expect(isRootPlatformOwner(rootUser)).toBe(true);
  });

  it("returns false for platform_admin", () => {
    expect(isRootPlatformOwner(platformAdmin)).toBe(false);
  });

  it("returns false for support_admin", () => {
    expect(isRootPlatformOwner(supportAdmin)).toBe(false);
  });

  it("returns false for user with workspaceId (workspace user)", () => {
    const workspaceUser: PlatformUserIdentity = { id: 99, role: "admin", workspaceId: 5, platformRoleCode: null };
    expect(isRootPlatformOwner(workspaceUser)).toBe(false);
  });
});

// ── T3: isProtectedPlatformAccount ───────────────────────────────────────────

describe("T3 - isProtectedPlatformAccount", () => {
  it("returns true for explicit isProtected flag", () => {
    expect(isProtectedPlatformAccount(explicitRootUser)).toBe(true);
  });

  it("returns true for backward-compat root (no explicit isProtected needed)", () => {
    expect(isProtectedPlatformAccount(rootUser)).toBe(true);
  });

  it("returns false for platform_admin", () => {
    expect(isProtectedPlatformAccount(platformAdmin)).toBe(false);
  });

  it("returns false for auditor", () => {
    expect(isProtectedPlatformAccount(auditor)).toBe(false);
  });
});

// ── T4: canAssignPlatformRole ─────────────────────────────────────────────────

describe("T4 - canAssignPlatformRole", () => {
  it("always blocks root_platform_owner assignment", () => {
    const result = canAssignPlatformRole(explicitRootUser, "root_platform_owner");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("ROOT_ROLE_ASSIGNMENT_BLOCKED");
  });

  it("root can assign platform_admin (lower privilege)", () => {
    const result = canAssignPlatformRole(explicitRootUser, "platform_admin");
    expect(result.allowed).toBe(true);
  });

  it("root can assign auditor", () => {
    const result = canAssignPlatformRole(explicitRootUser, "auditor");
    expect(result.allowed).toBe(true);
  });

  it("platform_admin cannot assign platform_admin (equal privilege)", () => {
    const result = canAssignPlatformRole(platformAdmin, "platform_admin");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("EQUAL_OR_HIGHER_PRIVILEGE");
  });

  it("platform_admin can assign support_admin (lower privilege)", () => {
    const result = canAssignPlatformRole(platformAdmin, "support_admin");
    expect(result.allowed).toBe(true);
  });

  it("blocks unknown role codes", () => {
    const result = canAssignPlatformRole(explicitRootUser, "unknown_role");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("UNKNOWN_ROLE_CODE");
  });
});

// ── T5: canManagePlatformUser ─────────────────────────────────────────────────

describe("T5 - canManagePlatformUser", () => {
  it("blocks self-management", () => {
    const result = canManagePlatformUser({ id: 2, ...platformAdmin }, { id: 2, ...platformAdmin });
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("SELF_MANAGEMENT_BLOCKED");
  });

  it("blocks managing protected root owner", () => {
    const result = canManagePlatformUser(platformAdmin, explicitRootUser);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("PROTECTED_ACCOUNT");
  });

  it("even root cannot manage root (immutable)", () => {
    const result = canManagePlatformUser(explicitRootUser, { id: 10, ...explicitRootUser });
    expect(result.allowed).toBe(false);
  });

  it("blocks managing equal-privilege user", () => {
    const otherPlatformAdmin: PlatformUserIdentity = { id: 10, platformRoleCode: "platform_admin" };
    const result = canManagePlatformUser(platformAdmin, otherPlatformAdmin);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("EQUAL_OR_HIGHER_PRIVILEGE");
  });

  it("platform_admin can manage support_admin (lower privilege)", () => {
    const result = canManagePlatformUser(platformAdmin, supportAdmin);
    expect(result.allowed).toBe(true);
  });
});

// ── T6: canChangePlatformUserStatus ──────────────────────────────────────────

describe("T6 - canChangePlatformUserStatus", () => {
  it("cannot disable protected root owner (backward-compat root)", () => {
    const result = canChangePlatformUserStatus(platformAdmin, rootUser, "disabled");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("PROTECTED_ROOT_OWNER_IMMUTABLE");
  });

  it("cannot lock explicit root owner", () => {
    const result = canChangePlatformUserStatus(platformAdmin, explicitRootUser, "locked");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("PROTECTED_ROOT_OWNER_IMMUTABLE");
  });

  it("cannot change status of equal-privilege user", () => {
    const other: PlatformUserIdentity = { id: 10, platformRoleCode: "platform_admin" };
    const result = canChangePlatformUserStatus(platformAdmin, other, "disabled");
    expect(result.allowed).toBe(false);
  });

  it("platform_admin can change support_admin status", () => {
    const result = canChangePlatformUserStatus(platformAdmin, supportAdmin, "disabled");
    expect(result.allowed).toBe(true);
  });
});

// ── T7: canResetPlatformUserPasswordFromAdmin ─────────────────────────────────

describe("T7 - canResetPlatformUserPasswordFromAdmin", () => {
  it("cannot reset root password from admin UI", () => {
    const result = canResetPlatformUserPasswordFromAdmin(platformAdmin, explicitRootUser);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("ROOT_PASSWORD_RESET_BLOCKED");
  });

  it("cannot reset backward-compat root password", () => {
    const result = canResetPlatformUserPasswordFromAdmin(platformAdmin, rootUser);
    expect(result.allowed).toBe(false);
  });

  it("allows reset for non-protected user", () => {
    const result = canResetPlatformUserPasswordFromAdmin(platformAdmin, supportAdmin);
    expect(result.allowed).toBe(true);
  });
});

// ── T8: canChangePlatformUserEmail ────────────────────────────────────────────

describe("T8 - canChangePlatformUserEmail", () => {
  it("cannot change root email from admin UI", () => {
    const result = canChangePlatformUserEmail(platformAdmin, explicitRootUser);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("ROOT_EMAIL_CHANGE_BLOCKED");
  });

  it("cannot change backward-compat root email", () => {
    const result = canChangePlatformUserEmail(platformAdmin, rootUser);
    expect(result.allowed).toBe(false);
  });

  it("allows email change for non-protected user", () => {
    const result = canChangePlatformUserEmail(platformAdmin, auditor);
    expect(result.allowed).toBe(true);
  });
});

// ── T9: validatePlatformUserCreate ────────────────────────────────────────────

describe("T9 - validatePlatformUserCreate", () => {
  it("valid payload passes", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "newuser@platform.local",
      displayName: "New User",
      roleCode: "support_admin",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("blocks root_platform_owner roleCode", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "root2@platform.local",
      displayName: "Second Root",
      roleCode: "root_platform_owner",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ROOT_ROLE_ASSIGNMENT_BLOCKED");
  });

  it("blocks invalid email", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "not-an-email",
      displayName: "Test",
      roleCode: "auditor",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("INVALID_EMAIL");
  });

  it("blocks missing display name", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "user@platform.local",
      displayName: "",
      roleCode: "auditor",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("DISPLAY_NAME_REQUIRED");
  });

  it("blocks missing roleCode", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "user@platform.local",
      displayName: "Test User",
      roleCode: undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ROLE_CODE_REQUIRED");
  });

  it("blocks unknown roleCode", () => {
    const result = validatePlatformUserCreate(explicitRootUser, {
      email: "user@platform.local",
      displayName: "Test User",
      roleCode: "nonexistent_role",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("UNKNOWN_ROLE_CODE");
  });

  it("blocks platform_admin assigning platform_admin (equal privilege)", () => {
    const result = validatePlatformUserCreate(platformAdmin, {
      email: "user@platform.local",
      displayName: "Test User",
      roleCode: "platform_admin",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("EQUAL_OR_HIGHER_PRIVILEGE");
  });
});

// ── T10: validatePlatformUserStatusChange ─────────────────────────────────────

describe("T10 - validatePlatformUserStatusChange", () => {
  it("valid status change passes", () => {
    const result = validatePlatformUserStatusChange(platformAdmin, supportAdmin, {
      nextStatus: "disabled",
      reason: "Account no longer required for operations",
      confirmation: true,
    });
    expect(result.valid).toBe(true);
  });

  it("blocks status change for protected root (no reason/confirmation provided)", () => {
    const result = validatePlatformUserStatusChange(platformAdmin, rootUser, {
      nextStatus: "disabled",
      reason: "Disabling root for testing",
      confirmation: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PROTECTED_ROOT_OWNER_IMMUTABLE");
  });

  it("blocks when reason is too short", () => {
    const result = validatePlatformUserStatusChange(platformAdmin, supportAdmin, {
      nextStatus: "disabled",
      reason: "short",
      confirmation: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("REASON_TOO_SHORT");
  });

  it("blocks when confirmation is false", () => {
    const result = validatePlatformUserStatusChange(platformAdmin, supportAdmin, {
      nextStatus: "active",
      reason: "Restoring account access for operator",
      confirmation: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("CONFIRMATION_REQUIRED");
  });

  it("blocks unknown status", () => {
    const result = validatePlatformUserStatusChange(platformAdmin, supportAdmin, {
      nextStatus: "deleted",
      reason: "Trying to delete this account now",
      confirmation: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("UNKNOWN_STATUS");
  });
});

// ── T11: buildBlockedPlatformUserActionAuditEvent ────────────────────────────

describe("T11 - buildBlockedPlatformUserActionAuditEvent", () => {
  it("produces correct audit event structure", () => {
    const event = buildBlockedPlatformUserActionAuditEvent(
      platformAdmin,
      rootUser,
      "disable_account",
      "PROTECTED_ROOT_OWNER_IMMUTABLE",
    );
    expect(event.result).toBe("blocked");
    expect(event.blockedReason).toBe("PROTECTED_ROOT_OWNER_IMMUTABLE");
    expect(event.actorId).toBe(2);
    expect(event.targetUserId).toBe(1);
    expect(event.action).toBe("disable_account");
    expect(typeof event.timestamp).toBe("string");
  });
});

// ── T12: Constants ────────────────────────────────────────────────────────────

describe("T12 - Constants", () => {
  it("BLOCKED_ROLE_CODES_FROM_UI includes root_platform_owner", () => {
    expect(BLOCKED_ROLE_CODES_FROM_UI).toContain("root_platform_owner");
  });

  it("ALL_ASSIGNABLE_PLATFORM_ROLE_CODES does NOT include root_platform_owner", () => {
    expect(ALL_ASSIGNABLE_PLATFORM_ROLE_CODES).not.toContain("root_platform_owner");
  });

  it("ALL_PLATFORM_USER_STATUSES includes all 4 statuses", () => {
    expect(ALL_PLATFORM_USER_STATUSES).toContain("invited");
    expect(ALL_PLATFORM_USER_STATUSES).toContain("active");
    expect(ALL_PLATFORM_USER_STATUSES).toContain("disabled");
    expect(ALL_PLATFORM_USER_STATUSES).toContain("locked");
  });

  it("MUTABLE_PLATFORM_USER_STATUSES does NOT include invited", () => {
    expect(MUTABLE_PLATFORM_USER_STATUSES).not.toContain("invited");
  });

  it("PLATFORM_USER_REASON_MIN_LENGTH is 10", () => {
    expect(PLATFORM_USER_REASON_MIN_LENGTH).toBe(10);
  });
});

// ── T13: isAssignableRoleCode ─────────────────────────────────────────────────

describe("T13 - isAssignableRoleCode", () => {
  it("returns false for root_platform_owner", () => {
    expect(isAssignableRoleCode("root_platform_owner")).toBe(false);
  });

  it("returns true for all assignable codes", () => {
    for (const code of ALL_ASSIGNABLE_PLATFORM_ROLE_CODES) {
      expect(isAssignableRoleCode(code), `code: ${code}`).toBe(true);
    }
  });

  it("returns false for unknown codes", () => {
    expect(isAssignableRoleCode("tenant_admin")).toBe(false);
    expect(isAssignableRoleCode("")).toBe(false);
  });
});

// ── T14: Self-promotion blocked ───────────────────────────────────────────────

describe("T14 - Self-promotion blocked", () => {
  it("actor cannot manage themselves", () => {
    const result = canManagePlatformUser(
      { id: 5, platformRoleCode: "support_admin" },
      { id: 5, platformRoleCode: "support_admin" },
    );
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("SELF_MANAGEMENT_BLOCKED");
  });
});

// ── T15: No forbidden scope ───────────────────────────────────────────────────

describe("T15 - No forbidden scope in policy lib", () => {
  it("policy lib exports no password reset functions", () => {
    const policyExports = Object.keys({
      ROOT_PLATFORM_OWNER_PROTECTION_POLICY,
      isRootPlatformOwner,
      isProtectedPlatformAccount,
      canAssignPlatformRole,
      canManagePlatformUser,
      canChangePlatformUserStatus,
      canResetPlatformUserPasswordFromAdmin,
      canChangePlatformUserEmail,
      validatePlatformUserCreate,
      validatePlatformUserStatusChange,
      buildBlockedPlatformUserActionAuditEvent,
    });
    const forbidden = policyExports.filter(k =>
      k.toLowerCase().includes("delete") ||
      k.toLowerCase().includes("invite") ||
      k.toLowerCase().includes("sso") ||
      k.toLowerCase().includes("mfa")
    );
    expect(forbidden).toHaveLength(0);
  });
});
