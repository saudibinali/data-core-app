/**
 * @file   __tests__/platform-usage.test.ts
 * @phase  P13-E - Usage Limits, Quotas & Capacity Intelligence
 *
 * Tests T13-T17 covering the frontend usage config, safety contract,
 * and wording guarantees. No API calls - pure config tests.
 */

import { describe, it, expect } from "vitest";
import {
  USAGE_METRIC_CONFIG,
  USAGE_STATUS_CONFIG,
  CAPACITY_RISK_CONFIG,
  METRIC_SOURCE_CONFIG,
  USAGE_SAFETY_CONTRACT,
  USAGE_READ_HOOK_NAMES,
  ALL_USAGE_METRIC_CODES,
  type UsageMetricCode,
  type UsageLimitStatus,
  type CapacityRiskLevel,
  type MetricSourceType,
} from "../platform-usage-config";

// ─────────────────────────────────────────────────────────────────────────────
// T13 - Frontend usage metric config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T13: frontend usage metric config stable", () => {
  it("ALL_USAGE_METRIC_CODES has exactly 10 codes", () => {
    expect(ALL_USAGE_METRIC_CODES).toHaveLength(10);
  });

  it("USAGE_METRIC_CONFIG has an entry for every code", () => {
    for (const code of ALL_USAGE_METRIC_CODES) {
      expect(USAGE_METRIC_CONFIG[code]).toBeDefined();
    }
  });

  it("every USAGE_METRIC_CONFIG entry has required fields", () => {
    for (const [code, cfg] of Object.entries(USAGE_METRIC_CONFIG)) {
      expect(cfg.code).toBe(code);
      expect(typeof cfg.label).toBe("string");
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(typeof cfg.unit).toBe("string");
      expect(cfg.unit.length).toBeGreaterThan(0);
      expect(typeof cfg.description).toBe("string");
      expect(cfg.description.length).toBeGreaterThan(0);
      expect(typeof cfg.order).toBe("number");
      expect(typeof cfg.supportsLimitComparison).toBe("boolean");
    }
  });

  it("order values are unique and sequential starting at 0", () => {
    const orders = ALL_USAGE_METRIC_CODES.map(c => USAGE_METRIC_CONFIG[c].order);
    expect(new Set(orders).size).toBe(orders.length);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(sorted[0]).toBe(0);
    expect(sorted[sorted.length - 1]).toBe(ALL_USAGE_METRIC_CODES.length - 1);
  });

  it("seats and workflows support limit comparison", () => {
    expect(USAGE_METRIC_CONFIG["seats"].supportsLimitComparison).toBe(true);
    expect(USAGE_METRIC_CONFIG["workflows"].supportsLimitComparison).toBe(true);
  });

  it("non-measurable metrics do not support limit comparison", () => {
    const noComparison: UsageMetricCode[] = [
      "storage_gb", "monthly_api_calls", "documents",
      "custom_reports", "integrations", "ai_actions",
      "audit_retention_days", "workspaces",
    ];
    for (const code of noComparison) {
      expect(USAGE_METRIC_CONFIG[code].supportsLimitComparison).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - Frontend usage status config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T14: frontend USAGE_STATUS_CONFIG stable", () => {
  const ALL_STATUSES: UsageLimitStatus[] = [
    "unknown", "normal", "approaching", "exceeded", "unlimited", "not_applicable",
  ];

  it("has entries for all 6 statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(USAGE_STATUS_CONFIG[status]).toBeDefined();
    }
  });

  it("every entry has label, description, and badgeClass", () => {
    for (const [status, cfg] of Object.entries(USAGE_STATUS_CONFIG)) {
      expect(typeof cfg.label).toBe("string");
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(typeof cfg.description).toBe("string");
      expect(cfg.description.length).toBeGreaterThan(0);
      expect(typeof cfg.badgeClass).toBe("string");
      expect(cfg.badgeClass.length).toBeGreaterThan(0);
    }
  });

  it("all source types have entries in METRIC_SOURCE_CONFIG", () => {
    const ALL_SOURCES: MetricSourceType[] = ["live_db", "derived", "configured", "unavailable"];
    for (const src of ALL_SOURCES) {
      expect(METRIC_SOURCE_CONFIG[src]).toBeDefined();
      const cfg = METRIC_SOURCE_CONFIG[src];
      expect(typeof cfg.label).toBe("string");
      expect(typeof cfg.description).toBe("string");
      expect(typeof cfg.badgeClass).toBe("string");
    }
  });

  it("badgeClass values contain Tailwind class patterns", () => {
    for (const cfg of Object.values(USAGE_STATUS_CONFIG)) {
      expect(cfg.badgeClass).toMatch(/bg-|text-/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Frontend CAPACITY_RISK_CONFIG stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T15: CAPACITY_RISK_CONFIG stable", () => {
  const ALL_RISK_LEVELS: CapacityRiskLevel[] = [
    "none", "low", "medium", "high", "critical", "unknown",
  ];

  it("has entries for all 6 risk levels", () => {
    for (const level of ALL_RISK_LEVELS) {
      expect(CAPACITY_RISK_CONFIG[level]).toBeDefined();
    }
  });

  it("every entry has label, description, and badgeClass", () => {
    for (const [level, cfg] of Object.entries(CAPACITY_RISK_CONFIG)) {
      expect(typeof cfg.label).toBe("string");
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(typeof cfg.description).toBe("string");
      expect(cfg.description.length).toBeGreaterThan(0);
      expect(typeof cfg.badgeClass).toBe("string");
      expect(cfg.badgeClass.length).toBeGreaterThan(0);
    }
  });

  it("critical has more severe styling than none", () => {
    const criticalClass = CAPACITY_RISK_CONFIG.critical.badgeClass;
    const noneClass     = CAPACITY_RISK_CONFIG.none.badgeClass;
    expect(criticalClass).not.toBe(noneClass);
    expect(criticalClass).toMatch(/red/);
    expect(noneClass).toMatch(/emerald|green/);
  });

  it("USAGE_READ_HOOK_NAMES contains exactly one entry", () => {
    expect(USAGE_READ_HOOK_NAMES).toHaveLength(1);
    expect(USAGE_READ_HOOK_NAMES[0]).toBe("useTenantUsage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - No forbidden wording in frontend usage config
// ─────────────────────────────────────────────────────────────────────────────

describe("T16: no billing/payment/enforcement/legal/suspension wording", () => {
  const FORBIDDEN_PATTERNS = [
    /\bpayment\b/i,
    /\bbilling\b/i,
    /\binvoice\b/i,
    /\bcharge\b/i,
    /\btax\b/i,
    /\brefund\b/i,
    /\bauto.?suspend/i,
    /\bautomatic.?suspension/i,
    /\bdelete.?data/i,
    /\bdata.?delet/i,
    /\blegal.?notice/i,
    /\bemail.?notice/i,
    /\bsend.?email/i,
    /\benforce.?limit/i,
    /\bhard.?enforce/i,
    /\bHR.?module.?execut/i,
    /\bpayroll.?process/i,
  ];

  function allConfigStrings(): string[] {
    const strings: string[] = [];

    for (const cfg of Object.values(USAGE_METRIC_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    for (const cfg of Object.values(USAGE_STATUS_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    for (const cfg of Object.values(CAPACITY_RISK_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    for (const cfg of Object.values(METRIC_SOURCE_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }

    return strings;
  }

  it("no forbidden wording in any config label or description", () => {
    const strings = allConfigStrings();
    const violations: string[] = [];

    for (const s of strings) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(s)) {
          violations.push(`Pattern ${pattern} matched in: "${s}"`);
        }
      }
    }

    expect(violations).toHaveLength(0);
  });

  it("USAGE_SAFETY_CONTRACT all properties are true", () => {
    for (const [key, value] of Object.entries(USAGE_SAFETY_CONTRACT)) {
      expect(value).toBe(true);
    }
  });

  it("USAGE_SAFETY_CONTRACT has the expected keys", () => {
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("superAdminOnly",              true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("readOnly",                    true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noPaymentProcessing",         true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noInvoiceGeneration",         true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noChargeCollection",          true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noAutoWorkspaceSuspension",   true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noDataDeletion",              true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noHardLimitEnforcement",      true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("noEmailOrLegalNotices",       true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("prefersUnknownOverInference", true);
    expect(USAGE_SAFETY_CONTRACT).toHaveProperty("failsClosedOnInvalidTenant",  true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 - Frontend/backend test consistency check
// ─────────────────────────────────────────────────────────────────────────────

describe("T17: frontend/backend config symmetry", () => {
  it("frontend has the same 10 metric codes as defined in the spec", () => {
    const EXPECTED: UsageMetricCode[] = [
      "seats", "storage_gb", "monthly_api_calls", "documents", "workflows",
      "custom_reports", "integrations", "ai_actions", "audit_retention_days", "workspaces",
    ];
    for (const code of EXPECTED) {
      expect(ALL_USAGE_METRIC_CODES).toContain(code);
      expect(USAGE_METRIC_CONFIG[code]).toBeDefined();
    }
    expect(ALL_USAGE_METRIC_CODES).toHaveLength(EXPECTED.length);
  });

  it("frontend status config covers all status values from the spec", () => {
    const EXPECTED_STATUSES: UsageLimitStatus[] = [
      "unknown", "normal", "approaching", "exceeded", "unlimited", "not_applicable",
    ];
    for (const status of EXPECTED_STATUSES) {
      expect(USAGE_STATUS_CONFIG[status]).toBeDefined();
    }
  });

  it("frontend risk config covers all risk levels from the spec", () => {
    const EXPECTED_RISK_LEVELS: CapacityRiskLevel[] = [
      "none", "low", "medium", "high", "critical", "unknown",
    ];
    for (const level of EXPECTED_RISK_LEVELS) {
      expect(CAPACITY_RISK_CONFIG[level]).toBeDefined();
    }
  });
});
