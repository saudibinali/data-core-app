/**
 * platform-audit-events.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * Pure library - no DB, no HTTP, no side effects.
 * Defines the taxonomy of platform audit events that appear in activity_logs.
 *
 * Scope:
 *   Platform-level events only (workspaceId IS NULL in activity_logs).
 *   Does NOT cover workspace-tenant events (those belong to workspace activity feed).
 *
 * Safety:
 *   Read-only classification. Does not write, delete, or modify audit records.
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
  | "tenant_quota"
  | "commercial"
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

// ── Known Event Definitions ───────────────────────────────────────────────────

const KNOWN_EVENTS: PlatformAuditEventDef[] = [
  // Platform User Management
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
    description: "An attempt to create a platform user was blocked (e.g., root role assignment attempt).",
  },
  {
    actionCode: "platform_user_status_changed",
    label: "Platform User Status Changed",
    labelAr: "تغيير حالة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user's account status was changed (active/disabled/locked).",
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
    actionCode: "platform_user_profile_updated",
    label: "Platform User Profile Updated",
    labelAr: "تحديث ملف مستخدم المنصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "Basic profile fields were updated for a platform user.",
  },
  {
    actionCode: "platform_user_disabled",
    label: "Platform User Disabled",
    labelAr: "تعطيل مستخدم منصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A platform user account was disabled.",
  },
  {
    actionCode: "platform_user_suspended",
    label: "Platform User Suspended",
    labelAr: "تعليق مستخدم منصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A platform user account was suspended.",
  },
  {
    actionCode: "platform_user_reactivated",
    label: "Platform User Reactivated",
    labelAr: "إعادة تفعيل مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user account was reactivated to active status.",
  },
  {
    actionCode: "platform_permission_override_granted",
    label: "Permission Override Granted",
    labelAr: "منح صلاحية مخصصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A custom grant override was applied to a platform user.",
  },
  {
    actionCode: "platform_permission_override_denied",
    label: "Permission Override Denied",
    labelAr: "منع صلاحية مخصصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A custom deny override was applied to a platform user.",
  },
  {
    actionCode: "platform_permission_override_removed",
    label: "Permission Override Removed",
    labelAr: "إزالة صلاحية مخصصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A custom permission override was cleared.",
  },
  {
    actionCode: "platform_permission_overrides_bulk_updated",
    label: "Permission Overrides Bulk Updated",
    labelAr: "تحديث جماعي للصلاحيات المخصصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "Bulk replacement of custom permission overrides for a platform user.",
  },
  {
    actionCode: "platform_permission_change_blocked",
    label: "Permission Change Blocked",
    labelAr: "منع تغيير صلاحية",
    group: "platform_user_management",
    severity: "critical",
    resultType: "blocked",
    description: "An attempt to change platform permission overrides was blocked.",
  },
  {
    actionCode: "platform_admin_protection_evaluated_blocked",
    label: "Admin Protection Blocked",
    labelAr: "منع إجراء بحماية المسؤول",
    group: "platform_user_management",
    severity: "critical",
    resultType: "blocked",
    description: "A platform admin action was blocked by protection policy.",
  },
  {
    actionCode: "platform_admin_protection_warning",
    label: "Admin Protection Warning",
    labelAr: "تحذير حماية المسؤول",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A platform admin protection policy warning was recorded.",
  },
  {
    actionCode: "platform_admin_sensitive_change_allowed",
    label: "Sensitive Admin Change Allowed",
    labelAr: "سماح بتغيير حساس للمسؤول",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A sensitive platform admin change was allowed.",
  },
  {
    actionCode: "platform_admin_sensitive_change_blocked",
    label: "Sensitive Admin Change Blocked",
    labelAr: "منع تغيير حساس للمسؤول",
    group: "platform_user_management",
    severity: "critical",
    resultType: "blocked",
    description: "A sensitive platform admin change was blocked.",
  },
  {
    actionCode: "platform_root_owner_change_blocked",
    label: "Root Owner Change Blocked",
    labelAr: "منع تغيير المالك الجذري",
    group: "root_protection",
    severity: "critical",
    resultType: "blocked",
    description: "An attempt to change root owner status was blocked.",
  },
  {
    actionCode: "platform_last_owner_action_blocked",
    label: "Last Owner Action Blocked",
    labelAr: "منع إجراء على آخر مالك",
    group: "root_protection",
    severity: "critical",
    resultType: "blocked",
    description: "An action on the last platform owner was blocked.",
  },
  {
    actionCode: "platform_access_review_recorded",
    label: "Access Review Recorded",
    labelAr: "تسجيل مراجعة وصول",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A manual platform access review was recorded.",
  },
  {
    actionCode: "platform_user_invitation_created",
    label: "Platform Invitation Created",
    labelAr: "إنشاء دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user activation invitation was created.",
  },
  {
    actionCode: "platform_user_invitation_resent",
    label: "Platform Invitation Resent",
    labelAr: "إعادة إرسال دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user activation invitation was reissued.",
  },
  {
    actionCode: "platform_user_invitation_revoked",
    label: "Platform Invitation Revoked",
    labelAr: "إلغاء دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "warning",
    resultType: "success",
    description: "A pending platform user invitation was revoked.",
  },
  {
    actionCode: "platform_user_invitation_accepted",
    label: "Platform Invitation Accepted",
    labelAr: "قبول دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user completed activation via invitation.",
  },
  {
    actionCode: "platform_user_invitation_expired",
    label: "Platform Invitation Expired",
    labelAr: "انتهاء دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "info",
    resultType: "success",
    description: "A platform user invitation expired.",
  },
  {
    actionCode: "platform_user_invitation_blocked",
    label: "Platform Invitation Blocked",
    labelAr: "منع دعوة مستخدم منصة",
    group: "platform_user_management",
    severity: "critical",
    resultType: "blocked",
    description: "A platform invitation action was blocked by policy.",
  },
  // Platform Role Management
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
  // Platform Permission Denial
  {
    actionCode: "platform_permission_denied",
    label: "Platform Permission Denied",
    labelAr: "رفض صلاحية منصة",
    group: "platform_permission_denial",
    severity: "warning",
    resultType: "denied",
    description: "A platform API call was denied due to insufficient permissions.",
  },
  // Root Protection
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
  // Tenant Lifecycle
  {
    actionCode: "tenant_lifecycle_changed",
    label: "Tenant Lifecycle Changed",
    labelAr: "تغيير دورة حياة مستأجر",
    group: "tenant_lifecycle",
    severity: "warning",
    resultType: "success",
    description: "A tenant workspace lifecycle state was changed (activate/suspend/disable).",
  },
  // Tenant Subscription
  {
    actionCode: "tenant_subscription_updated",
    label: "Tenant Subscription Updated",
    labelAr: "تحديث اشتراك مستأجر",
    group: "tenant_subscription",
    severity: "info",
    resultType: "success",
    description: "A tenant's subscription metadata was updated (P13 metadata).",
  },
  {
    actionCode: "workspace_subscription_created",
    label: "Workspace Subscription Created",
    labelAr: "إنشاء اشتراك مساحة عمل",
    group: "tenant_subscription",
    severity: "info",
    resultType: "success",
    description: "A workspace subscription state record was created (P16-A).",
  },
  {
    actionCode: "workspace_subscription_updated",
    label: "Workspace Subscription Updated",
    labelAr: "تحديث اشتراك مساحة عمل",
    group: "tenant_subscription",
    severity: "info",
    resultType: "success",
    description: "Workspace subscription metadata was updated (non-status fields).",
  },
  {
    actionCode: "workspace_subscription_status_changed",
    label: "Workspace Subscription Status Changed",
    labelAr: "تغيير حالة اشتراك مساحة عمل",
    group: "tenant_subscription",
    severity: "warning",
    resultType: "success",
    description: "Workspace subscription status was transitioned with reason (no enforcement).",
  },
  {
    actionCode: "workspace_subscription_status_change_blocked",
    label: "Workspace Subscription Status Change Blocked",
    labelAr: "منع تغيير حالة اشتراك مساحة عمل",
    group: "tenant_subscription",
    severity: "warning",
    resultType: "blocked",
    description: "An invalid workspace subscription status transition was blocked.",
  },
  {
    actionCode: "workspace_entitlements_updated",
    label: "Workspace Entitlements Updated",
    labelAr: "تحديث استحقاقات مساحة العمل",
    group: "tenant_entitlement",
    severity: "info",
    resultType: "success",
    description: "Workspace entitlements were bulk upserted (P16-B).",
  },
  {
    actionCode: "workspace_entitlement_changed",
    label: "Workspace Entitlement Changed",
    labelAr: "تغيير استحقاق مساحة عمل",
    group: "tenant_entitlement",
    severity: "info",
    resultType: "success",
    description: "A single workspace entitlement record was updated.",
  },
  {
    actionCode: "workspace_entitlement_change_blocked",
    label: "Workspace Entitlement Change Blocked",
    labelAr: "منع تغيير استحقاق مساحة عمل",
    group: "tenant_entitlement",
    severity: "warning",
    resultType: "blocked",
    description: "An invalid workspace entitlement change was blocked (e.g. disabling core).",
  },
  {
    actionCode: "workspace_quotas_updated",
    label: "Workspace Quotas Updated",
    labelAr: "تحديث حدود استخدام مساحة العمل",
    group: "tenant_quota",
    severity: "info",
    resultType: "success",
    description: "Workspace quota limits were bulk upserted (P16-C).",
  },
  {
    actionCode: "workspace_quota_changed",
    label: "Workspace Quota Changed",
    labelAr: "تغيير حد استخدام مساحة عمل",
    group: "tenant_quota",
    severity: "info",
    resultType: "success",
    description: "A single workspace quota limit record was updated.",
  },
  {
    actionCode: "workspace_quota_change_blocked",
    label: "Workspace Quota Change Blocked",
    labelAr: "منع تغيير حد استخدام مساحة عمل",
    group: "tenant_quota",
    severity: "warning",
    resultType: "blocked",
    description: "An invalid workspace quota change was blocked.",
  },
  {
    actionCode: "workspace_subscription_policy_updated",
    label: "Workspace Subscription Policy Updated",
    labelAr: "تحديث سياسة اشتراك مساحة العمل",
    group: "tenant_subscription_policy",
    severity: "info",
    resultType: "success",
    description: "Grace and suspension policy was upserted (P16-D, advisory only).",
  },
  {
    actionCode: "workspace_subscription_policy_evaluated",
    label: "Workspace Subscription Policy Evaluated",
    labelAr: "تقييم سياسة اشتراك مساحة العمل",
    group: "tenant_subscription_policy",
    severity: "info",
    resultType: "success",
    description: "Read-only policy evaluation was run (P16-D).",
  },
  {
    actionCode: "workspace_subscription_policy_change_blocked",
    label: "Workspace Subscription Policy Change Blocked",
    labelAr: "منع تغيير سياسة اشتراك مساحة عمل",
    group: "tenant_subscription_policy",
    severity: "warning",
    resultType: "blocked",
    description: "An invalid subscription policy change was blocked.",
  },
  {
    actionCode: "workspace_access_evaluated",
    label: "Workspace Access Evaluated",
    labelAr: "تقييم وصول مساحة العمل",
    group: "tenant_workspace_access",
    severity: "info",
    resultType: "success",
    description: "Commercial-to-workspace access evaluation was run (P16-E).",
  },
  {
    actionCode: "workspace_access_mode_changed",
    label: "Workspace Access Mode Changed",
    labelAr: "تغيير وضع وصول مساحة العمل",
    group: "tenant_workspace_access",
    severity: "info",
    resultType: "success",
    description: "Workspace access enforcement mode was manually updated.",
  },
  {
    actionCode: "workspace_access_change_blocked",
    label: "Workspace Access Change Blocked",
    labelAr: "منع تغيير وصول مساحة العمل",
    group: "tenant_workspace_access",
    severity: "warning",
    resultType: "blocked",
    description: "An invalid workspace access change was blocked.",
  },
  {
    actionCode: "workspace_write_blocked_read_only",
    label: "Workspace Write Blocked (Read-Only)",
    labelAr: "منع الكتابة - وضع القراءة فقط",
    group: "tenant_workspace_access",
    severity: "warning",
    resultType: "blocked",
    description: "An operational write was blocked because the workspace is read-only.",
  },
  // Tenant Entitlement
  {
    actionCode: "tenant_entitlement_override_updated",
    label: "Tenant Entitlement Override Updated",
    labelAr: "تحديث استثناء صلاحيات مستأجر",
    group: "tenant_entitlement",
    severity: "info",
    resultType: "success",
    description: "A tenant's entitlement override was applied.",
  },
  // Commercial - P15-A
  {
    actionCode: "commercial_account_created",
    label: "Commercial Account Created",
    labelAr: "إنشاء حساب تجاري",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A commercial account was created for a tenant workspace.",
  },
  {
    actionCode: "commercial_account_updated",
    label: "Commercial Account Updated",
    labelAr: "تحديث حساب تجاري",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A tenant's commercial account details were updated.",
  },
  {
    actionCode: "commercial_billing_contact_created",
    label: "Billing Contact Created",
    labelAr: "إنشاء جهة تواصل فوترة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A billing contact was added to a commercial account.",
  },
  {
    actionCode: "commercial_billing_contact_updated",
    label: "Billing Contact Updated",
    labelAr: "تحديث جهة تواصل فوترة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A billing contact record was updated.",
  },
  {
    actionCode: "commercial_billing_contact_primary_changed",
    label: "Primary Billing Contact Changed",
    labelAr: "تغيير جهة التواصل الأساسية",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "The primary billing contact was changed for a commercial account.",
  },
  {
    actionCode: "commercial_access_denied",
    label: "Commercial Access Denied",
    labelAr: "رفض وصول تجاري",
    group: "commercial",
    severity: "warning",
    resultType: "denied",
    description: "Access to commercial account data was denied due to insufficient permissions.",
  },
  // Commercial - P15-B
  {
    actionCode: "commercial_contract_created",
    label: "Commercial Contract Created",
    labelAr: "إنشاء عقد تجاري",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A commercial contract term record was created for a tenant.",
  },
  {
    actionCode: "commercial_contract_updated",
    label: "Commercial Contract Updated",
    labelAr: "تحديث عقد تجاري",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A commercial contract term record was updated.",
  },
  {
    actionCode: "commercial_contract_status_changed",
    label: "Commercial Contract Status Changed",
    labelAr: "تغيير حالة عقد تجاري",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A commercial contract term status was changed with a documented reason.",
  },
  {
    actionCode: "commercial_contract_status_change_blocked",
    label: "Commercial Contract Status Change Blocked",
    labelAr: "منع تغيير حالة عقد تجاري",
    group: "commercial",
    severity: "warning",
    resultType: "blocked",
    description: "A commercial contract status change was blocked (e.g. missing reason).",
  },
  // Commercial - P15-C
  {
    actionCode: "commercial_invoice_created",
    label: "Commercial Invoice Created",
    labelAr: "إنشاء سجل فاتورة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An enterprise invoice record was created for a tenant.",
  },
  {
    actionCode: "commercial_invoice_updated",
    label: "Commercial Invoice Updated",
    labelAr: "تحديث سجل فاتورة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An enterprise invoice record was updated.",
  },
  {
    actionCode: "commercial_invoice_status_changed",
    label: "Commercial Invoice Status Changed",
    labelAr: "تغيير حالة فاتورة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An invoice status was changed with a documented reason.",
  },
  {
    actionCode: "commercial_invoice_status_change_blocked",
    label: "Commercial Invoice Status Change Blocked",
    labelAr: "منع تغيير حالة فاتورة",
    group: "commercial",
    severity: "warning",
    resultType: "blocked",
    description: "An invoice status change was blocked (e.g. missing reason).",
  },
  {
    actionCode: "commercial_invoice_document_uploaded",
    label: "Commercial Invoice PDF Uploaded",
    labelAr: "رفع PDF فاتورة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An official invoice PDF was uploaded for an invoice record.",
  },
  {
    actionCode: "commercial_invoice_document_downloaded",
    label: "Commercial Invoice PDF Downloaded",
    labelAr: "تحميل PDF فاتورة",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An official invoice PDF was downloaded via the protected API.",
  },
  {
    actionCode: "commercial_invoice_document_upload_blocked",
    label: "Commercial Invoice PDF Upload Blocked",
    labelAr: "منع رفع PDF فاتورة",
    group: "commercial",
    severity: "warning",
    resultType: "blocked",
    description: "An invoice PDF upload was blocked (invalid file or policy).",
  },
  // Commercial - P15-E
  {
    actionCode: "commercial_payment_recorded",
    label: "Manual Payment Recorded",
    labelAr: "تسجيل دفعة يدوية",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "An off-platform manual payment was recorded against an invoice.",
  },
  {
    actionCode: "commercial_payment_updated",
    label: "Manual Payment Updated",
    labelAr: "تحديث دفعة يدوية",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A pending manual payment record was updated.",
  },
  {
    actionCode: "commercial_payment_verified",
    label: "Manual Payment Verified",
    labelAr: "التحقق من دفعة يدوية",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A manual payment was verified by finance.",
  },
  {
    actionCode: "commercial_payment_rejected",
    label: "Manual Payment Rejected",
    labelAr: "رفض دفعة يدوية",
    group: "commercial",
    severity: "warning",
    resultType: "success",
    description: "A manual payment was rejected with a documented reason.",
  },
  {
    actionCode: "commercial_payment_reversed",
    label: "Manual Payment Reversed",
    labelAr: "عكس دفعة يدوية",
    group: "commercial",
    severity: "warning",
    resultType: "success",
    description: "A manual payment was reversed with a documented reason.",
  },
  {
    actionCode: "commercial_payment_action_blocked",
    label: "Manual Payment Action Blocked",
    labelAr: "منع إجراء على دفعة يدوية",
    group: "commercial",
    severity: "warning",
    resultType: "blocked",
    description: "A payment action was blocked (policy or invalid state).",
  },
  // Commercial - P15-F
  {
    actionCode: "commercial_risk_viewed",
    label: "Commercial Risk Viewed",
    labelAr: "عرض المخاطر التجارية",
    group: "commercial",
    severity: "info",
    resultType: "success",
    description: "A tenant commercial risk detail view was accessed.",
  },
  {
    actionCode: "commercial_risk_access_denied",
    label: "Commercial Risk Access Denied",
    labelAr: "منع الوصول للمخاطر التجارية",
    group: "commercial",
    severity: "warning",
    resultType: "denied",
    description: "Commercial risk access was denied.",
  },
];

// ── Config Map ────────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_EVENT_CONFIG: Readonly<Record<string, PlatformAuditEventDef>> =
  Object.fromEntries(KNOWN_EVENTS.map((e) => [e.actionCode, e]));

// ── Groups ────────────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_EVENT_GROUPS: readonly PlatformAuditEventGroup[] = [
  "platform_user_management",
  "platform_role_management",
  "platform_permission_denial",
  "root_protection",
  "tenant_lifecycle",
  "tenant_subscription",
  "tenant_entitlement",
  "tenant_quota",
  "commercial",
  "platform_access",
] as const;

// ── Unknown Event Fallback ────────────────────────────────────────────────────

function buildUnknownEventDef(actionCode: string): PlatformAuditEventDef {
  return {
    actionCode,
    label: actionCode,
    labelAr: "حدث غير مصنف",
    group: "platform_access",
    severity: "info",
    resultType: "success",
    description: `Unknown platform event: ${actionCode}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the event definition for a given actionCode.
 * Falls back to a safe unknown-event definition if the actionCode is not registered.
 */
export function getPlatformAuditEventConfig(actionCode: string): PlatformAuditEventDef {
  return PLATFORM_AUDIT_EVENT_CONFIG[actionCode] ?? buildUnknownEventDef(actionCode);
}

/**
 * Returns the severity for a given actionCode.
 * Falls back to "info" for unknown events.
 */
export function getPlatformAuditSeverity(actionCode: string): PlatformAuditSeverity {
  return PLATFORM_AUDIT_EVENT_CONFIG[actionCode]?.severity ?? "info";
}

/**
 * Returns true if the actionCode is a registered known platform event.
 */
export function isPlatformAuditEvent(actionCode: string): boolean {
  return actionCode in PLATFORM_AUDIT_EVENT_CONFIG;
}

/**
 * Returns all known actionCodes.
 */
export const PLATFORM_AUDIT_ACTION_CODES = KNOWN_EVENTS.map((e) => e.actionCode) as readonly string[];
