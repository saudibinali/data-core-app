/**
 * platform-permissions.ts
 *
 * @phase P14-B - Platform Roles & Permission Matrix
 *
 * Pure library - no DB, no HTTP, no side effects.
 * Defines the fixed permission matrix for platform administration roles.
 *
 * Permission codes are stable identifiers. Do NOT rename or remove codes
 * without a migration plan - they are stored in audit logs.
 */

// ── Permission Codes ─────────────────────────────────────────────────────────

export const PLATFORM_PERMISSION_CODES = [
  "platform.users.read",
  "platform.users.create",
  "platform.users.update",
  "platform.users.disable",
  "platform.users.reactivate",
  "platform.users.status.update",
  "platform.users.role.update",
  "platform.permissions.read",
  "platform.permissions.update",
  "platform.accessReview.read",
  "platform.accessReview.update",
  "platform.invitations.read",
  "platform.invitations.create",
  "platform.invitations.revoke",
  "platform.roles.read",
  "tenants.read",
  "tenants.lifecycle.update",
  "subscriptions.read",
  "subscriptions.update",
  "entitlements.read",
  "entitlements.override.update",
  "usage.read",
  "renewal.read",
  "health.read",
  "evaluation.read",
  "audit.read",
  "platform.activity.read",
  "platform.settings.read",
  // P15-A - Commercial Accounts & Billing Contacts
  "commercial.accounts.read",
  "commercial.accounts.update",
  "commercial.contacts.read",
  "commercial.contacts.update",
  // P15-B - Contract Terms & Renewal Commitments
  "commercial.contracts.read",
  "commercial.contracts.update",
  // P15-C - Invoice Records & Uploaded Invoice PDFs
  "commercial.invoices.read",
  "commercial.invoices.update",
  "commercial.invoiceDocuments.read",
  "commercial.invoiceDocuments.upload",
  // P15-E - Manual Payment & Collection Tracking
  "commercial.payments.read",
  "commercial.payments.record",
  "commercial.payments.verify",
  // P15-F - Commercial Risk & Renewal Readiness
  "commercial.risk.read",
  // P16-A - Workspace Subscription State Model
  "platform.subscriptions.read",
  "platform.subscriptions.update",
  "platform.subscriptions.status.change",
  // P16-B - Workspace Entitlement & Feature Access Model
  "platform.entitlements.read",
  "platform.entitlements.update",
  // P16-C - Workspace Limits & Quotas
  "platform.quotas.read",
  "platform.quotas.update",
  // P16-D - Grace Period & Suspension Policy Model
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.update",
  "platform.subscriptionPolicies.evaluate",
  // P16-E - Workspace Access Enforcement
  "platform.workspaceAccess.read",
  "platform.workspaceAccess.update",
  "platform.workspaceAccess.evaluate",
  // P23-A — Platform control plane governance
  "platform.governance.ops.read",
  "platform.modules.govern",
  "platform.support.session.start",
  "platform.support.session.end",
] as const;

export type PlatformPermissionCode = (typeof PLATFORM_PERMISSION_CODES)[number];

// ── Permission Risk Levels & Groups ──────────────────────────────────────────

export type PermissionRiskLevel = "read" | "controlled_write" | "sensitive_write" | "root_only";

export type PermissionGroup =
  | "Platform Users"
  | "Tenants"
  | "Subscriptions"
  | "Entitlements"
  | "Usage"
  | "Renewal"
  | "Health"
  | "Evaluation"
  | "Audit"
  | "Settings"
  | "Commercial";

export interface PlatformPermissionDefinition {
  readonly code: PlatformPermissionCode;
  readonly label: string;
  readonly labelAr: string;
  readonly description: string;
  readonly group: PermissionGroup;
  readonly riskLevel: PermissionRiskLevel;
}

export const PLATFORM_PERMISSION_CONFIG: Record<PlatformPermissionCode, PlatformPermissionDefinition> = {
  "platform.users.read": {
    code: "platform.users.read",
    label: "Read Platform Users",
    labelAr: "قراءة مستخدمي المنصة",
    description: "View the list of platform administration accounts and their roles.",
    group: "Platform Users",
    riskLevel: "read",
  },
  "platform.users.create": {
    code: "platform.users.create",
    label: "Create Platform Users",
    labelAr: "إنشاء مستخدمي المنصة",
    description: "Create new platform administration accounts (non-root only).",
    group: "Platform Users",
    riskLevel: "controlled_write",
  },
  "platform.users.update": {
    code: "platform.users.update",
    label: "Update Platform User Profile",
    labelAr: "تحديث ملف مستخدم المنصة",
    description: "Update display name, job title, department, and phone for platform users.",
    group: "Platform Users",
    riskLevel: "controlled_write",
  },
  "platform.users.disable": {
    code: "platform.users.disable",
    label: "Disable or Suspend Platform Users",
    labelAr: "تعطيل أو تعليق مستخدمي المنصة",
    description: "Disable, suspend, or lock platform user accounts (non-root/protected only).",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.users.reactivate": {
    code: "platform.users.reactivate",
    label: "Reactivate Platform Users",
    labelAr: "إعادة تفعيل مستخدمي المنصة",
    description: "Restore active status for disabled or suspended platform users.",
    group: "Platform Users",
    riskLevel: "controlled_write",
  },
  "platform.users.status.update": {
    code: "platform.users.status.update",
    label: "Update Platform User Status",
    labelAr: "تحديث حالة مستخدم منصة",
    description: "Activate, disable, or lock platform users (non-root/protected only).",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.users.role.update": {
    code: "platform.users.role.update",
    label: "Update Platform User Role",
    labelAr: "تحديث دور مستخدم منصة",
    description: "Change the assigned platform role for a platform user (non-root/protected only).",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.permissions.read": {
    code: "platform.permissions.read",
    label: "Read Platform Permission Catalog",
    labelAr: "قراءة كتالوج صلاحيات المنصة",
    description: "View platform permission catalog and effective permission assignments.",
    group: "Platform Users",
    riskLevel: "read",
  },
  "platform.permissions.update": {
    code: "platform.permissions.update",
    label: "Update Platform Permission Overrides",
    labelAr: "تحديث صلاحيات المنصة المخصصة",
    description: "Grant or deny custom platform permission overrides for platform users (root only in P17-B).",
    group: "Platform Users",
    riskLevel: "root_only",
  },
  "platform.accessReview.read": {
    code: "platform.accessReview.read",
    label: "Read Platform Access Review",
    labelAr: "قراءة مراجعة وصول المنصة",
    description: "View platform administration access review summaries, user detail, and audit timelines.",
    group: "Platform Users",
    riskLevel: "read",
  },
  "platform.accessReview.update": {
    code: "platform.accessReview.update",
    label: "Record Platform Access Review",
    labelAr: "تسجيل مراجعة وصول المنصة",
    description: "Record manual access review notes and status for platform users (does not change permissions).",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.invitations.read": {
    code: "platform.invitations.read",
    label: "Read Platform Invitations",
    labelAr: "قراءة دعوات مستخدمي المنصة",
    description: "View platform user invitation and activation status.",
    group: "Platform Users",
    riskLevel: "read",
  },
  "platform.invitations.create": {
    code: "platform.invitations.create",
    label: "Create Platform Invitations",
    labelAr: "إنشاء دعوات مستخدمي المنصة",
    description: "Create or resend platform user activation invitations (no email sent in P17-E).",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.invitations.revoke": {
    code: "platform.invitations.revoke",
    label: "Revoke Platform Invitations",
    labelAr: "إلغاء دعوات مستخدمي المنصة",
    description: "Revoke pending platform user invitations.",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.roles.read": {
    code: "platform.roles.read",
    label: "Read Platform Roles",
    labelAr: "قراءة الأدوار والصلاحيات",
    description: "View the platform role definitions and their permission matrix.",
    group: "Platform Users",
    riskLevel: "read",
  },
  "tenants.read": {
    code: "tenants.read",
    label: "Read Tenants",
    labelAr: "قراءة المستأجرين",
    description: "View tenant profiles, lifecycle status, and workspace metadata.",
    group: "Tenants",
    riskLevel: "read",
  },
  "tenants.lifecycle.update": {
    code: "tenants.lifecycle.update",
    label: "Update Tenant Lifecycle",
    labelAr: "تحديث دورة حياة المستأجر",
    description: "Perform controlled lifecycle transitions (activate, suspend, etc.) on tenants.",
    group: "Tenants",
    riskLevel: "controlled_write",
  },
  "subscriptions.read": {
    code: "subscriptions.read",
    label: "Read Subscriptions",
    labelAr: "قراءة الاشتراكات",
    description: "View subscription metadata, plan, trial, and renewal fields.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "subscriptions.update": {
    code: "subscriptions.update",
    label: "Update Subscriptions",
    labelAr: "تحديث بيانات الاشتراك",
    description: "Update subscription metadata fields (plan, dates, trial, seats).",
    group: "Subscriptions",
    riskLevel: "controlled_write",
  },
  "entitlements.read": {
    code: "entitlements.read",
    label: "Read Entitlements",
    labelAr: "قراءة الصلاحيات والميزات",
    description: "View tenant feature entitlements and active overrides.",
    group: "Entitlements",
    riskLevel: "read",
  },
  "entitlements.override.update": {
    code: "entitlements.override.update",
    label: "Update Entitlement Overrides",
    labelAr: "تحديث استثناءات الصلاحيات",
    description: "Apply or remove feature entitlement overrides for a tenant.",
    group: "Entitlements",
    riskLevel: "controlled_write",
  },
  "usage.read": {
    code: "usage.read",
    label: "Read Usage",
    labelAr: "قراءة الاستخدام",
    description: "View tenant resource usage metrics and capacity warnings.",
    group: "Usage",
    riskLevel: "read",
  },
  "renewal.read": {
    code: "renewal.read",
    label: "Read Renewal Intelligence",
    labelAr: "قراءة التجديد",
    description: "View renewal risk, days-to-expiry, and churn signals for tenants.",
    group: "Renewal",
    riskLevel: "read",
  },
  "health.read": {
    code: "health.read",
    label: "Read Tenant Health",
    labelAr: "قراءة صحة المستأجر",
    description: "View tenant health score, risk signals, and operational status.",
    group: "Health",
    riskLevel: "read",
  },
  "evaluation.read": {
    code: "evaluation.read",
    label: "Read Lifecycle Evaluation",
    labelAr: "قراءة تقييم دورة الحياة",
    description: "View lifecycle evaluation profiles and recommended actions.",
    group: "Evaluation",
    riskLevel: "read",
  },
  "audit.read": {
    code: "audit.read",
    label: "Read Audit Logs",
    labelAr: "قراءة السجلات",
    description: "View platform and tenant audit logs and activity history.",
    group: "Audit",
    riskLevel: "read",
  },
  "platform.activity.read": {
    code: "platform.activity.read",
    label: "Read Platform Activity",
    labelAr: "قراءة نشاط المنصة",
    description: "View recent platform-wide activity, workspace creations, and user registrations.",
    group: "Settings",
    riskLevel: "read",
  },
  "platform.settings.read": {
    code: "platform.settings.read",
    label: "Read Platform Settings",
    labelAr: "قراءة إعدادات المنصة",
    description: "View platform configuration settings (read-only).",
    group: "Settings",
    riskLevel: "read",
  },
  // P15-A - Commercial
  "commercial.accounts.read": {
    code: "commercial.accounts.read",
    label: "Read Commercial Accounts",
    labelAr: "قراءة الحسابات التجارية",
    description: "View commercial account details for tenant workspaces.",
    group: "Commercial",
    riskLevel: "read",
  },
  "commercial.accounts.update": {
    code: "commercial.accounts.update",
    label: "Update Commercial Accounts",
    labelAr: "تحديث الحسابات التجارية",
    description: "Create or update commercial account information for tenant workspaces.",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.contacts.read": {
    code: "commercial.contacts.read",
    label: "Read Billing Contacts",
    labelAr: "قراءة جهات تواصل الفوترة",
    description: "View billing contact information for commercial accounts. Contains sensitive contact data.",
    group: "Commercial",
    riskLevel: "sensitive_write",
  },
  "commercial.contacts.update": {
    code: "commercial.contacts.update",
    label: "Update Billing Contacts",
    labelAr: "تحديث جهات تواصل الفوترة",
    description: "Create or update billing contacts for commercial accounts.",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.contracts.read": {
    code: "commercial.contracts.read",
    label: "Read Commercial Contracts",
    labelAr: "قراءة عقود التجديد التجارية",
    description: "View contract terms and renewal commitment data for tenant workspaces.",
    group: "Commercial",
    riskLevel: "read",
  },
  "commercial.contracts.update": {
    code: "commercial.contracts.update",
    label: "Update Commercial Contracts",
    labelAr: "تحديث عقود التجديد التجارية",
    description: "Create or update contract terms and renewal commitments for tenant workspaces.",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.invoices.read": {
    code: "commercial.invoices.read",
    label: "Read Commercial Invoices",
    labelAr: "قراءة فواتير المستأجر",
    description: "View enterprise invoice records for tenant workspaces.",
    group: "Commercial",
    riskLevel: "read",
  },
  "commercial.invoices.update": {
    code: "commercial.invoices.update",
    label: "Update Commercial Invoices",
    labelAr: "تحديث فواتير المستأجر",
    description: "Create or update invoice records (metadata only; PDF uploaded separately).",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.invoiceDocuments.read": {
    code: "commercial.invoiceDocuments.read",
    label: "Read Invoice PDF Documents",
    labelAr: "قراءة مستندات الفواتير",
    description: "View metadata and download uploaded official invoice PDFs.",
    group: "Commercial",
    riskLevel: "sensitive_write",
  },
  "commercial.invoiceDocuments.upload": {
    code: "commercial.invoiceDocuments.upload",
    label: "Upload Invoice PDF Documents",
    labelAr: "رفع مستندات الفواتير",
    description: "Upload official invoice PDFs from external accounting systems.",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.payments.read": {
    code: "commercial.payments.read",
    label: "Read Manual Payment Records",
    labelAr: "قراءة سجلات الدفع اليدوي",
    description: "View manual off-platform payment records and invoice collection summaries.",
    group: "Commercial",
    riskLevel: "read",
  },
  "commercial.payments.record": {
    code: "commercial.payments.record",
    label: "Record Manual Payments",
    labelAr: "تسجيل دفعات يدوية",
    description: "Record off-platform payments (bank transfer, cheque, cash) against invoices.",
    group: "Commercial",
    riskLevel: "controlled_write",
  },
  "commercial.payments.verify": {
    code: "commercial.payments.verify",
    label: "Verify Manual Payments",
    labelAr: "التحقق من الدفعات اليدوية",
    description: "Verify, reject, or reverse manual payment records.",
    group: "Commercial",
    riskLevel: "sensitive_write",
  },
  "commercial.risk.read": {
    code: "commercial.risk.read",
    label: "Read Commercial Risk & Renewal Readiness",
    labelAr: "قراءة المخاطر التجارية وجاهزية التجديد",
    description: "View computed commercial risk and renewal readiness intelligence.",
    group: "Commercial",
    riskLevel: "read",
  },
  "platform.subscriptions.read": {
    code: "platform.subscriptions.read",
    label: "Read Workspace Subscription State",
    labelAr: "قراءة حالة اشتراك مساحة العمل",
    description: "View the workspace subscription state model linked to commercial contracts.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "platform.subscriptions.update": {
    code: "platform.subscriptions.update",
    label: "Update Workspace Subscription State",
    labelAr: "تحديث حالة اشتراك مساحة العمل",
    description: "Create or update workspace subscription metadata (non-status fields).",
    group: "Subscriptions",
    riskLevel: "controlled_write",
  },
  "platform.subscriptions.status.change": {
    code: "platform.subscriptions.status.change",
    label: "Change Workspace Subscription Status",
    labelAr: "تغيير حالة اشتراك مساحة العمل",
    description: "Transition workspace subscription status with audit reason (no enforcement).",
    group: "Subscriptions",
    riskLevel: "sensitive_write",
  },
  "platform.entitlements.read": {
    code: "platform.entitlements.read",
    label: "Read Workspace Entitlements",
    labelAr: "قراءة استحقاقات مساحة العمل",
    description: "View workspace module and feature entitlement catalog and records.",
    group: "Entitlements",
    riskLevel: "read",
  },
  "platform.entitlements.update": {
    code: "platform.entitlements.update",
    label: "Update Workspace Entitlements",
    labelAr: "تحديث استحقاقات مساحة العمل",
    description: "Bulk upsert or patch workspace entitlements (no broad enforcement).",
    group: "Entitlements",
    riskLevel: "controlled_write",
  },
  "platform.quotas.read": {
    code: "platform.quotas.read",
    label: "Read Workspace Quotas",
    labelAr: "قراءة حدود الاستخدام",
    description: "View workspace quota catalog, limits, and usage indicators.",
    group: "Usage",
    riskLevel: "read",
  },
  "platform.quotas.update": {
    code: "platform.quotas.update",
    label: "Update Workspace Quotas",
    labelAr: "تحديث حدود الاستخدام",
    description: "Bulk upsert or patch workspace quota limits (no hard enforcement).",
    group: "Usage",
    riskLevel: "controlled_write",
  },
  "platform.subscriptionPolicies.read": {
    code: "platform.subscriptionPolicies.read",
    label: "Read Subscription Policies",
    labelAr: "قراءة سياسات الاشتراك",
    description: "View grace period and suspension policy configuration per workspace.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "platform.subscriptionPolicies.update": {
    code: "platform.subscriptionPolicies.update",
    label: "Update Subscription Policies",
    labelAr: "تحديث سياسات الاشتراك",
    description: "Upsert grace period and suspension policy (advisory only, no enforcement).",
    group: "Subscriptions",
    riskLevel: "controlled_write",
  },
  "platform.subscriptionPolicies.evaluate": {
    code: "platform.subscriptionPolicies.evaluate",
    label: "Evaluate Subscription Policies",
    labelAr: "تقييم سياسات الاشتراك",
    description: "Run read-only policy evaluation and status recommendations.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "platform.workspaceAccess.read": {
    code: "platform.workspaceAccess.read",
    label: "Read Workspace Access Mode",
    labelAr: "قراءة وضع وصول مساحة العمل",
    description: "View workspace read-only enforcement status and access flags.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "platform.workspaceAccess.update": {
    code: "platform.workspaceAccess.update",
    label: "Update Workspace Access Mode",
    labelAr: "تحديث وضع وصول مساحة العمل",
    description: "Manually apply read-only or view-only workspace access (no login block).",
    group: "Subscriptions",
    riskLevel: "controlled_write",
  },
  "platform.workspaceAccess.evaluate": {
    code: "platform.workspaceAccess.evaluate",
    label: "Evaluate Workspace Access",
    labelAr: "تقييم وصول مساحة العمل",
    description: "Run commercial-to-workspace access enforcement recommendations.",
    group: "Subscriptions",
    riskLevel: "read",
  },
  "platform.governance.ops.read": {
    code: "platform.governance.ops.read",
    label: "Read Platform Governance Operations",
    labelAr: "قراءة عمليات حوكمة المنصة",
    description: "View platform operations center aggregates, lifecycle events, and governance audit excerpts.",
    group: "Audit",
    riskLevel: "read",
  },
  "platform.modules.govern": {
    code: "platform.modules.govern",
    label: "Govern Workspace Modules",
    labelAr: "حوكمة وحدات مساحة العمل",
    description: "Enable or disable non-core workspace modules with dependency validation.",
    group: "Tenants",
    riskLevel: "controlled_write",
  },
  "platform.support.session.start": {
    code: "platform.support.session.start",
    label: "Start Scoped Support Session",
    labelAr: "بدء جلسة دعم محدودة النطاق",
    description: "Begin a time-bound, scope-limited support impersonation session with audit trail.",
    group: "Platform Users",
    riskLevel: "sensitive_write",
  },
  "platform.support.session.end": {
    code: "platform.support.session.end",
    label: "End Support Session",
    labelAr: "إنهاء جلسة الدعم",
    description: "Terminate an active support impersonation session.",
    group: "Platform Users",
    riskLevel: "controlled_write",
  },
};

// ── Role Codes ────────────────────────────────────────────────────────────────

export type PlatformRoleCode =
  | "root_platform_owner"
  | "platform_admin"
  | "support_admin"
  | "workspace_support"
  | "sales_admin"
  | "finance_admin"
  | "auditor"
  | "read_only_operator";

// ── Role Permission Matrix ────────────────────────────────────────────────────

const ALL_PERMISSIONS = new Set<PlatformPermissionCode>(PLATFORM_PERMISSION_CODES);

/** P17-B/P17-D/P17-E: platform_admin gets all except root-only capabilities */
const PLATFORM_ADMIN_PERMISSIONS = new Set<PlatformPermissionCode>(
  PLATFORM_PERMISSION_CODES.filter(
    (c) =>
      c !== "platform.permissions.update" &&
      c !== "platform.accessReview.update",
  ),
);

const CATALOG_READ_PERMISSION: PlatformPermissionCode = "platform.permissions.read";

const SUPPORT_ADMIN_PERMISSIONS = new Set<PlatformPermissionCode>([
  CATALOG_READ_PERMISSION,
  "tenants.read",
  "usage.read",
  "renewal.read",
  "health.read",
  "evaluation.read",
  "platform.activity.read",
  "platform.roles.read",
  "platform.subscriptions.read",
  "platform.entitlements.read",
  "platform.quotas.read",
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.evaluate",
  "platform.workspaceAccess.read",
  "platform.workspaceAccess.evaluate",
  "commercial.accounts.read",
  "commercial.contracts.read",
  "commercial.invoices.read",
  "commercial.payments.read",
  "commercial.risk.read",
  "platform.governance.ops.read",
  "platform.support.session.start",
  "platform.support.session.end",
]);

const WORKSPACE_SUPPORT_PERMISSIONS = new Set<PlatformPermissionCode>([
  "tenants.read",
  "usage.read",
  "health.read",
  "evaluation.read",
  "platform.roles.read",
]);

const SALES_ADMIN_PERMISSIONS = new Set<PlatformPermissionCode>([
  CATALOG_READ_PERMISSION,
  "tenants.read",
  "subscriptions.read",
  "platform.subscriptions.read",
  "platform.entitlements.read",
  "platform.quotas.read",
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.evaluate",
  "platform.workspaceAccess.read",
  "platform.workspaceAccess.evaluate",
  "renewal.read",
  "health.read",
  "platform.roles.read",
  "commercial.accounts.read",
  "commercial.accounts.update",
  "commercial.contacts.read",
  "commercial.contacts.update",
  "commercial.contracts.read",
  "commercial.contracts.update",
  "commercial.invoices.read",
  "commercial.invoiceDocuments.read",
  "commercial.payments.read",
  "commercial.risk.read",
]);

const FINANCE_ADMIN_PERMISSIONS = new Set<PlatformPermissionCode>([
  CATALOG_READ_PERMISSION,
  "tenants.read",
  "subscriptions.read",
  "platform.subscriptions.read",
  "platform.subscriptions.update",
  "platform.subscriptions.status.change",
  "platform.entitlements.read",
  "platform.entitlements.update",
  "platform.quotas.read",
  "platform.quotas.update",
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.update",
  "platform.subscriptionPolicies.evaluate",
  "platform.workspaceAccess.read",
  "platform.workspaceAccess.evaluate",
  "renewal.read",
  "audit.read",
  "platform.roles.read",
  "commercial.accounts.read",
  "commercial.accounts.update",
  "commercial.contacts.read",
  "commercial.contacts.update",
  "commercial.contracts.read",
  "commercial.contracts.update",
  "commercial.invoices.read",
  "commercial.invoices.update",
  "commercial.invoiceDocuments.read",
  "commercial.invoiceDocuments.upload",
  "commercial.payments.read",
  "commercial.payments.record",
  "commercial.payments.verify",
  "commercial.risk.read",
]);

const ACCESS_REVIEW_READ: PlatformPermissionCode = "platform.accessReview.read";
const INVITATIONS_READ: PlatformPermissionCode = "platform.invitations.read";

const AUDITOR_PERMISSIONS = new Set<PlatformPermissionCode>([
  CATALOG_READ_PERMISSION,
  ACCESS_REVIEW_READ,
  INVITATIONS_READ,
  "tenants.read",
  "subscriptions.read",
  "platform.subscriptions.read",
  "platform.entitlements.read",
  "platform.quotas.read",
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.evaluate",
  "platform.workspaceAccess.read",
  "entitlements.read",
  "usage.read",
  "renewal.read",
  "health.read",
  "evaluation.read",
  "audit.read",
  "platform.activity.read",
  "platform.roles.read",
  "commercial.accounts.read",
  "commercial.contacts.read",
  "commercial.contracts.read",
  "commercial.invoices.read",
  "commercial.invoiceDocuments.read",
  "commercial.payments.read",
  "commercial.risk.read",
  "platform.governance.ops.read",
]);

const READ_ONLY_OPERATOR_PERMISSIONS = new Set<PlatformPermissionCode>([
  CATALOG_READ_PERMISSION,
  ACCESS_REVIEW_READ,
  INVITATIONS_READ,
  "tenants.read",
  "usage.read",
  "renewal.read",
  "health.read",
  "evaluation.read",
  "platform.roles.read",
  "platform.entitlements.read",
  "platform.quotas.read",
  "platform.subscriptionPolicies.read",
  "platform.subscriptionPolicies.evaluate",
  "platform.workspaceAccess.read",
  "commercial.accounts.read",
  "commercial.contracts.read",
  "commercial.invoices.read",
  "commercial.payments.read",
  "commercial.risk.read",
  "platform.governance.ops.read",
]);

export const PLATFORM_ROLE_PERMISSION_MATRIX: Record<PlatformRoleCode, ReadonlySet<PlatformPermissionCode>> = {
  root_platform_owner: ALL_PERMISSIONS,
  platform_admin: PLATFORM_ADMIN_PERMISSIONS,
  support_admin: SUPPORT_ADMIN_PERMISSIONS,
  workspace_support: WORKSPACE_SUPPORT_PERMISSIONS,
  sales_admin: SALES_ADMIN_PERMISSIONS,
  finance_admin: FINANCE_ADMIN_PERMISSIONS,
  auditor: AUDITOR_PERMISSIONS,
  read_only_operator: READ_ONLY_OPERATOR_PERMISSIONS,
};

// ── User Identity for Permission Checks ──────────────────────────────────────

export interface PlatformUserPermissionIdentity {
  id?: number;
  role: string;
  platformRoleCode?: string | null;
  isRootOwner?: boolean;
}

// ── Role Code Resolution ──────────────────────────────────────────────────────

/**
 * Resolves the effective platform role code for a user.
 *
 * Resolution order:
 *   1. isRootOwner === true → root_platform_owner (explicit flag)
 *   2. role === "super_admin" AND platformRoleCode IS NULL → root_platform_owner (legacy compat)
 *   3. platformRoleCode matches known role → returns that role
 *   4. Otherwise → null (not a platform user or unknown role)
 */
export function getPlatformUserRoleCode(user: PlatformUserPermissionIdentity): PlatformRoleCode | null {
  if (user.role !== "super_admin") return null;
  if (user.isRootOwner === true) return "root_platform_owner";
  if (user.platformRoleCode == null) return "root_platform_owner";
  if (user.platformRoleCode in PLATFORM_ROLE_PERMISSION_MATRIX) {
    return user.platformRoleCode as PlatformRoleCode;
  }
  return null;
}

// ── Permission Query Functions ────────────────────────────────────────────────

export function getPlatformPermissionsForRole(
  roleCode: PlatformRoleCode | null,
): ReadonlySet<PlatformPermissionCode> {
  if (!roleCode) return new Set();
  return PLATFORM_ROLE_PERMISSION_MATRIX[roleCode] ?? new Set();
}

export function hasPlatformPermission(
  user: PlatformUserPermissionIdentity,
  permissionCode: PlatformPermissionCode,
): boolean {
  const roleCode = getPlatformUserRoleCode(user);
  const permissions = getPlatformPermissionsForRole(roleCode);
  return permissions.has(permissionCode);
}

export function hasAnyPlatformPermission(
  user: PlatformUserPermissionIdentity,
  permissionCodes: readonly PlatformPermissionCode[],
): boolean {
  const roleCode = getPlatformUserRoleCode(user);
  const permissions = getPlatformPermissionsForRole(roleCode);
  return permissionCodes.some(code => permissions.has(code));
}

export function hasAllPlatformPermissions(
  user: PlatformUserPermissionIdentity,
  permissionCodes: readonly PlatformPermissionCode[],
): boolean {
  const roleCode = getPlatformUserRoleCode(user);
  const permissions = getPlatformPermissionsForRole(roleCode);
  return permissionCodes.every(code => permissions.has(code));
}

/**
 * Returns null if permission is granted, or the denied permissionCode if not.
 * Does not throw - callers decide how to handle the denial.
 */
export function assertPlatformPermission(
  user: PlatformUserPermissionIdentity,
  permissionCode: PlatformPermissionCode,
): PlatformPermissionCode | null {
  return hasPlatformPermission(user, permissionCode) ? null : permissionCode;
}

/**
 * In P14-B, no permissions are root-only (platform_admin gets all permissions).
 * Reserved for P14-C+ where certain administrative recovery actions may be root-only.
 */
export function isRootOnlyPermission(permissionCode: PlatformPermissionCode): boolean {
  return permissionCode === "platform.permissions.update";
}

export function isAssignablePlatformRoleCode(
  code: string,
): code is Exclude<PlatformRoleCode, "root_platform_owner"> {
  return code !== "root_platform_owner" && code in PLATFORM_ROLE_PERMISSION_MATRIX;
}

// ── Audit Event Builder ───────────────────────────────────────────────────────

export interface PermissionDeniedAuditEvent {
  readonly event: "platform_permission_denied";
  readonly actorId: number | undefined;
  readonly permissionCode: PlatformPermissionCode;
  readonly resource: string;
  readonly effectiveRoleCode: PlatformRoleCode | null;
  readonly action: "permission_check";
  readonly result: "denied";
}

export function buildPermissionDeniedAuditEvent(
  actor: PlatformUserPermissionIdentity,
  permissionCode: PlatformPermissionCode,
  resource: string,
): PermissionDeniedAuditEvent {
  return {
    event: "platform_permission_denied",
    actorId: actor.id,
    permissionCode,
    resource,
    effectiveRoleCode: getPlatformUserRoleCode(actor),
    action: "permission_check",
    result: "denied",
  };
}
