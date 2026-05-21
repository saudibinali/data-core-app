/**
 * platform-users-config.ts
 *
 * P14-A - Frontend static configuration for Platform Users & Access.
 * No HTTP calls, no mutations, no DB. Config only.
 */

// ── Safety Contract ───────────────────────────────────────────────────────────

export const PLATFORM_USER_SAFETY_CONTRACT = {
  superAdminOnly: true,
  controlledPlatformUserCreation: true,
  noTenantUserManagement: true,
  noCustomerUserManagement: true,
  noHrEmployeeUserManagement: true,
  noPasswordReset: true,
  noEmailInviteSending: true,
  noSso: true,
  noMfa: true,
  noDeleteUser: true,
  noRootCreationFromUi: true,
  noRootRoleAssignmentFromUi: true,
  noRootPasswordResetFromAdminUi: true,
  noRootEmailChangeFromAdminUi: true,
  noRootDisableOrLock: true,
  noSelfPromotion: true,
  noManageEqualOrHigherPrivilege: true,
  auditBlockedAttempts: true,
  // Phase 14-E additions - finalization
  noCustomRoles: true,
  noPermissionEditor: true,
  noAuditDelete: true,
  noAuditEdit: true,
  noAuditExport: true,
  noBillingCommercial: true,
  noInvoicePayment: true,
  preserveRootProtection: true,
  preserveBackendAuthority: true,
} as const;

// Import-time guard - throws if any property is ever set to false
(function validateSafetyContract() {
  for (const [key, value] of Object.entries(PLATFORM_USER_SAFETY_CONTRACT)) {
    if (!value) {
      throw new Error(`PLATFORM_USER_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

// ── Root Protection Policy Config ─────────────────────────────────────────────

export const ROOT_PLATFORM_OWNER_PROTECTION_POLICY_CONFIG = {
  root_platform_owner: true,
  protected_account: true,
  immutable_role: true,
  non_deletable: true,
  non_disableable: true,
  non_lockable: true,
  password_reset_blocked_from_admin_ui: true,
  email_change_blocked: true,
  self_promotion_blocked: true,
  root_role_assignment_blocked: true,
  cannot_manage_equal_or_higher_privilege: true,
  cannot_disable_last_root_owner: true,
  requires_break_glass_recovery: true,
  audit_required: true,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlatformUserStatus = "invited" | "active" | "disabled" | "suspended" | "locked";
export type InitialPlatformRoleCode =
  | "root_platform_owner"
  | "platform_admin"
  | "support_admin"
  | "workspace_support"
  | "sales_admin"
  | "finance_admin"
  | "auditor"
  | "read_only_operator";

// ── Status Config ─────────────────────────────────────────────────────────────

export interface PlatformUserStatusConfig {
  label: string;
  labelAr: string;
  description: string;
  badgeClass: string;
  tier: "neutral" | "good" | "attention" | "critical" | "muted";
}

export const PLATFORM_USER_STATUS_CONFIG: Record<PlatformUserStatus, PlatformUserStatusConfig> = {
  invited: {
    label: "Invited",
    labelAr: "مُضاف - لم يُفعّل بعد",
    description: "Account created, pending first sign-in.",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    tier: "neutral",
  },
  active: {
    label: "Active",
    labelAr: "نشط",
    description: "Account is active and can sign in.",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    tier: "good",
  },
  disabled: {
    label: "Disabled",
    labelAr: "معطّل",
    description: "Account is disabled. Sign-in is blocked.",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    tier: "attention",
  },
  suspended: {
    label: "Suspended",
    labelAr: "معلّق",
    description: "Account is suspended pending review.",
    badgeClass: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    tier: "attention",
  },
  locked: {
    label: "Locked",
    labelAr: "مقفل",
    description: "Account is locked. Requires administrator action to restore.",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    tier: "critical",
  },
};

export const ALL_PLATFORM_USER_STATUS_KEYS = Object.keys(PLATFORM_USER_STATUS_CONFIG) as PlatformUserStatus[];

// ── Role Config ───────────────────────────────────────────────────────────────

export interface PlatformRoleConfig {
  label: string;
  labelAr: string;
  description: string;
  badgeClass: string;
  privilegeOrder: number;
  assignableFromUi: boolean;
}

export const INITIAL_PLATFORM_ROLE_CONFIG: Record<InitialPlatformRoleCode, PlatformRoleConfig> = {
  root_platform_owner: {
    label: "Root Platform Owner",
    labelAr: "مالك المنصة الجذري",
    description: "The original protected platform owner. Cannot be created, disabled, or modified from the UI.",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    privilegeOrder: 0,
    assignableFromUi: false,
  },
  platform_admin: {
    label: "Platform Admin",
    labelAr: "مدير المنصة",
    description: "Full platform administration access (excluding root-level operations).",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    privilegeOrder: 1,
    assignableFromUi: true,
  },
  support_admin: {
    label: "Support Admin",
    labelAr: "مسؤول الدعم",
    description: "Platform support operations, workspace diagnostics, and ticket oversight.",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
    privilegeOrder: 2,
    assignableFromUi: true,
  },
  workspace_support: {
    label: "Workspace Support",
    labelAr: "دعم مساحات العمل",
    description: "Read access to workspace data for customer support purposes.",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    privilegeOrder: 3,
    assignableFromUi: true,
  },
  sales_admin: {
    label: "Sales Admin",
    labelAr: "مسؤول المبيعات",
    description: "Access to tenant subscription metadata and plan details for sales purposes.",
    badgeClass: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    privilegeOrder: 3,
    assignableFromUi: true,
  },
  finance_admin: {
    label: "Finance Admin",
    labelAr: "مسؤول المالية",
    description: "Read access to subscription and billing metadata for finance reporting.",
    badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    privilegeOrder: 3,
    assignableFromUi: true,
  },
  auditor: {
    label: "Auditor",
    labelAr: "مدقق",
    description: "Read-only access to platform audit logs, governance data, and reports.",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
    privilegeOrder: 4,
    assignableFromUi: true,
  },
  read_only_operator: {
    label: "Read-Only Operator",
    labelAr: "مستخدم قراءة فقط",
    description: "Minimal read-only access to platform overview data.",
    badgeClass: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
    privilegeOrder: 5,
    assignableFromUi: true,
  },
};

export const ALL_INITIAL_PLATFORM_ROLE_KEYS = Object.keys(INITIAL_PLATFORM_ROLE_CONFIG) as InitialPlatformRoleCode[];

export const ASSIGNABLE_PLATFORM_ROLE_KEYS = ALL_INITIAL_PLATFORM_ROLE_KEYS.filter(
  (k) => INITIAL_PLATFORM_ROLE_CONFIG[k].assignableFromUi,
);

// ── Status Change Action Config ───────────────────────────────────────────────

export interface PlatformUserActionConfig {
  label: string;
  description: string;
  confirmationPrompt: string;
  targetStatus: PlatformUserStatus;
  buttonClass: string;
  requiresReason: true;
  requiresConfirmation: true;
}

export const PLATFORM_USER_ACTION_CONFIG: Record<string, PlatformUserActionConfig> = {
  activate: {
    label: "Activate Account",
    description: "Restore access for this platform user.",
    confirmationPrompt: "I confirm I want to activate this platform user account.",
    targetStatus: "active",
    buttonClass: "bg-emerald-600 hover:bg-emerald-700 text-white",
    requiresReason: true,
    requiresConfirmation: true,
  },
  disable: {
    label: "Disable Account",
    description: "Block sign-in for this platform user without deleting the account.",
    confirmationPrompt: "I confirm I want to disable this platform user account.",
    targetStatus: "disabled",
    buttonClass: "bg-amber-600 hover:bg-amber-700 text-white",
    requiresReason: true,
    requiresConfirmation: true,
  },
  suspend: {
    label: "Suspend Account",
    description: "Temporarily suspend this platform user account.",
    confirmationPrompt: "I confirm I want to suspend this platform user account.",
    targetStatus: "suspended",
    buttonClass: "bg-orange-600 hover:bg-orange-700 text-white",
    requiresReason: true,
    requiresConfirmation: true,
  },
  lock: {
    label: "Lock Account",
    description: "Lock this platform user account. Requires administrator action to restore.",
    confirmationPrompt: "I confirm I want to lock this platform user account.",
    targetStatus: "locked",
    buttonClass: "bg-rose-600 hover:bg-rose-700 text-white",
    requiresReason: true,
    requiresConfirmation: true,
  },
};

// ── API Paths ─────────────────────────────────────────────────────────────────

export const PLATFORM_USER_API_PATHS = {
  list: (params?: { search?: string; status?: string; userType?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.userType) q.set("userType", params.userType);
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return qs ? `/api/platform/users?${qs}` : "/api/platform/users";
  },
  get: (userId: string | number) => `/api/platform/users/${userId}`,
  create: () => "/api/platform/users",
  update: (userId: string | number) => `/api/platform/users/${userId}`,
  updateStatus: (userId: string | number) => `/api/platform/users/${userId}/status`,
  updateRole: (userId: string | number) => `/api/platform/users/${userId}/role`,
} as const;

// ── Hook Names ────────────────────────────────────────────────────────────────

export const PLATFORM_USER_READ_HOOK_NAMES = [
  "usePlatformUsers",
  "usePlatformUser",
] as const;

export const PLATFORM_USER_MUTATION_HOOK_NAMES = [
  "useCreatePlatformUser",
  "useUpdatePlatformUserProfile",
  "useUpdatePlatformUserStatus",
  "useUpdatePlatformUserRole",
] as const;

// ── Empty States ──────────────────────────────────────────────────────────────

export const PLATFORM_USER_EMPTY_STATE = {
  noUsers: "No platform users have been created yet.",
  loading: "Loading platform users...",
  error: "Failed to load platform users.",
  protectedNotice:
    "Root Platform Owner is protected. Other administrators cannot disable, lock, demote, change email, or reset the password for this account. The root owner manages their own credentials from My Account.",
  protectedNoticeAr:
    "مالك المنصة الجذري حساب محمي. لا يمكن لمسؤول آخر تعطيله أو تغيير بيانات الدخول. يدير المالك الجذري حسابه من صفحة حسابي.",
  safetyBanner: "Platform user management is for internal platform accounts only. Tenant workspace users are managed separately.",
} as const;

// ── Forbidden Wording (used by tests) ────────────────────────────────────────

export const PLATFORM_USER_FORBIDDEN_WORDING: readonly string[] = [
  "password reset",
  "send invite",
  "delete user",
  "SSO",
  "MFA",
  "tenant user",
  "customer user",
  "HR employee",
  "payroll",
  "invoice",
  "payment",
  "billing",
];
