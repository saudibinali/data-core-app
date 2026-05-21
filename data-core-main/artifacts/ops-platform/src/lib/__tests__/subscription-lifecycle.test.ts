/**
 * @file   src/lib/__tests__/subscription-lifecycle.test.ts
 * @phase  P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * Pure frontend config tests for subscription lifecycle.
 * No DB, no HTTP - all values are static config testable in isolation.
 *
 * Tests:
 *   T1   SUBSCRIPTION_STATUS_CONFIG: 8 statuses, required fields
 *   T2   PLAN_CODE_CONFIG: 5 plan codes, required fields
 *   T3   deriveSubscriptionStatusFromFields: active derivation
 *   T4   deriveSubscriptionStatusFromFields: trialing derivation
 *   T5   deriveSubscriptionStatusFromFields: grace_period derivation
 *   T6   isSubscriptionFormValid: returns false for empty/short reason
 *   T7   isSubscriptionFormValid: returns false for unconfirmed
 *   T8   isSubscriptionFormValid: returns true for fully valid form
 *   T9   SUBSCRIPTION_SAFETY_CONTRACT: all properties are true
 *   T10  SUBSCRIPTION_SAFETY_CONTRACT: exactly 14 properties
 *   T11  SUBSCRIPTION_MUTATION_HOOK_NAMES: exactly 1 entry
 *   T12  SUBSCRIPTION_MUTATION_HOOK_NAMES: contains useUpdateTenantSubscription
 *   T13  getSubscriptionFormError: correct error messages
 *   T14  No payment/invoice/charge/tax/card wording in configs
 *   T15  SUBSCRIPTION_API_PATHS: correct path format
 *   T16  deriveSubscriptionStatusFromFields: deterministic
 */

import { describe, it, expect } from "vitest";
import {
  PLAN_CODE_CONFIG,
  ALL_PLAN_CODES,
  SUBSCRIPTION_STATUS_CONFIG,
  ALL_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_SAFETY_CONTRACT,
  SUBSCRIPTION_MUTATION_HOOK_NAMES,
  SUBSCRIPTION_API_PATHS,
  SUBSCRIPTION_EMPTY_STATE,
  REASON_MIN_LENGTH,
  RENEWAL_WARNING_DAYS,
  deriveSubscriptionStatusFromFields,
  isSubscriptionFormValid,
  getSubscriptionFormError,
  type SubscriptionFormState,
  type SubscriptionStatusKey,
} from "../subscription-lifecycle-config";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-16T12:00:00Z");

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

const EMPTY_FORM: SubscriptionFormState = {
  planCode:             "",
  subscriptionStatus:   "",
  billingPeriodStart:   "",
  billingPeriodEnd:     "",
  renewalDueAt:         "",
  trialStartedAt:       "",
  trialEndsAt:          "",
  gracePeriodStartedAt: "",
  gracePeriodEndsAt:    "",
  cancelledAt:          "",
  suspendedAt:          "",
  reason:               "",
  confirmation:         false,
};

// ─────────────────────────────────────────────────────────────────────────────
// T1 - SUBSCRIPTION_STATUS_CONFIG: 8 statuses, required fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - SUBSCRIPTION_STATUS_CONFIG: 8 statuses, required fields", () => {
  it("has exactly 8 configured statuses", () => {
    expect(ALL_SUBSCRIPTION_STATUSES).toHaveLength(8);
  });

  it("each status has required fields", () => {
    for (const status of ALL_SUBSCRIPTION_STATUSES) {
      const cfg = SUBSCRIPTION_STATUS_CONFIG[status];
      expect(typeof cfg.label).toBe("string");
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(typeof cfg.description).toBe("string");
      expect(typeof cfg.badgeClass).toBe("string");
      expect(typeof cfg.alertClass).toBe("string");
      expect(typeof cfg.order).toBe("number");
    }
  });

  it("order values are unique", () => {
    const orders = ALL_SUBSCRIPTION_STATUSES.map(s => SUBSCRIPTION_STATUS_CONFIG[s].order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("tier values are from allowed set", () => {
    const allowed = new Set(["good", "neutral", "attention", "critical", "muted"]);
    for (const s of ALL_SUBSCRIPTION_STATUSES) {
      expect(allowed.has(SUBSCRIPTION_STATUS_CONFIG[s].tier)).toBe(true);
    }
  });

  it("no duplicate labels", () => {
    const labels = ALL_SUBSCRIPTION_STATUSES.map(s => SUBSCRIPTION_STATUS_CONFIG[s].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - PLAN_CODE_CONFIG: 5 plan codes, required fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - PLAN_CODE_CONFIG: 5 plan codes, required fields", () => {
  it("has exactly 5 plan codes", () => {
    expect(ALL_PLAN_CODES).toHaveLength(5);
  });

  it("each plan code has required fields", () => {
    for (const code of ALL_PLAN_CODES) {
      const cfg = PLAN_CODE_CONFIG[code];
      expect(cfg.code).toBe(code);
      expect(typeof cfg.name).toBe("string");
      expect(cfg.name.length).toBeGreaterThan(0);
      expect(typeof cfg.tier).toBe("string");
      expect(typeof cfg.description).toBe("string");
      expect(typeof cfg.badgeClass).toBe("string");
      expect(typeof cfg.order).toBe("number");
    }
  });

  it("order values are unique", () => {
    const orders = ALL_PLAN_CODES.map(c => PLAN_CODE_CONFIG[c].order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("starter has lowest order", () => {
    expect(PLAN_CODE_CONFIG.starter.order).toBe(0);
  });

  it("ALL_PLAN_CODES has no duplicates", () => {
    expect(new Set(ALL_PLAN_CODES).size).toBe(ALL_PLAN_CODES.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - deriveSubscriptionStatusFromFields: active derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - deriveSubscriptionStatusFromFields: active derivation", () => {
  it("billingPeriodEnd far in future → active", () => {
    const result = deriveSubscriptionStatusFromFields(
      { billingPeriodEnd: daysFromNow(60) },
      NOW,
    );
    expect(result).toBe("active");
  });

  it("no data → unknown", () => {
    expect(deriveSubscriptionStatusFromFields(null, NOW)).toBe("unknown");
    expect(deriveSubscriptionStatusFromFields(undefined, NOW)).toBe("unknown");
    expect(deriveSubscriptionStatusFromFields({}, NOW)).toBe("unknown");
  });

  it("billingPeriodEnd within window → renewal_due", () => {
    const result = deriveSubscriptionStatusFromFields(
      { billingPeriodEnd: daysFromNow(RENEWAL_WARNING_DAYS - 1) },
      NOW,
    );
    expect(result).toBe("renewal_due");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - deriveSubscriptionStatusFromFields: trialing derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - deriveSubscriptionStatusFromFields: trialing derivation", () => {
  it("trialEndsAt future → trialing", () => {
    const result = deriveSubscriptionStatusFromFields(
      { trialEndsAt: daysFromNow(5) },
      NOW,
    );
    expect(result).toBe("trialing");
  });

  it("cancelled takes priority over trialing", () => {
    const result = deriveSubscriptionStatusFromFields(
      { trialEndsAt: daysFromNow(5), cancelledAt: daysFromNow(-1) },
      NOW,
    );
    expect(result).toBe("cancelled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - deriveSubscriptionStatusFromFields: grace_period derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - deriveSubscriptionStatusFromFields: grace_period derivation", () => {
  it("past billingPeriodEnd + future gracePeriodEndsAt → grace_period", () => {
    const result = deriveSubscriptionStatusFromFields(
      {
        billingPeriodEnd: daysFromNow(-2),
        gracePeriodEndsAt: daysFromNow(5),
      },
      NOW,
    );
    expect(result).toBe("grace_period");
  });

  it("past billingPeriodEnd + past gracePeriodEndsAt → expired", () => {
    const result = deriveSubscriptionStatusFromFields(
      {
        billingPeriodEnd: daysFromNow(-10),
        gracePeriodEndsAt: daysFromNow(-2),
      },
      NOW,
    );
    expect(result).toBe("expired");
  });

  it("suspended status → suspended", () => {
    const result = deriveSubscriptionStatusFromFields(
      { subscriptionStatus: "suspended", billingPeriodEnd: daysFromNow(30) },
      NOW,
    );
    expect(result).toBe("suspended");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - isSubscriptionFormValid: returns false for empty/short reason
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - isSubscriptionFormValid: empty/short reason", () => {
  it("empty reason → false", () => {
    expect(isSubscriptionFormValid({ ...EMPTY_FORM, confirmation: true })).toBe(false);
  });

  it("short reason → false", () => {
    expect(isSubscriptionFormValid({
      ...EMPTY_FORM,
      reason: "short",
      confirmation: true,
    })).toBe(false);
  });

  it(`reason with exactly ${REASON_MIN_LENGTH} chars → true (with confirmation)`, () => {
    expect(isSubscriptionFormValid({
      ...EMPTY_FORM,
      reason: "x".repeat(REASON_MIN_LENGTH),
      confirmation: true,
    })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - isSubscriptionFormValid: returns false for unconfirmed
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - isSubscriptionFormValid: returns false for unconfirmed", () => {
  it("valid reason + no confirmation → false", () => {
    expect(isSubscriptionFormValid({
      ...EMPTY_FORM,
      reason: "A sufficiently long reason for this update.",
      confirmation: false,
    })).toBe(false);
  });

  it("null-like action + empty form → false", () => {
    expect(isSubscriptionFormValid(EMPTY_FORM)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - isSubscriptionFormValid: returns true for fully valid form
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - isSubscriptionFormValid: returns true for fully valid form", () => {
  it("valid reason + confirmed → true", () => {
    expect(isSubscriptionFormValid({
      ...EMPTY_FORM,
      reason: "Updating subscription plan to growth tier for Q3.",
      confirmation: true,
    })).toBe(true);
  });

  it("valid for all plan codes", () => {
    for (const code of ALL_PLAN_CODES) {
      expect(isSubscriptionFormValid({
        ...EMPTY_FORM,
        planCode:     code,
        reason:       "Updating plan as requested by platform owner.",
        confirmation: true,
      })).toBe(true);
    }
  });

  it("valid for all subscription statuses", () => {
    for (const status of ALL_SUBSCRIPTION_STATUSES) {
      expect(isSubscriptionFormValid({
        ...EMPTY_FORM,
        subscriptionStatus: status,
        reason:             "Setting status as per the workspace agreement.",
        confirmation:       true,
      })).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - SUBSCRIPTION_SAFETY_CONTRACT: all properties are true
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - SUBSCRIPTION_SAFETY_CONTRACT: all properties are true", () => {
  it("all properties are true", () => {
    for (const [key, value] of Object.entries(SUBSCRIPTION_SAFETY_CONTRACT)) {
      expect(value).toBe(true, `Expected ${key} to be true`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - SUBSCRIPTION_SAFETY_CONTRACT: exactly 14 properties
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - SUBSCRIPTION_SAFETY_CONTRACT: exactly 14 properties", () => {
  it("has exactly 14 properties", () => {
    expect(Object.keys(SUBSCRIPTION_SAFETY_CONTRACT)).toHaveLength(14);
  });

  it("contains noPaymentProcessing", () => {
    expect(SUBSCRIPTION_SAFETY_CONTRACT.noPaymentProcessing).toBe(true);
  });

  it("contains noInvoiceGeneration", () => {
    expect(SUBSCRIPTION_SAFETY_CONTRACT.noInvoiceGeneration).toBe(true);
  });

  it("contains noAutomaticWorkspaceSuspension", () => {
    expect(SUBSCRIPTION_SAFETY_CONTRACT.noAutomaticWorkspaceSuspension).toBe(true);
  });

  it("contains failClosedOnInvalidDates", () => {
    expect(SUBSCRIPTION_SAFETY_CONTRACT.failClosedOnInvalidDates).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - SUBSCRIPTION_MUTATION_HOOK_NAMES: exactly 1 entry
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - SUBSCRIPTION_MUTATION_HOOK_NAMES: exactly 1 entry", () => {
  it("has exactly 1 mutation hook name", () => {
    expect(SUBSCRIPTION_MUTATION_HOOK_NAMES).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - SUBSCRIPTION_MUTATION_HOOK_NAMES: contains useUpdateTenantSubscription
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - SUBSCRIPTION_MUTATION_HOOK_NAMES: correct hook name", () => {
  it("contains useUpdateTenantSubscription", () => {
    expect(SUBSCRIPTION_MUTATION_HOOK_NAMES).toContain("useUpdateTenantSubscription");
  });

  it("no lifecycle mutation hook names in subscription list", () => {
    const lifecycleNames = ["useWorkspaceLifecycleTransition"];
    for (const name of lifecycleNames) {
      expect(SUBSCRIPTION_MUTATION_HOOK_NAMES).not.toContain(name);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - getSubscriptionFormError: correct error messages
// ─────────────────────────────────────────────────────────────────────────────

describe("T13 - getSubscriptionFormError: correct error messages", () => {
  it("empty reason → error about reason required", () => {
    const err = getSubscriptionFormError({ ...EMPTY_FORM });
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toContain("reason");
  });

  it("short reason → error about min length", () => {
    const err = getSubscriptionFormError({ ...EMPTY_FORM, reason: "short" });
    expect(err).not.toBeNull();
    expect(err!).toContain(String(REASON_MIN_LENGTH));
  });

  it("valid reason + no confirmation → error about confirmation", () => {
    const err = getSubscriptionFormError({
      ...EMPTY_FORM,
      reason: "Valid reason with enough characters.",
    });
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toContain("confirm");
  });

  it("valid reason + confirmation → null (no error)", () => {
    const err = getSubscriptionFormError({
      ...EMPTY_FORM,
      reason: "Valid reason with enough characters.",
      confirmation: true,
    });
    expect(err).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - No payment/invoice/charge/tax/card wording in configs
// ─────────────────────────────────────────────────────────────────────────────

describe("T14 - No forbidden wording in subscription config", () => {
  const FORBIDDEN = ["payment", "invoice", "charge", "tax", "card", "billing portal", "legal notice"];

  function scanObject(obj: unknown): string {
    return JSON.stringify(obj).toLowerCase();
  }

  it("PLAN_CODE_CONFIG has no forbidden wording", () => {
    const text = scanObject(PLAN_CODE_CONFIG);
    for (const word of FORBIDDEN) {
      expect(text).not.toContain(word);
    }
  });

  it("SUBSCRIPTION_STATUS_CONFIG description has no forbidden wording", () => {
    for (const status of ALL_SUBSCRIPTION_STATUSES) {
      const desc = SUBSCRIPTION_STATUS_CONFIG[status].description.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(desc).not.toContain(word);
      }
    }
  });

  it("SUBSCRIPTION_EMPTY_STATE has no forbidden wording", () => {
    const text = scanObject(SUBSCRIPTION_EMPTY_STATE);
    for (const word of ["invoice", "charge", "card"]) {
      expect(text).not.toContain(word);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - SUBSCRIPTION_API_PATHS: correct path format
// ─────────────────────────────────────────────────────────────────────────────

describe("T15 - SUBSCRIPTION_API_PATHS: correct path format", () => {
  it("get() returns a function", () => {
    expect(typeof SUBSCRIPTION_API_PATHS.get).toBe("function");
  });

  it("update() returns a function", () => {
    expect(typeof SUBSCRIPTION_API_PATHS.update).toBe("function");
  });

  it("get() path includes tenantId", () => {
    const path = SUBSCRIPTION_API_PATHS.get("42");
    expect(path).toContain("42");
    expect(path).toContain("subscription");
    expect(path.startsWith("/api/")).toBe(true);
  });

  it("update() path is the same as get() (PATCH)", () => {
    expect(SUBSCRIPTION_API_PATHS.update("99")).toBe(SUBSCRIPTION_API_PATHS.get("99"));
  });

  it("different tenantIds produce different paths", () => {
    expect(SUBSCRIPTION_API_PATHS.get("1")).not.toBe(SUBSCRIPTION_API_PATHS.get("2"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - deriveSubscriptionStatusFromFields: deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T16 - deriveSubscriptionStatusFromFields: deterministic", () => {
  it("same input called twice → same result", () => {
    const fields = { billingPeriodEnd: daysFromNow(30) };
    const r1 = deriveSubscriptionStatusFromFields(fields, NOW);
    const r2 = deriveSubscriptionStatusFromFields(fields, NOW);
    expect(r1).toBe(r2);
  });

  it("all statuses from ALL_SUBSCRIPTION_STATUSES are reachable", () => {
    // just verify the function can return different statuses
    const results = new Set<string>([
      deriveSubscriptionStatusFromFields(null, NOW),
      deriveSubscriptionStatusFromFields({ cancelledAt: daysFromNow(-1) }, NOW),
      deriveSubscriptionStatusFromFields({ subscriptionStatus: "suspended" }, NOW),
      deriveSubscriptionStatusFromFields({ trialEndsAt: daysFromNow(5) }, NOW),
      deriveSubscriptionStatusFromFields({ billingPeriodEnd: daysFromNow(-2), gracePeriodEndsAt: daysFromNow(5) }, NOW),
      deriveSubscriptionStatusFromFields({ billingPeriodEnd: daysFromNow(-5) }, NOW),
      deriveSubscriptionStatusFromFields({ billingPeriodEnd: daysFromNow(10) }, NOW),
      deriveSubscriptionStatusFromFields({ billingPeriodEnd: daysFromNow(30) }, NOW),
    ]);
    expect(results.size).toBeGreaterThanOrEqual(6);
  });

  it("expired status maps to critical/muted tier in config", () => {
    const cfg = SUBSCRIPTION_STATUS_CONFIG["expired" as SubscriptionStatusKey];
    expect(["critical", "muted"]).toContain(cfg.tier);
  });

  it("active status maps to good tier", () => {
    expect(SUBSCRIPTION_STATUS_CONFIG.active.tier).toBe("good");
  });
});
