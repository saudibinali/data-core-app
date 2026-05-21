/**
 * @file   __tests__/tenant-usage.test.ts
 * @phase  P13-E - Usage Limits, Quotas & Capacity Intelligence
 *
 * Tests T1-T12 covering the pure usage metric and intelligence libraries.
 * No DB, no HTTP - all pure functions.
 */

import { describe, it, expect } from "vitest";
import {
  USAGE_METRIC_REGISTRY,
  ALL_USAGE_METRIC_CODES,
  isKnownMetricCode,
} from "../tenant-usage-metrics";
import {
  USAGE_APPROACHING_THRESHOLD,
  USAGE_EXCEEDED_THRESHOLD,
  deriveUsageLimitStatus,
  calculateUsagePercentage,
  buildUsageMetricRows,
  deriveCapacityRiskLevel,
  deriveTenantUsageProfile,
  summarizeUsageWarnings,
  isUsageApproachingLimit,
  isUsageLimitExceeded,
  type RawTenantUsage,
  type UsageMetricRow,
} from "../tenant-usage-intelligence";
import {
  deriveTenantEntitlementProfile,
} from "../tenant-entitlements";
import {
  buildUsageSummary,
  deriveRiskSignalSummary,
} from "../tenant-registry";

const NOW = new Date("2026-05-16T12:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Usage metric config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: usage metric registry stable", () => {
  it("has exactly 10 metric codes", () => {
    expect(ALL_USAGE_METRIC_CODES).toHaveLength(10);
  });

  it("every code in ALL_USAGE_METRIC_CODES has a registry entry", () => {
    for (const code of ALL_USAGE_METRIC_CODES) {
      expect(USAGE_METRIC_REGISTRY[code]).toBeDefined();
    }
  });

  it("every registry entry has required fields", () => {
    for (const [code, def] of Object.entries(USAGE_METRIC_REGISTRY)) {
      expect(def.code).toBe(code);
      expect(typeof def.label).toBe("string");
      expect(typeof def.unit).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(typeof def.order).toBe("number");
      expect(["live_db", "derived", "configured", "unavailable"]).toContain(def.defaultSourceType);
      expect(typeof def.supportsLimitComparison).toBe("boolean");
      expect(typeof def.nullableMeansUnlimited).toBe("boolean");
    }
  });

  it("order values are unique and start from 0", () => {
    const orders = ALL_USAGE_METRIC_CODES.map(c => USAGE_METRIC_REGISTRY[c].order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(sorted[0]).toBe(0);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("isKnownMetricCode returns true for all codes", () => {
    for (const code of ALL_USAGE_METRIC_CODES) {
      expect(isKnownMetricCode(code)).toBe(true);
    }
  });

  it("isKnownMetricCode returns false for unknown code", () => {
    expect(isKnownMetricCode("fake_metric")).toBe(false);
    expect(isKnownMetricCode("")).toBe(false);
  });

  it("seats and workflows support limit comparison", () => {
    expect(USAGE_METRIC_REGISTRY.seats.supportsLimitComparison).toBe(true);
    expect(USAGE_METRIC_REGISTRY.workflows.supportsLimitComparison).toBe(true);
  });

  it("unavailable metrics do not support limit comparison", () => {
    const unavailable = ["storage_gb", "monthly_api_calls", "documents", "custom_reports", "integrations", "ai_actions"];
    for (const code of unavailable) {
      expect(USAGE_METRIC_REGISTRY[code as keyof typeof USAGE_METRIC_REGISTRY].supportsLimitComparison).toBe(false);
    }
  });

  it("audit_retention_days has configured sourceType and no limit comparison", () => {
    const def = USAGE_METRIC_REGISTRY.audit_retention_days;
    expect(def.defaultSourceType).toBe("configured");
    expect(def.supportsLimitComparison).toBe(false);
  });

  it("workspaces has derived sourceType and no limit comparison", () => {
    const def = USAGE_METRIC_REGISTRY.workspaces;
    expect(def.defaultSourceType).toBe("derived");
    expect(def.supportsLimitComparison).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Usage status thresholds stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: usage status thresholds stable", () => {
  it("USAGE_APPROACHING_THRESHOLD is exactly 0.8", () => {
    expect(USAGE_APPROACHING_THRESHOLD).toBe(0.8);
  });

  it("USAGE_EXCEEDED_THRESHOLD is exactly 1.0", () => {
    expect(USAGE_EXCEEDED_THRESHOLD).toBe(1.0);
  });

  it("thresholds are between 0 and 1 inclusive", () => {
    expect(USAGE_APPROACHING_THRESHOLD).toBeGreaterThan(0);
    expect(USAGE_APPROACHING_THRESHOLD).toBeLessThan(1);
    expect(USAGE_EXCEEDED_THRESHOLD).toBe(1.0);
  });

  it("approaching threshold is strictly less than exceeded", () => {
    expect(USAGE_APPROACHING_THRESHOLD).toBeLessThan(USAGE_EXCEEDED_THRESHOLD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Percentage calculation stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: calculateUsagePercentage stable", () => {
  it("returns null when usage is null", () => {
    expect(calculateUsagePercentage(null, 100)).toBeNull();
  });

  it("returns null when limit is null", () => {
    expect(calculateUsagePercentage(50, null)).toBeNull();
  });

  it("returns null when limit is 0", () => {
    expect(calculateUsagePercentage(50, 0)).toBeNull();
  });

  it("returns correct ratio for normal usage", () => {
    expect(calculateUsagePercentage(25, 100)).toBe(0.25);
    expect(calculateUsagePercentage(80, 100)).toBe(0.80);
    expect(calculateUsagePercentage(100, 100)).toBe(1.0);
  });

  it("returns > 1.0 when usage exceeds limit", () => {
    expect(calculateUsagePercentage(110, 100)).toBe(1.1);
  });

  it("handles fractional values correctly", () => {
    expect(calculateUsagePercentage(1, 3)).toBeCloseTo(0.3333, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - unknown / unlimited / not_applicable behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: unknown/unlimited/not_applicable behavior", () => {
  it("returns not_applicable when supportsComparison = false", () => {
    expect(deriveUsageLimitStatus(100, 200, false, true)).toBe("not_applicable");
    expect(deriveUsageLimitStatus(null, null, false, true)).toBe("not_applicable");
    expect(deriveUsageLimitStatus(0, 0, false, false)).toBe("not_applicable");
  });

  it("returns unknown when usage is null and supportsComparison = true", () => {
    expect(deriveUsageLimitStatus(null, 100, true, true)).toBe("unknown");
    expect(deriveUsageLimitStatus(null, null, true, true)).toBe("unknown");
  });

  it("returns unlimited when limit is null and nullableMeansUnlimited = true", () => {
    expect(deriveUsageLimitStatus(50, null, true, true)).toBe("unlimited");
    expect(deriveUsageLimitStatus(0, null, true, true)).toBe("unlimited");
  });

  it("returns unknown when limit is null and nullableMeansUnlimited = false", () => {
    expect(deriveUsageLimitStatus(50, null, true, false)).toBe("unknown");
  });

  it("returns unlimited when limit is 0 and supportsComparison = true", () => {
    expect(deriveUsageLimitStatus(5, 0, true, true)).toBe("unlimited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - normal / approaching / exceeded derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: normal/approaching/exceeded derivation", () => {
  it("returns normal for usage below 80%", () => {
    expect(deriveUsageLimitStatus(79, 100, true, true)).toBe("normal");
    expect(deriveUsageLimitStatus(0, 100, true, true)).toBe("normal");
    expect(deriveUsageLimitStatus(1, 100, true, true)).toBe("normal");
  });

  it("returns approaching at exactly 80%", () => {
    expect(deriveUsageLimitStatus(80, 100, true, true)).toBe("approaching");
  });

  it("returns approaching for usage between 80% and 100%", () => {
    expect(deriveUsageLimitStatus(85, 100, true, true)).toBe("approaching");
    expect(deriveUsageLimitStatus(99, 100, true, true)).toBe("approaching");
  });

  it("returns exceeded at exactly 100%", () => {
    expect(deriveUsageLimitStatus(100, 100, true, true)).toBe("exceeded");
  });

  it("returns exceeded for usage above 100%", () => {
    expect(deriveUsageLimitStatus(101, 100, true, true)).toBe("exceeded");
    expect(deriveUsageLimitStatus(200, 100, true, true)).toBe("exceeded");
  });

  it("isUsageApproachingLimit / isUsageLimitExceeded helpers work correctly", () => {
    const approaching: UsageMetricRow = {
      metricCode: "seats", usageValue: 85, limitValue: 100, percentage: 0.85,
      status: "approaching", sourceType: "live_db", lastCalculatedAt: NOW.toISOString(),
    };
    const exceeded: UsageMetricRow = {
      metricCode: "workflows", usageValue: 10, limitValue: 5, percentage: 2.0,
      status: "exceeded", sourceType: "live_db", lastCalculatedAt: NOW.toISOString(),
    };
    const normal: UsageMetricRow = {
      metricCode: "seats", usageValue: 10, limitValue: 100, percentage: 0.1,
      status: "normal", sourceType: "live_db", lastCalculatedAt: NOW.toISOString(),
    };

    expect(isUsageApproachingLimit(approaching)).toBe(true);
    expect(isUsageApproachingLimit(exceeded)).toBe(false);
    expect(isUsageApproachingLimit(normal)).toBe(false);

    expect(isUsageLimitExceeded(exceeded)).toBe(true);
    expect(isUsageLimitExceeded(approaching)).toBe(false);
    expect(isUsageLimitExceeded(normal)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Tenant usage profile derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: deriveTenantUsageProfile", () => {
  function makeRawUsage(overrides: Partial<RawTenantUsage> = {}): RawTenantUsage {
    const base: RawTenantUsage = {
      seats:                { value: null, sourceType: "unavailable" },
      storage_gb:           { value: null, sourceType: "unavailable" },
      monthly_api_calls:    { value: null, sourceType: "unavailable" },
      documents:            { value: null, sourceType: "unavailable" },
      workflows:            { value: null, sourceType: "unavailable" },
      custom_reports:       { value: null, sourceType: "unavailable" },
      integrations:         { value: null, sourceType: "unavailable" },
      ai_actions:           { value: null, sourceType: "unavailable" },
      audit_retention_days: { value: null, sourceType: "configured"  },
      workspaces:           { value: 1,    sourceType: "derived"     },
    };
    return { ...base, ...overrides };
  }

  it("returns a profile with tenantId and workspaceId", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    const rawUsage   = makeRawUsage({ seats: { value: 5, sourceType: "live_db" } });
    const profile    = deriveTenantUsageProfile("42", 42, rawUsage, entProfile, NOW);

    expect(profile.tenantId).toBe("42");
    expect(profile.workspaceId).toBe(42);
    expect(profile.derivedAt).toBe(NOW.toISOString());
  });

  it("counts approaching and exceeded correctly", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    // starter plan: seats limit=25, workflows limit=5
    const rawUsage = makeRawUsage({
      seats:     { value: 22, sourceType: "live_db" }, // 88% → approaching
      workflows: { value: 6,  sourceType: "live_db" }, // 120% → exceeded
    });
    const profile = deriveTenantUsageProfile("1", 1, rawUsage, entProfile, NOW);

    expect(profile.warningCount).toBe(1);  // seats approaching
    expect(profile.exceededCount).toBe(1); // workflows exceeded
  });

  it("counts unknown metrics correctly (null value on a comparable metric)", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    // Leave seats as null (supportsLimitComparison=true + null value → unknown)
    // Workflows also null → unknown
    const rawUsage = makeRawUsage(); // seats=null, workflows=null (from base defaults)
    const profile  = deriveTenantUsageProfile("1", 1, rawUsage, entProfile, NOW);

    // seats and workflows both have supportsLimitComparison=true + null value → unknown
    expect(profile.unknownCount).toBe(2);
    // Non-comparable metrics get not_applicable, not unknown
    expect(profile.warningCount).toBe(0);
    expect(profile.exceededCount).toBe(0);
  });

  it("returns 10 metric rows", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    const rawUsage   = makeRawUsage();
    const profile    = deriveTenantUsageProfile("1", 1, rawUsage, entProfile, NOW);

    expect(profile.metrics).toHaveLength(10);
  });

  it("all-unknown raw usage gives capacityRiskLevel=unknown", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    const rawUsage   = makeRawUsage(); // all null/unavailable/not_applicable
    const profile    = deriveTenantUsageProfile("1", 1, rawUsage, entProfile, NOW);

    // seats and workflows with null → unknown status → overall unknown
    expect(profile.capacityRiskLevel).toBe("unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Capacity risk derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: deriveCapacityRiskLevel", () => {
  function makeRow(code: string, status: UsageMetricRow["status"]): UsageMetricRow {
    return {
      metricCode: code as UsageMetricRow["metricCode"],
      usageValue: null, limitValue: null, percentage: null,
      status, sourceType: "live_db", lastCalculatedAt: NOW.toISOString(),
    };
  }

  it("returns unknown for empty rows", () => {
    expect(deriveCapacityRiskLevel([])).toBe("unknown");
  });

  it("returns unknown when all rows are not_applicable or unlimited", () => {
    const rows = [makeRow("seats", "not_applicable"), makeRow("workflows", "unlimited")];
    expect(deriveCapacityRiskLevel(rows)).toBe("unknown");
  });

  it("returns unknown when all actionable rows are unknown", () => {
    const rows = [makeRow("seats", "unknown"), makeRow("workflows", "unknown")];
    expect(deriveCapacityRiskLevel(rows)).toBe("unknown");
  });

  it("returns none when all rows are normal", () => {
    const rows = [makeRow("seats", "normal"), makeRow("workflows", "normal")];
    expect(deriveCapacityRiskLevel(rows)).toBe("none");
  });

  it("returns low for one approaching metric", () => {
    const rows = [makeRow("seats", "approaching"), makeRow("workflows", "normal")];
    expect(deriveCapacityRiskLevel(rows)).toBe("low");
  });

  it("returns medium for two approaching metrics", () => {
    const rows = [makeRow("seats", "approaching"), makeRow("workflows", "approaching")];
    expect(deriveCapacityRiskLevel(rows)).toBe("medium");
  });

  it("returns high for one exceeded metric", () => {
    const rows = [makeRow("seats", "exceeded"), makeRow("workflows", "normal")];
    expect(deriveCapacityRiskLevel(rows)).toBe("high");
  });

  it("returns critical for two exceeded metrics", () => {
    const rows = [makeRow("seats", "exceeded"), makeRow("workflows", "exceeded")];
    expect(deriveCapacityRiskLevel(rows)).toBe("critical");
  });

  it("exceeded takes priority over approaching", () => {
    const rows = [makeRow("seats", "exceeded"), makeRow("workflows", "approaching")];
    expect(deriveCapacityRiskLevel(rows)).toBe("high"); // 1 exceeded > medium
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Raw usage collector safely returns null for unavailable sources
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: unavailable source types produce null usage safely", () => {
  const unavailableCodes = [
    "storage_gb", "monthly_api_calls", "documents",
    "custom_reports", "integrations", "ai_actions",
  ] as const;

  it("USAGE_METRIC_REGISTRY marks unavailable sources correctly", () => {
    for (const code of unavailableCodes) {
      expect(USAGE_METRIC_REGISTRY[code].defaultSourceType).toBe("unavailable");
    }
  });

  it("buildUsageMetricRows handles null/unavailable entries without throwing", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    const rawUsage: RawTenantUsage = {
      seats:                { value: null, sourceType: "unavailable" },
      storage_gb:           { value: null, sourceType: "unavailable" },
      monthly_api_calls:    { value: null, sourceType: "unavailable" },
      documents:            { value: null, sourceType: "unavailable" },
      workflows:            { value: null, sourceType: "unavailable" },
      custom_reports:       { value: null, sourceType: "unavailable" },
      integrations:         { value: null, sourceType: "unavailable" },
      ai_actions:           { value: null, sourceType: "unavailable" },
      audit_retention_days: { value: null, sourceType: "configured"  },
      workspaces:           { value: 1,    sourceType: "derived"     },
    };

    expect(() => buildUsageMetricRows(rawUsage, entProfile, NOW)).not.toThrow();
    const rows = buildUsageMetricRows(rawUsage, entProfile, NOW);
    for (const code of unavailableCodes) {
      const row = rows.find(r => r.metricCode === code);
      expect(row).toBeDefined();
      expect(row!.usageValue).toBeNull();
      expect(row!.percentage).toBeNull();
    }
  });

  it("unavailable metrics with supportsLimitComparison=false get not_applicable status", () => {
    const entProfile = deriveTenantEntitlementProfile("starter", [], NOW);
    const rawUsage: RawTenantUsage = {
      seats:                { value: null, sourceType: "unavailable" },
      storage_gb:           { value: null, sourceType: "unavailable" },
      monthly_api_calls:    { value: null, sourceType: "unavailable" },
      documents:            { value: null, sourceType: "unavailable" },
      workflows:            { value: null, sourceType: "unavailable" },
      custom_reports:       { value: null, sourceType: "unavailable" },
      integrations:         { value: null, sourceType: "unavailable" },
      ai_actions:           { value: null, sourceType: "unavailable" },
      audit_retention_days: { value: null, sourceType: "configured"  },
      workspaces:           { value: 1,    sourceType: "derived"     },
    };

    const rows = buildUsageMetricRows(rawUsage, entProfile, NOW);
    for (const code of unavailableCodes) {
      const row = rows.find(r => r.metricCode === code);
      expect(row!.status).toBe("not_applicable");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - API safety: all metrics without supportsLimitComparison get not_applicable
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: metrics without limit comparison get not_applicable (never charged/enforced)", () => {
  it("non-comparable metrics produce not_applicable regardless of value", () => {
    const entProfile = deriveTenantEntitlementProfile("enterprise", [], NOW);
    const rawUsage: RawTenantUsage = {
      seats:                { value: 500, sourceType: "live_db"     },
      storage_gb:           { value: 200, sourceType: "unavailable" },
      monthly_api_calls:    { value: 500, sourceType: "unavailable" },
      documents:            { value: 100, sourceType: "unavailable" },
      workflows:            { value: 10,  sourceType: "live_db"     },
      custom_reports:       { value: 5,   sourceType: "unavailable" },
      integrations:         { value: 3,   sourceType: "unavailable" },
      ai_actions:           { value: 100, sourceType: "unavailable" },
      audit_retention_days: { value: 365, sourceType: "configured"  },
      workspaces:           { value: 1,   sourceType: "derived"     },
    };

    const rows = buildUsageMetricRows(rawUsage, entProfile, NOW);
    const nonComparable = rows.filter(r =>
      !USAGE_METRIC_REGISTRY[r.metricCode as keyof typeof USAGE_METRIC_REGISTRY].supportsLimitComparison,
    );

    for (const row of nonComparable) {
      expect(row.status).toBe("not_applicable");
      expect(row.percentage).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - summarizeUsageWarnings correct messages
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: summarizeUsageWarnings correct messages", () => {
  function makeRow(code: string, status: UsageMetricRow["status"], usage: number | null, limit: number | null, pct: number | null): UsageMetricRow {
    return {
      metricCode: code as UsageMetricRow["metricCode"],
      usageValue: usage, limitValue: limit, percentage: pct,
      status, sourceType: "live_db", lastCalculatedAt: NOW.toISOString(),
    };
  }

  it("returns empty warnings for all-normal/unknown rows", () => {
    const rows = [
      makeRow("seats", "normal", 10, 100, 0.1),
      makeRow("workflows", "unknown", null, null, null),
    ];
    expect(summarizeUsageWarnings(rows).warnings).toHaveLength(0);
  });

  it("includes exceeded warning with correct label", () => {
    const rows = [makeRow("seats", "exceeded", 110, 100, 1.1)];
    const { warnings } = summarizeUsageWarnings(rows);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Active Seats");
    expect(warnings[0]).toContain("exceeded");
    expect(warnings[0]).toContain("110");
    expect(warnings[0]).toContain("100");
  });

  it("includes approaching warning with percentage", () => {
    const rows = [makeRow("workflows", "approaching", 9, 10, 0.9)];
    const { warnings } = summarizeUsageWarnings(rows);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Workflows");
    expect(warnings[0]).toContain("approaching");
    expect(warnings[0]).toContain("90%");
  });

  it("includes both exceeded and approaching warnings", () => {
    const rows = [
      makeRow("seats", "exceeded", 110, 100, 1.1),
      makeRow("workflows", "approaching", 9, 10, 0.9),
    ];
    const { warnings } = summarizeUsageWarnings(rows);
    expect(warnings).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - TenantUsageSummary new fields in buildUsageSummary
// ─────────────────────────────────────────────────────────────────────────────

describe("T11: buildUsageSummary new fields", () => {
  it("returns defaults when no opts provided", () => {
    const summary = buildUsageSummary(10, NOW);
    expect(summary.usageWarningCount).toBe(0);
    expect(summary.usageExceededCount).toBe(0);
    expect(summary.capacityRiskLevel).toBe("unknown");
    expect(summary.activeUsers).toBe(10);
  });

  it("applies opts correctly", () => {
    const summary = buildUsageSummary(50, NOW, {
      seatLimit:          100,
      usageWarningCount:  1,
      usageExceededCount: 2,
      capacityRiskLevel:  "high",
    });
    expect(summary.seatLimit).toBe(100);
    expect(summary.usageWarningCount).toBe(1);
    expect(summary.usageExceededCount).toBe(2);
    expect(summary.capacityRiskLevel).toBe("high");
  });

  it("lastCalculatedAt is set to now", () => {
    const summary = buildUsageSummary(0, NOW);
    expect(summary.lastCalculatedAt).toBe(NOW.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - deriveRiskSignalSummary reflects usage signals
// ─────────────────────────────────────────────────────────────────────────────

describe("T12: deriveRiskSignalSummary reflects usage signals", () => {
  it("usageLimitApproaching=false by default when no signals provided", () => {
    const result = deriveRiskSignalSummary("active", 5);
    expect(result.usageLimitApproaching).toBe(false);
    expect(result.usageLimitExceeded).toBe(false);
  });

  it("passes through usageSignals correctly", () => {
    const result = deriveRiskSignalSummary("active", 5, null, NOW, {
      usageLimitApproaching: true,
      usageLimitExceeded:    false,
    });
    expect(result.usageLimitApproaching).toBe(true);
    expect(result.usageLimitExceeded).toBe(false);
  });

  it("usageLimitApproaching elevates riskLevel to at least low for an otherwise-clean workspace", () => {
    const result = deriveRiskSignalSummary("active", 5, null, NOW, {
      usageLimitApproaching: true,
      usageLimitExceeded:    false,
    });
    expect(result.riskLevel).toBe("low");
  });

  it("usageLimitExceeded elevates riskLevel to at least medium", () => {
    const result = deriveRiskSignalSummary("active", 5, null, NOW, {
      usageLimitApproaching: false,
      usageLimitExceeded:    true,
    });
    expect(result.riskLevel).toBe("medium");
  });

  it("suspended workspace overrides usage signals (high risk from suspension)", () => {
    const result = deriveRiskSignalSummary("suspended", 5, null, NOW, {
      usageLimitApproaching: true,
      usageLimitExceeded:    true,
    });
    expect(result.riskLevel).toBe("high"); // suspended > exceeded (medium)
  });

  it("disabled workspace is always critical, ignores usage signals", () => {
    const result = deriveRiskSignalSummary("disabled", 5, null, NOW, {
      usageLimitApproaching: false,
      usageLimitExceeded:    false,
    });
    expect(result.riskLevel).toBe("critical");
  });
});
