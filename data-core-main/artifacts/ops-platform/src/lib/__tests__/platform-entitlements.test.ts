/**
 * @file   __tests__/platform-entitlements.test.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Tests T13-T16 covering frontend entitlement config purity and safety.
 */

import { describe, it, expect } from "vitest";
import {
  MODULE_REGISTRY_CONFIG,
  FEATURE_LIMIT_CONFIG,
  PLAN_ENTITLEMENT_CONFIG,
  ALL_MODULE_CODES,
  ALL_LIMIT_CODES,
  ALL_OVERRIDE_TYPES,
  OVERRIDE_TYPE_CONFIG,
  ENTITLEMENT_SAFETY_CONTRACT,
  ENTITLEMENT_MUTATION_HOOK_NAMES,
  ENTITLEMENT_API_PATHS,
  ENTITLEMENT_REASON_MIN_LENGTH,
  isEntitlementOverrideFormValid,
  getEntitlementOverrideFormError,
  type EntitlementOverrideFormState,
} from "../platform-entitlements-config";

// ─────────────────────────────────────────────────────────────────────────────
// T13 - Frontend module config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T13: frontend module config stable", () => {
  it("MODULE_REGISTRY_CONFIG has exactly 20 entries", () => {
    expect(Object.keys(MODULE_REGISTRY_CONFIG)).toHaveLength(20);
  });

  it("ALL_MODULE_CODES has exactly 20 codes", () => {
    expect(ALL_MODULE_CODES).toHaveLength(20);
  });

  it("every code in ALL_MODULE_CODES has a config entry", () => {
    for (const code of ALL_MODULE_CODES) {
      expect(MODULE_REGISTRY_CONFIG[code]).toBeDefined();
    }
  });

  it("every config entry has required fields", () => {
    for (const [code, cfg] of Object.entries(MODULE_REGISTRY_CONFIG)) {
      expect(cfg.code).toBe(code);
      expect(typeof cfg.label).toBe("string");
      expect(typeof cfg.description).toBe("string");
      expect(typeof cfg.category).toBe("string");
      expect(typeof cfg.order).toBe("number");
      expect(typeof cfg.isCore).toBe("boolean");
      expect(typeof cfg.requiresHigherPlan).toBe("boolean");
      expect(typeof cfg.enabledBadgeClass).toBe("string");
      expect(typeof cfg.disabledBadgeClass).toBe("string");
      expect(cfg.enabledBadgeClass.length).toBeGreaterThan(0);
      expect(cfg.disabledBadgeClass.length).toBeGreaterThan(0);
    }
  });

  it("order values are unique", () => {
    const orders = Object.values(MODULE_REGISTRY_CONFIG).map(c => c.order);
    const unique  = new Set(orders);
    expect(unique.size).toBe(orders.length);
  });

  it("FEATURE_LIMIT_CONFIG has exactly 10 entries", () => {
    expect(Object.keys(FEATURE_LIMIT_CONFIG)).toHaveLength(10);
  });

  it("ALL_LIMIT_CODES has exactly 10 codes", () => {
    expect(ALL_LIMIT_CODES).toHaveLength(10);
  });

  it("every limit code in ALL_LIMIT_CODES has a config entry", () => {
    for (const code of ALL_LIMIT_CODES) {
      expect(FEATURE_LIMIT_CONFIG[code]).toBeDefined();
    }
  });

  it("PLAN_ENTITLEMENT_CONFIG has 5 plan codes", () => {
    expect(Object.keys(PLAN_ENTITLEMENT_CONFIG)).toHaveLength(5);
  });

  it("all plan enabledModules are known module codes", () => {
    for (const [planCode, plan] of Object.entries(PLAN_ENTITLEMENT_CONFIG)) {
      for (const mod of plan.enabledModules) {
        expect(ALL_MODULE_CODES, `${mod} in plan ${planCode}`).toContain(mod);
      }
    }
  });

  it("ALL_OVERRIDE_TYPES has exactly 3 entries", () => {
    expect(ALL_OVERRIDE_TYPES).toHaveLength(3);
    expect(ALL_OVERRIDE_TYPES).toContain("enable");
    expect(ALL_OVERRIDE_TYPES).toContain("disable");
    expect(ALL_OVERRIDE_TYPES).toContain("limit_override");
  });

  it("OVERRIDE_TYPE_CONFIG has entries for all 3 override types", () => {
    for (const type of ALL_OVERRIDE_TYPES) {
      expect(OVERRIDE_TYPE_CONFIG[type]).toBeDefined();
      expect(typeof OVERRIDE_TYPE_CONFIG[type].label).toBe("string");
      expect(typeof OVERRIDE_TYPE_CONFIG[type].description).toBe("string");
    }
  });

  it("ENTITLEMENT_REASON_MIN_LENGTH is 10", () => {
    expect(ENTITLEMENT_REASON_MIN_LENGTH).toBe(10);
  });

  it("ENTITLEMENT_API_PATHS.get produces correct path format", () => {
    const path = ENTITLEMENT_API_PATHS.get("42");
    expect(path).toContain("/42/");
    expect(path).toContain("entitlements");
    expect(path).not.toContain("billing");
    expect(path).not.toContain("payment");
  });

  it("ENTITLEMENT_API_PATHS.overrides produces correct path format", () => {
    const path = ENTITLEMENT_API_PATHS.overrides("99");
    expect(path).toContain("/99/");
    expect(path).toContain("entitlements");
    expect(path).toContain("overrides");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - Frontend entitlement form validation
// ─────────────────────────────────────────────────────────────────────────────

describe("T14: frontend entitlement form validation", () => {
  const validForm: EntitlementOverrideFormState = {
    moduleCode:   "payroll",
    overrideType: "enable",
    limitCode:    "",
    limitValue:   "",
    reason:       "Approved override - platform owner authorised",
    confirmation: true,
  };

  it("isEntitlementOverrideFormValid: valid form returns true", () => {
    expect(isEntitlementOverrideFormValid(validForm)).toBe(true);
  });

  it("isEntitlementOverrideFormValid: missing moduleCode returns false", () => {
    expect(isEntitlementOverrideFormValid({ ...validForm, moduleCode: "" })).toBe(false);
  });

  it("isEntitlementOverrideFormValid: missing overrideType returns false", () => {
    expect(isEntitlementOverrideFormValid({ ...validForm, overrideType: "" })).toBe(false);
  });

  it("isEntitlementOverrideFormValid: short reason returns false", () => {
    expect(isEntitlementOverrideFormValid({ ...validForm, reason: "short" })).toBe(false);
  });

  it("isEntitlementOverrideFormValid: false confirmation returns false", () => {
    expect(isEntitlementOverrideFormValid({ ...validForm, confirmation: false })).toBe(false);
  });

  it("isEntitlementOverrideFormValid: limit_override without limitCode returns false", () => {
    expect(isEntitlementOverrideFormValid({
      ...validForm,
      overrideType: "limit_override",
      limitCode:    "",
    })).toBe(false);
  });

  it("isEntitlementOverrideFormValid: limit_override with valid limitCode returns true", () => {
    expect(isEntitlementOverrideFormValid({
      ...validForm,
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   "100",
    })).toBe(true);
  });

  it("isEntitlementOverrideFormValid: limit_override with blank limitValue means unlimited (valid)", () => {
    expect(isEntitlementOverrideFormValid({
      ...validForm,
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   "",
    })).toBe(true);
  });

  it("isEntitlementOverrideFormValid: limit_override with negative limitValue returns false", () => {
    expect(isEntitlementOverrideFormValid({
      ...validForm,
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   "-5",
    })).toBe(false);
  });

  it("getEntitlementOverrideFormError: returns null for valid form", () => {
    expect(getEntitlementOverrideFormError(validForm)).toBeNull();
  });

  it("getEntitlementOverrideFormError: returns message for missing moduleCode", () => {
    const err = getEntitlementOverrideFormError({ ...validForm, moduleCode: "" });
    expect(err).toBeTruthy();
    expect(typeof err).toBe("string");
  });

  it("getEntitlementOverrideFormError: returns message for missing overrideType", () => {
    const err = getEntitlementOverrideFormError({ ...validForm, overrideType: "" });
    expect(err).toBeTruthy();
  });

  it("getEntitlementOverrideFormError: returns message for short reason", () => {
    const err = getEntitlementOverrideFormError({ ...validForm, reason: "tiny" });
    expect(err).toContain("10");
  });

  it("getEntitlementOverrideFormError: returns message for unconfirmed", () => {
    const err = getEntitlementOverrideFormError({ ...validForm, confirmation: false });
    expect(err).toBeTruthy();
  });

  it("getEntitlementOverrideFormError: returns message for negative limit", () => {
    const err = getEntitlementOverrideFormError({
      ...validForm,
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   "-1",
    });
    expect(err).toBeTruthy();
    expect(err).toContain("non-negative");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Mutation hook count limited
// ─────────────────────────────────────────────────────────────────────────────

describe("T15: mutation hook count limited", () => {
  it("ENTITLEMENT_MUTATION_HOOK_NAMES has exactly 1 entry", () => {
    expect(ENTITLEMENT_MUTATION_HOOK_NAMES).toHaveLength(1);
  });

  it("the single hook name is useUpdateTenantEntitlementOverrides", () => {
    expect(ENTITLEMENT_MUTATION_HOOK_NAMES[0]).toBe("useUpdateTenantEntitlementOverrides");
  });

  it("hook name does not contain payment/billing/delete/suspend words", () => {
    const name = ENTITLEMENT_MUTATION_HOOK_NAMES[0];
    expect(name).not.toMatch(/payment|billing|delete|suspend|charge|invoice/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - No payment/billing/HR execution/legal/email/super-admin exposure wording
// ─────────────────────────────────────────────────────────────────────────────

describe("T16: safety wording checks", () => {
  const FORBIDDEN_BILLING = /payment.?process|invoice.?generat|charge.?collect|tax.?calculat|credit.?card.?process/i;
  const FORBIDDEN_HR_EXEC = /process.?payroll|run.?payroll|submit.?payroll|payroll.?execut/i;
  const FORBIDDEN_SUPER_EXPOSURE = /tenant.*super.?admin.*console|open.*super.?admin.*govern/i;
  const FORBIDDEN_LEGAL = /legal.?notice|send.?legal|auto.*suspend/i;

  function fullConfigString() {
    return JSON.stringify({
      MODULE_REGISTRY_CONFIG,
      FEATURE_LIMIT_CONFIG,
      PLAN_ENTITLEMENT_CONFIG,
      OVERRIDE_TYPE_CONFIG,
    });
  }

  it("no billing/payment processing wording in config", () => {
    expect(fullConfigString()).not.toMatch(FORBIDDEN_BILLING);
  });

  it("no HR execution wording in config", () => {
    expect(fullConfigString()).not.toMatch(FORBIDDEN_HR_EXEC);
  });

  it("no super-admin governance exposure wording in config", () => {
    expect(fullConfigString()).not.toMatch(FORBIDDEN_SUPER_EXPOSURE);
  });

  it("no legal notice or auto-suspend wording in config", () => {
    expect(fullConfigString()).not.toMatch(FORBIDDEN_LEGAL);
  });

  it("ENTITLEMENT_SAFETY_CONTRACT has at least 14 properties", () => {
    expect(Object.keys(ENTITLEMENT_SAFETY_CONTRACT).length).toBeGreaterThanOrEqual(14);
  });

  it("all ENTITLEMENT_SAFETY_CONTRACT properties are true", () => {
    for (const [key, val] of Object.entries(ENTITLEMENT_SAFETY_CONTRACT)) {
      expect(val, key).toBe(true);
    }
  });

  it("ENTITLEMENT_SAFETY_CONTRACT includes noPaymentProcessing", () => {
    expect(ENTITLEMENT_SAFETY_CONTRACT.noPaymentProcessing).toBe(true);
  });

  it("ENTITLEMENT_SAFETY_CONTRACT includes noAutoWorkspaceSuspension", () => {
    expect(ENTITLEMENT_SAFETY_CONTRACT.noAutoWorkspaceSuspension).toBe(true);
  });

  it("ENTITLEMENT_SAFETY_CONTRACT includes noSuperAdminGovernanceExposure", () => {
    expect(ENTITLEMENT_SAFETY_CONTRACT.noSuperAdminGovernanceExposure).toBe(true);
  });

  it("ENTITLEMENT_SAFETY_CONTRACT includes failClosedOnUnknownModule", () => {
    expect(ENTITLEMENT_SAFETY_CONTRACT.failClosedOnUnknownModule).toBe(true);
  });

  it("governance_console module description clarifies it is not the super-admin console", () => {
    const desc = MODULE_REGISTRY_CONFIG.governance_console.description.toLowerCase();
    expect(desc).not.toMatch(/super.?admin.*console.*tenant/);
  });

  it("module safetyNotes on payroll clarifies entitlement only", () => {
    const notes = MODULE_REGISTRY_CONFIG.payroll.description.toLowerCase();
    expect(notes).toContain("entitlement");
  });
});
