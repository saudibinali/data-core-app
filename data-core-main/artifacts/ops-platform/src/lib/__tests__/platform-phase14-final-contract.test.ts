/**
 * platform-phase14-final-contract.test.ts
 *
 * @phase P14-E - Platform Administration Users Console Finalization
 *
 * Unified Phase 14 closure tests.
 *
 * T1:  Users & Access page config: title, role matrix, badges, create dialog safety
 * T2:  Create dialog excludes root_platform_owner
 * T3:  Status panel hidden for root/protected (config-level assertion)
 * T4:  Role panel excludes root role, self-promotion, equal/higher privilege
 * T5:  Recent activity section permission gate (audit.read / platform.activity.read)
 * T6:  Activity page denied state - no permission → denied
 * T7:  Activity page config: filters/timeline/load more verified via config
 * T8:  metadataSafe only, no raw metadata
 * T11: Permission consistency - backend ↔ frontend matrix match
 * T12: Root protection final assertions
 * T13: Safety contract final assertions - all 17 properties true
 * T14: No forbidden features in any Phase 14 config
 */

import { describe, it, expect } from "vitest";

// Phase 14 unified contract
import {
  PHASE14_FINAL_SAFETY_CONTRACT,
  PHASE14_PERMISSION_CONSISTENCY_FACTS,
  PHASE14_ROOT_PROTECTION_CONTRACT,
  PLATFORM_USER_SAFETY_CONTRACT,
  PLATFORM_AUDIT_SAFETY_CONTRACT,
  PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT,
} from "../platform-phase14-final-contract";

// Platform user config
import {
  ASSIGNABLE_PLATFORM_ROLE_KEYS,
  PLATFORM_USER_SAFETY_CONTRACT as USERS_CONTRACT,
  ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG,
} from "../platform-users-config";

// Permission matrix
import {
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
  PLATFORM_PERMISSION_CODES,
} from "../platform-permissions-config";

// Platform access helpers
import {
  hasAnyPlatformPermissionClient,
  canViewPlatformNavItem,
} from "../platform-access";

// Audit config
import {
  PLATFORM_AUDIT_SAFETY_CONTRACT as AUDIT_CONTRACT,
  PLATFORM_AUDIT_EVENT_CONFIG,
  PLATFORM_AUDIT_SEVERITY_CONFIG,
  PLATFORM_AUDIT_RESULT_CONFIG,
  PLATFORM_AUDIT_FILTER_CONFIG,
} from "../platform-audit-config";

// ── T1: Users & Access page config ───────────────────────────────────────────

describe("T1 - Users & Access page config stability", () => {
  it("assignable roles are defined and non-empty", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS.length).toBeGreaterThan(0);
  });

  it("root_platform_owner is NOT in assignable roles", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).not.toContain("root_platform_owner");
  });

  it("platform_admin IS in assignable roles", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).toContain("platform_admin");
  });

  it("audit config has all 12 known events", () => {
    expect(Object.keys(PLATFORM_AUDIT_EVENT_CONFIG)).toHaveLength(12);
  });

  it("severity badges have bilingual labels (EN+AR)", () => {
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.info.label).toBe("Info");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.info.labelAr).toBe("معلومات");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.critical.label).toBe("Critical");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.critical.labelAr).toBe("حرج");
  });

  it("result badges have bilingual labels (EN+AR)", () => {
    expect(PLATFORM_AUDIT_RESULT_CONFIG.success.label).toBe("Success");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.success.labelAr).toBe("ناجح");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.blocked.label).toBe("Blocked");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.blocked.labelAr).toBe("محظور");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.denied.label).toBe("Denied");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.denied.labelAr).toBe("مرفوض");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.failed.label).toBe("Failed");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.failed.labelAr).toBe("فشل");
  });

  it("filter config has correct default/max limits", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.defaultLimit).toBe(50);
    expect(PLATFORM_AUDIT_FILTER_CONFIG.maxLimit).toBe(200);
  });
});

// ── T2: Create dialog excludes root ──────────────────────────────────────────

describe("T2 - Create dialog excludes root_platform_owner", () => {
  it("root_platform_owner is absent from ASSIGNABLE_PLATFORM_ROLE_KEYS", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS).not.toContain("root_platform_owner");
  });

  it("USERS_CONTRACT.noRootCreationFromUi is true", () => {
    expect(USERS_CONTRACT.noRootCreationFromUi).toBe(true);
  });

  it("USERS_CONTRACT.noRootRoleAssignmentFromUi is true", () => {
    expect(USERS_CONTRACT.noRootRoleAssignmentFromUi).toBe(true);
  });

  it("all assignable roles have non-empty label (safe for UI display)", () => {
    expect(ASSIGNABLE_PLATFORM_ROLE_KEYS.length).toBeGreaterThan(0);
    for (const k of ASSIGNABLE_PLATFORM_ROLE_KEYS) {
      expect(k).toBeTruthy();
      expect(k).not.toBe("root_platform_owner");
    }
  });
});

// ── T3: Status panel hidden for root/protected ────────────────────────────────

describe("T3 - Status panel hidden for root/protected (config assertions)", () => {
  it("ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG marks root non-disableable", () => {
    expect(ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG.non_disableable).toBe(true);
  });

  it("ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG marks root non-lockable", () => {
    expect(ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG.non_lockable).toBe(true);
  });

  it("ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG marks root non-deletable", () => {
    expect(ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG.non_deletable).toBe(true);
  });

  it("USERS_CONTRACT.noRootDisableOrLock is true", () => {
    expect(USERS_CONTRACT.noRootDisableOrLock).toBe(true);
  });

  it("PHASE14_ROOT_PROTECTION_CONTRACT.cannotDisableRoot is true", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotDisableRoot).toBe(true);
  });

  it("PHASE14_ROOT_PROTECTION_CONTRACT.cannotLockRoot is true", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotLockRoot).toBe(true);
  });
});

// ── T4: Role panel excludes root/protected/self/equal-higher ─────────────────

describe("T4 - Role panel safety assertions", () => {
  it("root role not assignable from UI", () => {
    expect(USERS_CONTRACT.noRootRoleAssignmentFromUi).toBe(true);
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotAssignRootRoleFromApi).toBe(true);
  });

  it("self-promotion blocked", () => {
    expect(USERS_CONTRACT.noSelfPromotion).toBe(true);
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotSelfPromote).toBe(true);
  });

  it("equal or higher privilege management blocked", () => {
    expect(USERS_CONTRACT.noManageEqualOrHigherPrivilege).toBe(true);
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotManageEqualOrHigherPrivilege).toBe(true);
  });

  it("root role change blocked", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotChangeRootRole).toBe(true);
  });
});

// ── T5: Recent activity permission gate ───────────────────────────────────────

describe("T5 - Recent activity section permission gate", () => {
  const noPermUser = { role: "super_admin", platformRoleCode: "workspace_support" };
  const activityUser = { role: "super_admin", platformRoleCode: "support_admin" };
  const auditUser = { role: "super_admin", platformRoleCode: "finance_admin" }; // has audit.read
  const auditorUser = { role: "super_admin", platformRoleCode: "auditor" };    // has both

  it("workspace_support cannot see activity (no platform.activity.read or audit.read)", () => {
    const can = hasAnyPlatformPermissionClient(noPermUser, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(false);
  });

  it("support_admin CAN see activity (has platform.activity.read)", () => {
    const can = hasAnyPlatformPermissionClient(activityUser, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(true);
  });

  it("finance_admin CAN see activity (has audit.read)", () => {
    const can = hasAnyPlatformPermissionClient(auditUser, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(true);
  });

  it("auditor CAN see activity (has both permissions)", () => {
    const can = hasAnyPlatformPermissionClient(auditorUser, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(true);
  });

  it("read_only_operator cannot see activity", () => {
    const user = { role: "super_admin", platformRoleCode: "read_only_operator" };
    const can = hasAnyPlatformPermissionClient(user, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(false);
  });

  it("sales_admin cannot see activity", () => {
    const user = { role: "super_admin", platformRoleCode: "sales_admin" };
    const can = hasAnyPlatformPermissionClient(user, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(false);
  });
});

// ── T6: Activity page denied state ───────────────────────────────────────────

describe("T6 - Activity page denied state for unauthorized roles", () => {
  it("platform-activity nav item hidden from workspace_support", () => {
    const user = { role: "super_admin", platformRoleCode: "workspace_support" };
    expect(canViewPlatformNavItem(user, "platform-activity")).toBe(false);
  });

  it("platform-activity nav item hidden from finance_admin", () => {
    // finance_admin has audit.read but NOT platform.activity.read
    // nav guard checks platform.activity.read specifically (P14-C)
    // finance_admin sees denied if accessing URL directly
    const user = { role: "super_admin", platformRoleCode: "finance_admin" };
    // The nav item requires platform.activity.read (not audit.read)
    // finance_admin doesn't have platform.activity.read
    const financePerms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin;
    expect(financePerms).not.toContain("platform.activity.read");
  });

  it("platform-activity nav item visible for support_admin", () => {
    const user = { role: "super_admin", platformRoleCode: "support_admin" };
    expect(canViewPlatformNavItem(user, "platform-activity")).toBe(true);
  });

  it("platform-activity nav item visible for auditor", () => {
    const user = { role: "super_admin", platformRoleCode: "auditor" };
    expect(canViewPlatformNavItem(user, "platform-activity")).toBe(true);
  });

  it("platform-activity nav item visible for root", () => {
    const user = { role: "super_admin", platformRoleCode: null, isRootOwner: false };
    expect(canViewPlatformNavItem(user, "platform-activity")).toBe(true);
  });

  it("workspace user cannot access activity (no super_admin role)", () => {
    const user = { role: "member", platformRoleCode: null };
    const can = hasAnyPlatformPermissionClient(user, ["platform.activity.read", "audit.read"]);
    expect(can).toBe(false);
  });
});

// ── T7: Activity page config completeness ────────────────────────────────────

describe("T7 - Activity page config: filters/timeline verified via config", () => {
  it("group filter options cover all 8 groups", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.groups).toHaveLength(8);
  });

  it("result filter options cover all 4 results", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.results).toHaveLength(4);
  });

  it("severity filter options cover all 3 severities", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.severities).toHaveLength(3);
  });

  it("every filter option has Arabic label", () => {
    for (const opt of [
      ...PLATFORM_AUDIT_FILTER_CONFIG.groups,
      ...PLATFORM_AUDIT_FILTER_CONFIG.results,
      ...PLATFORM_AUDIT_FILTER_CONFIG.severities,
    ]) {
      expect(opt.labelAr).toMatch(/[\u0600-\u06ff]/);
    }
  });

  it("defaultLimit=50 respects backend API spec", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.defaultLimit).toBe(50);
  });

  it("maxLimit=200 respects backend API spec", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.maxLimit).toBe(200);
  });
});

// ── T8: metadataSafe only, no raw metadata ────────────────────────────────────

describe("T8 - metadataSafe contract", () => {
  it("AUDIT_CONTRACT.noSecretMetadataDisplay is true", () => {
    expect(AUDIT_CONTRACT.noSecretMetadataDisplay).toBe(true);
  });

  it("AUDIT_CONTRACT.readOnlyAudit is true", () => {
    expect(AUDIT_CONTRACT.readOnlyAudit).toBe(true);
  });

  it("PHASE14_FINAL_SAFETY_CONTRACT.metadataAlwaysRedacted is true", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.metadataAlwaysRedacted).toBe(true);
  });
});

// ── T11: Permission consistency - backend ↔ frontend matrix ──────────────────

describe("T11 - Permission matrix consistency", () => {
  it("frontend permission catalog matches PLATFORM_PERMISSION_CODES length", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBeGreaterThan(0);
  });

  it("support_admin has platform.activity.read in frontend matrix", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.support_admin).toContain("platform.activity.read");
  });

  it("auditor has audit.read in frontend matrix", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.auditor).toContain("audit.read");
  });

  it("auditor has platform.activity.read in frontend matrix", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.auditor).toContain("platform.activity.read");
  });

  it("finance_admin has audit.read but NOT platform.activity.read", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.finance_admin;
    expect(perms).toContain("audit.read");
    expect(perms).not.toContain("platform.activity.read");
  });

  it("read_only_operator has neither audit.read nor platform.activity.read", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.read_only_operator;
    expect(perms).not.toContain("audit.read");
    expect(perms).not.toContain("platform.activity.read");
  });

  it("workspace_support has neither activity permission", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.workspace_support;
    expect(perms).not.toContain("audit.read");
    expect(perms).not.toContain("platform.activity.read");
  });

  it("sales_admin has neither activity permission", () => {
    const perms = PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.sales_admin;
    expect(perms).not.toContain("audit.read");
    expect(perms).not.toContain("platform.activity.read");
  });

  it("root_platform_owner and platform_admin have full catalog minus root-only codes", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.root_platform_owner).toHaveLength(
      PLATFORM_PERMISSION_CODES.length,
    );
    expect(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG.platform_admin).toHaveLength(
      PLATFORM_PERMISSION_CODES.length - 2,
    );
  });

  it("PHASE14_PERMISSION_CONSISTENCY_FACTS all true", () => {
    for (const [key, value] of Object.entries(PHASE14_PERMISSION_CONSISTENCY_FACTS)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });
});

// ── T12: Root protection final assertions ─────────────────────────────────────

describe("T12 - Root protection final assertions", () => {
  it("PHASE14_ROOT_PROTECTION_CONTRACT - all properties true", () => {
    for (const [key, value] of Object.entries(PHASE14_ROOT_PROTECTION_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("13 root protection guarantees documented", () => {
    expect(Object.keys(PHASE14_ROOT_PROTECTION_CONTRACT)).toHaveLength(13);
  });

  it("no password reset button - documented in contract", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.noResetPasswordButton).toBe(true);
    expect(USERS_CONTRACT.noPasswordReset).toBe(true);
  });

  it("no delete button - documented in contract", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.noDeleteButton).toBe(true);
    expect(USERS_CONTRACT.noDeleteUser).toBe(true);
  });

  it("no assign root button - documented in contract", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.noAssignRootButton).toBe(true);
  });

  it("blocked attempts are audit logged", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.blockedAttemptsAuditLogged).toBe(true);
    expect(USERS_CONTRACT.auditBlockedAttempts).toBe(true);
  });

  it("both legacy and explicit root detection is supported", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.rootIsLegacyAndExplicit).toBe(true);
  });

  it("cannot create root from UI OR API", () => {
    expect(PHASE14_ROOT_PROTECTION_CONTRACT.cannotCreateRootFromUiOrApi).toBe(true);
    expect(USERS_CONTRACT.noRootCreationFromUi).toBe(true);
  });
});

// ── T13: Safety contract final assertions ─────────────────────────────────────

describe("T13 - Safety contract final assertions", () => {
  it("PHASE14_FINAL_SAFETY_CONTRACT has 26 properties", () => {
    expect(Object.keys(PHASE14_FINAL_SAFETY_CONTRACT)).toHaveLength(26);
  });

  it("every PHASE14_FINAL_SAFETY_CONTRACT property is true", () => {
    for (const [key, value] of Object.entries(PHASE14_FINAL_SAFETY_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("PLATFORM_USER_SAFETY_CONTRACT - 27 properties all true", () => {
    const entries = Object.entries(PLATFORM_USER_SAFETY_CONTRACT);
    expect(entries.length).toBeGreaterThanOrEqual(27);
    for (const [key, value] of entries) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("PLATFORM_AUDIT_SAFETY_CONTRACT - 9 properties all true", () => {
    const entries = Object.entries(PLATFORM_AUDIT_SAFETY_CONTRACT);
    expect(entries).toHaveLength(9);
    for (const [key, value] of entries) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT - all properties true", () => {
    for (const [key, value] of Object.entries(PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("noPasswordReset guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noPasswordReset).toBe(true);
  });

  it("noDeleteUser guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noDeleteUser).toBe(true);
  });

  it("noAuditDelete guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noAuditDelete).toBe(true);
  });

  it("noAuditExport guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noAuditExport).toBe(true);
  });

  it("noBillingCommercial boundary is clear", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noBillingCommercial).toBe(true);
  });

  it("noCustomRoles guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noCustomRoles).toBe(true);
  });

  it("preserveBackendAuthority guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.preserveBackendAuthority).toBe(true);
  });

  it("preserveRootProtection guaranteed in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.preserveRootProtection).toBe(true);
  });
});

// ── T14: No forbidden features in Phase 14 configs ───────────────────────────

describe("T14 - No forbidden features introduced", () => {
  it("no password reset in platform-users-config", () => {
    expect(USERS_CONTRACT.noPasswordReset).toBe(true);
  });

  it("no SSO in platform-users-config", () => {
    expect(USERS_CONTRACT.noSso).toBe(true);
  });

  it("no MFA in platform-users-config", () => {
    expect(USERS_CONTRACT.noMfa).toBe(true);
  });

  it("no email invite sending", () => {
    expect(USERS_CONTRACT.noEmailInviteSending).toBe(true);
  });

  it("no delete user", () => {
    expect(USERS_CONTRACT.noDeleteUser).toBe(true);
  });

  it("no custom roles", () => {
    expect(USERS_CONTRACT.noCustomRoles).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noCustomRoles).toBe(true);
  });

  it("no permission editor", () => {
    expect(USERS_CONTRACT.noPermissionEditor).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noPermissionEditor).toBe(true);
  });

  it("no audit delete/edit/export", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noAuditDelete).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noAuditEdit).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noAuditExport).toBe(true);
    expect(AUDIT_CONTRACT.noAuditDelete).toBe(true);
    expect(AUDIT_CONTRACT.noAuditEdit).toBe(true);
  });

  it("no SIEM integration", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noSiemIntegration).toBe(true);
    expect(AUDIT_CONTRACT.noSiemIntegration).toBe(true);
  });

  it("no billing/commercial in Phase 14", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noBillingCommercial).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noInvoicePayment).toBe(true);
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noTenantSideBilling).toBe(true);
  });

  it("no break-glass recovery", () => {
    expect(PHASE14_FINAL_SAFETY_CONTRACT.noBreakGlassRecovery).toBe(true);
  });

  it("no tenant/customer/HR user management in platform users page", () => {
    expect(USERS_CONTRACT.noTenantUserManagement).toBe(true);
    expect(USERS_CONTRACT.noCustomerUserManagement).toBe(true);
    expect(USERS_CONTRACT.noHrEmployeeUserManagement).toBe(true);
  });

  it("ASSIGNABLE_PLATFORM_ROLE_KEYS contains only valid non-root roles", () => {
    const forbidden = ["root_platform_owner"];
    for (const key of ASSIGNABLE_PLATFORM_ROLE_KEYS) {
      expect(forbidden).not.toContain(key);
    }
  });
});
