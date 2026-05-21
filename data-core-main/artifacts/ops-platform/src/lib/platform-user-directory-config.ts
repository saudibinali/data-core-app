/**
 * @phase P17-A - Platform User Directory & Lifecycle (frontend config)
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

export const PLATFORM_USER_TYPE_CONFIG: Record<
  PlatformUserType,
  { label: string; labelAr: string; badgeClass: string }
> = {
  platform_owner: {
    label: "Platform Owner",
    labelAr: "مالك المنصة",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  },
  platform_admin: {
    label: "Platform Admin",
    labelAr: "مدير المنصة",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  },
  platform_operator: {
    label: "Platform Operator",
    labelAr: "مشغّل المنصة",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  },
};

/** User-visible button/label phrases that must not appear in P17-A UI */
export const P17_FORBIDDEN_UI_TERMS = [
  "delete user",
  "reset password",
  "assign permissions",
  "custom permissions",
  "enable mfa",
  "configure sso",
  "send invite",
  "make root owner",
  "remove root owner",
] as const;
