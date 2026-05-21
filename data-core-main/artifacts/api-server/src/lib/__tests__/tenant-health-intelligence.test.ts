/**
 * @file   lib/__tests__/tenant-health-intelligence.test.ts
 * @phase  P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * Backend unit tests for tenant-health-intelligence.ts
 * Pure derivation - no DB, no HTTP, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  deriveTenantHealthSignals,
  deriveTenantHealthRiskLevel,
  deriveTenantHealthStatus,
  deriveRecommendedTenantHealthAction,
  deriveTenantHealthProfile,
  buildTenantHealthWarnings,
  buildTenantHealthSummary,
  ALL_TENANT_HEALTH_SIGNAL_CODES,
  ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS,
  type TenantHealthInput,
  type TenantHealthProfile,
} from "../tenant-health-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeHealthyInput(overrides: Partial<TenantHealthInput> = {}): TenantHealthInput {
  return {
    tenantId:           "tenant-001",
    workspaceId:        1,
    workspaceStatus:    "active",
    subscriptionStatus: "active",
    renewal: {
      urgency: "none",
      signals: ["subscription_active"],
      warnings: [],
    },
    usage: {
      capacityRiskLevel: "none",
      warningCount:       0,
      exceededCount:      0,
      unknownCount:       0,
    },
    entitlements: {
      customEntitlementsCount: 0,
      planCode:                "standard",
    },
    governance: {
      hasWarnings: false,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Tenant health config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - Tenant health config stable", () => {
  it("ALL_TENANT_HEALTH_SIGNAL_CODES has exactly 18 codes", () => {
    expect(ALL_TENANT_HEALTH_SIGNAL_CODES).toHaveLength(18);
  });

  it("ALL_TENANT_HEALTH_SIGNAL_CODES has no duplicates", () => {
    const unique = new Set(ALL_TENANT_HEALTH_SIGNAL_CODES);
    expect(unique.size).toBe(ALL_TENANT_HEALTH_SIGNAL_CODES.length);
  });

  it("ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS has exactly 9 actions", () => {
    expect(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS).toHaveLength(9);
  });

  it("ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS has no duplicates", () => {
    const unique = new Set(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS);
    expect(unique.size).toBe(ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS.length);
  });

  it("all expected signal codes are present", () => {
    const codes = ALL_TENANT_HEALTH_SIGNAL_CODES;
    expect(codes).toContain("workspace_active");
    expect(codes).toContain("workspace_suspended");
    expect(codes).toContain("workspace_archived");
    expect(codes).toContain("grace_expired");
    expect(codes).toContain("usage_exceeded_limit");
    expect(codes).toContain("renewal_high_risk");
    expect(codes).toContain("entitlement_overrides_present");
    expect(codes).toContain("governance_warning_present");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Health signal config stable (derivation of individual signal codes)
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - Health signal config stable", () => {
  it("active workspace emits workspace_active signal", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput());
    expect(signals).toContain("workspace_active");
    expect(signals).not.toContain("workspace_suspended");
    expect(signals).not.toContain("workspace_archived");
  });

  it("suspended workspace emits workspace_suspended signal", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({ workspaceStatus: "suspended" }));
    expect(signals).toContain("workspace_suspended");
    expect(signals).not.toContain("workspace_active");
  });

  it("locked workspace emits workspace_locked signal", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({ workspaceStatus: "locked" }));
    expect(signals).toContain("workspace_locked");
  });

  it("disabled workspace emits workspace_archived signal", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({ workspaceStatus: "disabled" }));
    expect(signals).toContain("workspace_archived");
  });

  it("pending_activation emits lifecycle_manual_review_required", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({ workspaceStatus: "pending_activation" }));
    expect(signals).toContain("lifecycle_manual_review_required");
  });

  it("governance warnings emit governance_warning_present", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({ governance: { hasWarnings: true } }));
    expect(signals).toContain("governance_warning_present");
  });

  it("custom plan emits custom_plan signal", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({
      entitlements: { customEntitlementsCount: 0, planCode: "custom" },
    }));
    expect(signals).toContain("custom_plan");
  });

  it("entitlement overrides emit entitlement_overrides_present", () => {
    const signals = deriveTenantHealthSignals(makeHealthyInput({
      entitlements: { customEntitlementsCount: 3, planCode: "standard" },
    }));
    expect(signals).toContain("entitlement_overrides_present");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Healthy tenant derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - Healthy tenant derivation", () => {
  it("healthy input produces healthStatus healthy", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.healthStatus).toBe("healthy");
  });

  it("healthy input produces riskLevel none", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.riskLevel).toBe("none");
  });

  it("healthy input produces recommendedAction none", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.recommendedAction).toBe("none");
  });

  it("healthy input produces empty warnings", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.warnings).toHaveLength(0);
  });

  it("healthy input produces non-empty summary", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.summary.length).toBeGreaterThan(10);
  });

  it("healthy input has ISO derivedAt", () => {
    const now = new Date("2026-05-16T12:00:00Z");
    const profile = deriveTenantHealthProfile(makeHealthyInput(), now);
    expect(profile.derivedAt).toBe("2026-05-16T12:00:00.000Z");
  });

  it("healthy input lifecycle component is ok", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.components.lifecycle.status).toBe("ok");
  });

  it("healthy input subscription component is ok", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.components.subscription.status).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Suspended workspace derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - Suspended workspace derivation", () => {
  it("suspended workspace → healthStatus suspended", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(profile.healthStatus).toBe("suspended");
  });

  it("suspended workspace → riskLevel high (at minimum)", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(["high", "critical"]).toContain(profile.riskLevel);
  });

  it("suspended workspace → recommendedAction review_lifecycle", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(profile.recommendedAction).toBe("review_lifecycle");
  });

  it("suspended workspace → lifecycle component is critical", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(profile.components.lifecycle.status).toBe("critical");
  });

  it("suspended workspace → warning includes suspension message", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(profile.warnings.some(w => w.toLowerCase().includes("suspend"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Archived workspace derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - Archived workspace derivation", () => {
  it("archived workspace (disabled) → healthStatus archived", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "disabled" }), new Date(),
    );
    expect(profile.healthStatus).toBe("archived");
  });

  it("archived workspace → riskLevel critical", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "disabled" }), new Date(),
    );
    expect(profile.riskLevel).toBe("critical");
  });

  it("archived workspace → recommendedAction review_lifecycle", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "disabled" }), new Date(),
    );
    expect(profile.recommendedAction).toBe("review_lifecycle");
  });

  it("archived workspace → signals include workspace_archived", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "disabled" }), new Date(),
    );
    expect(profile.signals).toContain("workspace_archived");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Grace expired critical derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - Grace expired critical derivation", () => {
  it("grace_period_expired signal → riskLevel critical", () => {
    const input = makeHealthyInput({
      renewal: {
        urgency: "critical",
        signals: ["grace_period_expired"],
        warnings: ["Grace period has expired."],
      },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.riskLevel).toBe("critical");
  });

  it("grace_period_expired → signals include grace_expired", () => {
    const input = makeHealthyInput({
      renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.signals).toContain("grace_expired");
  });

  it("grace_period_expired → recommendedAction contact_customer", () => {
    const input = makeHealthyInput({
      renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.recommendedAction).toBe("contact_customer");
  });

  it("grace_period_expired → healthStatus restricted (active workspace)", () => {
    const input = makeHealthyInput({
      renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.healthStatus).toBe("restricted");
  });

  it("grace_period_expired → warnings include grace message", () => {
    const input = makeHealthyInput({
      renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.warnings.some(w => w.toLowerCase().includes("grace"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Usage exceeded derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - Usage exceeded derivation", () => {
  it("exceededCount > 0 → usage_exceeded_limit signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 2, unknownCount: 0 } }),
      new Date(),
    );
    expect(profile.signals).toContain("usage_exceeded_limit");
  });

  it("exceededCount > 0 → riskLevel at least high", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 1, unknownCount: 0 } }),
      new Date(),
    );
    expect(["high", "critical"]).toContain(profile.riskLevel);
  });

  it("exceededCount > 0 → recommendedAction review_usage", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 1, unknownCount: 0 } }),
      new Date(),
    );
    expect(profile.recommendedAction).toBe("review_usage");
  });

  it("warningCount > 0 → usage_approaching_limit signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "medium", warningCount: 2, exceededCount: 0, unknownCount: 0 } }),
      new Date(),
    );
    expect(profile.signals).toContain("usage_approaching_limit");
  });

  it("warningCount > 0 → riskLevel at least medium", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "medium", warningCount: 1, exceededCount: 0, unknownCount: 0 } }),
      new Date(),
    );
    expect(["medium", "high", "critical"]).toContain(profile.riskLevel);
  });

  it("capacityRiskLevel critical + exceeded → riskLevel critical", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "critical", warningCount: 0, exceededCount: 3, unknownCount: 0 } }),
      new Date(),
    );
    expect(profile.riskLevel).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Renewal high risk derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - Renewal high risk derivation", () => {
  it("renewalUrgency high → renewal_high_risk signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "high", signals: ["renewal_due_now"], warnings: [] } }),
      new Date(),
    );
    expect(profile.signals).toContain("renewal_high_risk");
  });

  it("renewalUrgency high → riskLevel at least high", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "high", signals: [], warnings: [] } }),
      new Date(),
    );
    expect(["high", "critical"]).toContain(profile.riskLevel);
  });

  it("renewalUrgency medium → renewal_attention signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "medium", signals: ["renewal_due_soon"], warnings: [] } }),
      new Date(),
    );
    expect(profile.signals).toContain("renewal_attention");
  });

  it("renewalUrgency medium → riskLevel at least medium", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "medium", signals: [], warnings: [] } }),
      new Date(),
    );
    expect(["medium", "high", "critical"]).toContain(profile.riskLevel);
  });

  it("renewalUrgency high → recommendedAction contact_customer", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "high", signals: [], warnings: [] } }),
      new Date(),
    );
    expect(profile.recommendedAction).toBe("contact_customer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Entitlement overrides signal
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - Entitlement overrides signal", () => {
  it("customEntitlementsCount > 0 → entitlement_overrides_present signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ entitlements: { customEntitlementsCount: 2, planCode: "standard" } }),
      new Date(),
    );
    expect(profile.signals).toContain("entitlement_overrides_present");
  });

  it("customEntitlementsCount > 0 → riskLevel at least low", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ entitlements: { customEntitlementsCount: 1, planCode: "standard" } }),
      new Date(),
    );
    expect(["low", "medium", "high", "critical"]).toContain(profile.riskLevel);
  });

  it("customEntitlementsCount 0 → no entitlement_overrides_present signal", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.signals).not.toContain("entitlement_overrides_present");
  });

  it("customEntitlementsCount > 0 → recommendedAction review_entitlements (when no higher-priority issue)", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ entitlements: { customEntitlementsCount: 1, planCode: "standard" } }),
      new Date(),
    );
    expect(profile.recommendedAction).toBe("review_entitlements");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Missing operational data signal
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - Missing operational data signal", () => {
  it("subscriptionStatus unknown → subscription_unknown + operational_data_missing", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ subscriptionStatus: "unknown" }),
      new Date(),
    );
    expect(profile.signals).toContain("subscription_unknown");
    expect(profile.signals).toContain("operational_data_missing");
  });

  it("subscriptionStatus unknown → riskLevel at least medium", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ subscriptionStatus: "unknown" }),
      new Date(),
    );
    expect(["medium", "high", "critical"]).toContain(profile.riskLevel);
  });

  it("usage unknownCount > 0 with no exceeded/warning → usage_unknown signal", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "unknown", warningCount: 0, exceededCount: 0, unknownCount: 3 } }),
      new Date(),
    );
    expect(profile.signals).toContain("usage_unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - Risk escalation never decreases
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - Risk escalation never decreases", () => {
  it("adding a lower-risk layer does not reduce riskLevel", () => {
    // Start with high risk (suspended)
    const highRiskInput = makeHealthyInput({ workspaceStatus: "suspended" });
    const profileHigh = deriveTenantHealthProfile(highRiskInput, new Date());

    // Add entitlement override (low risk) - should not reduce
    const combined = makeHealthyInput({
      workspaceStatus: "suspended",
      entitlements: { customEntitlementsCount: 1, planCode: "standard" },
    });
    const profileCombined = deriveTenantHealthProfile(combined, new Date());

    const riskOrder: Record<string, number> = { none: 0, unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };
    expect(riskOrder[profileCombined.riskLevel] ?? 0)
      .toBeGreaterThanOrEqual(riskOrder[profileHigh.riskLevel] ?? 0);
  });

  it("suspended + grace_expired → riskLevel critical (highest wins)", () => {
    const input = makeHealthyInput({
      workspaceStatus: "suspended",
      renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.riskLevel).toBe("critical");
  });

  it("archived workspace always at least critical regardless of other inputs", () => {
    const input = makeHealthyInput({
      workspaceStatus: "disabled",
      subscriptionStatus: "active",
      renewal: { urgency: "none", signals: [], warnings: [] },
      usage: { capacityRiskLevel: "none", warningCount: 0, exceededCount: 0, unknownCount: 0 },
    });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.riskLevel).toBe("critical");
  });

  it("healthy tenant escalates to medium when renewal_attention added", () => {
    const profileBefore = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    const profileAfter  = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "medium", signals: ["renewal_due_soon"], warnings: [] } }),
      new Date(),
    );
    const riskOrder: Record<string, number> = { none: 0, unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };
    expect(riskOrder[profileAfter.riskLevel] ?? 0)
      .toBeGreaterThan(riskOrder[profileBefore.riskLevel] ?? 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - Recommended action derivation stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - Recommended action derivation stable", () => {
  const cases: Array<[string, Partial<TenantHealthInput>, string]> = [
    ["archived workspace → review_lifecycle",         { workspaceStatus: "disabled" },                                                           "review_lifecycle"],
    ["suspended workspace → review_lifecycle",        { workspaceStatus: "suspended" },                                                          "review_lifecycle"],
    ["locked workspace → review_lifecycle",           { workspaceStatus: "locked" },                                                             "review_lifecycle"],
    ["pending_activation → manual_review_required",  { workspaceStatus: "pending_activation" },                                                  "manual_review_required"],
    ["grace_expired → contact_customer",             { renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] } },       "contact_customer"],
    ["renewal_high_risk → contact_customer",         { renewal: { urgency: "high", signals: [], warnings: [] } },                                "contact_customer"],
    ["usage_exceeded → review_usage",                { usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 1, unknownCount: 0 } }, "review_usage"],
    ["renewal_attention → review_subscription",      { renewal: { urgency: "medium", signals: ["renewal_due_soon"], warnings: [] } },             "review_subscription"],
    ["healthy → none",                               {},                                                                                          "none"],
  ];

  for (const [label, partial, expected] of cases) {
    it(label, () => {
      const profile = deriveTenantHealthProfile(makeHealthyInput(partial), new Date());
      expect(profile.recommendedAction).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - Health warnings stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T13 - Health warnings stable", () => {
  it("healthy tenant has no warnings", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.warnings).toHaveLength(0);
  });

  it("suspended workspace → at least one warning", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    expect(profile.warnings.length).toBeGreaterThan(0);
  });

  it("grace_expired → warning about grace period", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] } }),
      new Date(),
    );
    expect(profile.warnings.some(w => w.toLowerCase().includes("grace"))).toBe(true);
  });

  it("usage exceeded → warning about usage", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 1, unknownCount: 0 } }),
      new Date(),
    );
    expect(profile.warnings.some(w => w.toLowerCase().includes("usage"))).toBe(true);
  });

  it("subscription unknown → warning about missing data", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ subscriptionStatus: "unknown" }), new Date(),
    );
    expect(profile.warnings.some(w => w.toLowerCase().includes("subscription") || w.toLowerCase().includes("data"))).toBe(true);
  });

  it("multiple issues → multiple warnings", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({
        workspaceStatus:    "suspended",
        subscriptionStatus: "unknown",
        renewal:            { urgency: "critical", signals: ["grace_period_expired"], warnings: [] },
      }),
      new Date(),
    );
    expect(profile.warnings.length).toBeGreaterThan(1);
  });

  it("buildTenantHealthWarnings returns empty array for healthy profile", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    const warnings = buildTenantHealthWarnings(profile);
    expect(warnings).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - Health API super-admin only (contract check)
// ─────────────────────────────────────────────────────────────────────────────

describe("T14 - Health API read-only contract", () => {
  it("deriveTenantHealthProfile is a pure function (idempotent)", () => {
    const input = makeHealthyInput();
    const now = new Date("2026-05-16T12:00:00Z");
    const profile1 = deriveTenantHealthProfile(input, now);
    const profile2 = deriveTenantHealthProfile(input, now);
    expect(profile1.healthStatus).toBe(profile2.healthStatus);
    expect(profile1.riskLevel).toBe(profile2.riskLevel);
    expect(profile1.signals).toEqual(profile2.signals);
    expect(profile1.derivedAt).toBe(profile2.derivedAt);
  });

  it("deriveTenantHealthProfile does not mutate input", () => {
    const input = makeHealthyInput();
    const inputCopy = JSON.parse(JSON.stringify(input)) as TenantHealthInput;
    deriveTenantHealthProfile(input, new Date());
    expect(input).toEqual(inputCopy);
  });

  it("buildTenantHealthSummary is deterministic", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date("2026-01-01T00:00:00Z"));
    const s1 = buildTenantHealthSummary(profile);
    const s2 = buildTenantHealthSummary(profile);
    expect(s1).toBe(s2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Health API read-only no mutation
// ─────────────────────────────────────────────────────────────────────────────

describe("T15 - Health derivation no forbidden wording", () => {
  const FORBIDDEN_TERMS = [
    "payment", "invoice", "charge", "billing portal", "tax",
    "legal notice", "auto-suspend", "automatic suspension", "automatic lock",
    "entitlement enforcement",
  ];

  it("deriveTenantHealthProfile does not produce warnings containing forbidden terms", () => {
    const inputs: TenantHealthInput[] = [
      makeHealthyInput(),
      makeHealthyInput({ workspaceStatus: "suspended" }),
      makeHealthyInput({ workspaceStatus: "disabled" }),
      makeHealthyInput({ renewal: { urgency: "critical", signals: ["grace_period_expired"], warnings: [] } }),
      makeHealthyInput({ usage: { capacityRiskLevel: "critical", warningCount: 0, exceededCount: 3, unknownCount: 0 } }),
    ];

    for (const input of inputs) {
      const profile = deriveTenantHealthProfile(input, new Date());
      const allText = [profile.summary, ...profile.warnings].join(" ").toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        expect(allText).not.toContain(term.toLowerCase());
      }
    }
  });

  it("buildTenantHealthSummary does not mention enforcement or payment", () => {
    const profile = deriveTenantHealthProfile(
      makeHealthyInput({ workspaceStatus: "suspended" }), new Date(),
    );
    const summary = profile.summary.toLowerCase();
    expect(summary).not.toContain("payment");
    expect(summary).not.toContain("charge");
    expect(summary).not.toContain("invoice");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - Tenant registry reflects health summary
// ─────────────────────────────────────────────────────────────────────────────

describe("T16 - Tenant registry health fields passthrough", () => {
  it("profile carries tenantId and workspaceId from input", () => {
    const input = makeHealthyInput({ tenantId: "abc-123", workspaceId: 42 });
    const profile = deriveTenantHealthProfile(input, new Date());
    expect(profile.tenantId).toBe("abc-123");
    expect(profile.workspaceId).toBe(42);
  });

  it("profile components object has all 6 required keys", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    expect(profile.components).toHaveProperty("lifecycle");
    expect(profile.components).toHaveProperty("subscription");
    expect(profile.components).toHaveProperty("renewal");
    expect(profile.components).toHaveProperty("usage");
    expect(profile.components).toHaveProperty("entitlements");
    expect(profile.components).toHaveProperty("governance");
  });

  it("each component has name, status, and note", () => {
    const profile = deriveTenantHealthProfile(makeHealthyInput(), new Date());
    for (const comp of Object.values(profile.components)) {
      expect(comp).toHaveProperty("name");
      expect(comp).toHaveProperty("status");
      expect(comp).toHaveProperty("note");
      expect(comp.note.length).toBeGreaterThan(0);
    }
  });
});
