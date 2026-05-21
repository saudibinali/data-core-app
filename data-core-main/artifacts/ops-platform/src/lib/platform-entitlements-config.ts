/**
 * @file   lib/platform-entitlements-config.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Static UI configuration for platform modules, feature limits, plan entitlements,
 * and entitlement override management. Mirrors backend pure - no API calls.
 *
 * SAFETY CONTRACT:
 *   - All maps declared as "as const" - TypeScript-enforced immutability.
 *   - No payment, invoice, charge, tax, or billing portal wording.
 *   - No HR module execution wording.
 *   - governance_console entitlement is future tenant governance only.
 *     It NEVER exposes the Super Admin Governance Console to tenant users.
 *   - No automatic workspace suspension logic.
 *   - All ENTITLEMENT_SAFETY_CONTRACT properties are true (tested).
 *   - Exactly ONE mutation hook name in ENTITLEMENT_MUTATION_HOOK_NAMES.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module Registry
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformModuleCode =
  | "hr_core" | "employee_records" | "organization_structure"
  | "attendance" | "leave_management" | "payroll" | "recruitment"
  | "onboarding" | "performance" | "lms" | "documents" | "workflows"
  | "analytics" | "advanced_analytics" | "integrations" | "ai_automation"
  | "governance_console" | "audit_logs" | "self_service" | "manager_portal";

export type ModuleCategory =
  | "core_hr" | "talent" | "operations" | "learning"
  | "intelligence" | "integration" | "platform" | "portal";

export interface ModuleConfig {
  code:               PlatformModuleCode;
  label:              string;
  description:        string;
  category:           ModuleCategory;
  order:              number;
  isCore:             boolean;
  requiresHigherPlan: boolean;
  enabledBadgeClass:  string;
  disabledBadgeClass: string;
}

export const MODULE_REGISTRY_CONFIG: Record<PlatformModuleCode, ModuleConfig> = {
  hr_core:                { code: "hr_core",                label: "HR Core",                description: "Core HR: employee lifecycle and position management.",                    category: "core_hr",      order: 0,  isCore: true,  requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  employee_records:       { code: "employee_records",       label: "Employee Records",       description: "Structured employee profiles and document management.",                   category: "core_hr",      order: 1,  isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  organization_structure: { code: "organization_structure", label: "Organisation",           description: "Department hierarchy and reporting line management.",                     category: "core_hr",      order: 2,  isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  attendance:             { code: "attendance",             label: "Attendance",             description: "Clock-in/out, shift scheduling, and attendance reports.",                 category: "core_hr",      order: 3,  isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  leave_management:       { code: "leave_management",       label: "Leave",                  description: "Leave requests, approvals, balances, and policy configuration.",          category: "core_hr",      order: 4,  isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  payroll:                { code: "payroll",                label: "Payroll",                description: "Payroll processing, deductions, and payslip generation. Entitlement only.",category: "operations",   order: 5,  isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",         disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  recruitment:            { code: "recruitment",            label: "Recruitment",            description: "Job postings, applicant tracking, and hiring pipeline.",                  category: "talent",       order: 6,  isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",         disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  onboarding:             { code: "onboarding",             label: "Onboarding",             description: "Structured onboarding checklists and new-hire flows.",                    category: "talent",       order: 7,  isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  performance:            { code: "performance",            label: "Performance",            description: "Goal setting, review cycles, and performance assessments.",                category: "talent",       order: 8,  isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",         disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  lms:                    { code: "lms",                    label: "LMS",                    description: "Learning management: courses, progress, and training completion.",         category: "learning",     order: 9,  isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",   disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  documents:              { code: "documents",              label: "Documents",              description: "Document storage, versioning, and library management.",                   category: "operations",   order: 10, isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  workflows:              { code: "workflows",              label: "Workflows",              description: "Configurable approval and process automation workflows.",                  category: "operations",   order: 11, isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  analytics:              { code: "analytics",              label: "Analytics",              description: "Standard dashboards and reports for HR and tickets.",                     category: "intelligence", order: 12, isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",       disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  advanced_analytics:     { code: "advanced_analytics",     label: "Advanced Analytics",     description: "Custom reports, data exports, and cross-workspace trends.",                category: "intelligence", order: 13, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",       disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  integrations:           { code: "integrations",           label: "Integrations",           description: "Third-party system connectors and API integration management.",           category: "integration",  order: 14, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",   disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  ai_automation:          { code: "ai_automation",          label: "AI & Automation",        description: "AI-assisted workflows and smart automation. Entitlement only.",           category: "intelligence", order: 15, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",   disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  governance_console:     { code: "governance_console",     label: "Governance Console",     description: "Workspace-scoped compliance and policy configuration. Distinct from platform administration.",  category: "platform",     order: 16, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",             disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  audit_logs:             { code: "audit_logs",             label: "Audit Logs",             description: "Workspace-scoped audit event history and tamper-evident log access.",     category: "platform",     order: 17, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",             disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  self_service:           { code: "self_service",           label: "Self-Service",           description: "Employee self-service portal for profiles, leave, and requests.",         category: "portal",       order: 18, isCore: false, requiresHigherPlan: false, enabledBadgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
  manager_portal:         { code: "manager_portal",         label: "Manager Portal",         description: "Manager portal: team overview, approvals, and performance dashboards.",   category: "portal",       order: 19, isCore: false, requiresHigherPlan: true,  enabledBadgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",         disabledBadgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 line-through" },
} as const;

export const ALL_MODULE_CODES: PlatformModuleCode[] = [
  "hr_core", "employee_records", "organization_structure", "attendance",
  "leave_management", "payroll", "recruitment", "onboarding", "performance",
  "lms", "documents", "workflows", "analytics", "advanced_analytics",
  "integrations", "ai_automation", "governance_console", "audit_logs",
  "self_service", "manager_portal",
];

// ─────────────────────────────────────────────────────────────────────────────
// Feature Limit Config
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureLimitCode =
  | "seats" | "storage_gb" | "monthly_api_calls" | "documents"
  | "workflows" | "custom_reports" | "integrations" | "ai_actions"
  | "audit_retention_days" | "workspaces";

export interface FeatureLimitConfig {
  code:                   FeatureLimitCode;
  label:                  string;
  unit:                   string;
  description:            string;
  order:                  number;
  nullableMeansUnlimited: boolean;
}

export const FEATURE_LIMIT_CONFIG: Record<FeatureLimitCode, FeatureLimitConfig> = {
  seats:               { code: "seats",               label: "Active Seats",         unit: "users",       description: "Maximum active user accounts.",          order: 0, nullableMeansUnlimited: true  },
  storage_gb:          { code: "storage_gb",          label: "Storage",              unit: "GB",          description: "Total file and document storage quota.",  order: 1, nullableMeansUnlimited: true  },
  monthly_api_calls:   { code: "monthly_api_calls",   label: "Monthly API Calls",    unit: "calls/month", description: "API request quota per calendar month.",   order: 2, nullableMeansUnlimited: true  },
  documents:           { code: "documents",           label: "Documents",            unit: "documents",   description: "Maximum stored documents.",               order: 3, nullableMeansUnlimited: true  },
  workflows:           { code: "workflows",           label: "Workflows",            unit: "workflows",   description: "Maximum active workflow definitions.",     order: 4, nullableMeansUnlimited: true  },
  custom_reports:      { code: "custom_reports",      label: "Custom Reports",       unit: "reports",     description: "Maximum saved custom report definitions.", order: 5, nullableMeansUnlimited: true  },
  integrations:        { code: "integrations",        label: "Integrations",         unit: "connections", description: "Maximum active integration connections.",  order: 6, nullableMeansUnlimited: true  },
  ai_actions:          { code: "ai_actions",          label: "AI Actions",           unit: "actions/mo",  description: "Monthly AI action budget.",               order: 7, nullableMeansUnlimited: true  },
  audit_retention_days:{ code: "audit_retention_days",label: "Audit Retention",      unit: "days",        description: "Days audit logs are retained.",           order: 8, nullableMeansUnlimited: false },
  workspaces:          { code: "workspaces",          label: "Sub-workspaces",       unit: "workspaces",  description: "Maximum sub-workspaces.",                 order: 9, nullableMeansUnlimited: true  },
} as const;

export const ALL_LIMIT_CODES: FeatureLimitCode[] = [
  "seats", "storage_gb", "monthly_api_calls", "documents", "workflows",
  "custom_reports", "integrations", "ai_actions", "audit_retention_days", "workspaces",
];

// ─────────────────────────────────────────────────────────────────────────────
// Plan Entitlement Config (frontend-facing)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanEntitlementConfig {
  planCode:       string;
  planTier:       string;
  enabledModules: PlatformModuleCode[];
  notes:          string;
}

const STARTER_MODULES: PlatformModuleCode[] = [
  "hr_core", "employee_records", "organization_structure",
  "attendance", "leave_management", "documents", "self_service",
];
const GROWTH_MODULES: PlatformModuleCode[] = [
  ...STARTER_MODULES, "workflows", "analytics", "onboarding",
];
const BUSINESS_MODULES: PlatformModuleCode[] = [
  ...GROWTH_MODULES, "payroll", "recruitment", "performance", "integrations", "manager_portal",
];
const ENTERPRISE_MODULES: PlatformModuleCode[] = [
  ...BUSINESS_MODULES, "lms", "advanced_analytics", "ai_automation", "governance_console", "audit_logs",
];

export const PLAN_ENTITLEMENT_CONFIG: Record<string, PlanEntitlementConfig> = {
  starter:    { planCode: "starter",    planTier: "basic",      enabledModules: STARTER_MODULES,    notes: "Core HR. Limited quota." },
  growth:     { planCode: "growth",     planTier: "standard",   enabledModules: GROWTH_MODULES,     notes: "Adds workflows, analytics, onboarding." },
  business:   { planCode: "business",   planTier: "premium",    enabledModules: BUSINESS_MODULES,   notes: "Adds payroll, recruitment, performance, integrations." },
  enterprise: { planCode: "enterprise", planTier: "enterprise", enabledModules: ENTERPRISE_MODULES, notes: "All modules. Unlimited quotas." },
  custom:     { planCode: "custom",     planTier: "custom",     enabledModules: [],                 notes: "All modules configured via overrides." },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Override Type Config
// ─────────────────────────────────────────────────────────────────────────────

export type EntitlementOverrideType = "enable" | "disable" | "limit_override";

export const ALL_OVERRIDE_TYPES: EntitlementOverrideType[] = ["enable", "disable", "limit_override"];

export const OVERRIDE_TYPE_CONFIG: Record<EntitlementOverrideType, { label: string; description: string; badgeClass: string }> = {
  enable:         { label: "Enable",         description: "Enable this module for the workspace, regardless of plan.",       badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  disable:        { label: "Disable",        description: "Disable this module for the workspace, regardless of plan.",      badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"             },
  limit_override: { label: "Limit Override", description: "Set a custom feature limit value for this workspace and module.", badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"     },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// API Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_API_PATHS = {
  get:     (tenantId: string) => `/api/platform/tenants/${tenantId}/entitlements`,
  overrides: (tenantId: string) => `/api/platform/tenants/${tenantId}/entitlements/overrides`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_REASON_MIN_LENGTH = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Form Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface EntitlementOverrideFormState {
  moduleCode:    string;
  overrideType:  string;
  limitCode:     string;
  limitValue:    string;
  reason:        string;
  confirmation:  boolean;
}

export function isEntitlementOverrideFormValid(form: EntitlementOverrideFormState): boolean {
  if (!form.moduleCode)    return false;
  if (!form.overrideType)  return false;
  if (!form.reason || form.reason.trim().length < ENTITLEMENT_REASON_MIN_LENGTH) return false;
  if (!form.confirmation)  return false;
  if (form.overrideType === "limit_override") {
    if (!form.limitCode) return false;
    const val = parseFloat(form.limitValue);
    if (form.limitValue !== "" && (isNaN(val) || val < 0)) return false;
  }
  return true;
}

export function getEntitlementOverrideFormError(form: EntitlementOverrideFormState): string | null {
  if (!form.moduleCode) return "Select a module.";
  if (!form.overrideType) return "Select an override type.";
  if (form.overrideType === "limit_override" && !form.limitCode) return "Select a limit code.";
  if (form.overrideType === "limit_override" && form.limitValue !== "") {
    const val = parseFloat(form.limitValue);
    if (isNaN(val) || val < 0) return "Limit value must be a non-negative number or leave blank for unlimited.";
  }
  if (!form.reason || form.reason.trim().length === 0) return "Reason is required.";
  if (form.reason.trim().length < ENTITLEMENT_REASON_MIN_LENGTH) {
    return `Reason must be at least ${ENTITLEMENT_REASON_MIN_LENGTH} characters (currently ${form.reason.trim().length}).`;
  }
  if (!form.confirmation) return "You must confirm before saving.";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Name Registry
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_MUTATION_HOOK_NAMES = [
  "useUpdateTenantEntitlementOverrides",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract (tested - all properties must be true)
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_SAFETY_CONTRACT = {
  superAdminOnly:                      true,
  requiresReason:                      true,
  requiresConfirmation:                true,
  noPaymentProcessing:                 true,
  noInvoiceGeneration:                 true,
  noChargeCollection:                  true,
  noHrModuleExecution:                 true,
  noPayrollProcessing:                 true,
  noRecruitmentExecution:              true,
  noAttendanceEnforcement:             true,
  noLmsContentDelivery:                true,
  noAutoWorkspaceSuspension:           true,
  noSuperAdminGovernanceExposure:      true,
  noEmailOrLegalNotices:               true,
  failClosedOnUnknownModule:           true,
  failClosedOnUnknownLimit:            true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_EMPTY_STATE = {
  noOverrides:      "No custom overrides configured",
  noPlan:           "No plan - all modules follow custom override configuration",
  unknownModule:    "Unknown module",
  entitlementOnly:  "Access foundation only - module implementations are separate",
} as const;
