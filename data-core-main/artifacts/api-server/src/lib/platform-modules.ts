/**
 * @file   lib/platform-modules.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Static registry of all platform modules. Pure config - no implementation,
 * no HTTP, no DB.
 *
 * SAFETY CONTRACT:
 *   - This file is a REGISTRY ONLY - it does not implement any module.
 *   - No HR execution, payroll processing, recruitment logic, or LMS content.
 *   - No billing, payment, invoice, or tax logic.
 *   - governance_console entitlement is future-facing tenant governance access.
 *     It does NOT expose the Super Admin Governance Console to tenant users.
 *   - All maps declared as "as const" - TypeScript-enforced immutability.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module Code Type
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformModuleCode =
  | "hr_core"
  | "employee_records"
  | "organization_structure"
  | "attendance"
  | "leave_management"
  | "payroll"
  | "recruitment"
  | "onboarding"
  | "performance"
  | "lms"
  | "documents"
  | "workflows"
  | "analytics"
  | "advanced_analytics"
  | "integrations"
  | "ai_automation"
  | "governance_console"
  | "audit_logs"
  | "self_service"
  | "manager_portal";

// ─────────────────────────────────────────────────────────────────────────────
// Module Category
// ─────────────────────────────────────────────────────────────────────────────

export type ModuleCategory =
  | "core_hr"
  | "talent"
  | "operations"
  | "learning"
  | "intelligence"
  | "integration"
  | "platform"
  | "portal";

// ─────────────────────────────────────────────────────────────────────────────
// Module Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformModuleDef {
  code:               PlatformModuleCode;
  label:              string;
  description:        string;
  category:           ModuleCategory;
  order:              number;
  isCore:             boolean;
  requiresHigherPlan: boolean;
  safetyNotes?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Registry
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_MODULE_REGISTRY: Record<PlatformModuleCode, PlatformModuleDef> = {
  hr_core: {
    code:               "hr_core",
    label:              "HR Core",
    description:        "Foundation HR functionality: employee lifecycle, position management, and core records.",
    category:           "core_hr",
    order:              0,
    isCore:             true,
    requiresHigherPlan: false,
  },
  employee_records: {
    code:               "employee_records",
    label:              "Employee Records",
    description:        "Structured employee profile data: personal info, contracts, and document management.",
    category:           "core_hr",
    order:              1,
    isCore:             false,
    requiresHigherPlan: false,
  },
  organization_structure: {
    code:               "organization_structure",
    label:              "Organisation Structure",
    description:        "Department hierarchy, reporting lines, and cost centre management.",
    category:           "core_hr",
    order:              2,
    isCore:             false,
    requiresHigherPlan: false,
  },
  attendance: {
    code:               "attendance",
    label:              "Attendance",
    description:        "Clock-in/out tracking, shift scheduling, and attendance reports.",
    category:           "core_hr",
    order:              3,
    isCore:             false,
    requiresHigherPlan: false,
  },
  leave_management: {
    code:               "leave_management",
    label:              "Leave Management",
    description:        "Leave requests, approval workflows, balances, and policy configuration.",
    category:           "core_hr",
    order:              4,
    isCore:             false,
    requiresHigherPlan: false,
  },
  payroll: {
    code:               "payroll",
    label:              "Payroll",
    description:        "Payroll processing, deductions, and payslip generation.",
    category:           "operations",
    order:              5,
    isCore:             false,
    requiresHigherPlan: true,
    safetyNotes:        "Entitlement only - no payroll calculation runs here.",
  },
  recruitment: {
    code:               "recruitment",
    label:              "Recruitment",
    description:        "Job postings, applicant tracking, and hiring pipeline management.",
    category:           "talent",
    order:              6,
    isCore:             false,
    requiresHigherPlan: true,
  },
  onboarding: {
    code:               "onboarding",
    label:              "Onboarding",
    description:        "Structured onboarding checklists, task assignment, and new-hire welcome flows.",
    category:           "talent",
    order:              7,
    isCore:             false,
    requiresHigherPlan: false,
  },
  performance: {
    code:               "performance",
    label:              "Performance",
    description:        "Goal setting, review cycles, and performance assessments.",
    category:           "talent",
    order:              8,
    isCore:             false,
    requiresHigherPlan: true,
  },
  lms: {
    code:               "lms",
    label:              "Learning Management (LMS)",
    description:        "Course catalogue, learner progress, and training completion tracking.",
    category:           "learning",
    order:              9,
    isCore:             false,
    requiresHigherPlan: true,
  },
  documents: {
    code:               "documents",
    label:              "Documents",
    description:        "Document storage, versioning, and organisation-wide document library.",
    category:           "operations",
    order:              10,
    isCore:             false,
    requiresHigherPlan: false,
  },
  workflows: {
    code:               "workflows",
    label:              "Workflows",
    description:        "Configurable approval and process automation workflows.",
    category:           "operations",
    order:              11,
    isCore:             false,
    requiresHigherPlan: false,
  },
  analytics: {
    code:               "analytics",
    label:              "Analytics",
    description:        "Standard dashboards and reporting across HR, attendance, and tickets.",
    category:           "intelligence",
    order:              12,
    isCore:             false,
    requiresHigherPlan: false,
  },
  advanced_analytics: {
    code:               "advanced_analytics",
    label:              "Advanced Analytics",
    description:        "Custom reports, data exports, and cross-workspace trend analysis.",
    category:           "intelligence",
    order:              13,
    isCore:             false,
    requiresHigherPlan: true,
  },
  integrations: {
    code:               "integrations",
    label:              "Integrations",
    description:        "Third-party system connectors and API integration management.",
    category:           "integration",
    order:              14,
    isCore:             false,
    requiresHigherPlan: true,
  },
  ai_automation: {
    code:               "ai_automation",
    label:              "AI & Automation",
    description:        "AI-assisted workflows, smart suggestions, and automation rules.",
    category:           "intelligence",
    order:              15,
    isCore:             false,
    requiresHigherPlan: true,
    safetyNotes:        "Entitlement only - no AI execution logic in this module registry.",
  },
  governance_console: {
    code:               "governance_console",
    label:              "Governance Console",
    description:        "Future tenant-scoped governance and compliance features. Does NOT expose the Super Admin console.",
    category:           "platform",
    order:              16,
    isCore:             false,
    requiresHigherPlan: true,
    safetyNotes:        "This entitlement is for future tenant governance features only. The platform Super Admin Governance Console is always separate.",
  },
  audit_logs: {
    code:               "audit_logs",
    label:              "Audit Logs",
    description:        "Workspace-scoped audit event history and tamper-evident log access.",
    category:           "platform",
    order:              17,
    isCore:             false,
    requiresHigherPlan: true,
  },
  self_service: {
    code:               "self_service",
    label:              "Employee Self-Service",
    description:        "Self-service portal for employees to manage their own profiles, leave, and requests.",
    category:           "portal",
    order:              18,
    isCore:             false,
    requiresHigherPlan: false,
  },
  manager_portal: {
    code:               "manager_portal",
    label:              "Manager Portal",
    description:        "Dedicated portal for managers: team overview, approvals, and performance dashboards.",
    category:           "portal",
    order:              19,
    isCore:             false,
    requiresHigherPlan: true,
  },
} as const;

export const ALL_MODULE_CODES: PlatformModuleCode[] = [
  "hr_core", "employee_records", "organization_structure", "attendance",
  "leave_management", "payroll", "recruitment", "onboarding", "performance",
  "lms", "documents", "workflows", "analytics", "advanced_analytics",
  "integrations", "ai_automation", "governance_console", "audit_logs",
  "self_service", "manager_portal",
];

/** Returns true if the module code is a known platform module. */
export function isKnownModuleCode(code: string): code is PlatformModuleCode {
  return ALL_MODULE_CODES.includes(code as PlatformModuleCode);
}
