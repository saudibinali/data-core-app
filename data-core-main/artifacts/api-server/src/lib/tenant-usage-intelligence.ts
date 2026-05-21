/**
 * @file   lib/tenant-usage-intelligence.ts
 * @phase  P13-E - Usage Limits, Quotas & Capacity Intelligence
 *
 * Pure derivation library for tenant usage profiles and capacity risk.
 * No DB, no HTTP, no side effects.
 *
 * SAFETY CONTRACT:
 *   - Read-only derivation only. No billing, payment, enforcement, or suspension.
 *   - No automatic workspace state changes.
 *   - No email or legal notices.
 *   - "unknown" is preferred over unsafe inference when data is unavailable.
 *   - Risk level is informational only - no enforcement actions are taken.
 */

import {
  type UsageMetricCode,
  type MetricSourceType,
  USAGE_METRIC_REGISTRY,
  ALL_USAGE_METRIC_CODES,
} from "./tenant-usage-metrics";
import { type EntitlementProfile } from "./tenant-entitlements";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_APPROACHING_THRESHOLD = 0.8;
export const USAGE_EXCEEDED_THRESHOLD    = 1.0;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UsageLimitStatus =
  | "unknown"        // usage not available or limit configuration unknown
  | "normal"         // usage < 80% of limit
  | "approaching"    // usage >= 80% and < 100% of limit
  | "exceeded"       // usage >= 100% of limit
  | "unlimited"      // limit is null and nullableMeansUnlimited = true
  | "not_applicable"; // metric does not support limit comparison

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical" | "unknown";

export interface RawUsageEntry {
  value:      number | null;
  sourceType: MetricSourceType;
  notes?:     string;
}

export type RawTenantUsage = Record<UsageMetricCode, RawUsageEntry>;

export interface UsageMetricRow {
  metricCode:       UsageMetricCode;
  usageValue:       number | null;
  limitValue:       number | null;
  percentage:       number | null;
  status:           UsageLimitStatus;
  sourceType:       MetricSourceType;
  lastCalculatedAt: string;
  notes?:           string;
}

export interface TenantUsageProfile {
  tenantId:          string;
  workspaceId:       number;
  metrics:           UsageMetricRow[];
  warningCount:      number;   // count of metrics with status "approaching"
  exceededCount:     number;   // count of metrics with status "exceeded"
  unknownCount:      number;   // count of metrics with status "unknown"
  capacityRiskLevel: RiskLevel;
  derivedAt:         string;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveUsageLimitStatus
// ─────────────────────────────────────────────────────────────────────────────

export function deriveUsageLimitStatus(
  usage:                 number | null,
  limit:                 number | null,
  supportsComparison:    boolean,
  nullableMeansUnlimited: boolean,
): UsageLimitStatus {
  if (!supportsComparison)              return "not_applicable";
  if (usage === null)                   return "unknown";
  if (limit === null) {
    return nullableMeansUnlimited ? "unlimited" : "unknown";
  }
  if (limit === 0)                      return "unlimited";
  const pct = usage / limit;
  if (pct >= USAGE_EXCEEDED_THRESHOLD)    return "exceeded";
  if (pct >= USAGE_APPROACHING_THRESHOLD) return "approaching";
  return "normal";
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateUsagePercentage
// ─────────────────────────────────────────────────────────────────────────────

export function calculateUsagePercentage(
  usage: number | null,
  limit: number | null,
): number | null {
  if (usage === null || limit === null || limit <= 0) return null;
  return usage / limit;
}

// ─────────────────────────────────────────────────────────────────────────────
// isUsageApproachingLimit / isUsageLimitExceeded
// ─────────────────────────────────────────────────────────────────────────────

export function isUsageApproachingLimit(row: UsageMetricRow): boolean {
  return row.status === "approaching";
}

export function isUsageLimitExceeded(row: UsageMetricRow): boolean {
  return row.status === "exceeded";
}

// ─────────────────────────────────────────────────────────────────────────────
// buildUsageMetricRows
// ─────────────────────────────────────────────────────────────────────────────

export function buildUsageMetricRows(
  rawUsage:           RawTenantUsage,
  entitlementProfile: EntitlementProfile,
  now:                Date,
): UsageMetricRow[] {
  return ALL_USAGE_METRIC_CODES.map(code => {
    const def        = USAGE_METRIC_REGISTRY[code];
    const raw        = rawUsage[code];
    const limitValue = (entitlementProfile.limits as Record<string, number | null>)[code] ?? null;

    const status     = deriveUsageLimitStatus(
      raw.value,
      limitValue,
      def.supportsLimitComparison,
      def.nullableMeansUnlimited,
    );

    const percentage = def.supportsLimitComparison
      ? calculateUsagePercentage(raw.value, limitValue)
      : null;

    return {
      metricCode:       code,
      usageValue:       raw.value,
      limitValue,
      percentage,
      status,
      sourceType:       raw.sourceType,
      lastCalculatedAt: now.toISOString(),
      notes:            raw.notes,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveCapacityRiskLevel
// ─────────────────────────────────────────────────────────────────────────────

export function deriveCapacityRiskLevel(rows: UsageMetricRow[]): RiskLevel {
  if (rows.length === 0) return "unknown";

  // Only consider rows where we have real data (not not_applicable or unlimited)
  const actionable = rows.filter(
    r => r.status !== "not_applicable" && r.status !== "unlimited",
  );
  if (actionable.length === 0) return "unknown";

  const hasAnyKnown = actionable.some(r => r.status !== "unknown");
  if (!hasAnyKnown) return "unknown";

  const exceeded   = actionable.filter(r => r.status === "exceeded");
  const approaching = actionable.filter(r => r.status === "approaching");

  if (exceeded.length >= 2)   return "critical";
  if (exceeded.length === 1)  return "high";
  if (approaching.length >= 2) return "medium";
  if (approaching.length === 1) return "low";
  return "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantUsageProfile
// ─────────────────────────────────────────────────────────────────────────────

export function deriveTenantUsageProfile(
  tenantId:           string,
  workspaceId:        number,
  rawUsage:           RawTenantUsage,
  entitlementProfile: EntitlementProfile,
  now:                Date,
): TenantUsageProfile {
  const metrics           = buildUsageMetricRows(rawUsage, entitlementProfile, now);
  const warningCount      = metrics.filter(m => m.status === "approaching").length;
  const exceededCount     = metrics.filter(m => m.status === "exceeded").length;
  const unknownCount      = metrics.filter(m => m.status === "unknown").length;
  const capacityRiskLevel = deriveCapacityRiskLevel(metrics);

  return {
    tenantId,
    workspaceId,
    metrics,
    warningCount,
    exceededCount,
    unknownCount,
    capacityRiskLevel,
    derivedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// summarizeUsageWarnings
// ─────────────────────────────────────────────────────────────────────────────

export function summarizeUsageWarnings(rows: UsageMetricRow[]): { warnings: string[] } {
  const warnings: string[] = [];
  for (const row of rows) {
    const def = USAGE_METRIC_REGISTRY[row.metricCode];
    if (row.status === "exceeded") {
      warnings.push(
        `${def.label} limit exceeded - ${row.usageValue} / ${row.limitValue ?? "∞"} ${def.unit}`,
      );
    } else if (row.status === "approaching") {
      const pct = row.percentage !== null ? ` (${Math.round(row.percentage * 100)}%)` : "";
      warnings.push(
        `${def.label} approaching limit${pct} - ${row.usageValue} / ${row.limitValue ?? "∞"} ${def.unit}`,
      );
    }
  }
  return { warnings };
}
