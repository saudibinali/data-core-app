/**
 * @phase P17-E - Invitation policy & permissions (no DB)
 */

import { describe, it, expect } from "vitest";
import { canActorManageTargetInvitations } from "../platform-user-invitations";
import { PLATFORM_INVITATION_SAFETY_CONTRACT } from "../platform-user-invitation-config";
import { PLATFORM_PERMISSION_CODES, hasPlatformPermission } from "../platform-permissions";

const root = {
  id: 1,
  email: "r@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "root_platform_owner",
  isRootOwner: true,
  isProtected: true,
};

const platformAdmin = {
  id: 2,
  email: "a@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "platform_admin",
  isRootOwner: false,
  isProtected: false,
};

const protectedUser = {
  id: 3,
  email: "p@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "platform_admin",
  isRootOwner: false,
  isProtected: true,
};

const rootTarget = {
  id: 4,
  email: "ro@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "root_platform_owner",
  isRootOwner: true,
  isProtected: true,
};

describe("P17-E safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_INVITATION_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("invitation permissions", () => {
  it("55 platform permission codes include invitations", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.invitations.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.invitations.create");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.invitations.revoke");
  });

  it("root has read/create/revoke", () => {
    expect(hasPlatformPermission(root, "platform.invitations.read")).toBe(true);
    expect(hasPlatformPermission(root, "platform.invitations.create")).toBe(true);
    expect(hasPlatformPermission(root, "platform.invitations.revoke")).toBe(true);
  });

  it("platform_admin has read/create/revoke", () => {
    expect(hasPlatformPermission(platformAdmin, "platform.invitations.read")).toBe(true);
    expect(hasPlatformPermission(platformAdmin, "platform.invitations.create")).toBe(true);
    expect(hasPlatformPermission(platformAdmin, "platform.invitations.revoke")).toBe(true);
  });

  it("auditor has read only", () => {
    const auditor = { ...platformAdmin, platformRoleCode: "auditor" };
    expect(hasPlatformPermission(auditor, "platform.invitations.read")).toBe(true);
    expect(hasPlatformPermission(auditor, "platform.invitations.create")).toBe(false);
    expect(hasPlatformPermission(auditor, "platform.invitations.revoke")).toBe(false);
  });

  it("finance_admin has no invitation permissions", () => {
    const finance = { ...platformAdmin, platformRoleCode: "finance_admin" };
    expect(hasPlatformPermission(finance, "platform.invitations.read")).toBe(false);
  });

  it("workspace_support has no invitation permissions", () => {
    const support = { ...platformAdmin, platformRoleCode: "workspace_support" };
    expect(hasPlatformPermission(support, "platform.invitations.read")).toBe(false);
  });
});

describe("protected user invitation policy", () => {
  it("non-root cannot manage protected user invitations", () => {
    const result = canActorManageTargetInvitations(platformAdmin, protectedUser);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("PROTECTED_USER_REQUIRES_ROOT");
  });

  it("non-root cannot manage root owner invitations", () => {
    const result = canActorManageTargetInvitations(platformAdmin, rootTarget);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("ROOT_OWNER_IMMUTABLE");
  });

  it("root can manage protected users", () => {
    expect(canActorManageTargetInvitations(root, protectedUser).allowed).toBe(true);
  });
});
