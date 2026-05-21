/**
 * @phase P17-D - Access review resolver unit tests
 */

import { describe, it, expect } from "vitest";
import {
  computeUserRiskLevel,
  sanitizeAuditMetadataForReview,
} from "../platform-access-review";
import {
  ACCESS_REVIEW_SAFETY_CONTRACT,
  ACCESS_REVIEW_AUDIT_ACTIONS,
  STALE_SENSITIVE_LOGIN_DAYS,
} from "../platform-access-review-config";
import { PLATFORM_PERMISSION_CODES } from "../platform-permissions";
import { hasPlatformPermission } from "../platform-permissions";

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

const support = {
  id: 3,
  email: "s@x",
  role: "super_admin",
  workspaceId: null,
  platformRoleCode: "workspace_support",
  isRootOwner: false,
  isProtected: false,
};

describe("P17-D safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(ACCESS_REVIEW_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("includes accessReview read/update codes", () => {
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.accessReview.read");
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.accessReview.update");
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });

  it("root has read and update", () => {
    expect(hasPlatformPermission(root, "platform.accessReview.read")).toBe(true);
    expect(hasPlatformPermission(root, "platform.accessReview.update")).toBe(true);
  });

  it("platform_admin has read only", () => {
    expect(hasPlatformPermission(platformAdmin, "platform.accessReview.read")).toBe(true);
    expect(hasPlatformPermission(platformAdmin, "platform.accessReview.update")).toBe(false);
  });

  it("auditor has read only", () => {
    const auditor = { ...platformAdmin, platformRoleCode: "auditor" };
    expect(hasPlatformPermission(auditor, "platform.accessReview.read")).toBe(true);
    expect(hasPlatformPermission(auditor, "platform.accessReview.update")).toBe(false);
  });

  it("finance_admin has no access review", () => {
    const finance = { ...platformAdmin, platformRoleCode: "finance_admin" };
    expect(hasPlatformPermission(finance, "platform.accessReview.read")).toBe(false);
  });

  it("workspace_support has no access review", () => {
    expect(hasPlatformPermission(support, "platform.accessReview.read")).toBe(false);
  });
});

describe("high risk detection", () => {
  it("root is critical", () => {
    const level = computeUserRiskLevel({
      user: root,
      effective: ["platform.users.read"],
      grantedOverrides: [],
      deniedOverrides: [],
      isStaleSensitive: false,
    });
    expect(level).toBe("critical");
  });

  it("protected platform_admin is high", () => {
    const level = computeUserRiskLevel({
      user: platformAdmin,
      effective: ["platform.users.disable", "platform.users.read"],
      grantedOverrides: [],
      deniedOverrides: [],
      isStaleSensitive: false,
    });
    expect(level).toBe("high");
  });

  it("critical permission deny on overrides is high", () => {
    const level = computeUserRiskLevel({
      user: support,
      effective: ["platform.users.read"],
      grantedOverrides: [],
      deniedOverrides: ["platform.users.disable"],
      isStaleSensitive: false,
    });
    expect(level).toBe("high");
  });

  it("stale sensitive user is high", () => {
    const level = computeUserRiskLevel({
      user: support,
      effective: ["platform.users.disable"],
      grantedOverrides: [],
      deniedOverrides: [],
      isStaleSensitive: true,
    });
    expect(level).toBe("high");
  });
});

describe("sanitizeAuditMetadataForReview", () => {
  it("strips unknown keys and payloads", () => {
    const safe = sanitizeAuditMetadataForReview({
      actorId: 1,
      targetUserId: 2,
      blockedReason: "SELF_DISABLE_BLOCKED",
      password: "secret",
      payload: { huge: true },
    });
    expect(safe).toEqual({
      actorId: 1,
      targetUserId: 2,
      blockedReason: "SELF_DISABLE_BLOCKED",
    });
  });
});

describe("audit action catalog", () => {
  it("includes P17-A/B/C events", () => {
    expect(ACCESS_REVIEW_AUDIT_ACTIONS).toContain("platform_user_disabled");
    expect(ACCESS_REVIEW_AUDIT_ACTIONS).toContain("platform_admin_protection_evaluated_blocked");
    expect(ACCESS_REVIEW_AUDIT_ACTIONS).toContain("platform_access_review_recorded");
  });

  it("stale threshold configured", () => {
    expect(STALE_SENSITIVE_LOGIN_DAYS).toBeGreaterThan(0);
  });
});
