/**
 * @file   workspace-quota-catalog.ts
 * @phase  P16-C - Workspace Limits & Quotas
 *
 * Static quota catalog. No payment linkage. No enforcement in P16-C.
 */

export const QUOTA_UNIT_TYPES = ["count", "gb", "requests", "actions"] as const;
export type QuotaUnit = (typeof QUOTA_UNIT_TYPES)[number];

export const QUOTA_SOURCES = [
  "manual",
  "subscription_plan",
  "contract_override",
  "trial",
  "system_default",
] as const;

export type QuotaSource = (typeof QUOTA_SOURCES)[number];

export interface QuotaCatalogEntry {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string;
  readonly unit: QuotaUnit;
  readonly defaultLimit: number;
  readonly warningThresholdPercent: number;
  readonly hardLimitSupported: boolean;
  readonly description: string;
  readonly relatedModule?: string;
}

export const QUOTA_CATALOG: readonly QuotaCatalogEntry[] = [
  {
    key: "users.max",
    label: "Maximum users",
    labelAr: "الحد الأقصى للمستخدمين",
    unit: "count",
    defaultLimit: 50,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "Active workspace user accounts.",
    relatedModule: "admin_console",
  },
  {
    key: "employees.max",
    label: "Maximum employees",
    labelAr: "الحد الأقصى للموظفين",
    unit: "count",
    defaultLimit: 100,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "HR employee records in the workspace.",
    relatedModule: "hr",
  },
  {
    key: "branches.max",
    label: "Maximum branches",
    labelAr: "الحد الأقصى للفروع",
    unit: "count",
    defaultLimit: 10,
    warningThresholdPercent: 80,
    hardLimitSupported: false,
    description: "Organizational branch units.",
    relatedModule: "hr",
  },
  {
    key: "storage.gb",
    label: "Storage (GB)",
    labelAr: "التخزين (جيجابايت)",
    unit: "gb",
    defaultLimit: 25,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "Approximate document storage footprint.",
    relatedModule: "documents",
  },
  {
    key: "documents.max",
    label: "Maximum documents",
    labelAr: "الحد الأقصى للمستندات",
    unit: "count",
    defaultLimit: 5000,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "Employee document files stored in HR.",
    relatedModule: "documents",
  },
  {
    key: "workflows.max",
    label: "Maximum workflows",
    labelAr: "الحد الأقصى لسير العمل",
    unit: "count",
    defaultLimit: 25,
    warningThresholdPercent: 80,
    hardLimitSupported: false,
    description: "Workflow definitions (non-archived).",
    relatedModule: "workflows",
  },
  {
    key: "integrations.max",
    label: "Maximum integrations",
    labelAr: "الحد الأقصى للتكاملات",
    unit: "count",
    defaultLimit: 5,
    warningThresholdPercent: 80,
    hardLimitSupported: false,
    description: "External system integrations.",
    relatedModule: "integrations",
  },
  {
    key: "api.requests.monthly",
    label: "API requests (monthly)",
    labelAr: "طلبات API (شهرياً)",
    unit: "requests",
    defaultLimit: 100_000,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "Outbound API request volume per calendar month.",
    relatedModule: "integrations",
  },
  {
    key: "ai.actions.monthly",
    label: "AI actions (monthly)",
    labelAr: "إجراءات الذكاء الاصطناعي (شهرياً)",
    unit: "actions",
    defaultLimit: 5000,
    warningThresholdPercent: 80,
    hardLimitSupported: true,
    description: "AI assistant or automation actions per month.",
    relatedModule: "ai_automation",
  },
  {
    key: "reports.max",
    label: "Maximum reports",
    labelAr: "الحد الأقصى للتقارير",
    unit: "count",
    defaultLimit: 50,
    warningThresholdPercent: 80,
    hardLimitSupported: false,
    description: "Saved or scheduled report definitions.",
    relatedModule: "analytics",
  },
  {
    key: "custom.roles.max",
    label: "Maximum custom roles",
    labelAr: "الحد الأقصى للأدوار المخصصة",
    unit: "count",
    defaultLimit: 20,
    warningThresholdPercent: 80,
    hardLimitSupported: false,
    description: "Workspace-defined custom roles.",
    relatedModule: "admin_console",
  },
] as const;

export const QUOTA_KEYS = QUOTA_CATALOG.map((q) => q.key) as readonly string[];

export type QuotaKey = (typeof QUOTA_CATALOG)[number]["key"];

export function isQuotaKey(key: string): key is QuotaKey {
  return QUOTA_CATALOG.some((q) => q.key === key);
}

export function isQuotaSource(source: string): source is QuotaSource {
  return (QUOTA_SOURCES as readonly string[]).includes(source);
}

export function getQuotaCatalogEntry(key: string): QuotaCatalogEntry | undefined {
  return QUOTA_CATALOG.find((q) => q.key === key);
}

export function buildQuotaCatalogPayload() {
  return {
    quotas: QUOTA_CATALOG.map((q) => ({ ...q })),
    sources: [...QUOTA_SOURCES],
    units: [...QUOTA_UNIT_TYPES],
  };
}
