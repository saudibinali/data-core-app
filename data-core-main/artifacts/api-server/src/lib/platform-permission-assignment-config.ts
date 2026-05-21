/**
 * @phase P17-B - Custom Platform Permission Assignment
 */

import type { PlatformPermissionCode } from "./platform-permissions";

export const PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT = {
  customPlatformPermissionsOnly: true,
  noTenantPermissionAssignment: true,
  noWorkspacePermissionAssignment: true,
  noRoleMatrixRedesign: true,
  noPasswordManagement: true,
  noMfaManagement: true,
  noSsoManagement: true,
  noInvitationEmailSending: true,
  noRootOwnerPromotion: true,
  noSelfPermissionModification: true,
  protectRootOwnerPermissions: true,
  denyOverridesSupported: true,
  denyOverridesWin: true,
  permissionGated: true,
  auditPermissionOverrides: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`PLATFORM_PERMISSION_ASSIGNMENT_SAFETY_CONTRACT violated: ${key}`);
    }
  }
})();

/** Only root may grant these via override API in P17-B */
export const ROOT_ONLY_GRANTABLE_PERMISSION_CODES = [
  "platform.users.disable",
  "platform.users.reactivate",
  "platform.users.role.update",
  "platform.permissions.update",
  "platform.workspaceAccess.update",
  "platform.subscriptions.status.change",
] as const satisfies readonly PlatformPermissionCode[];

export const SELF_ESCALATION_BLOCKED_PREFIXES = [
  "platform.users.",
  "platform.permissions.",
] as const;

/** Cannot deny these on the last active platform owner */
export const LAST_OWNER_CRITICAL_PERMISSION_CODES = [
  "platform.users.read",
  "platform.permissions.read",
  "platform.users.disable",
  "platform.users.reactivate",
] as const satisfies readonly PlatformPermissionCode[];

export const OVERRIDE_REASON_MIN_LENGTH = 10;

export type PermissionOverrideEffect = "grant" | "deny";
