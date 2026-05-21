/**
 * @file   lib/__tests__/tenant-health-config.test.ts
 * @phase  P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * Frontend tests for tenant-health-config.ts - validates stability,
 * safety contract, read-only intent, and forbidden wording.
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_HEALTH_STATUS_CONFIG,
  TENANT_HEALTH_RISK_CONFIG,
  TENANT_HEALTH_SIGNAL_CONFIG,
  TENANT_HEALTH_ACTION_CONFIG,
  TENANT_HEALTH_SAFETY_CONTRACT,
  TENANT_HEALTH_EMPTY_STATE,
  TENANT_HEALTH_READ_HOOK_NAMES,
  TENANT_HEALTH_API_PATHS,
  ALL_TENANT_HEALTH_SIGNAL_CODES,
  ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS,
  type TenantHealthStatus,
  type TenantHealthRiskLevel,
  type TenantHealthSignalCode,
  type RecommendedTenantHealthAction,
} from "../tenant-health-config";

// ─────────────────────────────────────────────────────────────────────────────
// T17 - Frontend health hook read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T17 - Frontend health hook read-only", () => {
  it("TENANT_HEALTH_READ_HOOK_NAMES has exactly one entry", () => {
    expect(TENANT_HEALTH_READ_HOOK_NAMES).toHaveLength(1);
  });

  it("hook name is useTenantHealth", () => {
    expect(TENANT_HEALTH_READ_HOOK_NAMES[0]).toBe("useTenantHealth");
  });

  it("hook name starts with 'use'", () => {
    expect(TENANT_HEALTH_READ_HOOK_NAMES.every(n => n.startsWith("use"))).toBe(true);
  });

  it("hook names contain no mutation/update/create verbs", () => {
    const forbidden = ["update", "mutation", "create", "delete", "patch"];
    for (const name of TENANT_HEALTH_READ_HOOK_NAMES) {
      for (const verb of forbidden) {
        expect(name.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("API path builder constructs correct read path", () => {
    expect(TENANT_HEALTH_API_PATHS.get("tenant-abc")).toBe("/api/platform/tenants/tenant-abc/health");
  });

  it("TENANT_HEALTH_API_PATHS has only a get builder (no post/patch/delete)", () => {
    const keys = Object.keys(TENANT_HEALTH_API_PATHS);
    expect(keys).toEqual(["get"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 - Health panel renders major states
// ─────────────────────────────────────────────────────────────────────────────

describe("T18 - Config covers all major panel states", () => {
  it("TENANT_HEALTH_STATUS_CONFIG has all 7 health status values", () => {
    const statuses: TenantHealthStatus[] = [
      "healthy", "attention", "degraded", "restricted", "suspended", "archived", "unknown",
    ];
    for (const s of statuses) {
      expect(TENANT_HEALTH_STATUS_CONFIG[s]).toBeDefined();
      expect(TENANT_HEALTH_STATUS_CONFIG[s].label.length).toBeGreaterThan(0);
      expect(TENANT_HEALTH_STATUS_CONFIG[s].description.length).toBeGreaterThan(0);
      expect(TENANT_HEALTH_STATUS_CONFIG[s].badgeClass.length).toBeGreaterThan(0);
    }
  });

  it("TENANT_HEALTH_RISK_CONFIG has all 6 risk levels", () => {
    const levels: TenantHealthRiskLevel[] = ["none", "low", "medium", "high", "critical", "unknown"];
    for (const l of levels) {
      expect(TENANT_HEALTH_RISK_CONFIG[l]).toBeDefined();
    }
  });

  it("TENANT_HEALTH_SIGNAL_CONFIG covers all 18 signal codes", () => {
    expect(ALL_TENANT_HEALTH_SIGNAL_CODES).toHaveLength(18);
    for (const code of ALL_TENANT_HEALTH_SIGNAL_CODES) {
      expect(TENANT_HEALTH_SIGNAL_CONFIG[code]).toBeDefined();
      expect(TENANT_HEALTH_SIGNAL_CONFIG[code].label.length).toBeGreaterThan(0);
    }
  });

  it("TENANT_HEALTH_ACTION_CONFIG covers all 9 recommended actions", () => {
    expect(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS).toHaveLength(9);
    for (const action of ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS) {
      expect(TENANT_HEALTH_ACTION_CONFIG[action]).toBeDefined();
      expect(TENANT_HEALTH_ACTION_CONFIG[action].label.length).toBeGreaterThan(0);
    }
  });

  it("TENANT_HEALTH_EMPTY_STATE has all required keys", () => {
    expect(TENANT_HEALTH_EMPTY_STATE).toHaveProperty("noData");
    expect(TENANT_HEALTH_EMPTY_STATE).toHaveProperty("loading");
    expect(TENANT_HEALTH_EMPTY_STATE).toHaveProperty("noSignals");
    expect(TENANT_HEALTH_EMPTY_STATE).toHaveProperty("noWarnings");
    expect(TENANT_HEALTH_EMPTY_STATE).toHaveProperty("safetyNotice");
  });

  it("safetyNotice does not say 'enforcement'", () => {
    expect(TENANT_HEALTH_EMPTY_STATE.safetyNotice.toLowerCase()).not.toContain("enforcement");
  });

  it("all status config labels are unique", () => {
    const labels = Object.values(TENANT_HEALTH_STATUS_CONFIG).map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("all risk config labels are unique", () => {
    const labels = Object.values(TENANT_HEALTH_RISK_CONFIG).map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("all signal config labels are unique", () => {
    const labels = Object.values(TENANT_HEALTH_SIGNAL_CONFIG).map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("all action config labels are unique", () => {
    const labels = Object.values(TENANT_HEALTH_ACTION_CONFIG).map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T19 - No payment/invoice/charge/suspend/lock/legal/email/enforcement wording
// ─────────────────────────────────────────────────────────────────────────────

describe("T19 - No forbidden wording in any config string", () => {
  const FORBIDDEN_TERMS = [
    "payment", "invoice", "charge", "billing portal", "tax",
    "legal notice", "auto-suspend", "automatic suspension", "automatic lock",
    "entitlement enforcement",
  ];

  function collectAllStrings(): string[] {
    const parts: string[] = [];

    for (const v of Object.values(TENANT_HEALTH_STATUS_CONFIG)) {
      parts.push(v.label, v.description);
    }
    for (const v of Object.values(TENANT_HEALTH_RISK_CONFIG)) {
      parts.push(v.label, v.description);
    }
    for (const v of Object.values(TENANT_HEALTH_SIGNAL_CONFIG)) {
      parts.push(v.label, v.description);
    }
    for (const v of Object.values(TENANT_HEALTH_ACTION_CONFIG)) {
      parts.push(v.label, v.description);
    }
    parts.push(
      TENANT_HEALTH_EMPTY_STATE.noData,
      TENANT_HEALTH_EMPTY_STATE.loading,
      TENANT_HEALTH_EMPTY_STATE.noSignals,
      TENANT_HEALTH_EMPTY_STATE.noWarnings,
      TENANT_HEALTH_EMPTY_STATE.safetyNotice,
    );

    return parts;
  }

  for (const term of FORBIDDEN_TERMS) {
    it(`no config string contains "${term}"`, () => {
      const allText = collectAllStrings().join(" ").toLowerCase();
      expect(allText).not.toContain(term.toLowerCase());
    });
  }

  it("TENANT_HEALTH_SAFETY_CONTRACT has exactly 12 properties", () => {
    expect(Object.keys(TENANT_HEALTH_SAFETY_CONTRACT)).toHaveLength(12);
  });

  it("all TENANT_HEALTH_SAFETY_CONTRACT properties are true", () => {
    for (const [key, val] of Object.entries(TENANT_HEALTH_SAFETY_CONTRACT)) {
      expect(val).toBe(true);
    }
  });

  it("TENANT_HEALTH_SAFETY_CONTRACT includes noDestructiveTenantActions", () => {
    expect(TENANT_HEALTH_SAFETY_CONTRACT.noDestructiveTenantActions).toBe(true);
  });

  it("TENANT_HEALTH_SAFETY_CONTRACT includes failsClosedOnMissingData", () => {
    expect(TENANT_HEALTH_SAFETY_CONTRACT.failsClosedOnMissingData).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20 - Frontend/backend symmetry
// ─────────────────────────────────────────────────────────────────────────────

describe("T20 - Frontend / backend symmetry", () => {
  it("frontend signal codes match expected backend set (18 codes)", () => {
    const EXPECTED_CODES: TenantHealthSignalCode[] = [
      "workspace_active", "workspace_suspended", "workspace_locked", "workspace_archived",
      "subscription_unknown", "subscription_active",
      "renewal_attention", "renewal_high_risk", "grace_expired",
      "usage_normal", "usage_approaching_limit", "usage_exceeded_limit", "usage_unknown",
      "entitlement_overrides_present", "custom_plan",
      "operational_data_missing", "governance_warning_present", "lifecycle_manual_review_required",
    ];
    expect(ALL_TENANT_HEALTH_SIGNAL_CODES).toHaveLength(EXPECTED_CODES.length);
    for (const code of EXPECTED_CODES) {
      expect(ALL_TENANT_HEALTH_SIGNAL_CODES).toContain(code);
    }
  });

  it("frontend action codes match expected backend set (9 actions)", () => {
    const EXPECTED_ACTIONS: RecommendedTenantHealthAction[] = [
      "none", "monitor", "review_subscription", "review_usage", "review_entitlements",
      "review_lifecycle", "contact_customer", "prepare_restriction_review", "manual_review_required",
    ];
    expect(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS).toHaveLength(EXPECTED_ACTIONS.length);
    for (const action of EXPECTED_ACTIONS) {
      expect(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS).toContain(action);
    }
  });

  it("frontend health statuses match expected set (7 statuses)", () => {
    const EXPECTED_STATUSES: TenantHealthStatus[] = [
      "healthy", "attention", "degraded", "restricted", "suspended", "archived", "unknown",
    ];
    for (const s of EXPECTED_STATUSES) {
      expect(TENANT_HEALTH_STATUS_CONFIG[s]).toBeDefined();
    }
  });

  it("frontend risk levels match expected set (6 levels)", () => {
    const EXPECTED_LEVELS: TenantHealthRiskLevel[] = [
      "none", "low", "medium", "high", "critical", "unknown",
    ];
    for (const l of EXPECTED_LEVELS) {
      expect(TENANT_HEALTH_RISK_CONFIG[l]).toBeDefined();
    }
  });

  it("signal severity values are constrained to valid options", () => {
    const VALID_SEVERITIES = ["info", "warning", "critical"];
    for (const sig of Object.values(TENANT_HEALTH_SIGNAL_CONFIG)) {
      expect(VALID_SEVERITIES).toContain(sig.severity);
    }
  });
});
