/**
 * @file   lib/tenant-usage-metrics.ts
 * @phase  P13-E - Usage Limits, Quotas & Capacity Intelligence
 *
 * Static registry of all platform usage metrics. Pure config - no DB, no HTTP.
 *
 * SAFETY CONTRACT:
 *   - Registry only. No billing, payment, invoice, or enforcement logic.
 *   - defaultSourceType reflects what is currently measurable from the DB.
 *   - supportsLimitComparison = false → no approaching/exceeded derivation.
 *   - Prefer "unavailable" over unsafe inference.
 */

import { type FeatureLimitCode, ALL_LIMIT_CODES } from "./feature-limits";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UsageMetricCode deliberately mirrors FeatureLimitCode - every feature limit
 * has a corresponding usage metric tracked (or marked unavailable) here.
 */
export type UsageMetricCode = FeatureLimitCode;

export type MetricSourceType =
  | "live_db"     // computed from a real DB count at request time
  | "derived"     // inferred from known constants or relationships
  | "configured"  // reflects the entitlement limit value itself (not consumption)
  | "unavailable"; // no implementation exists yet

// ─────────────────────────────────────────────────────────────────────────────
// Metric Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageMetricDef {
  code:                    UsageMetricCode;
  label:                   string;
  unit:                    string;
  description:             string;
  order:                   number;
  defaultSourceType:       MetricSourceType;
  supportsLimitComparison: boolean;
  nullableMeansUnlimited:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Metric Registry
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_METRIC_REGISTRY: Record<UsageMetricCode, UsageMetricDef> = {
  seats: {
    code:                    "seats",
    label:                   "Active Seats",
    unit:                    "users",
    description:             "Active user accounts (status=active) in the workspace.",
    order:                   0,
    defaultSourceType:       "live_db",
    supportsLimitComparison: true,
    nullableMeansUnlimited:  true,
  },
  storage_gb: {
    code:                    "storage_gb",
    label:                   "Storage",
    unit:                    "GB",
    description:             "Total file and document storage used. No tracking implemented.",
    order:                   1,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  monthly_api_calls: {
    code:                    "monthly_api_calls",
    label:                   "Monthly API Calls",
    unit:                    "calls/month",
    description:             "API requests made in the current calendar month. No counter implemented.",
    order:                   2,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  documents: {
    code:                    "documents",
    label:                   "Documents",
    unit:                    "documents",
    description:             "Documents stored in the workspace. No documents table implemented.",
    order:                   3,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  workflows: {
    code:                    "workflows",
    label:                   "Workflows",
    unit:                    "workflows",
    description:             "Active workflow definitions (status=active) in the workspace.",
    order:                   4,
    defaultSourceType:       "live_db",
    supportsLimitComparison: true,
    nullableMeansUnlimited:  true,
  },
  custom_reports: {
    code:                    "custom_reports",
    label:                   "Custom Reports",
    unit:                    "reports",
    description:             "Saved custom report definitions. No table implemented.",
    order:                   5,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  integrations: {
    code:                    "integrations",
    label:                   "Integrations",
    unit:                    "connections",
    description:             "Active third-party integration connections. No table implemented.",
    order:                   6,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  ai_actions: {
    code:                    "ai_actions",
    label:                   "AI Actions",
    unit:                    "actions/month",
    description:             "AI action consumption in the current month. No counter implemented.",
    order:                   7,
    defaultSourceType:       "unavailable",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
  audit_retention_days: {
    code:                    "audit_retention_days",
    label:                   "Audit Retention",
    unit:                    "days",
    description:             "Configured audit log retention period. Reflects entitlement limit - not consumption.",
    order:                   8,
    defaultSourceType:       "configured",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  false,
  },
  workspaces: {
    code:                    "workspaces",
    label:                   "Sub-workspaces",
    unit:                    "workspaces",
    description:             "Number of sub-workspaces. Always 1 for standard single-workspace tenants.",
    order:                   9,
    defaultSourceType:       "derived",
    supportsLimitComparison: false,
    nullableMeansUnlimited:  true,
  },
} as const;

export const ALL_USAGE_METRIC_CODES: UsageMetricCode[] = [...ALL_LIMIT_CODES];

export function isKnownMetricCode(code: string): code is UsageMetricCode {
  return ALL_USAGE_METRIC_CODES.includes(code as UsageMetricCode);
}
