/**
 * @file   lib/feature-limits.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Static registry of all platform feature limits. Pure config - no DB, no HTTP.
 *
 * SAFETY CONTRACT:
 *   - Registry only. No billing, payment, invoice, or enforcement logic.
 *   - nullableMeansUnlimited = true → a null limitValue means "no limit".
 *   - nullableMeansUnlimited = false → null is disallowed for that limit.
 *   - All limit values are non-negative integers or null.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Feature Limit Code Type
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureLimitCode =
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

// ─────────────────────────────────────────────────────────────────────────────
// Limit Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureLimitDef {
  code:                  FeatureLimitCode;
  label:                 string;
  unit:                  string;
  description:           string;
  order:                 number;
  nullableMeansUnlimited: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Limit Registry
// ─────────────────────────────────────────────────────────────────────────────

export const FEATURE_LIMIT_REGISTRY: Record<FeatureLimitCode, FeatureLimitDef> = {
  seats: {
    code:                   "seats",
    label:                  "Active Seats",
    unit:                   "users",
    description:            "Maximum number of active user accounts in the workspace.",
    order:                  0,
    nullableMeansUnlimited: true,
  },
  storage_gb: {
    code:                   "storage_gb",
    label:                  "Storage",
    unit:                   "GB",
    description:            "Total file and document storage quota in gigabytes.",
    order:                  1,
    nullableMeansUnlimited: true,
  },
  monthly_api_calls: {
    code:                   "monthly_api_calls",
    label:                  "Monthly API Calls",
    unit:                   "calls/month",
    description:            "API request quota per calendar month.",
    order:                  2,
    nullableMeansUnlimited: true,
  },
  documents: {
    code:                   "documents",
    label:                  "Documents",
    unit:                   "documents",
    description:            "Maximum number of documents stored in the workspace.",
    order:                  3,
    nullableMeansUnlimited: true,
  },
  workflows: {
    code:                   "workflows",
    label:                  "Workflows",
    unit:                   "workflows",
    description:            "Maximum number of active workflow definitions.",
    order:                  4,
    nullableMeansUnlimited: true,
  },
  custom_reports: {
    code:                   "custom_reports",
    label:                  "Custom Reports",
    unit:                   "reports",
    description:            "Maximum number of saved custom report definitions.",
    order:                  5,
    nullableMeansUnlimited: true,
  },
  integrations: {
    code:                   "integrations",
    label:                  "Integrations",
    unit:                   "connections",
    description:            "Maximum number of active third-party integration connections.",
    order:                  6,
    nullableMeansUnlimited: true,
  },
  ai_actions: {
    code:                   "ai_actions",
    label:                  "AI Actions",
    unit:                   "actions/month",
    description:            "Monthly AI action budget (smart suggestions, automation runs).",
    order:                  7,
    nullableMeansUnlimited: true,
  },
  audit_retention_days: {
    code:                   "audit_retention_days",
    label:                  "Audit Log Retention",
    unit:                   "days",
    description:            "Number of days audit event logs are retained.",
    order:                  8,
    nullableMeansUnlimited: false, // must always be set
  },
  workspaces: {
    code:                   "workspaces",
    label:                  "Sub-workspaces",
    unit:                   "workspaces",
    description:            "Maximum number of sub-workspaces (future multi-workspace tenants).",
    order:                  9,
    nullableMeansUnlimited: true,
  },
} as const;

export const ALL_LIMIT_CODES: FeatureLimitCode[] = [
  "seats", "storage_gb", "monthly_api_calls", "documents", "workflows",
  "custom_reports", "integrations", "ai_actions", "audit_retention_days", "workspaces",
];

/** Returns true if the limit code is a known feature limit. */
export function isKnownLimitCode(code: string): code is FeatureLimitCode {
  return ALL_LIMIT_CODES.includes(code as FeatureLimitCode);
}

/** Returns the default limits record with all values set to null. */
export function buildEmptyLimits(): Record<FeatureLimitCode, number | null> {
  const result = {} as Record<FeatureLimitCode, number | null>;
  for (const code of ALL_LIMIT_CODES) result[code] = null;
  return result;
}
