/**
 * platform-audit-config.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * Frontend configuration mirror for platform audit events.
 * Pure module - no React, no network, no side effects.
 *
 * Safety contract enforced at import time.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlatformAuditEventGroup =
  | "platform_user_management"
  | "platform_role_management"
  | "platform_permission_denial"
  | "root_protection"
  | "tenant_lifecycle"
  | "tenant_subscription"
  | "tenant_entitlement"
  | "platform_access";

export type PlatformAuditSeverity = "info" | "warning" | "critical";
export type PlatformAuditResultType = "success" | "blocked" | "denied" | "failed";

export interface PlatformAuditEventDef {
  actionCode: string;
  label: string;
  labelAr: string;
  group: PlatformAuditEventGroup;
  severity: PlatformAuditSeverity;
  resultType: PlatformAuditResultType;
  description: string;
}

// ── Known Events ──────────────────────────────────────────────────────────────

const KNOWN_EVENTS: PlatformAuditEventDef[] = [
  {
    actionCode: "platform_user_created",
    label: "Platform User Created",
    labelAr: "إنشاء مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A new platform administration user account was created.",
  },
  {
    actionCode: "platform_user_create_blocked",
    label: "Platform User Creation Blocked",
    labelAr: "منع إنشاء مستخدم منصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "blocked",
    description: "An attempt to create a platform user was blocked.",
  },
  {
    actionCode: "platform_user_status_changed",
    label: "Platform User Status Changed",
    labelAr: "تغيير حالة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user's account status was changed.",
  },
  {
    actionCode: "platform_user_status_change_blocked",
    label: "Platform User Status Change Blocked",
    labelAr: "منع تغيير حالة مستخدم منصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "blocked",
    description: "An attempt to change a platform user's status was blocked.",
  },
  {
    actionCode: "platform_user_role_changed",
    label: "Platform User Role Changed",
    labelAr: "تغيير دور مستخدم منصة",
    group: "platform_role_management",
    severity: "warning",
    resultType: "success",
    description: "A platform user's role code was changed.",
  },
  {
    actionCode: "platform_user_role_change_blocked",
    label: "Platform User Role Change Blocked",
    labelAr: "منع تغيير دور مستخدم منصة",
    group: "platform_role_management",
    severity: "critical",
    resultType: "blocked",
    description: "An attempt to change a platform user's role was blocked.",
  },
  {
    actionCode: "platform_permission_denied",
    label: "Platform Permission Denied",
    labelAr: "رفض صلاحية منصة",
    group: "platform_permission_denial",
    severity: "warning",
    resultType: "denied",
    description: "A platform API call was denied due to insufficient permissions.",
  },
  {
    actionCode: "protected_root_action_blocked",
    label: "Root Protection Triggered",
    labelAr: "منع إجراء على المالك الجذري",
    group: "root_protection",
    severity: "critical",
    resultType: "blocked",
    description: "An attempt to modify the Root Platform Owner account was blocked.",
  },
  {
    actionCode: "platform_user_access_policy_violation",
    label: "Platform Access Policy Violation",
    labelAr: "مخالفة سياسة وصول مستخدم منصة",
    group: "platform_permission_denial",
    severity: "critical",
    resultType: "blocked",
    description: "A platform user access policy violation was detected and blocked.",
  },
  {
    actionCode: "tenant_lifecycle_changed",
    label: "Tenant Lifecycle Changed",
    labelAr: "تغيير دورة حياة مستأجر",
    group: "tenant_lifecycle",
    severity: "warning",
    resultType: "success",
    description: "A tenant workspace lifecycle state was changed.",
  },
  {
    actionCode: "tenant_subscription_updated",
    label: "Tenant Subscription Updated",
    labelAr: "تحديث اشتراك مستأجر",
    group: "tenant_subscription",
    severity: "info",
    resultType: "success",
    description: "A tenant's subscription metadata was updated.",
  },
  {
    actionCode: "tenant_entitlement_override_updated",
    label: "Tenant Entitlement Override Updated",
    labelAr: "تحديث استثناء صلاحيات مستأجر",
    group: "tenant_entitlement",
    severity: "info",
    resultType: "success",
    description: "A tenant's entitlement override was applied.",
  },
];

// ── Config Maps ───────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_EVENT_CONFIG: Readonly<Record<string, PlatformAuditEventDef>> =
  Object.fromEntries(KNOWN_EVENTS.map((e) => [e.actionCode, e]));

export const PLATFORM_AUDIT_EVENT_GROUPS: readonly PlatformAuditEventGroup[] = [
  "platform_user_management",
  "platform_role_management",
  "platform_permission_denial",
  "root_protection",
  "tenant_lifecycle",
  "tenant_subscription",
  "tenant_entitlement",
  "platform_access",
] as const;

export const PLATFORM_AUDIT_ACTION_CODES: readonly string[] = KNOWN_EVENTS.map((e) => e.actionCode);

// ── Severity Config ───────────────────────────────────────────────────────────

export interface SeverityDef {
  label: string;
  labelAr: string;
  badgeClass: string;
}

export const PLATFORM_AUDIT_SEVERITY_CONFIG: Readonly<Record<PlatformAuditSeverity, SeverityDef>> = {
  info:     { label: "Info",     labelAr: "معلومات", badgeClass: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  warning:  { label: "Warning",  labelAr: "تحذير",   badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  critical: { label: "Critical", labelAr: "حرج",     badgeClass: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

// ── Result Config ─────────────────────────────────────────────────────────────

export interface ResultDef {
  label: string;
  labelAr: string;
  badgeClass: string;
}

export const PLATFORM_AUDIT_RESULT_CONFIG: Readonly<Record<PlatformAuditResultType, ResultDef>> = {
  success: { label: "Success", labelAr: "ناجح",   badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  blocked: { label: "Blocked", labelAr: "محظور",  badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" },
  denied:  { label: "Denied",  labelAr: "مرفوض",  badgeClass: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  failed:  { label: "Failed",  labelAr: "فشل",    badgeClass: "bg-gray-100 text-gray-700 dark:bg-gray-950/40 dark:text-gray-300" },
};

// ── Filter Config ─────────────────────────────────────────────────────────────

export interface FilterOption {
  value: string;
  label: string;
  labelAr: string;
}

export const PLATFORM_AUDIT_GROUP_FILTER_OPTIONS: FilterOption[] = [
  { value: "platform_user_management",  label: "Platform User Management",  labelAr: "إدارة مستخدمي المنصة" },
  { value: "platform_role_management",  label: "Platform Role Management",  labelAr: "إدارة أدوار المنصة" },
  { value: "platform_permission_denial",label: "Permission Denial",          labelAr: "رفض الصلاحيات" },
  { value: "root_protection",           label: "Root Protection",            labelAr: "حماية المالك الجذري" },
  { value: "tenant_lifecycle",          label: "Tenant Lifecycle",           labelAr: "دورة حياة المستأجر" },
  { value: "tenant_subscription",       label: "Tenant Subscription",        labelAr: "اشتراك المستأجر" },
  { value: "tenant_entitlement",        label: "Tenant Entitlement",         labelAr: "صلاحيات المستأجر" },
  { value: "platform_access",           label: "Platform Access",            labelAr: "وصول المنصة" },
];

export const PLATFORM_AUDIT_RESULT_FILTER_OPTIONS: FilterOption[] = [
  { value: "success", label: "Success", labelAr: "ناجح" },
  { value: "blocked", label: "Blocked", labelAr: "محظور" },
  { value: "denied",  label: "Denied",  labelAr: "مرفوض" },
  { value: "failed",  label: "Failed",  labelAr: "فشل" },
];

export const PLATFORM_AUDIT_SEVERITY_FILTER_OPTIONS: FilterOption[] = [
  { value: "info",     label: "Info",     labelAr: "معلومات" },
  { value: "warning",  label: "Warning",  labelAr: "تحذير" },
  { value: "critical", label: "Critical", labelAr: "حرج" },
];

export const PLATFORM_AUDIT_FILTER_CONFIG = {
  groups:     PLATFORM_AUDIT_GROUP_FILTER_OPTIONS,
  results:    PLATFORM_AUDIT_RESULT_FILTER_OPTIONS,
  severities: PLATFORM_AUDIT_SEVERITY_FILTER_OPTIONS,
  defaultLimit: 50,
  maxLimit: 200,
} as const;

// ── Safety Contract ───────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_SAFETY_CONTRACT = {
  readOnlyAudit:              true,
  noAuditDelete:              true,
  noAuditEdit:                true,
  noSecretMetadataDisplay:    true,
  permissionGated:            true,
  platformActivityOnly:       true,
  noSiemIntegration:          true,
  noExport:                   true,
  preserveBackendAuthority:   true,
} as const satisfies Record<string, true>;

// Import-time enforcement - throws loudly if any property is false
void (() => {
  for (const [key, value] of Object.entries(PLATFORM_AUDIT_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`PLATFORM_AUDIT_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

// ── Client helpers ────────────────────────────────────────────────────────────

export function getPlatformAuditEventConfigClient(actionCode: string): PlatformAuditEventDef {
  return (
    PLATFORM_AUDIT_EVENT_CONFIG[actionCode] ?? {
      actionCode,
      label: actionCode,
      labelAr: "حدث غير مصنف",
      group: "platform_access" as PlatformAuditEventGroup,
      severity: "info" as PlatformAuditSeverity,
      resultType: "success" as PlatformAuditResultType,
      description: `Unknown platform event: ${actionCode}`,
    }
  );
}

export function isPlatformAuditEventClient(actionCode: string): boolean {
  return actionCode in PLATFORM_AUDIT_EVENT_CONFIG;
}
