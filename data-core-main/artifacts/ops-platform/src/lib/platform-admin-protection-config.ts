/**
 * @phase P17-C - Super Admin Protection Policies (client mirror)
 */

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

export const P17C_FORBIDDEN_UI_TERMS = [
  "Make Root Owner",
  "Remove Root Owner",
  "Override Protection",
  "Emergency Access",
  "Force Disable",
  "Force Permission Change",
  "Bypass Policy",
  "Delete User",
] as const;

export const PROTECTION_BLOCKED_REASON_MESSAGES: Record<string, string> = {
  SELF_DISABLE_BLOCKED: "You cannot disable or suspend your own platform administrator account.",
  SELF_DEMOTION_BLOCKED: "You cannot change your own role to reduce your privileges.",
  SELF_PERMISSION_MODIFICATION_BLOCKED: "You cannot modify your own permission overrides.",
  LAST_ROOT_OWNER_BLOCKED: "This action would remove or disable the last active root platform owner.",
  LAST_PLATFORM_OWNER_BLOCKED: "This action would remove or disable the last active platform owner.",
  ROOT_OWNER_IMMUTABLE: "Root platform owners cannot be modified by this action.",
  PROTECTED_USER_REQUIRES_ROOT: "Only a root platform owner can modify protected platform administrators.",
  CRITICAL_PERMISSION_DENY_BLOCKED: "Cannot deny critical permissions for the last active platform owner.",
  ROOT_OWNER_FLAG_IMMUTABLE: "Root owner status cannot be changed.",
  REASON_REQUIRED: "A documented reason is required for this sensitive change.",
  CONFIRMATION_REQUIRED: "You must confirm this sensitive change.",
};

export const PLATFORM_ADMIN_PROTECTION_NOTICE =
  "Protected platform administrators cannot be modified unless policy allows it.";

export function formatProtectionBlockedReason(code: string | undefined): string {
  if (!code) return "This action is blocked by platform admin protection policy.";
  return PROTECTION_BLOCKED_REASON_MESSAGES[code] ?? `Blocked: ${code}`;
}

export function isPolicyProtectedUser(user: { isProtected?: boolean; isRootOwner?: boolean }): boolean {
  return Boolean(user.isProtected || user.isRootOwner);
}
