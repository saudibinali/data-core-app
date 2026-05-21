/**
 * @phase P17-F - Platform Users Console integration (read-only aggregation)
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

void (() => {
  for (const [key, value] of Object.entries(PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT)) {
    if (value !== true) throw new Error(`PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT violated: ${key}`);
  }
})();
