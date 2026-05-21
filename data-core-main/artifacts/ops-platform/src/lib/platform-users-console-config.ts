/**
 * @phase P17-F - Platform Users Console integration config
 */

export const PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT = {
  platformUsersConsoleIntegrationOnly: true,
  noNewPermissionSemantics: true,
  noRoleMatrixRedesign: true,
  noApprovalWorkflow: true,
  noEmergencyAccess: true,
  noEmailSending: true,
  noSmtp: true,
  noPasswordReset: true,
  noMfaManagement: true,
  noSsoManagement: true,
  noTenantWorkspaceUserManagement: true,
  noTenantWorkspaceInvitations: true,
  noRootOwnerPromotion: true,
  noRootOwnerRemoval: true,
  noHardDeleteUsers: true,
  noDestructiveBulkActions: true,
  sensitivePayloadsHidden: true,
  permissionGated: true,
} as const satisfies Record<string, true>;

export const P17F_FORBIDDEN_UI_TERMS = [
  "Delete User",
  "Reset Password",
  "Make Root Owner",
  "Remove Root Owner",
  "Force Disable",
  "Emergency Access",
  "Assign Tenant Permissions",
  "Assign Workspace Permissions",
  "Send Email",
  "SMTP",
  "MFA",
  "SSO",
] as const;

export const PLATFORM_USERS_CONSOLE_API = {
  summary: "/api/platform/users/console-summary",
  userConsole: (userId: string) => `/api/platform/users/${userId}/console`,
} as const;

export type PlatformUserDetailTab =
  | "overview"
  | "permissions"
  | "protection"
  | "invitations"
  | "access-review"
  | "audit";

export const PLATFORM_USER_DETAIL_TABS: readonly { id: PlatformUserDetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "permissions", label: "Permissions" },
  { id: "protection", label: "Protection" },
  { id: "invitations", label: "Invitations" },
  { id: "access-review", label: "Access Review" },
  { id: "audit", label: "Audit" },
];
