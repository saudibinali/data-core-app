/**
 * @phase P17-B - Custom platform permission assignment (frontend config)
 */

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

export const P17B_FORBIDDEN_UI_TERMS = [
  "assign tenant permissions",
  "assign workspace permissions",
  "make root owner",
  "remove root owner",
  "edit role matrix",
  "reset password",
  "enable mfa",
  "configure sso",
  "delete user",
] as const;

export const PLATFORM_PERMISSION_API_PATHS = {
  catalog: () => "/api/platform/permissions/catalog",
  userPermissions: (userId: string | number) => `/api/platform/users/${userId}/permissions`,
  bulkOverrides: (userId: string | number) => `/api/platform/users/${userId}/permissions/overrides`,
  singleOverride: (userId: string | number, code: string) =>
    `/api/platform/users/${userId}/permissions/overrides/${encodeURIComponent(code)}`,
} as const;

export const OVERRIDE_REASON_MIN_LENGTH = 10;
