/**
 * @phase P17-E - Platform user invitation configuration & safety contract
 */

export const PLATFORM_INVITATION_SAFETY_CONTRACT = {
  platformInvitationActivationOnly: true,
  noEmailSending: true,
  noSmtp: true,
  noPasswordReset: true,
  noMfaManagement: true,
  noSsoManagement: true,
  noTenantInvitations: true,
  noWorkspaceInvitations: true,
  noRootOwnerPromotion: true,
  tokenStoredHashedOnly: true,
  tokenShownOnce: true,
  invitationExpiryRequired: true,
  noHardDeleteInvitations: true,
  protectedUserPolicyEnforced: true,
  auditInvitationLifecycle: true,
  permissionGated: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(PLATFORM_INVITATION_SAFETY_CONTRACT)) {
    if (value !== true) throw new Error(`PLATFORM_INVITATION_SAFETY_CONTRACT violated: ${key}`);
  }
})();

export const PLATFORM_INVITATION_DEFAULT_EXPIRY_DAYS = 7;

export const PLATFORM_INVITATION_ACTIVATION_PATH = "/platform/activate";

export const SYSTEM_REVOKE_REASON_REPLACED = "system_replaced_by_new_invitation";

export type PlatformInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export const PLATFORM_INVITATION_STATUSES: readonly PlatformInvitationStatus[] = [
  "pending",
  "accepted",
  "expired",
  "revoked",
];

export const REVOKE_REASON_MIN_LENGTH = 10;
