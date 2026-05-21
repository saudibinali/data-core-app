/**
 * @phase P17-E - Platform invitation client config
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

export const P17E_FORBIDDEN_UI_TERMS = [
  "Send Email",
  "SMTP",
  "Reset Password",
  "MFA",
  "SSO",
  "Make Root Owner",
  "Invite Tenant User",
  "Invite Workspace User",
  "Delete Invitation",
] as const;

export const ACTIVATION_LINK_ONCE_NOTICE =
  "This activation link is shown once. Store it securely.";

export const PLATFORM_INVITATION_API = {
  list: (userId: string) => `/api/platform/users/${userId}/invitations`,
  create: (userId: string) => `/api/platform/users/${userId}/invitations`,
  resend: (userId: string) => `/api/platform/users/${userId}/invitations/resend`,
  revoke: (invitationId: number) => `/api/platform/invitations/${invitationId}/revoke`,
  verify: (token: string) => `/api/platform/invitations/verify?token=${encodeURIComponent(token)}`,
  accept: "/api/platform/invitations/accept",
} as const;
