/**
 * @file   lib/plan-entitlements.ts
 * @phase  P13-D - Entitlements, Module Access & Feature Limit Controls
 *
 * Authoritative plan-to-entitlement mapping. Pure config - no DB, no HTTP.
 *
 * SAFETY CONTRACT:
 *   - No payment, billing, invoice, or enforcement logic.
 *   - governance_console entitlement does NOT expose the platform super-admin console.
 *   - Custom plan defaults to empty - all modules must be configured via overrides.
 *   - All maps declared as "as const" - TypeScript-enforced immutability.
 */

import { type PlatformModuleCode, ALL_MODULE_CODES } from "./platform-modules";
import { type FeatureLimitCode, buildEmptyLimits }    from "./feature-limits";

// ─────────────────────────────────────────────────────────────────────────────
// Plan Entitlement Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanEntitlementDef {
  planCode:       string;
  planTier:       string;
  enabledModules: PlatformModuleCode[];
  defaultLimits:  Record<FeatureLimitCode, number | null>;
  notes:          string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan Entitlement Map
// ─────────────────────────────────────────────────────────────────────────────

const STARTER_MODULES: PlatformModuleCode[] = [
  "hr_core", "employee_records", "organization_structure",
  "attendance", "leave_management", "documents", "self_service",
];

const GROWTH_MODULES: PlatformModuleCode[] = [
  ...STARTER_MODULES,
  "workflows", "analytics", "onboarding",
];

const BUSINESS_MODULES: PlatformModuleCode[] = [
  ...GROWTH_MODULES,
  "payroll", "recruitment", "performance", "integrations", "manager_portal",
];

const ENTERPRISE_MODULES: PlatformModuleCode[] = [
  ...BUSINESS_MODULES,
  "lms", "advanced_analytics", "ai_automation", "governance_console", "audit_logs",
];

function computeDisabled(enabled: PlatformModuleCode[]): PlatformModuleCode[] {
  const enabledSet = new Set(enabled);
  return ALL_MODULE_CODES.filter(m => !enabledSet.has(m));
}

export const PLAN_ENTITLEMENT_MAP: Record<string, PlanEntitlementDef> = {
  starter: {
    planCode: "starter",
    planTier: "basic",
    enabledModules: STARTER_MODULES,
    defaultLimits: {
      ...buildEmptyLimits(),
      seats:               25,
      storage_gb:          10,
      monthly_api_calls:   1_000,
      documents:           100,
      workflows:           5,
      custom_reports:      1,
      integrations:        0,
      ai_actions:          0,
      audit_retention_days: 30,
      workspaces:          1,
    },
    notes: "Entry-level plan. Core HR modules. Limited API quota.",
  },

  growth: {
    planCode: "growth",
    planTier: "standard",
    enabledModules: GROWTH_MODULES,
    defaultLimits: {
      ...buildEmptyLimits(),
      seats:               100,
      storage_gb:          50,
      monthly_api_calls:   10_000,
      documents:           1_000,
      workflows:           20,
      custom_reports:      5,
      integrations:        0,
      ai_actions:          0,
      audit_retention_days: 60,
      workspaces:          1,
    },
    notes: "Growing teams. Adds workflows, analytics, and onboarding.",
  },

  business: {
    planCode: "business",
    planTier: "premium",
    enabledModules: BUSINESS_MODULES,
    defaultLimits: {
      ...buildEmptyLimits(),
      seats:               500,
      storage_gb:          200,
      monthly_api_calls:   100_000,
      documents:           10_000,
      workflows:           100,
      custom_reports:      25,
      integrations:        5,
      ai_actions:          0,
      audit_retention_days: 90,
      workspaces:          1,
    },
    notes: "Business-grade. Adds payroll, recruitment, performance, and integrations.",
  },

  enterprise: {
    planCode: "enterprise",
    planTier: "enterprise",
    enabledModules: ENTERPRISE_MODULES,
    defaultLimits: {
      ...buildEmptyLimits(),
      seats:               null,   // unlimited
      storage_gb:          null,   // unlimited
      monthly_api_calls:   null,   // unlimited
      documents:           null,   // unlimited
      workflows:           null,   // unlimited
      custom_reports:      null,   // unlimited
      integrations:        null,   // unlimited
      ai_actions:          null,   // unlimited
      audit_retention_days: 365,
      workspaces:          null,   // unlimited
    },
    notes: "Full platform. All modules enabled. Unlimited seats and API quota.",
  },

  custom: {
    planCode: "custom",
    planTier: "custom",
    enabledModules: [],           // all disabled by default - configured via overrides
    defaultLimits:  buildEmptyLimits(),
    notes: "Custom plan. All modules and limits must be configured via entitlement overrides.",
  },
} as const;

/**
 * Returns enabled and disabled module lists for a plan code.
 * Falls back to empty for unknown/null plan codes.
 */
export function getModulesForPlan(planCode: string | null): {
  enabled:  PlatformModuleCode[];
  disabled: PlatformModuleCode[];
} {
  const plan = planCode ? PLAN_ENTITLEMENT_MAP[planCode] : null;
  if (!plan) return { enabled: [], disabled: [...ALL_MODULE_CODES] };
  return { enabled: plan.enabledModules, disabled: computeDisabled(plan.enabledModules) };
}

export { computeDisabled };
