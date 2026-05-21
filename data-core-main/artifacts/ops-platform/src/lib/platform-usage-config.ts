/**
 * @file   lib/platform-usage-config.ts
 * @phase  P13-E - Usage Limits, Quotas & Capacity Intelligence
 *
 * Static UI configuration for tenant usage metrics, status display, and capacity risk.
 * Mirrors backend pure config - no API calls.
 *
 * SAFETY CONTRACT:
 *   - Read-only display config only. No payment, billing, invoice, or charge wording.
 *   - No automatic enforcement, suspension, or data deletion wording.
 *   - No email or legal notice logic.
 *   - All USAGE_SAFETY_CONTRACT properties are true (tested in T16).
 *   - Exactly zero mutation hook names (USAGE_READ_HOOK_NAMES - read only).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Metric Code Types
// ─────────────────────────────────────────────────────────────────────────────

export type UsageMetricCode =
  | "seats"
  | "storage_gb"
  | "monthly_api_calls"
  | "documents"
  | "workflows"
  | "custom_reports"
  | "integrations"
  | "ai_actions"
  | "audit_retention_days"
  | "workspaces";

export type MetricSourceType =
  | "live_db"
  | "derived"
  | "configured"
  | "unavailable";

export type UsageLimitStatus =
  | "unknown"
  | "normal"
  | "approaching"
  | "exceeded"
  | "unlimited"
  | "not_applicable";

export type CapacityRiskLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// Usage Metric Config
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageMetricConfig {
  code:                    UsageMetricCode;
  label:                   string;
  unit:                    string;
  description:             string;
  order:                   number;
  supportsLimitComparison: boolean;
}

export const USAGE_METRIC_CONFIG: Record<UsageMetricCode, UsageMetricConfig> = {
  seats:               { code: "seats",               label: "Active Seats",      unit: "users",        description: "Active user accounts in the workspace.",                                order: 0, supportsLimitComparison: true  },
  storage_gb:          { code: "storage_gb",          label: "Storage",           unit: "GB",           description: "Total file and document storage used.",                                 order: 1, supportsLimitComparison: false },
  monthly_api_calls:   { code: "monthly_api_calls",   label: "Monthly API Calls", unit: "calls/month",  description: "API requests in the current calendar month.",                           order: 2, supportsLimitComparison: false },
  documents:           { code: "documents",           label: "Documents",         unit: "documents",    description: "Documents stored in the workspace.",                                    order: 3, supportsLimitComparison: false },
  workflows:           { code: "workflows",           label: "Workflows",         unit: "workflows",    description: "Active workflow definitions.",                                           order: 4, supportsLimitComparison: true  },
  custom_reports:      { code: "custom_reports",      label: "Custom Reports",    unit: "reports",      description: "Saved custom report definitions.",                                      order: 5, supportsLimitComparison: false },
  integrations:        { code: "integrations",        label: "Integrations",      unit: "connections",  description: "Active third-party integration connections.",                           order: 6, supportsLimitComparison: false },
  ai_actions:          { code: "ai_actions",          label: "AI Actions",        unit: "actions/mo",   description: "AI action consumption in the current month.",                           order: 7, supportsLimitComparison: false },
  audit_retention_days:{ code: "audit_retention_days",label: "Audit Retention",   unit: "days",         description: "Configured audit log retention period.",                                order: 8, supportsLimitComparison: false },
  workspaces:          { code: "workspaces",          label: "Sub-workspaces",    unit: "workspaces",   description: "Sub-workspaces (always 1 for standard single-workspace tenants).",       order: 9, supportsLimitComparison: false },
} as const;

export const ALL_USAGE_METRIC_CODES: UsageMetricCode[] = [
  "seats", "storage_gb", "monthly_api_calls", "documents", "workflows",
  "custom_reports", "integrations", "ai_actions", "audit_retention_days", "workspaces",
];

// ─────────────────────────────────────────────────────────────────────────────
// Usage Status Config
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageStatusConfig {
  label:       string;
  description: string;
  badgeClass:  string;
}

export const USAGE_STATUS_CONFIG: Record<UsageLimitStatus, UsageStatusConfig> = {
  unknown:        { label: "Unknown",     description: "Usage data is not available.",                         badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"              },
  normal:         { label: "Normal",      description: "Usage is within healthy range (below 80%).",           badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  approaching:    { label: "Approaching", description: "Usage is at or above 80% of the configured limit.",   badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"         },
  exceeded:       { label: "Exceeded",    description: "Usage has reached or exceeded the configured limit.",  badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"                 },
  unlimited:      { label: "Unlimited",   description: "No limit is configured for this metric.",              badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"             },
  not_applicable: { label: "N/A",         description: "Limit comparison is not supported for this metric.",   badgeClass: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"             },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Source Type Config
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricSourceConfig {
  label:       string;
  description: string;
  badgeClass:  string;
}

export const METRIC_SOURCE_CONFIG: Record<MetricSourceType, MetricSourceConfig> = {
  live_db:     { label: "Live",        description: "Computed from the database at request time.",       badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  derived:     { label: "Derived",     description: "Inferred from known relationships or constants.",   badgeClass: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"            },
  configured:  { label: "Configured",  description: "Reflects the configured entitlement limit value.",  badgeClass: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"    },
  unavailable: { label: "Unavailable", description: "No tracking implementation available.",             badgeClass: "bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400"           },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Capacity Risk Config
// ─────────────────────────────────────────────────────────────────────────────

export interface CapacityRiskConfig {
  label:       string;
  description: string;
  badgeClass:  string;
}

export const CAPACITY_RISK_CONFIG: Record<CapacityRiskLevel, CapacityRiskConfig> = {
  none:     { label: "None",     description: "All tracked metrics are within healthy range.",             badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  low:      { label: "Low",      description: "One metric is approaching its configured limit.",          badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"   },
  medium:   { label: "Medium",   description: "Multiple metrics approaching or one metric exceeded.",     badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"       },
  high:     { label: "High",     description: "One or more configured limits have been exceeded.",        badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"               },
  critical: { label: "Critical", description: "Multiple limits exceeded. Immediate capacity review.",    badgeClass: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100 font-semibold"  },
  unknown:  { label: "Unknown",  description: "Insufficient data to determine capacity risk.",            badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"           },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// API Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_API_PATHS = {
  usage: (tenantId: string) => `/api/platform/tenants/${tenantId}/usage`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hook Name Registry
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_READ_HOOK_NAMES = ["useTenantUsage"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract (all properties must be true - tested in T16)
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_SAFETY_CONTRACT = {
  superAdminOnly:              true,
  readOnly:                    true,
  noPaymentProcessing:         true,
  noInvoiceGeneration:         true,
  noChargeCollection:          true,
  noAutoWorkspaceSuspension:   true,
  noDataDeletion:              true,
  noHardLimitEnforcement:      true,
  noEmailOrLegalNotices:       true,
  prefersUnknownOverInference: true,
  failsClosedOnInvalidTenant:  true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_EMPTY_STATE = {
  noData:       "Usage data is not available for this metric",
  loading:      "Loading usage data...",
  noMetrics:    "No usage metrics available",
  unknownRisk:  "Capacity risk cannot be determined",
} as const;
