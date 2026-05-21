/**
 * @phase P17-C - Super Admin Protection Policies (static config module)
 *
 * No DB table in P17-C — policy values are versioned in code and documented in
 * workflow-phase-17c-report.txt. Optional GET API returns this snapshot read-only.
 */

import type { PlatformPermissionCode } from "./platform-permissions";

export const SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT = {
  superAdminProtectionPoliciesOnly: true,
  noApprovalWorkflow: true,
  noEmergencyAccessUi: true,
  noRootOwnerPromotion: true,
  noRootOwnerRemoval: true,
  rootOwnerImmutable: true,
  protectLastRootOwner: true,
  protectLastPlatformOwner: true,
  preventSelfDisable: true,
  preventSelfDemotion: true,
  preventSelfPermissionModification: true,
  preventCriticalPermissionDenyForLastOwner: true,
  nonRootCannotModifyProtectedUsers: true,
  noRoleMatrixRedesign: true,
  noTenantWorkspacePermissions: true,
  noPasswordManagement: true,
  noMfaManagement: true,
  noSsoManagement: true,
  auditSensitiveAdminChanges: true,
  permissionGated: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT violated: ${key}`);
    }
  }
})();

export type EmergencyAccessMode = "disabled" | "enabled_manual_only";

export interface PlatformAdminProtectionPolicy {
  policyName: string;
  isActive: boolean;
  minActiveRootOwners: number;
  minActivePlatformOwners: number;
  requireReasonForSensitiveChanges: boolean;
  requireTwoStepApprovalForRootChanges: boolean;
  preventSelfDemotion: boolean;
  preventSelfDisable: boolean;
  preventLastOwnerDisable: boolean;
  preventLastOwnerCriticalPermissionDeny: boolean;
  protectedPermissionPatterns: readonly string[];
  protectedRoleTypes: readonly string[];
  emergencyAccessMode: EmergencyAccessMode;
  internalNotes: string;
}

export const PLATFORM_ADMIN_PROTECTION_POLICY: PlatformAdminProtectionPolicy = {
  policyName: "default_platform_admin_protection",
  isActive: true,
  minActiveRootOwners: 1,
  minActivePlatformOwners: 1,
  requireReasonForSensitiveChanges: true,
  requireTwoStepApprovalForRootChanges: false,
  preventSelfDemotion: true,
  preventSelfDisable: true,
  preventLastOwnerDisable: true,
  preventLastOwnerCriticalPermissionDeny: true,
  protectedPermissionPatterns: [
    "platform.permissions.",
    "platform.users.",
    "platform.workspaceAccess.update",
    "platform.subscriptions.status.change",
  ],
  protectedRoleTypes: ["platform_owner", "root_platform_owner"],
  emergencyAccessMode: "disabled",
  internalNotes: "P17-C static policy — no approval workflow or emergency UI in this phase.",
};

export const CRITICAL_PLATFORM_PERMISSIONS = [
  "platform.permissions.update",
  "platform.users.disable",
  "platform.users.reactivate",
  "platform.users.role.update",
  "platform.users.status.update",
  "platform.subscriptions.status.change",
  "platform.workspaceAccess.update",
  "platform.subscriptionPolicies.update",
  "platform.entitlements.update",
  "platform.quotas.update",
] as const satisfies readonly PlatformPermissionCode[];

export const PROTECTED_PERMISSION_PATTERNS = PLATFORM_ADMIN_PROTECTION_POLICY.protectedPermissionPatterns;

export const SENSITIVE_CHANGE_REASON_MIN_LENGTH = 10;

export type ProtectionSeverity = "low" | "medium" | "high" | "critical";

export type ProtectionBlockedReasonCode =
  | "SELF_DISABLE_BLOCKED"
  | "SELF_DEMOTION_BLOCKED"
  | "SELF_PERMISSION_MODIFICATION_BLOCKED"
  | "LAST_ROOT_OWNER_BLOCKED"
  | "LAST_PLATFORM_OWNER_BLOCKED"
  | "ROOT_OWNER_IMMUTABLE"
  | "PROTECTED_USER_REQUIRES_ROOT"
  | "CRITICAL_PERMISSION_DENY_BLOCKED"
  | "ROOT_OWNER_FLAG_IMMUTABLE"
  | "REASON_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "UNKNOWN_PROTECTED_ACTION"
  | "ALLOWED";

export function isCriticalPlatformPermission(code: string): boolean {
  return (CRITICAL_PLATFORM_PERMISSIONS as readonly string[]).includes(code);
}

export function matchesProtectedPermissionPattern(code: string): boolean {
  return PROTECTED_PERMISSION_PATTERNS.some((p) =>
    p.endsWith(".") ? code.startsWith(p) : code === p,
  );
}

export function getSafePolicySnapshot(): Record<string, unknown> {
  const p = PLATFORM_ADMIN_PROTECTION_POLICY;
  return {
    policyName: p.policyName,
    isActive: p.isActive,
    minActiveRootOwners: p.minActiveRootOwners,
    minActivePlatformOwners: p.minActivePlatformOwners,
    requireReasonForSensitiveChanges: p.requireReasonForSensitiveChanges,
    requireTwoStepApprovalForRootChanges: p.requireTwoStepApprovalForRootChanges,
    preventSelfDemotion: p.preventSelfDemotion,
    preventSelfDisable: p.preventSelfDisable,
    preventLastOwnerDisable: p.preventLastOwnerDisable,
    preventLastOwnerCriticalPermissionDeny: p.preventLastOwnerCriticalPermissionDeny,
    protectedPermissionPatterns: [...p.protectedPermissionPatterns],
    protectedRoleTypes: [...p.protectedRoleTypes],
    emergencyAccessMode: p.emergencyAccessMode,
    criticalPermissionCount: CRITICAL_PLATFORM_PERMISSIONS.length,
  };
}
