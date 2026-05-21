/**
 * @file   __tests__/tenant-entitlements.test.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Tests T1-T12 covering the pure entitlement derivation library.
 * No DB, no HTTP - all pure functions.
 */

import { describe, it, expect } from "vitest";
import { PLATFORM_MODULE_REGISTRY, ALL_MODULE_CODES, isKnownModuleCode } from "../platform-modules";
import { FEATURE_LIMIT_REGISTRY, ALL_LIMIT_CODES, isKnownLimitCode, buildEmptyLimits } from "../feature-limits";
import { PLAN_ENTITLEMENT_MAP, getModulesForPlan } from "../plan-entitlements";
import {
  derivePlanEntitlements,
  applyEntitlementOverrides,
  deriveTenantEntitlementProfile,
  isModuleEnabled,
  getFeatureLimit,
  validateEntitlementOverride,
  validateEntitlementOverridesBatch,
  buildEntitlementAuditPayload,
  ENTITLEMENT_REASON_MIN_LENGTH,
  ALL_OVERRIDE_TYPES,
  type EntitlementOverrideRecord,
} from "../tenant-entitlements";

const NOW = new Date("2026-05-16T00:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Module registry stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: module registry stable", () => {
  it("has exactly 20 module codes", () => {
    expect(ALL_MODULE_CODES).toHaveLength(20);
  });

  it("every code in ALL_MODULE_CODES has a registry entry", () => {
    for (const code of ALL_MODULE_CODES) {
      expect(PLATFORM_MODULE_REGISTRY[code]).toBeDefined();
    }
  });

  it("every registry entry has required fields", () => {
    for (const [code, def] of Object.entries(PLATFORM_MODULE_REGISTRY)) {
      expect(def.code).toBe(code);
      expect(typeof def.label).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(typeof def.category).toBe("string");
      expect(typeof def.order).toBe("number");
      expect(typeof def.isCore).toBe("boolean");
      expect(typeof def.requiresHigherPlan).toBe("boolean");
    }
  });

  it("isKnownModuleCode returns true for all codes", () => {
    for (const code of ALL_MODULE_CODES) {
      expect(isKnownModuleCode(code)).toBe(true);
    }
  });

  it("isKnownModuleCode returns false for unknown codes", () => {
    expect(isKnownModuleCode("billing")).toBe(false);
    expect(isKnownModuleCode("payment")).toBe(false);
    expect(isKnownModuleCode("")).toBe(false);
  });

  it("order values are unique across all modules", () => {
    const orders = Object.values(PLATFORM_MODULE_REGISTRY).map(d => d.order);
    const unique  = new Set(orders);
    expect(unique.size).toBe(orders.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Feature limit registry stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: feature limit registry stable", () => {
  it("has exactly 10 limit codes", () => {
    expect(ALL_LIMIT_CODES).toHaveLength(10);
  });

  it("every code in ALL_LIMIT_CODES has a registry entry", () => {
    for (const code of ALL_LIMIT_CODES) {
      expect(FEATURE_LIMIT_REGISTRY[code]).toBeDefined();
    }
  });

  it("every registry entry has required fields", () => {
    for (const [code, def] of Object.entries(FEATURE_LIMIT_REGISTRY)) {
      expect(def.code).toBe(code);
      expect(typeof def.label).toBe("string");
      expect(typeof def.unit).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(typeof def.order).toBe("number");
      expect(typeof def.nullableMeansUnlimited).toBe("boolean");
    }
  });

  it("isKnownLimitCode returns true for all codes", () => {
    for (const code of ALL_LIMIT_CODES) {
      expect(isKnownLimitCode(code)).toBe(true);
    }
  });

  it("isKnownLimitCode returns false for unknown codes", () => {
    expect(isKnownLimitCode("invoice_count")).toBe(false);
    expect(isKnownLimitCode("billing_cycles")).toBe(false);
  });

  it("buildEmptyLimits returns null for every limit code", () => {
    const empty = buildEmptyLimits();
    for (const code of ALL_LIMIT_CODES) {
      expect(empty[code]).toBeNull();
    }
  });

  it("audit_retention_days is not nullable-means-unlimited", () => {
    expect(FEATURE_LIMIT_REGISTRY.audit_retention_days.nullableMeansUnlimited).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Plan entitlement map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: plan entitlement map stable", () => {
  const KNOWN_PLANS = ["starter", "growth", "business", "enterprise", "custom"] as const;

  it("has exactly 5 plan codes", () => {
    expect(Object.keys(PLAN_ENTITLEMENT_MAP)).toHaveLength(5);
  });

  it("has all expected plan codes", () => {
    for (const plan of KNOWN_PLANS) {
      expect(PLAN_ENTITLEMENT_MAP[plan]).toBeDefined();
    }
  });

  it("every plan has required fields", () => {
    for (const [code, plan] of Object.entries(PLAN_ENTITLEMENT_MAP)) {
      expect(plan.planCode).toBe(code);
      expect(typeof plan.planTier).toBe("string");
      expect(Array.isArray(plan.enabledModules)).toBe(true);
      expect(typeof plan.notes).toBe("string");
      expect(plan.defaultLimits).toBeDefined();
    }
  });

  it("every enabled module in every plan is a known module code", () => {
    for (const plan of Object.values(PLAN_ENTITLEMENT_MAP)) {
      for (const mod of plan.enabledModules) {
        expect(isKnownModuleCode(mod), `${mod} in plan ${plan.planCode}`).toBe(true);
      }
    }
  });

  it("every limit code in defaultLimits is a known limit code", () => {
    for (const plan of Object.values(PLAN_ENTITLEMENT_MAP)) {
      for (const code of Object.keys(plan.defaultLimits)) {
        expect(isKnownLimitCode(code), `limit ${code} in plan ${plan.planCode}`).toBe(true);
      }
    }
  });

  it("no payment/billing/charge/invoice wording in plan notes", () => {
    const forbidden = /payment|invoice|charge|billing|tax|credit.?card/i;
    for (const plan of Object.values(PLAN_ENTITLEMENT_MAP)) {
      expect(plan.notes, plan.planCode).not.toMatch(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - derivePlanEntitlements for all 5 plans
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: derivePlanEntitlements for all plans", () => {
  it("starter: has hr_core enabled, payroll disabled", () => {
    const result = derivePlanEntitlements("starter");
    expect(result.enabledModules).toContain("hr_core");
    expect(result.disabledModules).toContain("payroll");
    expect(result.limits.seats).toBe(25);
    expect(result.limits.storage_gb).toBe(10);
    expect(result.planTier).toBe("basic");
  });

  it("growth: has workflows enabled, payroll disabled", () => {
    const result = derivePlanEntitlements("growth");
    expect(result.enabledModules).toContain("workflows");
    expect(result.enabledModules).toContain("analytics");
    expect(result.disabledModules).toContain("payroll");
    expect(result.limits.seats).toBe(100);
    expect(result.planTier).toBe("standard");
  });

  it("business: has payroll enabled, lms disabled", () => {
    const result = derivePlanEntitlements("business");
    expect(result.enabledModules).toContain("payroll");
    expect(result.enabledModules).toContain("recruitment");
    expect(result.disabledModules).toContain("lms");
    expect(result.limits.seats).toBe(500);
    expect(result.planTier).toBe("premium");
  });

  it("enterprise: has all 20 modules enabled", () => {
    const result = derivePlanEntitlements("enterprise");
    expect(result.enabledModules).toHaveLength(20);
    expect(result.disabledModules).toHaveLength(0);
    expect(result.limits.seats).toBeNull();
    expect(result.limits.storage_gb).toBeNull();
    expect(result.planTier).toBe("enterprise");
  });

  it("custom: has 0 enabled modules and all 20 disabled", () => {
    const result = derivePlanEntitlements("custom");
    expect(result.enabledModules).toHaveLength(0);
    expect(result.disabledModules).toHaveLength(20);
    expect(result.planTier).toBe("custom");
  });

  it("unknown planCode: returns all 20 disabled and empty limits", () => {
    const result = derivePlanEntitlements(null);
    expect(result.enabledModules).toHaveLength(0);
    expect(result.disabledModules).toHaveLength(20);
    expect(result.planTier).toBeNull();
  });

  it("enabled + disabled covers all 20 modules for every plan", () => {
    for (const planCode of ["starter", "growth", "business", "enterprise", "custom"]) {
      const result = derivePlanEntitlements(planCode);
      const total  = result.enabledModules.length + result.disabledModules.length;
      expect(total, planCode).toBe(20);
    }
  });

  it("getModulesForPlan matches derivePlanEntitlements", () => {
    const { enabled, disabled } = getModulesForPlan("growth");
    const derived = derivePlanEntitlements("growth");
    expect(enabled).toEqual(derived.enabledModules);
    expect(disabled).toEqual(derived.disabledModules);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Override enable/disable applies correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: override enable/disable applies correctly", () => {
  const starterBase = derivePlanEntitlements("starter");

  it("enable override adds module to enabledModules", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "payroll",
      overrideType: "enable",
      limitCode:    null,
      limitValue:   null,
      reason:       "Special arrangement for this workspace",
    }];
    const result = applyEntitlementOverrides(starterBase, overrides);
    expect(result.enabledModules).toContain("payroll");
    expect(result.disabledModules).not.toContain("payroll");
  });

  it("disable override removes module from enabledModules", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "hr_core",
      overrideType: "disable",
      limitCode:    null,
      limitValue:   null,
      reason:       "Tenant requested custom configuration",
    }];
    const result = applyEntitlementOverrides(starterBase, overrides);
    expect(result.disabledModules).toContain("hr_core");
    expect(result.enabledModules).not.toContain("hr_core");
  });

  it("multiple overrides apply in order", () => {
    const overrides: EntitlementOverrideRecord[] = [
      { moduleCode: "payroll", overrideType: "enable",  limitCode: null, limitValue: null, reason: "Enable for this workspace special tier" },
      { moduleCode: "lms",     overrideType: "enable",  limitCode: null, limitValue: null, reason: "Enable LMS for training programme setup" },
      { moduleCode: "self_service", overrideType: "disable", limitCode: null, limitValue: null, reason: "Disabled at tenant admin request" },
    ];
    const result = applyEntitlementOverrides(starterBase, overrides);
    expect(result.enabledModules).toContain("payroll");
    expect(result.enabledModules).toContain("lms");
    expect(result.disabledModules).toContain("self_service");
  });

  it("deriveTenantEntitlementProfile reflects overrides in profile", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "payroll",
      overrideType: "enable",
      limitCode:    null,
      limitValue:   null,
      reason:       "Special arrangement for this workspace",
    }];
    const profile = deriveTenantEntitlementProfile("starter", overrides, NOW);
    expect(profile.enabledModules).toContain("payroll");
    expect(profile.customEntitlementsCount).toBe(1);
    expect(profile.overridesApplied).toHaveLength(1);
    expect(profile.derivedAt).toBe(NOW.toISOString());
  });

  it("isModuleEnabled returns correct value from profile", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "payroll",
      overrideType: "enable",
      limitCode:    null,
      limitValue:   null,
      reason:       "Special arrangement for this workspace",
    }];
    const profile = deriveTenantEntitlementProfile("starter", overrides, NOW);
    expect(isModuleEnabled(profile, "payroll")).toBe(true);
    expect(isModuleEnabled(profile, "lms")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Limit override applies correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: limit override applies correctly", () => {
  it("overrides seats limit", () => {
    const base      = derivePlanEntitlements("starter");
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "hr_core",
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   500,
      reason:       "Expanded seat allocation approved by platform owner",
    }];
    const result = applyEntitlementOverrides(base, overrides);
    expect(result.limits.seats).toBe(500);
  });

  it("null limitValue means unlimited for nullable limits", () => {
    const base      = derivePlanEntitlements("growth");
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "hr_core",
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   null,
      reason:       "Unlimited seats approved for enterprise trial period",
    }];
    const result = applyEntitlementOverrides(base, overrides);
    expect(result.limits.seats).toBeNull();
  });

  it("getFeatureLimit returns correct value from profile", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "hr_core",
      overrideType: "limit_override",
      limitCode:    "seats",
      limitValue:   999,
      reason:       "Expanded seat allocation approved by platform owner",
    }];
    const profile = deriveTenantEntitlementProfile("starter", overrides, NOW);
    expect(getFeatureLimit(profile, "seats")).toBe(999);
  });

  it("getFeatureLimit returns undefined for unknown limit code", () => {
    const profile = deriveTenantEntitlementProfile("starter", [], NOW);
    expect(getFeatureLimit(profile, "invoice_count")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Invalid module rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: invalid module rejected", () => {
  const validBase = {
    moduleCode:   "billing_module",
    overrideType: "enable",
    limitCode:    null,
    limitValue:   null,
    reason:       "This is a valid reason string",
    confirmation: true,
  };

  it("rejects unknown module code", () => {
    const result = validateEntitlementOverride(validBase);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("UNKNOWN_MODULE_CODE");
  });

  it("rejects empty module code", () => {
    const result = validateEntitlementOverride({ ...validBase, moduleCode: "" });
    expect(result.valid).toBe(false);
  });

  it("rejects payment-related module code", () => {
    const result = validateEntitlementOverride({ ...validBase, moduleCode: "payment_processing" });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("UNKNOWN_MODULE_CODE");
  });

  it("rejects invoice-related module code", () => {
    const result = validateEntitlementOverride({ ...validBase, moduleCode: "invoice_manager" });
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Invalid limit rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: invalid limit rejected", () => {
  const validLimitBase = {
    moduleCode:   "hr_core",
    overrideType: "limit_override",
    limitCode:    "invoice_count",
    limitValue:   100,
    reason:       "This is a valid reason string",
    confirmation: true,
  };

  it("rejects unknown limit code", () => {
    const result = validateEntitlementOverride(validLimitBase);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("UNKNOWN_LIMIT_CODE");
  });

  it("rejects negative limit value", () => {
    const result = validateEntitlementOverride({ ...validLimitBase, limitCode: "seats", limitValue: -1 });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_LIMIT_VALUE");
  });

  it("rejects non-numeric limit value for finite limits", () => {
    const result = validateEntitlementOverride({
      ...validLimitBase,
      limitCode:  "seats",
      limitValue: NaN,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects limit_override without limitCode", () => {
    const result = validateEntitlementOverride({ ...validLimitBase, limitCode: undefined, limitValue: 100 });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("LIMIT_CODE_REQUIRED");
  });

  it("rejects limitCode provided for enable/disable override", () => {
    const result = validateEntitlementOverride({
      moduleCode:   "hr_core",
      overrideType: "enable",
      limitCode:    "seats",
      limitValue:   null,
      reason:       "This is a valid reason string",
      confirmation: true,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("LIMIT_CODE_NOT_ALLOWED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Reason and confirmation required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: reason and confirmation required", () => {
  const validInput = {
    moduleCode:   "payroll",
    overrideType: "enable",
    limitCode:    null,
    limitValue:   null,
    reason:       "This is a valid reason string",
    confirmation: true,
  };

  it("passes with valid input", () => {
    const result = validateEntitlementOverride(validInput);
    expect(result.valid).toBe(true);
  });

  it("rejects when confirmation is false", () => {
    const result = validateEntitlementOverride({ ...validInput, confirmation: false });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("rejects when reason is empty", () => {
    const result = validateEntitlementOverride({ ...validInput, reason: "" });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("REASON_TOO_SHORT");
  });

  it("rejects when reason is too short", () => {
    const result = validateEntitlementOverride({ ...validInput, reason: "short" });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("REASON_TOO_SHORT");
  });

  it("accepts reason exactly at min length", () => {
    const reason = "x".repeat(ENTITLEMENT_REASON_MIN_LENGTH);
    const result = validateEntitlementOverride({ ...validInput, reason });
    expect(result.valid).toBe(true);
  });

  it("validateEntitlementOverridesBatch rejects empty overrides array", () => {
    const result = validateEntitlementOverridesBatch({ overrides: [], confirmation: true });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("OVERRIDES_REQUIRED");
  });

  it("validateEntitlementOverridesBatch rejects when confirmation is false", () => {
    const result = validateEntitlementOverridesBatch({
      overrides: [{ moduleCode: "payroll", overrideType: "enable", reason: "Valid reason here" }],
      confirmation: false,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Entitlement validation (super-admin-only intent)
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: entitlement validation enforces super-admin-only intent", () => {
  it("validateEntitlementOverridesBatch requires confirmation (confirms admin intent)", () => {
    const result = validateEntitlementOverridesBatch({
      overrides:    [{ moduleCode: "payroll", overrideType: "enable", reason: "Valid reason here" }],
      confirmation: false,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("ENTITLEMENT_REASON_MIN_LENGTH is exactly 10", () => {
    expect(ENTITLEMENT_REASON_MIN_LENGTH).toBe(10);
  });

  it("ALL_OVERRIDE_TYPES has exactly 3 entries", () => {
    expect(ALL_OVERRIDE_TYPES).toHaveLength(3);
    expect(ALL_OVERRIDE_TYPES).toContain("enable");
    expect(ALL_OVERRIDE_TYPES).toContain("disable");
    expect(ALL_OVERRIDE_TYPES).toContain("limit_override");
  });

  it("rejects more than 50 overrides in one batch", () => {
    const overrides = Array.from({ length: 51 }, (_, i) => ({
      moduleCode:   "hr_core",
      overrideType: "enable",
      reason:       `Batch override item ${i} - admin approved`,
    }));
    const result = validateEntitlementOverridesBatch({ overrides, confirmation: true });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TOO_MANY_OVERRIDES");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - buildEntitlementAuditPayload produces correct event
// ─────────────────────────────────────────────────────────────────────────────

describe("T11: buildEntitlementAuditPayload", () => {
  const params = {
    tenantId:       "42",
    workspaceId:    42,
    actorId:        1,
    planCode:       "growth",
    addedOverrides: [
      { moduleCode: "payroll", overrideType: "enable", reason: "Approved by platform owner" },
    ],
    reason:         "Approved by platform owner",
    now:            NOW,
  };

  it("eventType is tenant_entitlements_updated", () => {
    const payload = buildEntitlementAuditPayload(params);
    expect(payload.eventType).toBe("tenant_entitlements_updated");
  });

  it("addedCount matches overrides array length", () => {
    const payload = buildEntitlementAuditPayload(params);
    expect(payload.addedCount).toBe(1);
    expect(payload.addedModules).toEqual(["payroll"]);
  });

  it("payload contains no payment/billing/charge wording", () => {
    const payload  = buildEntitlementAuditPayload(params);
    const asString = JSON.stringify(payload);
    expect(asString).not.toMatch(/payment|invoice|charge|billing|tax|credit.?card/i);
  });

  it("ts matches now ISO string", () => {
    const payload = buildEntitlementAuditPayload(params);
    expect(payload.ts).toBe(NOW.toISOString());
  });

  it("empty overrides produces addedCount 0", () => {
    const payload = buildEntitlementAuditPayload({ ...params, addedOverrides: [] });
    expect(payload.addedCount).toBe(0);
    expect(payload.addedModules).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - Tenant registry reflects customEntitlementsCount
// ─────────────────────────────────────────────────────────────────────────────

describe("T12: customEntitlementsCount in entitlement profile", () => {
  it("0 overrides → customEntitlementsCount 0", () => {
    const profile = deriveTenantEntitlementProfile("starter", [], NOW);
    expect(profile.customEntitlementsCount).toBe(0);
  });

  it("3 overrides → customEntitlementsCount 3", () => {
    const overrides: EntitlementOverrideRecord[] = [
      { moduleCode: "payroll",      overrideType: "enable",         limitCode: null,    limitValue: null, reason: "Approved by platform owner" },
      { moduleCode: "lms",          overrideType: "enable",         limitCode: null,    limitValue: null, reason: "LMS access granted for trial" },
      { moduleCode: "hr_core",      overrideType: "limit_override", limitCode: "seats", limitValue: 999,  reason: "Seat expansion approved by owner" },
    ];
    const profile = deriveTenantEntitlementProfile("starter", overrides, NOW);
    expect(profile.customEntitlementsCount).toBe(3);
  });

  it("derivedAt is always set to the now parameter", () => {
    const profile = deriveTenantEntitlementProfile("growth", [], NOW);
    expect(profile.derivedAt).toBe(NOW.toISOString());
  });

  it("planCode and planTier are set from the plan", () => {
    const profile = deriveTenantEntitlementProfile("business", [], NOW);
    expect(profile.planCode).toBe("business");
    expect(profile.planTier).toBe("premium");
  });

  it("null planCode → planCode and planTier both null in profile", () => {
    const profile = deriveTenantEntitlementProfile(null, [], NOW);
    expect(profile.planCode).toBeNull();
    expect(profile.planTier).toBeNull();
  });

  it("overridesApplied array matches the input overrides", () => {
    const overrides: EntitlementOverrideRecord[] = [{
      moduleCode:   "payroll",
      overrideType: "enable",
      limitCode:    null,
      limitValue:   null,
      reason:       "Approved by platform owner",
    }];
    const profile = deriveTenantEntitlementProfile("starter", overrides, NOW);
    expect(profile.overridesApplied).toEqual(overrides);
  });
});
