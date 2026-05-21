/**
 * @phase P17-D - Access Review client config
 */

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

export const P17D_FORBIDDEN_UI_TERMS = [
  "Approve Access",
  "Reject Access",
  "Emergency Access",
  "Break Glass",
  "Force Change",
  "Grant Permission",
  "Deny Permission",
  "Change Role",
  "Disable User",
  "Delete User",
  "Reset Password",
  "MFA",
  "SSO",
] as const;

export const ACCESS_REVIEW_API = {
  summary: "/api/platform/access-review/summary",
  userDetail: (userId: string) => `/api/platform/access-review/users/${userId}`,
  auditEvents: "/api/platform/access-review/audit-events",
  recordReview: (userId: string) => `/api/platform/access-review/users/${userId}/review`,
} as const;

export const RISK_LEVEL_STYLES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  critical: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
};
