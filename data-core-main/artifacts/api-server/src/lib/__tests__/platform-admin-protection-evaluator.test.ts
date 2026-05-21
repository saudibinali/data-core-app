/**
 * @phase P17-C - Platform admin protection evaluator tests
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_ADMIN_PROTECTION_POLICY,
  CRITICAL_PLATFORM_PERMISSIONS,
  PROTECTED_PERMISSION_PATTERNS,
  SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT,
  getSafePolicySnapshot,
} from "../platform-admin-protection-policy-config";
import {
  evaluatePlatformAdminProtection,
  resolveStatusProtectionAction,
} from "../platform-admin-protection-evaluator";
import { isProtectedPlatformAdminUser } from "../platform-protected-user";
import type { PlatformUserProtectionContext } from "../platform-protected-user";

const root: PlatformUserProtectionContext = {
  id: 1,
  email: "root@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "root_platform_owner",
  isRootOwner: true,
  isProtected: true,
};

const platformAdmin: PlatformUserProtectionContext = {
  id: 2,
  email: "admin@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "platform_admin",
  isRootOwner: false,
  isProtected: false,
};

const support: PlatformUserProtectionContext = {
  id: 3,
  email: "support@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "workspace_support",
  isRootOwner: false,
  isProtected: false,
};

describe("P17-C policy defaults", () => {
  it("static policy matches spec defaults", () => {
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.minActiveRootOwners).toBe(1);
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.minActivePlatformOwners).toBe(1);
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.requireReasonForSensitiveChanges).toBe(true);
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.requireTwoStepApprovalForRootChanges).toBe(false);
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.preventSelfDisable).toBe(true);
    expect(PLATFORM_ADMIN_PROTECTION_POLICY.emergencyAccessMode).toBe("disabled");
  });

  it("safe snapshot omits internal notes", () => {
    const snap = getSafePolicySnapshot();
    expect(snap).not.toHaveProperty("internalNotes");
    expect(snap.policyName).toBe(PLATFORM_ADMIN_PROTECTION_POLICY.policyName);
  });

  it("safety contract all true", () => {
    for (const [k, v] of Object.entries(SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("critical permissions catalog", () => {
  it("includes required platform permission codes", () => {
    expect(CRITICAL_PLATFORM_PERMISSIONS).toContain("platform.permissions.update");
    expect(CRITICAL_PLATFORM_PERMISSIONS).toContain("platform.users.disable");
    expect(CRITICAL_PLATFORM_PERMISSIONS).toContain("platform.entitlements.update");
    expect(CRITICAL_PLATFORM_PERMISSIONS.length).toBeGreaterThanOrEqual(10);
  });

  it("protected patterns include platform.users.*", () => {
    expect(PROTECTED_PERMISSION_PATTERNS.some((p) => p.includes("platform.users"))).toBe(true);
  });
});

describe("protected user detection", () => {
  it("root and platform_admin are protected", () => {
    expect(isProtectedPlatformAdminUser(root)).toBe(true);
    expect(isProtectedPlatformAdminUser(platformAdmin)).toBe(true);
    expect(isProtectedPlatformAdminUser(support)).toBe(false);
  });
});

describe("evaluatePlatformAdminProtection", () => {
  it("blocks self-disable", () => {
    const r = evaluatePlatformAdminProtection({
      action: "disable_user",
      actor: platformAdmin,
      target: platformAdmin,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("SELF_DISABLE_BLOCKED");
  });

  it("blocks self-demotion", () => {
    const r = evaluatePlatformAdminProtection({
      action: "change_role",
      actor: platformAdmin,
      target: platformAdmin,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { nextRoleCode: "workspace_support", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("SELF_DEMOTION_BLOCKED");
  });

  it("blocks last root owner disable", () => {
    const otherRoot: PlatformUserProtectionContext = { ...root, id: 99 };
    const r = evaluatePlatformAdminProtection({
      action: "disable_user",
      actor: otherRoot,
      target: root,
      activeRootOwnerCount: 1,
      activePlatformOwnerCount: 1,
      payload: { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("LAST_ROOT_OWNER_BLOCKED");
  });

  it("blocks last platform owner disable when counts are 1", () => {
    const owner: PlatformUserProtectionContext = {
      ...platformAdmin,
      platformUserType: "platform_owner",
    };
    const r = evaluatePlatformAdminProtection({
      action: "suspend_user",
      actor: root,
      target: owner,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 1,
      payload: { nextStatus: "suspended", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("LAST_PLATFORM_OWNER_BLOCKED");
  });

  it("blocks critical permission deny for last owner", () => {
    const otherRoot: PlatformUserProtectionContext = { ...root, id: 99 };
    const r = evaluatePlatformAdminProtection({
      action: "update_permission_override",
      actor: otherRoot,
      target: root,
      activeRootOwnerCount: 1,
      activePlatformOwnerCount: 1,
      payload: {
        permissionCode: "platform.users.disable",
        effect: "deny",
        reason: "valid reason here",
      },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("CRITICAL_PERMISSION_DENY_BLOCKED");
  });

  it("blocks non-root modifying protected user", () => {
    const r = evaluatePlatformAdminProtection({
      action: "disable_user",
      actor: platformAdmin,
      target: root,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("ROOT_OWNER_IMMUTABLE");
  });

  it("blocks isRootOwner flag updates", () => {
    const r = evaluatePlatformAdminProtection({
      action: "update_root_owner_flag",
      actor: root,
      target: support,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { isRootOwner: true, reason: "valid reason here" },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("ROOT_OWNER_FLAG_IMMUTABLE");
  });

  it("requires reason for sensitive changes", () => {
    const r = evaluatePlatformAdminProtection({
      action: "disable_user",
      actor: root,
      target: support,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { nextStatus: "disabled", confirmation: true },
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe("REASON_REQUIRED");
    expect(r.requiredReason).toBe(true);
  });

  it("allows normal user status change with reason", () => {
    const r = evaluatePlatformAdminProtection({
      action: "disable_user",
      actor: root,
      target: support,
      activeRootOwnerCount: 2,
      activePlatformOwnerCount: 2,
      payload: { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
    });
    expect(r.allowed).toBe(true);
    expect(r.blockedReason).toBe("ALLOWED");
  });

  it("resolveStatusProtectionAction maps statuses", () => {
    expect(resolveStatusProtectionAction("active")).toBe("reactivate_user");
    expect(resolveStatusProtectionAction("suspended")).toBe("suspend_user");
    expect(resolveStatusProtectionAction("disabled")).toBe("disable_user");
  });
});
