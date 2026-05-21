/**
 * @phase P17-B - Permission override protection policy tests
 */

import { describe, it, expect } from "vitest";
import {
  validateOverrideChange,
  validateSelfEscalationOverride,
  validatePermissionCodeCatalog,
} from "../platform-permission-override-policy";
import { PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT } from "../platform-permission-assignment-config";
import type { PlatformPermissionCode } from "../platform-permissions";

const root = { id: 1, role: "super_admin", isRootOwner: true, platformRoleCode: null };
const platformAdmin = { id: 2, role: "super_admin", platformRoleCode: "platform_admin", isRootOwner: false };
const target = { id: 3, role: "super_admin", platformRoleCode: "auditor", isRootOwner: false };
const rootTarget = { id: 4, role: "super_admin", isRootOwner: true, platformRoleCode: null };

describe("PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT", () => {
  it("all true", () => {
    for (const [k, v] of Object.entries(PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("validatePermissionCodeCatalog", () => {
  it("rejects unknown permission", () => {
    expect(validatePermissionCodeCatalog("not.a.real.code")).toBe("UNKNOWN_PERMISSION_CODE");
  });

  it("rejects tenant-style codes", () => {
    expect(validatePermissionCodeCatalog("tenant.billing.write")).toBe("TENANT_OR_WORKSPACE_PERMISSION_BLOCKED");
  });
});

describe("validateOverrideChange", () => {
  const adminEffective = new Set<PlatformPermissionCode>([
    "platform.permissions.read",
    "tenants.read",
    "platform.users.read",
  ]);

  it("blocks self modification", () => {
    const r = validateOverrideChange(platformAdmin, { ...platformAdmin, id: 2 }, adminEffective, {
      permissionCode: "tenants.read",
      effect: "grant",
    }, { activeOwnerCount: 2, reason: "valid reason here" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("SELF_PERMISSION_MODIFICATION_BLOCKED");
  });

  it("blocks non-root modifying root", () => {
    const r = validateOverrideChange(platformAdmin, rootTarget, adminEffective, {
      permissionCode: "tenants.read",
      effect: "grant",
    }, { activeOwnerCount: 2, reason: "valid reason here" });
    expect(r.valid).toBe(false);
  });

  it("blocks platform_admin granting permissions.update", () => {
    const r = validateOverrideChange(platformAdmin, target, adminEffective, {
      permissionCode: "platform.permissions.update",
      effect: "grant",
    }, { activeOwnerCount: 2, reason: "valid reason here" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("ROOT_ONLY_SENSITIVE_GRANT");
  });

  it("allows root to grant sensitive permission", () => {
    const rootEffective = new Set<PlatformPermissionCode>(["platform.permissions.update", "platform.users.disable"]);
    const r = validateOverrideChange(root, target, rootEffective, {
      permissionCode: "platform.users.disable",
      effect: "grant",
    }, { activeOwnerCount: 2, reason: "valid reason here" });
    expect(r.valid).toBe(true);
  });
});

describe("validateSelfEscalationOverride", () => {
  it("blocks self platform.users grant", () => {
    expect(validateSelfEscalationOverride(2, 2, "platform.users.create")).toBe("SELF_ESCALATION_BLOCKED");
  });
});
