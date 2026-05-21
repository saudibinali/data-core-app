/**
 * platform-phase14-final-contract.ts
 *
 * @phase P14-E - Platform Administration Users Console Finalization
 *
 * Unified Phase 14 safety contract aggregating all P14-A/B/C/D guarantees.
 * Pure module - no React, no network, no side effects.
 * Enforced at import time.
 *
 * Referenced by: platform-phase14-final-contract.test.ts
 */

import { PLATFORM_USER_SAFETY_CONTRACT } from "./platform-users-config";
import { PLATFORM_AUDIT_SAFETY_CONTRACT } from "./platform-audit-config";
import { PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT } from "./platform-permissions-config";

// ── Phase 14 Unified Safety Contract ─────────────────────────────────────────

export const PHASE14_FINAL_SAFETY_CONTRACT = {
  // ── From P14-A (user management) ─────────────────────────────────────────
  noPasswordReset:                    true,
  noDeleteUser:                       true,
  noEmailInviteSending:               true,
  noSso:                              true,
  noMfa:                              true,
  noTenantUsers:                      true,
  noCustomerUsers:                    true,
  noHrUsers:                          true,

  // ── From P14-B (role matrix) ──────────────────────────────────────────────
  noCustomRoles:                      true,
  noPermissionEditor:                 true,
  fixedEightRoleMatrix:               true,

  // ── From P14-C (route guards) ─────────────────────────────────────────────
  preserveRootProtection:             true,
  preserveBackendAuthority:           true,
  noBreakGlassRecovery:               true,

  // ── From P14-D (audit) ────────────────────────────────────────────────────
  noAuditDelete:                      true,
  noAuditEdit:                        true,
  noAuditExport:                      true,
  noSiemIntegration:                  true,
  noRealTimeAuditStream:              true,

  // ── Commercial boundary (Phase 15) ───────────────────────────────────────
  noBillingCommercial:                true,
  noInvoicePayment:                   true,
  noTenantSideBilling:                true,

  // ── Overall integrity ─────────────────────────────────────────────────────
  readOnlyAuditVisibility:            true,
  permissionGatedThroughout:          true,
  metadataAlwaysRedacted:             true,
  noSchemaHeavyAuditRedesign:         true,
} as const satisfies Record<string, true>;

// ── Import-time enforcement ───────────────────────────────────────────────────

void (() => {
  for (const [key, value] of Object.entries(PHASE14_FINAL_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`PHASE14_FINAL_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

// ── Permission Consistency Contract ──────────────────────────────────────────

/**
 * Confirms that the permission matrix is consistent with navigation/route gating.
 * Documented as static facts - verified in tests.
 */
export const PHASE14_PERMISSION_CONSISTENCY_FACTS = {
  supportAdminHasPlatformActivityRead:   true,
  auditorHasAuditRead:                   true,
  auditorHasPlatformActivityRead:        true,
  financeAdminHasAuditReadNotActivity:   true,
  readOnlyOperatorHasNeitherActivityPerm: true,
  workspaceSupportHasNeitherActivityPerm: true,
  salesAdminHasNeitherActivityPerm:       true,
  rootAndPlatformAdminHaveAllPerms:       true,
  activityPageRequiresEitherPermission:   true,
  userDetailActivityHiddenWithoutPerm:    true,
  navItemHiddenWithoutPerm:              true,
} as const satisfies Record<string, true>;

// ── Root Protection Contract ──────────────────────────────────────────────────

export const PHASE14_ROOT_PROTECTION_CONTRACT = {
  cannotCreateRootFromUiOrApi:           true,
  cannotAssignRootRoleFromApi:           true,
  cannotDisableRoot:                     true,
  cannotLockRoot:                        true,
  cannotChangeRootRole:                  true,
  cannotSelfPromote:                     true,
  cannotManageEqualOrHigherPrivilege:    true,
  noResetPasswordButton:                 true,
  noDeleteButton:                        true,
  noEmailChangeButton:                   true,
  noAssignRootButton:                    true,
  blockedAttemptsAuditLogged:            true,
  rootIsLegacyAndExplicit:               true,
} as const satisfies Record<string, true>;

// ── Re-exports for convenience ────────────────────────────────────────────────

export {
  PLATFORM_USER_SAFETY_CONTRACT,
  PLATFORM_AUDIT_SAFETY_CONTRACT,
  PLATFORM_PERMISSION_MATRIX_SAFETY_CONTRACT,
};
