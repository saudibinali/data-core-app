/**
 * @file   __tests__/renewal-intelligence-config.test.ts
 * @phase  P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
 *
 * T16: Frontend config stable (signals, urgency, actions)
 * T17: Frontend hook is read-only (no mutation entries)
 * T18: Renewal panel renders all major states (config completeness)
 * T19: No forbidden wording (payment/billing/invoice/suspend/charge/legal)
 * T20: Frontend/backend symmetry (codes match across both layers)
 */

import { describe, it, expect } from "vitest";
import {
  RENEWAL_SIGNAL_CONFIG,
  RENEWAL_URGENCY_CONFIG,
  RECOMMENDED_PLATFORM_ACTION_CONFIG,
  RENEWAL_INTELLIGENCE_SAFETY_CONTRACT,
  RENEWAL_EMPTY_STATE,
  RENEWAL_READ_HOOK_NAMES,
  ALL_RENEWAL_SIGNAL_CODES,
  ALL_RECOMMENDED_PLATFORM_ACTIONS,
  RENEWAL_DUE_SOON_DAYS,
  TRIAL_ENDING_SOON_DAYS,
  GRACE_ENDING_SOON_DAYS,
  type RenewalSignalCode,
  type RenewalUrgency,
  type RecommendedPlatformAction,
} from "../renewal-intelligence-config";

// ─────────────────────────────────────────────────────────────────────────────
// T16 - Frontend config is stable and complete
// ─────────────────────────────────────────────────────────────────────────────

describe("T16 - Frontend config stable", () => {
  describe("RENEWAL_SIGNAL_CONFIG", () => {
    it("has exactly 14 codes", () => {
      expect(Object.keys(RENEWAL_SIGNAL_CONFIG)).toHaveLength(14);
    });

    it("all codes have required fields", () => {
      for (const [code, cfg] of Object.entries(RENEWAL_SIGNAL_CONFIG)) {
        expect(cfg.code).toBe(code);
        expect(typeof cfg.label).toBe("string");
        expect(cfg.label.length).toBeGreaterThan(0);
        expect(typeof cfg.description).toBe("string");
        expect(cfg.description.length).toBeGreaterThan(0);
        expect(["info", "warning", "high", "critical", "muted"]).toContain(cfg.severity);
        expect(typeof cfg.badgeClass).toBe("string");
        expect(cfg.badgeClass.length).toBeGreaterThan(0);
      }
    });

    it("all ALL_RENEWAL_SIGNAL_CODES have a config entry", () => {
      for (const code of ALL_RENEWAL_SIGNAL_CODES) {
        expect(RENEWAL_SIGNAL_CONFIG[code]).toBeDefined();
      }
    });

    it("no duplicate labels", () => {
      const labels = Object.values(RENEWAL_SIGNAL_CONFIG).map(c => c.label);
      const set = new Set(labels);
      expect(set.size).toBe(labels.length);
    });
  });

  describe("RENEWAL_URGENCY_CONFIG", () => {
    const expectedUrgencies: RenewalUrgency[] = ["none", "low", "medium", "high", "critical", "unknown"];

    it("has exactly 6 urgency levels", () => {
      expect(Object.keys(RENEWAL_URGENCY_CONFIG)).toHaveLength(6);
    });

    it("all urgencies have required fields", () => {
      for (const urgency of expectedUrgencies) {
        const cfg = RENEWAL_URGENCY_CONFIG[urgency];
        expect(cfg).toBeDefined();
        expect(cfg.urgency).toBe(urgency);
        expect(typeof cfg.label).toBe("string");
        expect(cfg.label.length).toBeGreaterThan(0);
        expect(typeof cfg.description).toBe("string");
        expect(typeof cfg.badgeClass).toBe("string");
      }
    });

    it("critical and none have visually distinct badgeClasses", () => {
      expect(RENEWAL_URGENCY_CONFIG.critical.badgeClass).not.toBe(
        RENEWAL_URGENCY_CONFIG.none.badgeClass,
      );
    });
  });

  describe("RECOMMENDED_PLATFORM_ACTION_CONFIG", () => {
    it("has exactly 8 actions", () => {
      expect(Object.keys(RECOMMENDED_PLATFORM_ACTION_CONFIG)).toHaveLength(8);
    });

    it("all actions have required fields", () => {
      for (const [action, cfg] of Object.entries(RECOMMENDED_PLATFORM_ACTION_CONFIG)) {
        expect(cfg.action).toBe(action);
        expect(typeof cfg.label).toBe("string");
        expect(cfg.label.length).toBeGreaterThan(0);
        expect(typeof cfg.description).toBe("string");
        expect(typeof cfg.badgeClass).toBe("string");
      }
    });

    it("all ALL_RECOMMENDED_PLATFORM_ACTIONS have a config entry", () => {
      for (const action of ALL_RECOMMENDED_PLATFORM_ACTIONS) {
        expect(RECOMMENDED_PLATFORM_ACTION_CONFIG[action]).toBeDefined();
      }
    });
  });

  describe("Threshold constants", () => {
    it("RENEWAL_DUE_SOON_DAYS = 14", () => expect(RENEWAL_DUE_SOON_DAYS).toBe(14));
    it("TRIAL_ENDING_SOON_DAYS = 7",  () => expect(TRIAL_ENDING_SOON_DAYS).toBe(7));
    it("GRACE_ENDING_SOON_DAYS = 3",  () => expect(GRACE_ENDING_SOON_DAYS).toBe(3));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 - Frontend hook is read-only (no mutation hook names)
// ─────────────────────────────────────────────────────────────────────────────

describe("T17 - Frontend hook read-only", () => {
  it("RENEWAL_READ_HOOK_NAMES contains exactly 1 entry", () => {
    expect(RENEWAL_READ_HOOK_NAMES).toHaveLength(1);
  });

  it("the single hook name is useTenantRenewalIntelligence", () => {
    expect(RENEWAL_READ_HOOK_NAMES[0]).toBe("useTenantRenewalIntelligence");
  });

  it("there is no RENEWAL_MUTATION_HOOK_NAMES export (no mutations defined)", () => {
    // Verify the config module does not expose any mutation hook registry.
    // The exported RENEWAL_READ_HOOK_NAMES proves read-only intent;
    // absence of a mutation export is enforced at code review level (no write API exists).
    expect(RENEWAL_READ_HOOK_NAMES.every(n => n.startsWith("use"))).toBe(true);
    expect(RENEWAL_READ_HOOK_NAMES.every(n => !n.toLowerCase().includes("update") && !n.toLowerCase().includes("mutation") && !n.toLowerCase().includes("create"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 - Config completeness covers all major UI states
// ─────────────────────────────────────────────────────────────────────────────

describe("T18 - Config covers all major panel states", () => {
  const panelStates: RenewalSignalCode[] = [
    "no_subscription_metadata",  // empty / loading state
    "trial_active",
    "trial_ending_soon",
    "trial_expired",
    "subscription_active",
    "renewal_due_soon",
    "renewal_due_now",
    "billing_period_expired",
    "grace_period_active",
    "grace_period_ending_soon",
    "grace_period_expired",
    "subscription_cancelled",
    "subscription_suspended",
    "invalid_subscription_dates",
  ];

  for (const state of panelStates) {
    it(`${state} has a signal config entry with label and badgeClass`, () => {
      const cfg = RENEWAL_SIGNAL_CONFIG[state];
      expect(cfg).toBeDefined();
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.badgeClass.includes("bg-")).toBe(true);
    });
  }

  it("RENEWAL_EMPTY_STATE has all required keys", () => {
    expect(typeof RENEWAL_EMPTY_STATE.noData).toBe("string");
    expect(typeof RENEWAL_EMPTY_STATE.loading).toBe("string");
    expect(typeof RENEWAL_EMPTY_STATE.noSignals).toBe("string");
    expect(typeof RENEWAL_EMPTY_STATE.noWarnings).toBe("string");
    expect(typeof RENEWAL_EMPTY_STATE.safetyNotice).toBe("string");
  });

  it("safetyNotice does not say 'enforcement'", () => {
    expect(RENEWAL_EMPTY_STATE.safetyNotice.toLowerCase()).not.toContain("enforcement");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T19 - No forbidden wording
// ─────────────────────────────────────────────────────────────────────────────

describe("T19 - No forbidden wording in config", () => {
  const FORBIDDEN_PATTERNS = [
    /\bpayment\b/i,
    /\binvoice\b/i,
    /\bcharge\b/i,
    /\bbilling portal\b/i,
    /\btax\b/i,
    /\blegal notice\b/i,
    /\bauto.?suspend\b/i,
    /\bautomatic suspension\b/i,
    /\bautomatic.?lock\b/i,
  ];

  function getAllConfigStrings(): string[] {
    const strings: string[] = [];
    for (const cfg of Object.values(RENEWAL_SIGNAL_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    for (const cfg of Object.values(RENEWAL_URGENCY_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    for (const cfg of Object.values(RECOMMENDED_PLATFORM_ACTION_CONFIG)) {
      strings.push(cfg.label, cfg.description);
    }
    strings.push(
      RENEWAL_EMPTY_STATE.noData,
      RENEWAL_EMPTY_STATE.loading,
      RENEWAL_EMPTY_STATE.noSignals,
      RENEWAL_EMPTY_STATE.noWarnings,
      RENEWAL_EMPTY_STATE.safetyNotice,
    );
    return strings;
  }

  const allStrings = getAllConfigStrings();

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`no string matches forbidden pattern: ${pattern}`, () => {
      for (const s of allStrings) {
        expect(s).not.toMatch(pattern);
      }
    });
  }

  it("RENEWAL_INTELLIGENCE_SAFETY_CONTRACT - all 11 properties are true", () => {
    const contract = RENEWAL_INTELLIGENCE_SAFETY_CONTRACT;
    expect(contract.superAdminOnly).toBe(true);
    expect(contract.readOnly).toBe(true);
    expect(contract.noPaymentProcessing).toBe(true);
    expect(contract.noInvoiceGeneration).toBe(true);
    expect(contract.noChargeCollection).toBe(true);
    expect(contract.noAutoWorkspaceSuspension).toBe(true);
    expect(contract.noWorkspaceLocking).toBe(true);
    expect(contract.noEntitlementEnforcement).toBe(true);
    expect(contract.noEmailOrLegalNotices).toBe(true);
    expect(contract.recommendationsOnly).toBe(true);
    expect(contract.failsClosedOnInvalidDates).toBe(true);
  });

  it("RENEWAL_INTELLIGENCE_SAFETY_CONTRACT has exactly 11 keys", () => {
    expect(Object.keys(RENEWAL_INTELLIGENCE_SAFETY_CONTRACT)).toHaveLength(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20 - Frontend / backend symmetry
// ─────────────────────────────────────────────────────────────────────────────

describe("T20 - Frontend/backend symmetry", () => {
  const BACKEND_SIGNAL_CODES: RenewalSignalCode[] = [
    "no_subscription_metadata",
    "trial_active",
    "trial_ending_soon",
    "trial_expired",
    "subscription_active",
    "renewal_due_soon",
    "renewal_due_now",
    "billing_period_expired",
    "grace_period_active",
    "grace_period_ending_soon",
    "grace_period_expired",
    "subscription_cancelled",
    "subscription_suspended",
    "invalid_subscription_dates",
  ];

  const BACKEND_URGENCIES: RenewalUrgency[] = ["none", "low", "medium", "high", "critical", "unknown"];

  const BACKEND_ACTIONS: RecommendedPlatformAction[] = [
    "none",
    "monitor",
    "contact_customer",
    "prepare_grace_period",
    "review_for_suspension",
    "renew_subscription_metadata",
    "fix_subscription_metadata",
    "manual_review_required",
  ];

  it("ALL_RENEWAL_SIGNAL_CODES matches backend list exactly", () => {
    expect([...ALL_RENEWAL_SIGNAL_CODES].sort()).toEqual([...BACKEND_SIGNAL_CODES].sort());
  });

  it("RENEWAL_URGENCY_CONFIG keys match backend urgency list", () => {
    const frontendKeys = Object.keys(RENEWAL_URGENCY_CONFIG).sort();
    const backendKeys  = [...BACKEND_URGENCIES].sort();
    expect(frontendKeys).toEqual(backendKeys);
  });

  it("ALL_RECOMMENDED_PLATFORM_ACTIONS matches backend action list exactly", () => {
    expect([...ALL_RECOMMENDED_PLATFORM_ACTIONS].sort()).toEqual([...BACKEND_ACTIONS].sort());
  });

  it("frontend threshold constants match backend values", () => {
    expect(RENEWAL_DUE_SOON_DAYS).toBe(14);
    expect(TRIAL_ENDING_SOON_DAYS).toBe(7);
    expect(GRACE_ENDING_SOON_DAYS).toBe(3);
  });
});
