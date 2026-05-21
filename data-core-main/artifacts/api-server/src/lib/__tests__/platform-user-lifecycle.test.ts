/**
 * @phase P17-A - Platform user directory lifecycle unit tests
 */

import { describe, it, expect } from "vitest";
import {
  normalizePlatformUserEmail,
  isValidPlatformUserEmail,
  validatePlatformUserDirectoryCreate,
  validatePlatformUserProfileUpdate,
  validatePlatformUserDirectoryStatusChange,
  resolveStatusPermission,
  resolveStatusAuditAction,
} from "../platform-user-lifecycle";
import { PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT } from "../platform-user-directory-config";

const rootActor = { id: 1, role: "super_admin", isRootOwner: true, workspaceId: null, platformRoleCode: null };
const platformAdminActor = { id: 2, role: "super_admin", isRootOwner: false, workspaceId: null, platformRoleCode: "platform_admin" };
const targetOperator = { id: 3, role: "super_admin", isRootOwner: false, workspaceId: null, platformRoleCode: "support_admin", platformUserType: "platform_operator", status: "active" };
const rootTarget = { id: 4, role: "super_admin", isRootOwner: true, workspaceId: null, platformRoleCode: null, platformUserType: "platform_owner", status: "active" };

describe("PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("email normalization", () => {
  it("lowercases and trims email", () => {
    expect(normalizePlatformUserEmail("  Admin@Example.COM ")).toBe("admin@example.com");
  });

  it("rejects invalid email", () => {
    expect(isValidPlatformUserEmail("not-an-email")).toBe(false);
  });
});

describe("create validation", () => {
  it("accepts valid create with userType", () => {
    const r = validatePlatformUserDirectoryCreate(rootActor, {
      email: "ops@example.com",
      displayName: "Ops User",
      userType: "platform_operator",
    });
    expect(r.valid).toBe(true);
    expect(r.normalizedEmail).toBe("ops@example.com");
  });

  it("blocks platform_owner create", () => {
    const r = validatePlatformUserDirectoryCreate(platformAdminActor, {
      email: "owner@example.com",
      displayName: "Owner",
      userType: "platform_owner",
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("PLATFORM_OWNER_CREATE_BLOCKED");
  });
});

describe("profile update validation", () => {
  it("blocks email update", () => {
    const r = validatePlatformUserProfileUpdate({ email: "new@example.com" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("EMAIL_UPDATE_NOT_SUPPORTED");
  });

  it("blocks isRootOwner update", () => {
    const r = validatePlatformUserProfileUpdate({ isRootOwner: true });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("ROOT_OWNER_FLAG_IMMUTABLE");
  });
});

describe("status change validation", () => {
  it("requires reason", () => {
    const r = validatePlatformUserDirectoryStatusChange(
      platformAdminActor,
      targetOperator,
      { nextStatus: "disabled", confirmation: true },
      { activeOwnerCount: 2 },
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("REASON_TOO_SHORT");
  });

  it("blocks disabling last active owner", () => {
    const r = validatePlatformUserDirectoryStatusChange(
      rootActor,
      rootTarget,
      { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
      { activeOwnerCount: 1 },
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("LAST_ACTIVE_OWNER_PROTECTED");
  });

  it("non-root cannot change protected root", () => {
    const r = validatePlatformUserDirectoryStatusChange(
      platformAdminActor,
      rootTarget,
      { nextStatus: "disabled", reason: "valid reason here", confirmation: true },
      { activeOwnerCount: 2 },
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("PROTECTED_ACCOUNT");
  });
});

describe("status permission and audit mapping", () => {
  it("maps active to reactivate permission", () => {
    expect(resolveStatusPermission("active")).toBe("platform.users.reactivate");
  });

  it("maps disabled to disable permission", () => {
    expect(resolveStatusPermission("disabled")).toBe("platform.users.disable");
  });

  it("maps audit actions", () => {
    expect(resolveStatusAuditAction("active")).toBe("platform_user_reactivated");
    expect(resolveStatusAuditAction("suspended")).toBe("platform_user_suspended");
    expect(resolveStatusAuditAction("disabled")).toBe("platform_user_disabled");
  });
});
