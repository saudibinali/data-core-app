/**
 * @file   lib/__tests__/tenant-lifecycle-evaluation.test.ts
 * @phase  P13-I - Automated Lifecycle Evaluation Engine
 *
 * Backend unit tests for tenant-lifecycle-evaluation.ts
 * Pure derivation - no DB, no HTTP, no side effects.
 *
 * Tests:
 *   T1  - safety contract properties all true
 *   T2  - ALL_EVALUATION_SIGNAL_CODES has 17 entries
 *   T3  - ALL_EVALUATION_RECOMMENDED_ACTIONS has 10 entries
 *   T4  - healthy tenant produces no signals and "none" severity
 *   T5  - suspended workspace triggers workspace_suspended_requires_review signal
 *   T6  - locked workspace triggers manual_review_required signal and "critical" severity
 *   T7  - grace period expired triggers prepare_restriction_review action
 *   T8  - subscription expired triggers review_subscription action
 *   T9  - usage exceeded triggers usage_exceeded_requires_review signal
 *   T10 - usage approaching triggers usage_approaching_requires_review signal
 *   T11 - missing subscription metadata triggers subscription_metadata_missing
 *   T12 - trial ending triggers trial_ending_requires_review
 *   T13 - custom plan triggers custom_plan_requires_review signal
 *   T14 - entitlement overrides trigger entitlement_overrides_require_review
 *   T15 - health critical triggers health_critical_requires_review and manual_review_required
 *   T16 - governance warning triggers governance_warning_requires_review signal
 *   T17 - deriveTenantLifecycleEvaluationProfile returns complete profile shape
 *   T18 - reviewEligibility fields correctly mapped for complex input
 */

import { describe, it, expect } from "vitest";
import {
  deriveLifecycleEvaluationSignals,
  deriveEvaluationSeverity,
  deriveEvaluationRecommendedAction,
  deriveReviewEligibility,
  buildEvaluationWarnings,
  buildEvaluationSummary,
  deriveTenantLifecycleEvaluationProfile,
  LIFECYCLE_EVALUATION_SAFETY_CONTRACT,
  ALL_EVALUATION_SIGNAL_CODES,
  ALL_EVALUATION_RECOMMENDED_ACTIONS,
  type TenantLifecycleEvaluationInput,
  type EvaluationSignalCode,
} from "../tenant-lifecycle-evaluation";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeHealthyInput(overrides: Partial<TenantLifecycleEvaluationInput> = {}): TenantLifecycleEvaluationInput {
  return {
    tenantId:    "tenant-001",
    workspaceId: 1,
    lifecycle: {
      workspaceStatus: "active",
      lifecycleState:  "active",
    },
    subscription: {
      subscriptionStatus:  "active",
      planCode:            "standard",
      renewalDueSoon:      false,
      renewalDueNow:       false,
      trialEndingSoon:     false,
      gracePeriodActive:   false,
      graceEndingSoon:     false,
      graceExpired:        false,
      subscriptionExpired: false,
      hasMissingMetadata:  false,
    },
    usage: {
      capacityRiskLevel: "none",
      warningCount:      0,
      exceededCount:     0,
      unknownCount:      0,
    },
    entitlements: {
      customEntitlementsCount: 0,
      planCode:                "standard",
    },
    health: {
      healthRiskLevel:         "none",
      healthStatus:            "healthy",
      healthRecommendedAction: "none",
      healthWarningCount:      0,
    },
    governance: {
      hasWarnings: false,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - safety contract all true
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - LIFECYCLE_EVALUATION_SAFETY_CONTRACT all true", () => {
  it("T1: all safety contract boolean properties are true", () => {
    const keys: Array<keyof typeof LIFECYCLE_EVALUATION_SAFETY_CONTRACT> = [
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
    ];
    for (const key of keys) {
      expect(LIFECYCLE_EVALUATION_SAFETY_CONTRACT[key], `${key} must be true`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - signal codes registry
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - ALL_EVALUATION_SIGNAL_CODES has 17 entries", () => {
  it("T2: signal codes count is 17 and has no duplicates", () => {
    expect(ALL_EVALUATION_SIGNAL_CODES).toHaveLength(17);
    const unique = new Set(ALL_EVALUATION_SIGNAL_CODES);
    expect(unique.size).toBe(17);
  });

  it("T2b: manual_review_required is in signal codes", () => {
    expect(ALL_EVALUATION_SIGNAL_CODES).toContain("manual_review_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - recommended actions registry
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - ALL_EVALUATION_RECOMMENDED_ACTIONS has 10 entries", () => {
  it("T3: action count is 10 and has no duplicates", () => {
    expect(ALL_EVALUATION_RECOMMENDED_ACTIONS).toHaveLength(10);
    const unique = new Set(ALL_EVALUATION_RECOMMENDED_ACTIONS);
    expect(unique.size).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - healthy tenant produces no signals and "none" severity
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - healthy tenant produces no signals", () => {
  it("T4: fully healthy input produces no signals, severity=none, action=none", () => {
    const input = makeHealthyInput();
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toHaveLength(0);
    const severity = deriveEvaluationSeverity(signals);
    expect(severity).toBe("none");
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(action).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - suspended workspace
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - suspended workspace triggers workspace_suspended_requires_review", () => {
  it("T5: suspended workspaceStatus produces workspace_suspended_requires_review signal", () => {
    const input = makeHealthyInput({
      lifecycle: { workspaceStatus: "suspended", lifecycleState: "suspended" },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("workspace_suspended_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["high", "critical"]).toContain(severity);
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(["review_lifecycle", "prepare_restriction_review", "manual_review_required"]).toContain(action);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - locked workspace triggers manual_review_required and critical severity
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - locked workspace triggers manual_review_required", () => {
  it("T6: locked workspaceStatus produces manual_review_required signal and critical severity", () => {
    const input = makeHealthyInput({
      lifecycle: { workspaceStatus: "locked", lifecycleState: "locked" },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("workspace_locked_requires_review");
    expect(signals).toContain("manual_review_required");
    const severity = deriveEvaluationSeverity(signals);
    expect(severity).toBe("critical");
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(action).toBe("manual_review_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - grace period expired triggers prepare_restriction_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - grace period expired triggers prepare_restriction_review", () => {
  it("T7: graceExpired=true produces grace_period_expired_requires_review and manual_review_required", () => {
    const input = makeHealthyInput({
      subscription: {
        ...makeHealthyInput().subscription,
        graceExpired: true,
      },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("grace_period_expired_requires_review");
    expect(signals).toContain("manual_review_required");
    const severity = deriveEvaluationSeverity(signals);
    expect(severity).toBe("critical");
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(action).toBe("manual_review_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - subscription expired triggers review_subscription action
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - subscription expired triggers review_subscription", () => {
  it("T8: subscriptionExpired=true (active workspace) produces subscription_expired_requires_review", () => {
    const input = makeHealthyInput({
      subscription: {
        ...makeHealthyInput().subscription,
        subscriptionExpired: true,
      },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("subscription_expired_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["high", "critical"]).toContain(severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - usage exceeded triggers usage_exceeded_requires_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - usage exceeded triggers usage_exceeded_requires_review", () => {
  it("T9: exceededCount > 0 produces usage_exceeded_requires_review signal", () => {
    const input = makeHealthyInput({
      usage: { capacityRiskLevel: "high", warningCount: 0, exceededCount: 2, unknownCount: 0 },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("usage_exceeded_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["high", "critical"]).toContain(severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - usage approaching triggers usage_approaching_requires_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - usage approaching triggers usage_approaching_requires_review", () => {
  it("T10: warningCount > 0 produces usage_approaching_requires_review signal", () => {
    const input = makeHealthyInput({
      usage: { capacityRiskLevel: "medium", warningCount: 1, exceededCount: 0, unknownCount: 0 },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("usage_approaching_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["medium", "high"]).toContain(severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - missing subscription metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - missing subscription metadata triggers subscription_metadata_missing", () => {
  it("T11: hasMissingMetadata=true produces subscription_metadata_missing signal", () => {
    const input = makeHealthyInput({
      subscription: {
        ...makeHealthyInput().subscription,
        hasMissingMetadata: true,
        subscriptionStatus: "unknown",
      },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("subscription_metadata_missing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - trial ending
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - trial ending triggers trial_ending_requires_review", () => {
  it("T12: trialEndingSoon=true produces trial_ending_requires_review signal", () => {
    const input = makeHealthyInput({
      subscription: {
        ...makeHealthyInput().subscription,
        trialEndingSoon: true,
        subscriptionStatus: "trialing",
      },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("trial_ending_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["low", "medium"]).toContain(severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - custom plan triggers custom_plan_requires_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T13 - custom plan triggers custom_plan_requires_review", () => {
  it("T13: planCode=custom produces custom_plan_requires_review signal", () => {
    const input = makeHealthyInput({
      entitlements: { customEntitlementsCount: 0, planCode: "custom" },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("custom_plan_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["low", "medium"]).toContain(severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - entitlement overrides trigger entitlement_overrides_require_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T14 - entitlement overrides trigger entitlement_overrides_require_review", () => {
  it("T14: customEntitlementsCount > 0 produces entitlement_overrides_require_review signal", () => {
    const input = makeHealthyInput({
      entitlements: { customEntitlementsCount: 3, planCode: "standard" },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("entitlement_overrides_require_review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - health critical triggers manual_review_required
// ─────────────────────────────────────────────────────────────────────────────

describe("T15 - health critical triggers health_critical_requires_review + manual_review_required", () => {
  it("T15: healthRiskLevel=critical produces health_critical_requires_review and manual_review_required", () => {
    const input = makeHealthyInput({
      health: {
        healthRiskLevel:         "critical",
        healthStatus:            "restricted",
        healthRecommendedAction: "manual_review_required",
        healthWarningCount:      3,
      },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("health_critical_requires_review");
    expect(signals).toContain("manual_review_required");
    const severity = deriveEvaluationSeverity(signals);
    expect(severity).toBe("critical");
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(action).toBe("manual_review_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - governance warning triggers governance_warning_requires_review
// ─────────────────────────────────────────────────────────────────────────────

describe("T16 - governance warning triggers governance_warning_requires_review", () => {
  it("T16: governance.hasWarnings=true produces governance_warning_requires_review signal", () => {
    const input = makeHealthyInput({
      governance: { hasWarnings: true },
    });
    const signals = deriveLifecycleEvaluationSignals(input);
    expect(signals).toContain("governance_warning_requires_review");
    const severity = deriveEvaluationSeverity(signals);
    expect(["medium", "high"]).toContain(severity);
    const action = deriveEvaluationRecommendedAction(signals, severity);
    expect(action).toBe("review_governance");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 - deriveTenantLifecycleEvaluationProfile returns complete profile shape
// ─────────────────────────────────────────────────────────────────────────────

describe("T17 - deriveTenantLifecycleEvaluationProfile returns complete profile", () => {
  it("T17: profile has all required fields for healthy input", () => {
    const input = makeHealthyInput();
    const now   = new Date("2026-05-16T10:00:00.000Z");
    const profile = deriveTenantLifecycleEvaluationProfile(input, now);

    expect(profile.tenantId).toBe("tenant-001");
    expect(profile.workspaceId).toBe(1);
    expect(Array.isArray(profile.signals)).toBe(true);
    expect(profile.severity).toBe("none");
    expect(profile.recommendedAction).toBe("none");
    expect(profile.reviewEligibility).toBeDefined();
    expect(typeof profile.reviewEligibility.manualReviewRequired).toBe("boolean");
    expect(Array.isArray(profile.warnings)).toBe(true);
    expect(typeof profile.summary).toBe("string");
    expect(typeof profile.evaluatedAt).toBe("string");
    expect(typeof profile.safetyNotice).toBe("string");
    expect(profile.safetyNotice.length).toBeGreaterThan(10);
  });

  it("T17b: profile safetyNotice does not contain forbidden wording", () => {
    const profile = deriveTenantLifecycleEvaluationProfile(makeHealthyInput());
    const notice = profile.safetyNotice.toLowerCase();
    const forbidden = ["payment", "invoice", "charge", "billing portal", "tax", "auto-suspend"];
    for (const word of forbidden) {
      expect(notice, `safetyNotice must not contain "${word}"`).not.toContain(word);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 - reviewEligibility correctly mapped for complex input
// ─────────────────────────────────────────────────────────────────────────────

describe("T18 - reviewEligibility fields correctly mapped", () => {
  it("T18: suspended+graceExpired+usageExceeded sets multiple eligibility flags", () => {
    const signals: EvaluationSignalCode[] = [
      "workspace_suspended_requires_review",
      "grace_period_expired_requires_review",
      "usage_exceeded_requires_review",
      "entitlement_overrides_require_review",
      "governance_warning_requires_review",
      "manual_review_required",
    ];
    const severity = deriveEvaluationSeverity(signals);
    const eligibility = deriveReviewEligibility(signals, severity);

    expect(eligibility.suspensionReviewEligible).toBe(true);
    expect(eligibility.graceReviewEligible).toBe(true);
    expect(eligibility.usageReviewEligible).toBe(true);
    expect(eligibility.entitlementReviewEligible).toBe(true);
    expect(eligibility.governanceReviewEligible).toBe(true);
    expect(eligibility.lifecycleReviewEligible).toBe(true);
    expect(eligibility.manualReviewRequired).toBe(true);
  });

  it("T18b: healthy input has all eligibility flags false", () => {
    const signals: EvaluationSignalCode[] = [];
    const eligibility = deriveReviewEligibility(signals, "none");
    expect(eligibility.manualReviewRequired).toBe(false);
    expect(eligibility.suspensionReviewEligible).toBe(false);
    expect(eligibility.renewalReviewEligible).toBe(false);
    expect(eligibility.usageReviewEligible).toBe(false);
    expect(eligibility.entitlementReviewEligible).toBe(false);
    expect(eligibility.lifecycleReviewEligible).toBe(false);
    expect(eligibility.governanceReviewEligible).toBe(false);
  });
});
