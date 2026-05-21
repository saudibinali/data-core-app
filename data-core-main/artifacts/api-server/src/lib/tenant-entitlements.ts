/**
 * @file   lib/tenant-entitlements.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Pure derivation lib for tenant entitlement profiles.
 * No DB, no HTTP, no side effects.
 *
 * SAFETY CONTRACT:
 *   - No payment, invoice, billing, charge, tax, or enforcement logic.
 *   - No HR module execution, payroll processing, or recruitment logic.
 *   - No workspace suspension or legal/email notice logic.
 *   - governance_console entitlement is for future tenant governance access only.
 *     It does NOT expose the Super Admin Governance Console.
 *   - Validation fails closed on unknown module codes and limit codes.
 *   - reason must be >= ENTITLEMENT_REASON_MIN_LENGTH characters.
 *   - confirmation must be explicitly true.
 */

import {
  type PlatformModuleCode,
  ALL_MODULE_CODES,
  isKnownModuleCode,
} from "./platform-modules";
import {
  type FeatureLimitCode,
  ALL_LIMIT_CODES,
  FEATURE_LIMIT_REGISTRY,
  isKnownLimitCode,
  buildEmptyLimits,
} from "./feature-limits";
import {
  PLAN_ENTITLEMENT_MAP,
  computeDisabled,
} from "./plan-entitlements";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITLEMENT_REASON_MIN_LENGTH = 10;

export const ALL_OVERRIDE_TYPES = ["enable", "disable", "limit_override"] as const;
export type OverrideType = (typeof ALL_OVERRIDE_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EntitlementOverrideRecord {
  id?:          number;
  moduleCode:   PlatformModuleCode;
  overrideType: OverrideType;
  limitCode:    FeatureLimitCode | null;
  limitValue:   number | null;
  reason:       string;
  createdBy?:   number;
  createdAt?:   string;
}

export interface EntitlementProfile {
  planCode:               string | null;
  planTier:               string | null;
  enabledModules:         PlatformModuleCode[];
  disabledModules:        PlatformModuleCode[];
  limits:                 Record<FeatureLimitCode, number | null>;
  overridesApplied:       EntitlementOverrideRecord[];
  customEntitlementsCount: number;
  derivedAt:              string;
}

export interface EntitlementValidationResult {
  valid:    boolean;
  code?:    string;
  message?: string;
}

export interface EntitlementOverrideInput {
  moduleCode:   string;
  overrideType: string;
  limitCode?:   string | null;
  limitValue?:  number | null;
  reason:       string;
}

export interface EntitlementOverridesBatchInput {
  overrides:    EntitlementOverrideInput[];
  confirmation: boolean;
}

export interface EntitlementAuditPayload {
  eventType:       "tenant_entitlements_updated";
  tenantId:        string;
  workspaceId:     number;
  actorId:         number;
  planCode:        string | null;
  addedCount:      number;
  addedModules:    string[];
  reason:          string;
  ts:              string;
}

// ─────────────────────────────────────────────────────────────────────────────
// derivePlanEntitlements
// ─────────────────────────────────────────────────────────────────────────────

export function derivePlanEntitlements(planCode: string | null): {
  enabledModules:  PlatformModuleCode[];
  disabledModules: PlatformModuleCode[];
  limits:          Record<FeatureLimitCode, number | null>;
  planTier:        string | null;
} {
  const plan = planCode ? PLAN_ENTITLEMENT_MAP[planCode] : null;
  if (!plan) {
    return {
      enabledModules:  [],
      disabledModules: [...ALL_MODULE_CODES],
      limits:          buildEmptyLimits(),
      planTier:        null,
    };
  }
  return {
    enabledModules:  [...plan.enabledModules],
    disabledModules: computeDisabled(plan.enabledModules),
    limits:          { ...plan.defaultLimits },
    planTier:        plan.planTier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyEntitlementOverrides
// ─────────────────────────────────────────────────────────────────────────────

export function applyEntitlementOverrides(
  base: {
    enabledModules:  PlatformModuleCode[];
    disabledModules: PlatformModuleCode[];
    limits:          Record<FeatureLimitCode, number | null>;
  },
  overrides: EntitlementOverrideRecord[],
): {
  enabledModules:  PlatformModuleCode[];
  disabledModules: PlatformModuleCode[];
  limits:          Record<FeatureLimitCode, number | null>;
} {
  const enabled  = new Set<PlatformModuleCode>(base.enabledModules);
  const disabled = new Set<PlatformModuleCode>(base.disabledModules);
  const limits   = { ...base.limits } as Record<FeatureLimitCode, number | null>;

  for (const ov of overrides) {
    if (ov.overrideType === "enable") {
      enabled.add(ov.moduleCode);
      disabled.delete(ov.moduleCode);
    } else if (ov.overrideType === "disable") {
      disabled.add(ov.moduleCode);
      enabled.delete(ov.moduleCode);
    } else if (ov.overrideType === "limit_override" && ov.limitCode) {
      limits[ov.limitCode] = ov.limitValue ?? null;
    }
  }

  return {
    enabledModules:  [...enabled].sort(),
    disabledModules: [...disabled].sort(),
    limits,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantEntitlementProfile
// ─────────────────────────────────────────────────────────────────────────────

export function deriveTenantEntitlementProfile(
  planCode:  string | null,
  overrides: EntitlementOverrideRecord[],
  now:       Date,
): EntitlementProfile {
  const base    = derivePlanEntitlements(planCode);
  const applied = applyEntitlementOverrides(base, overrides);

  return {
    planCode,
    planTier:                base.planTier,
    enabledModules:          applied.enabledModules,
    disabledModules:         applied.disabledModules,
    limits:                  applied.limits,
    overridesApplied:        overrides,
    customEntitlementsCount: overrides.length,
    derivedAt:               now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// isModuleEnabled / getFeatureLimit
// ─────────────────────────────────────────────────────────────────────────────

export function isModuleEnabled(
  profile:    EntitlementProfile,
  moduleCode: string,
): boolean {
  return profile.enabledModules.includes(moduleCode as PlatformModuleCode);
}

export function getFeatureLimit(
  profile:   EntitlementProfile,
  limitCode: string,
): number | null | undefined {
  if (!isKnownLimitCode(limitCode)) return undefined;
  return profile.limits[limitCode];
}

// ─────────────────────────────────────────────────────────────────────────────
// validateEntitlementOverride
// ─────────────────────────────────────────────────────────────────────────────

export function validateEntitlementOverride(
  input: EntitlementOverrideInput & { confirmation: boolean },
): EntitlementValidationResult {
  if (input.confirmation !== true) {
    return { valid: false, code: "CONFIRMATION_REQUIRED", message: "confirmation must be true." };
  }
  if (!input.reason || input.reason.trim().length < ENTITLEMENT_REASON_MIN_LENGTH) {
    return {
      valid:   false,
      code:    "REASON_TOO_SHORT",
      message: `reason must be at least ${ENTITLEMENT_REASON_MIN_LENGTH} characters.`,
    };
  }
  if (!isKnownModuleCode(input.moduleCode)) {
    return {
      valid:   false,
      code:    "UNKNOWN_MODULE_CODE",
      message: `Unknown module code: "${input.moduleCode}".`,
    };
  }
  if (!(ALL_OVERRIDE_TYPES as readonly string[]).includes(input.overrideType)) {
    return {
      valid:   false,
      code:    "INVALID_OVERRIDE_TYPE",
      message: `overrideType must be one of: ${ALL_OVERRIDE_TYPES.join(", ")}.`,
    };
  }
  if (input.overrideType === "limit_override") {
    if (!input.limitCode) {
      return { valid: false, code: "LIMIT_CODE_REQUIRED", message: "limitCode is required for limit_override." };
    }
    if (!isKnownLimitCode(input.limitCode)) {
      return { valid: false, code: "UNKNOWN_LIMIT_CODE", message: `Unknown limit code: "${input.limitCode}".` };
    }
    if (input.limitValue !== null && input.limitValue !== undefined) {
      if (typeof input.limitValue !== "number" || !Number.isFinite(input.limitValue) || input.limitValue < 0) {
        return { valid: false, code: "INVALID_LIMIT_VALUE", message: "limitValue must be a non-negative integer or null." };
      }
      const limitDef = FEATURE_LIMIT_REGISTRY[input.limitCode];
      if (!limitDef.nullableMeansUnlimited && input.limitValue === null) {
        return { valid: false, code: "NULL_NOT_ALLOWED", message: `${input.limitCode} does not allow null (unlimited) as a value.` };
      }
    }
  } else {
    if (input.limitCode) {
      return { valid: false, code: "LIMIT_CODE_NOT_ALLOWED", message: "limitCode must be null/omitted for enable/disable overrides." };
    }
    if (input.limitValue !== null && input.limitValue !== undefined) {
      return { valid: false, code: "LIMIT_VALUE_NOT_ALLOWED", message: "limitValue must be null/omitted for enable/disable overrides." };
    }
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateEntitlementOverridesBatch
// ─────────────────────────────────────────────────────────────────────────────

export function validateEntitlementOverridesBatch(
  input: EntitlementOverridesBatchInput,
): EntitlementValidationResult {
  if (input.confirmation !== true) {
    return { valid: false, code: "CONFIRMATION_REQUIRED", message: "confirmation must be true." };
  }
  if (!Array.isArray(input.overrides) || input.overrides.length === 0) {
    return { valid: false, code: "OVERRIDES_REQUIRED", message: "overrides must be a non-empty array." };
  }
  if (input.overrides.length > 50) {
    return { valid: false, code: "TOO_MANY_OVERRIDES", message: "Maximum 50 overrides per request." };
  }
  for (let i = 0; i < input.overrides.length; i++) {
    const ov     = input.overrides[i];
    const result = validateEntitlementOverride({ ...ov, confirmation: true });
    if (!result.valid) {
      return {
        valid:   false,
        code:    result.code,
        message: `Override[${i}]: ${result.message}`,
      };
    }
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEntitlementAuditPayload
// ─────────────────────────────────────────────────────────────────────────────

export function buildEntitlementAuditPayload(params: {
  tenantId:        string;
  workspaceId:     number;
  actorId:         number;
  planCode:        string | null;
  addedOverrides:  EntitlementOverrideInput[];
  reason:          string;
  now:             Date;
}): EntitlementAuditPayload {
  return {
    eventType:    "tenant_entitlements_updated",
    tenantId:     params.tenantId,
    workspaceId:  params.workspaceId,
    actorId:      params.actorId,
    planCode:     params.planCode,
    addedCount:   params.addedOverrides.length,
    addedModules: params.addedOverrides.map(o => o.moduleCode),
    reason:       params.reason,
    ts:           params.now.toISOString(),
  };
}
