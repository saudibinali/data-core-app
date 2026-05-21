/**
 * @file   workspace-entitlement-catalog.ts
 * @phase  P16-B - Entitlement & Feature Access Model
 *
 * Static catalog of modules and features. No payment linkage.
 * core module cannot be disabled.
 */

export const CORE_MODULE_KEY = "core" as const;

export const ENTITLEMENT_MODULE_KEYS = [
  "core",
  "hr",
  "recruitment",
  "onboarding",
  "attendance",
  "leave",
  "payroll",
  "performance",
  "lms",
  "succession",
  "workflows",
  "notifications",
  "documents",
  "analytics",
  "integrations",
  "ai_automation",
  "communication",
  "admin_console",
] as const;

export type EntitlementModuleKey = (typeof ENTITLEMENT_MODULE_KEYS)[number];

export interface EntitlementModuleDef {
  readonly key: EntitlementModuleKey;
  readonly label: string;
  readonly labelAr: string;
  readonly description: string;
  readonly isCore: boolean;
  readonly order: number;
}

export interface EntitlementFeatureDef {
  readonly key: string;
  readonly moduleKey: EntitlementModuleKey;
  readonly label: string;
  readonly labelAr: string;
}

export const ENTITLEMENT_SOURCES = [
  "manual",
  "subscription_plan",
  "contract_override",
  "trial",
  "system_default",
] as const;

export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const ENTITLEMENT_MODULE_CATALOG: Record<EntitlementModuleKey, EntitlementModuleDef> = {
  core: {
    key: "core",
    label: "Core",
    labelAr: "الأساسي",
    description: "Platform core capabilities - always enabled.",
    isCore: true,
    order: 0,
  },
  hr: {
    key: "hr",
    label: "HR",
    labelAr: "الموارد البشرية",
    description: "Employee and organisation HR capabilities.",
    isCore: false,
    order: 1,
  },
  recruitment: {
    key: "recruitment",
    label: "Recruitment",
    labelAr: "التوظيف",
    description: "Hiring pipeline and job requisitions.",
    isCore: false,
    order: 2,
  },
  onboarding: {
    key: "onboarding",
    label: "Onboarding",
    labelAr: "الانضمام",
    description: "New hire onboarding tasks and templates.",
    isCore: false,
    order: 3,
  },
  attendance: {
    key: "attendance",
    label: "Attendance",
    labelAr: "الحضور",
    description: "Shift schedules and attendance tracking.",
    isCore: false,
    order: 4,
  },
  leave: {
    key: "leave",
    label: "Leave",
    labelAr: "الإجازات",
    description: "Leave requests and approval flows.",
    isCore: false,
    order: 5,
  },
  payroll: {
    key: "payroll",
    label: "Payroll",
    labelAr: "الرواتب",
    description: "Salary components and payroll entitlement surface.",
    isCore: false,
    order: 6,
  },
  performance: {
    key: "performance",
    label: "Performance",
    labelAr: "الأداء",
    description: "Review cycles and performance management.",
    isCore: false,
    order: 7,
  },
  lms: {
    key: "lms",
    label: "LMS",
    labelAr: "التعلم",
    description: "Learning management and course catalog.",
    isCore: false,
    order: 8,
  },
  succession: {
    key: "succession",
    label: "Succession",
    labelAr: "التعاقب",
    description: "Succession planning and talent pipelines.",
    isCore: false,
    order: 9,
  },
  workflows: {
    key: "workflows",
    label: "Workflows",
    labelAr: "سير العمل",
    description: "Approval and automation workflows.",
    isCore: false,
    order: 10,
  },
  notifications: {
    key: "notifications",
    label: "Notifications",
    labelAr: "الإشعارات",
    description: "In-app and operational notifications.",
    isCore: false,
    order: 11,
  },
  documents: {
    key: "documents",
    label: "Documents",
    labelAr: "المستندات",
    description: "Document library and employee files.",
    isCore: false,
    order: 12,
  },
  analytics: {
    key: "analytics",
    label: "Analytics",
    labelAr: "التحليلات",
    description: "Dashboards and executive reporting.",
    isCore: false,
    order: 13,
  },
  integrations: {
    key: "integrations",
    label: "Integrations",
    labelAr: "التكاملات",
    description: "API access and third-party connectors.",
    isCore: false,
    order: 14,
  },
  ai_automation: {
    key: "ai_automation",
    label: "AI & Automation",
    labelAr: "الذكاء والأتمتة",
    description: "AI assistant and automation actions.",
    isCore: false,
    order: 15,
  },
  communication: {
    key: "communication",
    label: "Communication",
    labelAr: "التواصل",
    description: "Messaging and team communication.",
    isCore: false,
    order: 16,
  },
  admin_console: {
    key: "admin_console",
    label: "Admin Console",
    labelAr: "وحدة الإدارة",
    description: "Tenant administration console surfaces.",
    isCore: false,
    order: 17,
  },
};

export const ENTITLEMENT_FEATURE_CATALOG: readonly EntitlementFeatureDef[] = [
  { key: "hr.employee_profiles", moduleKey: "hr", label: "Employee Profiles", labelAr: "ملفات الموظفين" },
  { key: "recruitment.job_requisitions", moduleKey: "recruitment", label: "Job Requisitions", labelAr: "طلبات التوظيف" },
  { key: "onboarding.task_templates", moduleKey: "onboarding", label: "Task Templates", labelAr: "قوالب المهام" },
  { key: "attendance.shift_schedules", moduleKey: "attendance", label: "Shift Schedules", labelAr: "جداول الورديات" },
  { key: "leave.approval_flows", moduleKey: "leave", label: "Approval Flows", labelAr: "مسارات الموافقة" },
  { key: "payroll.salary_components", moduleKey: "payroll", label: "Salary Components", labelAr: "مكونات الراتب" },
  { key: "performance.review_cycles", moduleKey: "performance", label: "Review Cycles", labelAr: "دورات التقييم" },
  { key: "lms.course_catalog", moduleKey: "lms", label: "Course Catalog", labelAr: "كتالوج الدورات" },
  { key: "documents.employee_files", moduleKey: "documents", label: "Employee Files", labelAr: "ملفات الموظفين" },
  { key: "analytics.executive_dashboards", moduleKey: "analytics", label: "Executive Dashboards", labelAr: "لوحات تنفيذية" },
  { key: "integrations.api_access", moduleKey: "integrations", label: "API Access", labelAr: "وصول API" },
  { key: "ai_automation.assistant_actions", moduleKey: "ai_automation", label: "Assistant Actions", labelAr: "إجراءات المساعد" },
] as const;

const FEATURE_BY_KEY = new Map(
  ENTITLEMENT_FEATURE_CATALOG.map((f) => [f.key, f] as const),
);

const FEATURES_BY_MODULE = new Map<EntitlementModuleKey, EntitlementFeatureDef[]>();
for (const mod of ENTITLEMENT_MODULE_KEYS) {
  FEATURES_BY_MODULE.set(
    mod,
    ENTITLEMENT_FEATURE_CATALOG.filter((f) => f.moduleKey === mod),
  );
}

export function isEntitlementModuleKey(v: string): v is EntitlementModuleKey {
  return (ENTITLEMENT_MODULE_KEYS as readonly string[]).includes(v);
}

export function isEntitlementSource(v: string): v is EntitlementSource {
  return (ENTITLEMENT_SOURCES as readonly string[]).includes(v);
}

export function getEntitlementFeatureDef(featureKey: string): EntitlementFeatureDef | undefined {
  return FEATURE_BY_KEY.get(featureKey);
}

export function featureBelongsToModule(featureKey: string, moduleKey: EntitlementModuleKey): boolean {
  const def = FEATURE_BY_KEY.get(featureKey);
  return def?.moduleKey === moduleKey;
}

export function getFeaturesForModule(moduleKey: EntitlementModuleKey): readonly EntitlementFeatureDef[] {
  return FEATURES_BY_MODULE.get(moduleKey) ?? [];
}

export function isCoreModule(moduleKey: string): boolean {
  return moduleKey === CORE_MODULE_KEY;
}

export function buildEntitlementCatalogPayload() {
  return {
    modules: ENTITLEMENT_MODULE_KEYS.map((key) => ({
      ...ENTITLEMENT_MODULE_CATALOG[key],
      features: getFeaturesForModule(key),
    })),
    features: [...ENTITLEMENT_FEATURE_CATALOG],
  };
}
