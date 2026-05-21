/**
 * @file   src/lib/__tests__/governance-analytics-visualization.test.ts
 * @phase  P12-E - Governance Analytics UI & Compliance Intelligence Visualization Foundations
 *
 * Pure node-environment tests.
 * Imports ONLY from governance-console-config.ts - no React, no DOM, no hooks.
 *
 * T1   analytics metric map stable
 * T2   workflow effectiveness score map stable
 * T3   analytics page remains super-admin scoped
 * T4   time range options stable
 * T5   chart config deterministic
 * T6   policy effectiveness columns stable
 * T7   no mutation/AI/legal/export labels exist
 * T8   analytics safety contract true
 * T9   hooks remain read-only (name-based assertion via GOVERNANCE_READ_HOOK_NAMES)
 * T10  config shapes correct
 */

import { describe, it, expect } from "vitest";
import {
  ANALYTICS_METRIC_MAP,
  ALL_ANALYTICS_METRIC_KEYS,
  WORKFLOW_EFFECTIVENESS_SCORE_MAP,
  WORKFLOW_EFFECTIVENESS_SCORE_ORDER,
  ANALYTICS_TIME_RANGE_OPTIONS,
  POLICY_EFFECTIVENESS_COLUMNS,
  TREND_SEVERITY_COLOURS,
  ANALYTICS_UI_SAFETY_CONTRACT,
  ANALYTICS_EMPTY_STATE,
  GOVERNANCE_READ_HOOK_NAMES,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  type AnalyticsMetricKey,
  type WorkflowEffectivenessScoreKey,
  type AnalyticsTimeRangeKey,
} from "../governance-console-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Analytics metric map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - Analytics metric map stable", () => {
  it("has exactly 13 metrics", () => {
    expect(ALL_ANALYTICS_METRIC_KEYS.length).toBe(13);
  });

  it("every metric has label, unit, tier, description, order", () => {
    for (const key of ALL_ANALYTICS_METRIC_KEYS) {
      const m = ANALYTICS_METRIC_MAP[key];
      expect(typeof m.label).toBe("string");
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.unit).toBe("string");
      expect(typeof m.tier).toBe("string");
      expect(typeof m.description).toBe("string");
      expect(m.description.length).toBeGreaterThan(0);
      expect(typeof m.order).toBe("number");
    }
  });

  it("order values are unique and span 0..12", () => {
    const orders = ALL_ANALYTICS_METRIC_KEYS.map(k => ANALYTICS_METRIC_MAP[k].order);
    const unique = new Set(orders);
    expect(unique.size).toBe(13);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(12);
  });

  it("required keys present: unresolvedCriticalCount, escalationRate, throughputRate", () => {
    const required: AnalyticsMetricKey[] = [
      "totalWorkflows",
      "activeWorkflows",
      "escalatedWorkflows",
      "unresolvedCriticalCount",
      "escalationRate",
      "throughputRate",
      "dismissalFrequency",
      "escalationToResolutionRatio",
      "averageResolutionDurationMs",
      "averageAcknowledgmentDurationMs",
      "criticalUnresolvedDurationMs",
    ];
    for (const k of required) {
      expect(ANALYTICS_METRIC_MAP).toHaveProperty(k);
    }
  });

  it("unit values are valid enum members", () => {
    const validUnits = ["count", "percent", "ms", "ratio"] as const;
    for (const key of ALL_ANALYTICS_METRIC_KEYS) {
      expect(validUnits as readonly string[]).toContain(ANALYTICS_METRIC_MAP[key].unit);
    }
  });

  it("no label contains forbidden terms (AI / export / legal)", () => {
    const forbidden = ["ai", "predict", "forecast", "export", "pdf", "legal", "verdict", "guilty"];
    for (const key of ALL_ANALYTICS_METRIC_KEYS) {
      const label = ANALYTICS_METRIC_MAP[key].label.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Workflow effectiveness score map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - Workflow effectiveness score map stable", () => {
  it("has exactly 5 score levels", () => {
    expect(Object.keys(WORKFLOW_EFFECTIVENESS_SCORE_MAP).length).toBe(5);
  });

  it("order tuple has 5 entries, matching the map keys", () => {
    expect(WORKFLOW_EFFECTIVENESS_SCORE_ORDER.length).toBe(5);
    for (const key of WORKFLOW_EFFECTIVENESS_SCORE_ORDER) {
      expect(WORKFLOW_EFFECTIVENESS_SCORE_MAP).toHaveProperty(key);
    }
  });

  it("canonical keys present: unstable, inconsistent, acceptable, effective, highly_effective", () => {
    const expected: WorkflowEffectivenessScoreKey[] = [
      "unstable", "inconsistent", "acceptable", "effective", "highly_effective",
    ];
    for (const k of expected) {
      expect(WORKFLOW_EFFECTIVENESS_SCORE_MAP).toHaveProperty(k);
    }
  });

  it("every score has label, description, tier, order", () => {
    for (const key of WORKFLOW_EFFECTIVENESS_SCORE_ORDER) {
      const s = WORKFLOW_EFFECTIVENESS_SCORE_MAP[key];
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
      expect(typeof s.tier).toBe("string");
      expect(typeof s.order).toBe("number");
    }
  });

  it("order is ascending 0..4 by WORKFLOW_EFFECTIVENESS_SCORE_ORDER", () => {
    WORKFLOW_EFFECTIVENESS_SCORE_ORDER.forEach((key, idx) => {
      expect(WORKFLOW_EFFECTIVENESS_SCORE_MAP[key].order).toBe(idx);
    });
  });

  it("unstable is lowest order, highly_effective is highest", () => {
    expect(WORKFLOW_EFFECTIVENESS_SCORE_MAP.unstable.order).toBe(0);
    expect(WORKFLOW_EFFECTIVENESS_SCORE_MAP.highly_effective.order).toBe(4);
  });

  it("no label contains disciplinary or legal wording", () => {
    const forbidden = ["discipline", "legal", "verdict", "guilty", "penalt", "suspend"];
    for (const key of WORKFLOW_EFFECTIVENESS_SCORE_ORDER) {
      const label = WORKFLOW_EFFECTIVENESS_SCORE_MAP[key].label.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Analytics page remains super-admin scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - Analytics page super-admin scoped", () => {
  it("ANALYTICS_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(ANALYTICS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true (base contract)", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("base safety contract remains intact", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.readOnly).toBe(true);
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noMutationControls).toBe(true);
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noAutoEnforcement).toBe(true);
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Time range options stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - Time range options stable", () => {
  it("has exactly 4 options: 7d, 30d, 90d, all", () => {
    expect(ANALYTICS_TIME_RANGE_OPTIONS.length).toBe(4);
    const values = ANALYTICS_TIME_RANGE_OPTIONS.map(o => o.value);
    expect(values).toContain("7d");
    expect(values).toContain("30d");
    expect(values).toContain("90d");
    expect(values).toContain("all");
  });

  it("every option has a non-empty label", () => {
    for (const opt of ANALYTICS_TIME_RANGE_OPTIONS) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it("value types are valid AnalyticsTimeRangeKey", () => {
    const validValues: AnalyticsTimeRangeKey[] = ["7d", "30d", "90d", "all"];
    for (const opt of ANALYTICS_TIME_RANGE_OPTIONS) {
      expect(validValues as string[]).toContain(opt.value);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Chart config deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - Chart config deterministic", () => {
  it("TREND_SEVERITY_COLOURS has entries for critical, high, medium, low, informational, total", () => {
    const required = ["critical", "high", "medium", "low", "informational", "total"];
    for (const key of required) {
      expect(TREND_SEVERITY_COLOURS).toHaveProperty(key);
      expect(typeof TREND_SEVERITY_COLOURS[key]).toBe("string");
      expect(TREND_SEVERITY_COLOURS[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("all severity colours are valid hex strings", () => {
    for (const [, colour] of Object.entries(TREND_SEVERITY_COLOURS)) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("ANALYTICS_EMPTY_STATE has 4 expected keys", () => {
    expect(ANALYTICS_EMPTY_STATE).toHaveProperty("noTrendData");
    expect(ANALYTICS_EMPTY_STATE).toHaveProperty("noPolicyEffectivenessData");
    expect(ANALYTICS_EMPTY_STATE).toHaveProperty("noUnresolvedCritical");
    expect(ANALYTICS_EMPTY_STATE).toHaveProperty("noAnalyticsData");
  });

  it("every empty state entry has title and description", () => {
    for (const [, entry] of Object.entries(ANALYTICS_EMPTY_STATE)) {
      expect(typeof entry.title).toBe("string");
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Policy effectiveness columns stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - Policy effectiveness columns stable", () => {
  it("has exactly 8 columns", () => {
    expect(POLICY_EFFECTIVENESS_COLUMNS.length).toBe(8);
  });

  it("required columns present: policyId, policyName, totalViolations, confirmedViolationRate, falsePositiveRate, escalationFrequency, averageResolutionDuration, policyStabilityScore", () => {
    const keys = POLICY_EFFECTIVENESS_COLUMNS.map(c => c.key);
    const required = [
      "policyId", "policyName", "totalViolations",
      "confirmedViolationRate", "falsePositiveRate", "escalationFrequency",
      "averageResolutionDuration", "policyStabilityScore",
    ];
    for (const k of required) {
      expect(keys).toContain(k);
    }
  });

  it("every column has label and width", () => {
    for (const col of POLICY_EFFECTIVENESS_COLUMNS) {
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
      expect(typeof col.width).toBe("string");
    }
  });

  it("policyId column is marked mono", () => {
    const policyIdCol = POLICY_EFFECTIVENESS_COLUMNS.find(c => c.key === "policyId");
    expect(policyIdCol?.mono).toBe(true);
  });

  it("policyName column is not mono", () => {
    const nameCol = POLICY_EFFECTIVENESS_COLUMNS.find(c => c.key === "policyName");
    expect(nameCol?.mono).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - No mutation / AI / legal / export labels exist
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - No mutation, AI, legal, or export labels", () => {
  // Forbidden phrases for metric labels
  const metricLabelForbidden = [
    "auto-escalate", "auto escalate",
    "auto-tune", "auto tune",
    "export", "pdf", "xlsx", "ai summary", "ai-generated",
    "legal verdict", "legal risk", "guilty", "discipline",
    "submit to regulator", "trigger",
  ];

  it("no analytics metric label contains forbidden phrases", () => {
    for (const key of ALL_ANALYTICS_METRIC_KEYS) {
      const label = ANALYTICS_METRIC_MAP[key].label.toLowerCase();
      const desc  = ANALYTICS_METRIC_MAP[key].description.toLowerCase();
      for (const phrase of metricLabelForbidden) {
        expect(label).not.toContain(phrase);
        expect(desc).not.toContain(phrase);
      }
    }
  });

  it("no effectiveness score label or description contains forbidden phrases", () => {
    const forbidden = [
      "auto-escalate", "trigger", "export", "pdf",
      "ai summary", "legal verdict", "guilty", "discipline",
    ];
    for (const key of WORKFLOW_EFFECTIVENESS_SCORE_ORDER) {
      const label = WORKFLOW_EFFECTIVENESS_SCORE_MAP[key].label.toLowerCase();
      const desc  = WORKFLOW_EFFECTIVENESS_SCORE_MAP[key].description.toLowerCase();
      for (const phrase of forbidden) {
        expect(label).not.toContain(phrase);
        expect(desc).not.toContain(phrase);
      }
    }
  });

  it("no time range option label contains forbidden phrases", () => {
    const forbidden = ["export", "ai", "auto", "legal"];
    for (const opt of ANALYTICS_TIME_RANGE_OPTIONS) {
      for (const phrase of forbidden) {
        expect(opt.label.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it("no policy effectiveness column label contains forbidden phrases", () => {
    const forbidden = ["auto-tune", "export", "ai", "legal verdict", "trigger"];
    for (const col of POLICY_EFFECTIVENESS_COLUMNS) {
      for (const phrase of forbidden) {
        expect(col.label.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Analytics safety contract true
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - Analytics safety contract all true", () => {
  const keys = Object.keys(ANALYTICS_UI_SAFETY_CONTRACT) as (keyof typeof ANALYTICS_UI_SAFETY_CONTRACT)[];

  it("has exactly 10 contract properties", () => {
    expect(keys.length).toBe(10);
  });

  it("every property is true", () => {
    for (const key of keys) {
      expect(ANALYTICS_UI_SAFETY_CONTRACT[key]).toBe(true);
    }
  });

  it("required properties are all present and true", () => {
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noAutoEscalation).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noPolicyAutoTuning).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noAnalyticsMutation).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noRecommendationEngine).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noLegalConclusions).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noAiPredictions).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noAiSummaries).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noExportRendering).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.noRegulatorSubmission).toBe(true);
    expect(ANALYTICS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Hooks remain read-only (name-based assertions)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - Governance read hook names remain read-only", () => {
  it("GOVERNANCE_READ_HOOK_NAMES has at least 16 entries", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(16);
  });

  it("required analytics hooks present: useGovernanceAnalytics, useGovernanceAnalyticsEffectiveness, useGovernancePolicyEffectiveness", () => {
    const required = [
      "useGovernanceAnalytics",
      "useGovernanceAnalyticsEffectiveness",
      "useGovernancePolicyEffectiveness",
    ];
    for (const name of required) {
      expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain(name);
    }
  });

  it("no hook name starts with useMutate, useCreate, useDelete, useUpdate, usePost", () => {
    const mutationPrefixes = ["useMutate", "useCreate", "useDelete", "useUpdate", "usePost"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const prefix of mutationPrefixes) {
        expect(name.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("all hook names start with 'useGovernance'", () => {
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      expect(name.startsWith("useGovernance")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Config shapes correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - Config shapes correct", () => {
  it("ANALYTICS_METRIC_MAP is a plain object with correct shape", () => {
    expect(typeof ANALYTICS_METRIC_MAP).toBe("object");
    expect(ANALYTICS_METRIC_MAP).not.toBeNull();
    const sample = ANALYTICS_METRIC_MAP.totalWorkflows;
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("unit");
    expect(sample).toHaveProperty("tier");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("order");
  });

  it("WORKFLOW_EFFECTIVENESS_SCORE_MAP sample has correct shape", () => {
    const sample = WORKFLOW_EFFECTIVENESS_SCORE_MAP.effective;
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("tier");
    expect(sample).toHaveProperty("order");
    expect(sample.tier).toBe("good");
  });

  it("ANALYTICS_TIME_RANGE_OPTIONS entries have value and label", () => {
    for (const opt of ANALYTICS_TIME_RANGE_OPTIONS) {
      expect(typeof opt.value).toBe("string");
      expect(typeof opt.label).toBe("string");
    }
  });

  it("TREND_SEVERITY_COLOURS is a plain object of hex strings", () => {
    expect(typeof TREND_SEVERITY_COLOURS).toBe("object");
    expect(Object.keys(TREND_SEVERITY_COLOURS).length).toBeGreaterThanOrEqual(6);
  });

  it("ANALYTICS_EMPTY_STATE entries each have title and description fields", () => {
    const entries = Object.values(ANALYTICS_EMPTY_STATE);
    expect(entries.length).toBe(4);
    for (const e of entries) {
      expect(typeof e.title).toBe("string");
      expect(typeof e.description).toBe("string");
    }
  });

  it("POLICY_EFFECTIVENESS_COLUMNS is a non-empty tuple of column defs", () => {
    expect(Array.isArray(POLICY_EFFECTIVENESS_COLUMNS)).toBe(true);
    expect(POLICY_EFFECTIVENESS_COLUMNS.length).toBeGreaterThan(0);
    const first = POLICY_EFFECTIVENESS_COLUMNS[0];
    expect(first).toHaveProperty("key");
    expect(first).toHaveProperty("label");
    expect(first).toHaveProperty("width");
    expect(first).toHaveProperty("mono");
  });

  it("ANALYTICS_UI_SAFETY_CONTRACT is a plain object with all boolean values", () => {
    for (const val of Object.values(ANALYTICS_UI_SAFETY_CONTRACT)) {
      expect(typeof val).toBe("boolean");
    }
  });

  it("critical metric has tier=critical, good metric has tier=good", () => {
    expect(ANALYTICS_METRIC_MAP.unresolvedCriticalCount.tier).toBe("critical");
    expect(ANALYTICS_METRIC_MAP.throughputRate.tier).toBe("good");
  });

  it("WORKFLOW_EFFECTIVENESS_SCORE_ORDER tuple values are unique", () => {
    const set = new Set(WORKFLOW_EFFECTIVENESS_SCORE_ORDER);
    expect(set.size).toBe(WORKFLOW_EFFECTIVENESS_SCORE_ORDER.length);
  });
});
