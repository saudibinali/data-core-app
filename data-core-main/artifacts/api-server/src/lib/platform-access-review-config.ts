/**
 * @phase P17-D - Access Review & Audit configuration
 */

import type { PlatformPermissionCode } from "./platform-permissions";

export const ACCESS_REVIEW_SAFETY_CONTRACT = {
  accessReviewVisibilityOnly: true,
  noApprovalWorkflow: true,
  noEmergencyAccess: true,
  noPermissionMutationFromReview: true,
  noRoleMutationFromReview: true,
  noStatusMutationFromReview: true,
  noTenantWorkspaceAccessReview: true,
  noPasswordManagement: true,
  noMfaManagement: true,
  noSsoManagement: true,
  noRoleMatrixRedesign: true,
  auditEventsReadOnly: true,
  sensitivePayloadsHidden: true,
  permissionGated: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(ACCESS_REVIEW_SAFETY_CONTRACT)) {
    if (value !== true) throw new Error(`ACCESS_REVIEW_SAFETY_CONTRACT violated: ${key}`);
  }
})();

/** Days without login before a sensitive user is considered stale */
export const STALE_SENSITIVE_LOGIN_DAYS = 90;

/** Days since last manual review before flagged as missing recent review */
export const ACCESS_REVIEW_RECENCY_DAYS = 180;

export type AccessReviewRiskLevel = "low" | "medium" | "high" | "critical";

export type AccessReviewStatus = "reviewed" | "needs_follow_up" | "exception_accepted";

export const ACCESS_REVIEW_STATUSES: readonly AccessReviewStatus[] = [
  "reviewed",
  "needs_follow_up",
  "exception_accepted",
];

export const ACCESS_REVIEW_AUDIT_ACTIONS = [
  "platform_user_created",
  "platform_user_profile_updated",
  "platform_user_disabled",
  "platform_user_suspended",
  "platform_user_reactivated",
  "platform_user_status_changed",
  "platform_user_status_change_blocked",
  "platform_user_role_changed",
  "platform_user_role_change_blocked",
  "platform_permission_override_granted",
  "platform_permission_override_denied",
  "platform_permission_override_removed",
  "platform_permission_overrides_bulk_updated",
  "platform_permission_change_blocked",
  "platform_admin_protection_evaluated_blocked",
  "platform_admin_protection_warning",
  "platform_admin_sensitive_change_allowed",
  "platform_admin_sensitive_change_blocked",
  "platform_root_owner_change_blocked",
  "platform_last_owner_action_blocked",
  "platform_access_review_recorded",
] as const;

export type AccessReviewAuditAction = (typeof ACCESS_REVIEW_AUDIT_ACTIONS)[number];

export const SENSITIVE_EFFECTIVE_PERMISSION_CODES: readonly PlatformPermissionCode[] = [
  "platform.permissions.update",
  "platform.users.disable",
  "platform.users.role.update",
];
