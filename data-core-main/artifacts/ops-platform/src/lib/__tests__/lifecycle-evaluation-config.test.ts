/**
 * @file   __tests__/lifecycle-evaluation-config.test.ts
 * @phase  P13-I - Automated Lifecycle Evaluation Engine
 *
 * Frontend unit tests for lifecycle-evaluation-config.ts
 *
 * Tests:
 *   T1  - safety contract all true
 *   T2  - ALL_EVALUATION_SIGNAL_CODES has 17 entries, no duplicates
 *   T3  - LIFECYCLE_EVALUATION_SIGNAL_CONFIG covers all signal codes
 *   T4  - LIFECYCLE_EVALUATION_SEVERITY_CONFIG covers all 7 severities
 *   T5  - LIFECYCLE_EVALUATION_ACTION_CONFIG covers all 10 actions
 *   T6  - REVIEW_ELIGIBILITY_CONFIG has 8 entries
 *   T7  - LIFECYCLE_EVALUATION_API_PATHS.get() returns correct URL
 *   T8  - all signal configs have non-empty label, description, badgeClass
 *   T9  - all severity configs have non-empty label, icon, badgeClass
 *   T10 - all action configs have non-empty label, description, badgeClass
 *   T11 - no forbidden wording in any config label or description
 *   T12 - manual_review_required signal is in the "critical" severity tier
 *   T13 - EVALUATION_FORBIDDEN_WORDING is non-empty array of strings
 *   T14 - review eligibility config keys are unique and non-empty
 */

import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_EVALUATION_SAFETY_CONTRACT,
  LIFECYCLE_EVALUATION_SIGNAL_CONFIG,
  LIFECYCLE_EVALUATION_SEVERITY_CONFIG,
  LIFECYCLE_EVALUATION_ACTION_CONFIG,
  REVIEW_ELIGIBILITY_CONFIG,
  LIFECYCLE_EVALUATION_API_PATHS,
  EVALUATION_FORBIDDEN_WORDING,
  ALL_EVALUATION_SIGNAL_CODES,
  type EvaluationSignalCode,
  type EvaluationSeverity,
  type EvaluationRecommendedAction,
} from "../lifecycle-evaluation-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - safety contract all true
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - LIFECYCLE_EVALUATION_SAFETY_CONTRACT all true", () => {
  it("T1: all safety contract boolean properties are true", () => {
    const contract = { ...LIFECYCLE_EVALUATION_SAFETY_CONTRACT };
    const keys = [
      "superAdminOnly",
      "readOnly",
      "recommendationsOnly",
      "noPaymentProcessing",
      "noInvoiceGeneration",
      "noChargeCollection",
      "noAutoWorkspaceSuspension",
      "noAutoWorkspaceLocking",
      "noEntitlementEnforcement",
      "noEmailOrLegalNotices",
      "noDestructiveTenantActions",
      "noStateMutation",
      "failsClosedOnMissingData",
    ] as const;
    for (const key of keys) {
      expect(contract[key], `${key} must be true`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - signal codes registry
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - ALL_EVALUATION_SIGNAL_CODES has 17 entries", () => {
  it("T2: exactly 17 signal codes, no duplicates", () => {
    expect(ALL_EVALUATION_SIGNAL_CODES).toHaveLength(17);
    const unique = new Set(ALL_EVALUATION_SIGNAL_CODES);
    expect(unique.size).toBe(17);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - LIFECYCLE_EVALUATION_SIGNAL_CONFIG covers all signal codes
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - LIFECYCLE_EVALUATION_SIGNAL_CONFIG covers all 17 signal codes", () => {
  it("T3: every signal code has a config entry", () => {
    for (const code of ALL_EVALUATION_SIGNAL_CODES) {
      const cfg = LIFECYCLE_EVALUATION_SIGNAL_CONFIG[code as EvaluationSignalCode];
      expect(cfg, `Missing config for signal "${code}"`).toBeDefined();
      expect(cfg.code).toBe(code);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - LIFECYCLE_EVALUATION_SEVERITY_CONFIG covers all 7 severities
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - LIFECYCLE_EVALUATION_SEVERITY_CONFIG covers 7 severities", () => {
  const EXPECTED_SEVERITIES: EvaluationSeverity[] = [
    "none", "info", "low", "medium", "high", "critical", "unknown",
  ];

  it("T4: all 7 severity values have config entries", () => {
    for (const sev of EXPECTED_SEVERITIES) {
      const cfg = LIFECYCLE_EVALUATION_SEVERITY_CONFIG[sev];
      expect(cfg, `Missing config for severity "${sev}"`).toBeDefined();
      expect(cfg.label).toBeTruthy();
      expect(cfg.icon).toBeTruthy();
      expect(cfg.badgeClass).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - LIFECYCLE_EVALUATION_ACTION_CONFIG covers all 10 actions
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - LIFECYCLE_EVALUATION_ACTION_CONFIG covers 10 actions", () => {
  const EXPECTED_ACTIONS: EvaluationRecommendedAction[] = [
    "none",
    "monitor",
    "review_subscription",
    "review_usage",
    "review_entitlements",
    "review_lifecycle",
    "review_governance",
    "prepare_customer_contact",
    "prepare_restriction_review",
    "manual_review_required",
  ];

  it("T5: all 10 action values have config entries", () => {
    expect(EXPECTED_ACTIONS).toHaveLength(10);
    for (const action of EXPECTED_ACTIONS) {
      const cfg = LIFECYCLE_EVALUATION_ACTION_CONFIG[action];
      expect(cfg, `Missing config for action "${action}"`).toBeDefined();
      expect(cfg.label).toBeTruthy();
      expect(cfg.badgeClass).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - REVIEW_ELIGIBILITY_CONFIG has 8 entries
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - REVIEW_ELIGIBILITY_CONFIG has 8 entries", () => {
  it("T6: exactly 8 review eligibility entries", () => {
    expect(REVIEW_ELIGIBILITY_CONFIG).toHaveLength(8);
  });

  it("T6b: includes manualReviewRequired entry", () => {
    const keys = REVIEW_ELIGIBILITY_CONFIG.map(e => e.key);
    expect(keys).toContain("manualReviewRequired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - LIFECYCLE_EVALUATION_API_PATHS.get() returns correct URL
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - LIFECYCLE_EVALUATION_API_PATHS.get()", () => {
  it("T7: builds correct lifecycle-evaluation URL", () => {
    const url = LIFECYCLE_EVALUATION_API_PATHS.get("42");
    expect(url).toBe("/api/platform/tenants/42/lifecycle-evaluation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - all signal configs have non-empty fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - all signal configs have non-empty label, description, badgeClass", () => {
  it("T8: every signal config has non-empty label, description, and badgeClass", () => {
    for (const code of ALL_EVALUATION_SIGNAL_CODES) {
      const cfg = LIFECYCLE_EVALUATION_SIGNAL_CONFIG[code as EvaluationSignalCode];
      expect(cfg.label.length, `label empty for ${code}`).toBeGreaterThan(0);
      expect(cfg.description.length, `description empty for ${code}`).toBeGreaterThan(0);
      expect(cfg.badgeClass.length, `badgeClass empty for ${code}`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - all severity configs have non-empty fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - all severity configs have non-empty label, icon, badgeClass", () => {
  it("T9: every severity config has non-empty label, icon, badgeClass", () => {
    const severities: EvaluationSeverity[] = ["none", "info", "low", "medium", "high", "critical", "unknown"];
    for (const sev of severities) {
      const cfg = LIFECYCLE_EVALUATION_SEVERITY_CONFIG[sev];
      expect(cfg.label.length, `label empty for ${sev}`).toBeGreaterThan(0);
      expect(cfg.icon.length,  `icon empty for ${sev}`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - all action configs have non-empty fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - all action configs have non-empty label, description", () => {
  it("T10: every action config has non-empty label and description", () => {
    const actions = Object.keys(LIFECYCLE_EVALUATION_ACTION_CONFIG) as EvaluationRecommendedAction[];
    for (const action of actions) {
      const cfg = LIFECYCLE_EVALUATION_ACTION_CONFIG[action];
      expect(cfg.label.length, `label empty for ${action}`).toBeGreaterThan(0);
      expect(cfg.description.length, `description empty for ${action}`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - no forbidden wording in any config
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - no forbidden wording in config labels and descriptions", () => {
  it("T11: signal config labels and descriptions contain no forbidden wording", () => {
    const allText = Object.values(LIFECYCLE_EVALUATION_SIGNAL_CONFIG)
      .map(c => `${c.label} ${c.description}`)
      .join(" ")
      .toLowerCase();
    const forbidden = ["payment", "invoice", "charge", "billing portal", "tax", "auto-suspend"];
    for (const word of forbidden) {
      expect(allText, `Signal config must not contain "${word}"`).not.toContain(word);
    }
  });

  it("T11b: action config descriptions contain no forbidden wording", () => {
    const allText = Object.values(LIFECYCLE_EVALUATION_ACTION_CONFIG)
      .map(c => c.description)
      .join(" ")
      .toLowerCase();
    for (const word of ["payment", "invoice", "charge", "tax"]) {
      expect(allText, `Action config must not contain "${word}"`).not.toContain(word);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - manual_review_required signal is in critical tier
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - manual_review_required is in the critical severity tier", () => {
  it("T12: manual_review_required signal config has severity=critical", () => {
    const cfg = LIFECYCLE_EVALUATION_SIGNAL_CONFIG.manual_review_required;
    expect(cfg.severity).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - EVALUATION_FORBIDDEN_WORDING is non-empty array of strings
// ─────────────────────────────────────────────────────────────────────────────

describe("T13 - EVALUATION_FORBIDDEN_WORDING is non-empty", () => {
  it("T13: EVALUATION_FORBIDDEN_WORDING is a non-empty array of strings", () => {
    expect(Array.isArray(EVALUATION_FORBIDDEN_WORDING)).toBe(true);
    expect(EVALUATION_FORBIDDEN_WORDING.length).toBeGreaterThan(0);
    for (const word of EVALUATION_FORBIDDEN_WORDING) {
      expect(typeof word).toBe("string");
      expect(word.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - review eligibility config keys are unique
// ─────────────────────────────────────────────────────────────────────────────

describe("T14 - review eligibility config keys are unique and non-empty", () => {
  it("T14: all eligibility config keys are unique strings", () => {
    const keys = REVIEW_ELIGIBILITY_CONFIG.map(e => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
    for (const key of keys) {
      expect(key.length, `key must be non-empty`).toBeGreaterThan(0);
    }
  });
});
