/**
 * @file   platform-user-directory-config.ts
 * @phase  P17-A - Platform User Directory & Lifecycle
 */

export const PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT = {
  platformUserDirectoryOnly: true,
  noCustomPermissionAssignment: true,
  noRoleMatrixRedesign: true,
  noTenantUserManagement: true,
  noWorkspaceUserManagement: true,
  noPasswordManagement: true,
  noMfaManagement: true,
  noSsoManagement: true,
  noInvitationEmailSending: true,
  noHardDeletePlatformUsers: true,
  protectLastRootOwner: true,
  cannotModifyRootOwnerFlag: true,
  permissionGated: true,
  auditPlatformUserLifecycle: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`PLATFORM_USER_DIRECTORY_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const PLATFORM_USER_TYPES = [
  "platform_owner",
  "platform_admin",
  "platform_operator",
] as const;

export type PlatformUserType = (typeof PLATFORM_USER_TYPES)[number];

export const PLATFORM_DIRECTORY_STATUSES = [
  "invited",
  "active",
  "suspended",
  "disabled",
  "locked",
] as const;

export type PlatformDirectoryStatus = (typeof PLATFORM_DIRECTORY_STATUSES)[number];

export const USER_TYPE_TO_DEFAULT_ROLE: Record<
  Exclude<PlatformUserType, "platform_owner">,
  string
> = {
  platform_admin: "platform_admin",
  platform_operator: "support_admin",
};
