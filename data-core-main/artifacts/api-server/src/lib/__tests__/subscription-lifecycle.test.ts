/**
 * @file   src/lib/__tests__/subscription-lifecycle.test.ts
 * @phase  P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * Pure model tests for subscription lifecycle derivation, validation, and audit.
 * No DB, no HTTP - all functions are testable in isolation.
 *
 * Tests:
 *   T1   deriveSubscriptionStatus: deterministic / stable output
 *   T2   deriveSubscriptionStatus: trialing derivation
 *   T3   deriveSubscriptionStatus: renewal_due derivation
 *   T4   deriveSubscriptionStatus: grace_period derivation
 *   T5   deriveSubscriptionStatus: expired derivation
 *   T6   deriveSubscriptionStatus: cancelled/suspended precedence
 *   T7   validateSubscriptionMetadataUpdate: date period validation
 *   T8   validateSubscriptionMetadataUpdate: impossible combinations
 *   T9   validateSubscriptionMetadataUpdate: super-admin fields only (reason/confirmation)
 *   T10  validateSubscriptionMetadataUpdate: reason/confirmation required
 *   T11  buildSubscriptionAuditPayload: changedFields populated
 *   T12  buildSubscriptionAuditPayload: eventType = subscription_metadata_updated
 *   T13  buildTenantProfile: reflects subscription metadata when provided
 *   T14  deriveRiskSignalSummary: renewal/grace/expired risk signals
 *   T15  PLAN_CODE_MAP: stable entries for all 5 plan codes
 *   T16  ALL_SUBSCRIPTION_STATUSES: 8 statuses, no duplicates
 */

import { describe, it, expect } from "vitest";
import {
  deriveSubscriptionStatus,
  isRenewalApproaching,
  isGracePeriodActive,
  isSubscriptionExpired,
  calculateDaysUntilEnd,
  calculateDaysPastDue,
  validateSubscriptionMetadataUpdate,
  buildSubscriptionAuditPayload,
  PLAN_CODE_MAP,
  ALL_PLAN_CODES,
  ALL_SUBSCRIPTION_STATUSES,
  RENEWAL_WARNING_DAYS,
  REASON_MIN_LENGTH,
  type SubscriptionFields,
  type SubscriptionUpdateRequest,
} from "../subscription-lifecycle";

import {
  buildTenantProfile,
  deriveRiskSignalSummary,
  type RawWorkspaceRow,
  type RawSubscriptionRow,
} from "../tenant-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-16T12:00:00Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

const EMPTY_SUB: Partial<SubscriptionFields> = {
  planCode:             null,
  subscriptionStatus:   "unknown",
  billingPeriodStart:   null,
  billingPeriodEnd:     null,
  renewalDueAt:         null,
  trialStartedAt:       null,
  trialEndsAt:          null,
  gracePeriodStartedAt: null,
  gracePeriodEndsAt:    null,
  cancelledAt:          null,
  suspendedAt:          null,
};

const VALID_REASON = "Updating subscription metadata for this workspace.";

function validRequest(overrides: Partial<SubscriptionUpdateRequest> = {}): SubscriptionUpdateRequest {
  return {
    reason:       VALID_REASON,
    confirmation: true,
    ...overrides,
  };
}

const MOCK_WORKSPACE: RawWorkspaceRow = {
  id:              1,
  name:            "Acme Corp",
  slug:            "acme-corp",
  status:          "active",
  logoUrl:         null,
  primaryColor:    null,
  createdAt:       NOW,
  updatedAt:       NOW,
  userCount:       5,
  ticketCount:     3,
  departmentCount: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// T1 - deriveSubscriptionStatus: deterministic / stable output
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - deriveSubscriptionStatus: deterministic / stable output", () => {
  it("null sub → unknown", () => {
    expect(deriveSubscriptionStatus(null, NOW)).toBe("unknown");
  });

  it("undefined sub → unknown", () => {
    expect(deriveSubscriptionStatus(undefined, NOW)).toBe("unknown");
  });

  it("empty sub → unknown", () => {
    expect(deriveSubscriptionStatus(EMPTY_SUB, NOW)).toBe("unknown");
  });

  it("same input called twice returns same result", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(30),
    };
    const r1 = deriveSubscriptionStatus(sub, NOW);
    const r2 = deriveSubscriptionStatus(sub, NOW);
    expect(r1).toBe(r2);
    expect(r1).toBe("active");
  });

  it("active status with far-future end → active", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(60),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - deriveSubscriptionStatus: trialing derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - deriveSubscriptionStatus: trialing derivation", () => {
  it("trialEndsAt in future → trialing", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      trialEndsAt: daysFromNow(10),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("trialing");
  });

  it("trialEndsAt in past → not trialing", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      trialEndsAt: daysFromNow(-1),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).not.toBe("trialing");
  });

  it("trialing takes priority over billingPeriodEnd", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      trialEndsAt:     daysFromNow(7),
      billingPeriodEnd: daysFromNow(30),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("trialing");
  });

  it("isRenewalApproaching false during trial", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      trialEndsAt:     daysFromNow(5),
    };
    expect(isRenewalApproaching(sub, NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - deriveSubscriptionStatus: renewal_due derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - deriveSubscriptionStatus: renewal_due derivation", () => {
  it("billingPeriodEnd within RENEWAL_WARNING_DAYS → renewal_due", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(RENEWAL_WARNING_DAYS - 1),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("renewal_due");
  });

  it("billingPeriodEnd exactly at RENEWAL_WARNING_DAYS → renewal_due", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(RENEWAL_WARNING_DAYS),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("renewal_due");
  });

  it("billingPeriodEnd beyond RENEWAL_WARNING_DAYS → active", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(RENEWAL_WARNING_DAYS + 1),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("active");
  });

  it("isRenewalApproaching true when within warning window", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(10),
    };
    expect(isRenewalApproaching(sub, NOW)).toBe(true);
  });

  it("isRenewalApproaching false when far in future", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(60),
    };
    expect(isRenewalApproaching(sub, NOW)).toBe(false);
  });

  it("calculateDaysUntilEnd returns positive number", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(10),
    };
    const days = calculateDaysUntilEnd(sub, NOW);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - deriveSubscriptionStatus: grace_period derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - deriveSubscriptionStatus: grace_period derivation", () => {
  it("billingPeriodEnd past + gracePeriodEndsAt future → grace_period", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-1),
      gracePeriodEndsAt: daysFromNow(7),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("grace_period");
  });

  it("isGracePeriodActive returns true", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-1),
      gracePeriodEndsAt: daysFromNow(7),
    };
    expect(isGracePeriodActive(sub, NOW)).toBe(true);
  });

  it("isGracePeriodActive false when grace window also expired", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-10),
      gracePeriodEndsAt: daysFromNow(-3),
    };
    expect(isGracePeriodActive(sub, NOW)).toBe(false);
  });

  it("calculateDaysPastDue returns positive when overdue", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(-5),
    };
    const days = calculateDaysPastDue(sub, NOW);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(0);
  });

  it("calculateDaysPastDue returns null when not yet due", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(5),
    };
    expect(calculateDaysPastDue(sub, NOW)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - deriveSubscriptionStatus: expired derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - deriveSubscriptionStatus: expired derivation", () => {
  it("billingPeriodEnd past + no grace period → expired", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(-5),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("expired");
  });

  it("billingPeriodEnd past + grace period also past → expired", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-10),
      gracePeriodEndsAt: daysFromNow(-2),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("expired");
  });

  it("isSubscriptionExpired true when both periods closed", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-10),
      gracePeriodEndsAt: daysFromNow(-2),
    };
    expect(isSubscriptionExpired(sub, NOW)).toBe(true);
  });

  it("isSubscriptionExpired false when still in billing period", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd: daysFromNow(10),
    };
    expect(isSubscriptionExpired(sub, NOW)).toBe(false);
  });

  it("isSubscriptionExpired false when in grace window", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      billingPeriodEnd:  daysFromNow(-1),
      gracePeriodEndsAt: daysFromNow(5),
    };
    expect(isSubscriptionExpired(sub, NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - deriveSubscriptionStatus: cancelled/suspended precedence
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - deriveSubscriptionStatus: cancelled/suspended precedence", () => {
  it("cancelledAt set → cancelled regardless of other fields", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      cancelledAt:      daysFromNow(-1),
      billingPeriodEnd: daysFromNow(30),
      trialEndsAt:      daysFromNow(10),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("cancelled");
  });

  it("cancelled takes priority over suspended", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      cancelledAt:        daysFromNow(-1),
      subscriptionStatus: "suspended",
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("cancelled");
  });

  it("suspended without cancelledAt → suspended", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      subscriptionStatus: "suspended",
      billingPeriodEnd:   daysFromNow(30),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("suspended");
  });

  it("suspended takes priority over trialing", () => {
    const sub: Partial<SubscriptionFields> = {
      ...EMPTY_SUB,
      subscriptionStatus: "suspended",
      trialEndsAt:        daysFromNow(10),
    };
    expect(deriveSubscriptionStatus(sub, NOW)).toBe("suspended");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - validateSubscriptionMetadataUpdate: date period validation
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - validateSubscriptionMetadataUpdate: date period validation", () => {
  it("billingPeriodStart >= billingPeriodEnd → INVALID_BILLING_PERIOD", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      billingPeriodStart: "2026-06-01T00:00:00Z",
      billingPeriodEnd:   "2026-05-01T00:00:00Z",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_BILLING_PERIOD");
  });

  it("billingPeriodStart === billingPeriodEnd → INVALID_BILLING_PERIOD", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      billingPeriodStart: "2026-06-01T00:00:00Z",
      billingPeriodEnd:   "2026-06-01T00:00:00Z",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_BILLING_PERIOD");
  });

  it("valid billingPeriod → passes", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      billingPeriodStart: "2026-05-01T00:00:00Z",
      billingPeriodEnd:   "2026-06-01T00:00:00Z",
    }));
    expect(r.valid).toBe(true);
  });

  it("trialStartedAt after trialEndsAt → INVALID_TRIAL_PERIOD", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      trialStartedAt: "2026-06-01T00:00:00Z",
      trialEndsAt:    "2026-05-01T00:00:00Z",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_TRIAL_PERIOD");
  });

  it("gracePeriodStartedAt after gracePeriodEndsAt → INVALID_GRACE_PERIOD", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      gracePeriodStartedAt: "2026-06-01T00:00:00Z",
      gracePeriodEndsAt:    "2026-05-01T00:00:00Z",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_GRACE_PERIOD");
  });

  it("invalid date string → INVALID_DATE", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      billingPeriodEnd: "not-a-date",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("null date fields → valid (clearing a field)", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      billingPeriodStart: null,
      billingPeriodEnd:   null,
    }));
    expect(r.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - validateSubscriptionMetadataUpdate: impossible combinations
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - validateSubscriptionMetadataUpdate: impossible combinations", () => {
  it("active + cancelledAt → IMPOSSIBLE_COMBINATION", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      subscriptionStatus: "active",
      cancelledAt:        "2026-05-01T00:00:00Z",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("IMPOSSIBLE_COMBINATION");
  });

  it("active without cancelledAt → valid", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      subscriptionStatus: "active",
    }));
    expect(r.valid).toBe(true);
  });

  it("unknown planCode → INVALID_PLAN_CODE", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      planCode: "mega_enterprise_plus",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_PLAN_CODE");
  });

  it("unknown subscriptionStatus → INVALID_STATUS", () => {
    const r = validateSubscriptionMetadataUpdate(validRequest({
      subscriptionStatus: "pending_payment",
    }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_STATUS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - validateSubscriptionMetadataUpdate: requires reason + confirmation
// (No payment/charge/invoice/tax fields exist on the request type)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - validateSubscriptionMetadataUpdate: safety field requirements", () => {
  it("no reason → REASON_REQUIRED", () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       "",
      confirmation: true,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("REASON_REQUIRED");
  });

  it("short reason → REASON_REQUIRED", () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       "short",
      confirmation: true,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("REASON_REQUIRED");
  });

  it(`reason length ${REASON_MIN_LENGTH} chars is sufficient`, () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       "x".repeat(REASON_MIN_LENGTH),
      confirmation: true,
    });
    expect(r.valid).toBe(true);
  });

  it("SubscriptionUpdateRequest has no payment/invoice/charge/tax/card fields", () => {
    const req = validRequest();
    const keys = Object.keys(req);
    const forbidden = ["payment", "invoice", "charge", "tax", "card", "billing_portal"];
    for (const f of forbidden) {
      expect(keys.some(k => k.toLowerCase().includes(f))).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - validateSubscriptionMetadataUpdate: confirmation required
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - validateSubscriptionMetadataUpdate: confirmation required", () => {
  it("confirmation=false → CONFIRMATION_REQUIRED", () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       VALID_REASON,
      confirmation: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("confirmation=true with valid reason → valid", () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       VALID_REASON,
      confirmation: true,
    });
    expect(r.valid).toBe(true);
  });

  it("reason checked before confirmation", () => {
    const r = validateSubscriptionMetadataUpdate({
      reason:       "short",
      confirmation: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("REASON_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - buildSubscriptionAuditPayload: changedFields populated correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - buildSubscriptionAuditPayload: changedFields populated", () => {
  it("builds payload with correct changedFields", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "42",
      workspaceId:                42,
      actorId:                    1,
      previousSubscriptionStatus: "unknown",
      newSubscriptionStatus:      "trialing",
      previousPlanCode:           null,
      newPlanCode:                "starter",
      changedFields:              ["subscriptionStatus", "planCode"],
      reason:                     VALID_REASON,
      now:                        NOW,
    });

    expect(payload.changedFields).toContain("subscriptionStatus");
    expect(payload.changedFields).toContain("planCode");
    expect(payload.changedFields).toHaveLength(2);
  });

  it("empty changedFields when nothing changed", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "1",
      workspaceId:                1,
      actorId:                    1,
      previousSubscriptionStatus: "active",
      newSubscriptionStatus:      "active",
      previousPlanCode:           "growth",
      newPlanCode:                "growth",
      changedFields:              [],
      reason:                     VALID_REASON,
      now:                        NOW,
    });
    expect(payload.changedFields).toHaveLength(0);
  });

  it("tenantId and workspaceId preserved", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "99",
      workspaceId:                99,
      actorId:                    7,
      previousSubscriptionStatus: "active",
      newSubscriptionStatus:      "expired",
      previousPlanCode:           "enterprise",
      newPlanCode:                "enterprise",
      changedFields:              ["subscriptionStatus"],
      reason:                     VALID_REASON,
      now:                        NOW,
    });
    expect(payload.tenantId).toBe("99");
    expect(payload.workspaceId).toBe(99);
    expect(payload.actorId).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - buildSubscriptionAuditPayload: eventType = subscription_metadata_updated
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - buildSubscriptionAuditPayload: eventType correct", () => {
  it("eventType is subscription_metadata_updated", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "1",
      workspaceId:                1,
      actorId:                    1,
      previousSubscriptionStatus: "unknown",
      newSubscriptionStatus:      "active",
      previousPlanCode:           null,
      newPlanCode:                "business",
      changedFields:              ["planCode", "subscriptionStatus"],
      reason:                     VALID_REASON,
      now:                        NOW,
    });
    expect(payload.eventType).toBe("subscription_metadata_updated");
  });

  it("occurredAt matches provided now", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "1",
      workspaceId:                1,
      actorId:                    1,
      previousSubscriptionStatus: "unknown",
      newSubscriptionStatus:      "active",
      previousPlanCode:           null,
      newPlanCode:                null,
      changedFields:              [],
      reason:                     VALID_REASON,
      now:                        NOW,
    });
    expect(payload.occurredAt).toBe(NOW.toISOString());
  });

  it("payload does not contain payment/invoice/charge/tax wording", () => {
    const payload = buildSubscriptionAuditPayload({
      tenantId:                   "1",
      workspaceId:                1,
      actorId:                    1,
      previousSubscriptionStatus: "active",
      newSubscriptionStatus:      "expired",
      previousPlanCode:           "growth",
      newPlanCode:                "growth",
      changedFields:              [],
      reason:                     VALID_REASON,
      now:                        NOW,
    });
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("invoice");
    expect(serialized).not.toContain("charge");
    expect(serialized).not.toContain("payment");
    expect(serialized).not.toContain("tax");
    expect(serialized).not.toContain("card");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - buildTenantProfile: reflects subscription metadata when provided
// ─────────────────────────────────────────────────────────────────────────────

describe("T13 - buildTenantProfile: reflects subscription metadata", () => {
  const SUB: RawSubscriptionRow = {
    planCode:             "growth",
    subscriptionStatus:   "active",
    billingPeriodStart:   daysFromNow(-30),
    billingPeriodEnd:     daysFromNow(60),
    renewalDueAt:         null,
    trialStartedAt:       null,
    trialEndsAt:          null,
    gracePeriodStartedAt: null,
    gracePeriodEndsAt:    null,
    cancelledAt:          null,
    suspendedAt:          null,
  };

  it("planCode is populated from subscription", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.planCode).toBe("growth");
  });

  it("planName is populated from plan code map", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.planName).toBe("Growth");
  });

  it("planTier is populated from plan code map", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.planTier).toBe("standard");
  });

  it("subscriptionStatus is derived (active, far future end)", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.subscriptionStatus).toBe("active");
  });

  it("billingPeriodEnd is ISO string from subscription", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.billingPeriodEnd).toBe(daysFromNow(60).toISOString());
  });

  it("renewalDueAt is null when not set", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, SUB);
    expect(profile.renewalDueAt).toBeNull();
  });

  it("without subscription → planCode null, status unknown", () => {
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW);
    expect(profile.planCode).toBeNull();
    expect(profile.subscriptionStatus).toBe("unknown");
    expect(profile.planName).toBeNull();
    expect(profile.planTier).toBeNull();
  });

  it("trialEndsAt as ISO string when set", () => {
    const subWithTrial: RawSubscriptionRow = {
      ...SUB,
      trialEndsAt: daysFromNow(5),
    };
    const profile = buildTenantProfile(MOCK_WORKSPACE, null, NOW, subWithTrial);
    expect(profile.trialEndsAt).toBe(daysFromNow(5).toISOString());
    expect(profile.subscriptionStatus).toBe("trialing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - deriveRiskSignalSummary: renewal/grace/expired risk signals
// ─────────────────────────────────────────────────────────────────────────────

describe("T14 - deriveRiskSignalSummary: subscription-driven risk signals", () => {
  it("renewalApproaching=true when billingPeriodEnd in warning window", () => {
    const sub: RawSubscriptionRow = {
      planCode:             null,
      subscriptionStatus:   "active",
      billingPeriodStart:   daysFromNow(-30),
      billingPeriodEnd:     daysFromNow(RENEWAL_WARNING_DAYS - 2),
      renewalDueAt:         null,
      trialStartedAt:       null,
      trialEndsAt:          null,
      gracePeriodStartedAt: null,
      gracePeriodEndsAt:    null,
      cancelledAt:          null,
      suspendedAt:          null,
    };
    const risk = deriveRiskSignalSummary("active", 5, sub, NOW);
    expect(risk.renewalApproaching).toBe(true);
  });

  it("gracePeriodActive=true when in grace window", () => {
    const sub: RawSubscriptionRow = {
      planCode:             null,
      subscriptionStatus:   "active",
      billingPeriodStart:   daysFromNow(-60),
      billingPeriodEnd:     daysFromNow(-2),
      renewalDueAt:         null,
      trialStartedAt:       null,
      trialEndsAt:          null,
      gracePeriodStartedAt: daysFromNow(-2),
      gracePeriodEndsAt:    daysFromNow(5),
      cancelledAt:          null,
      suspendedAt:          null,
    };
    const risk = deriveRiskSignalSummary("active", 5, sub, NOW);
    expect(risk.gracePeriodActive).toBe(true);
  });

  it("subscriptionExpired=true when both periods closed", () => {
    const sub: RawSubscriptionRow = {
      planCode:             null,
      subscriptionStatus:   "active",
      billingPeriodStart:   daysFromNow(-60),
      billingPeriodEnd:     daysFromNow(-10),
      renewalDueAt:         null,
      trialStartedAt:       null,
      trialEndsAt:          null,
      gracePeriodStartedAt: daysFromNow(-10),
      gracePeriodEndsAt:    daysFromNow(-3),
      cancelledAt:          null,
      suspendedAt:          null,
    };
    const risk = deriveRiskSignalSummary("active", 5, sub, NOW);
    expect(risk.subscriptionExpired).toBe(true);
  });

  it("no signals when subscription is healthy and far from renewal", () => {
    const sub: RawSubscriptionRow = {
      planCode:             "growth",
      subscriptionStatus:   "active",
      billingPeriodStart:   daysFromNow(-30),
      billingPeriodEnd:     daysFromNow(60),
      renewalDueAt:         null,
      trialStartedAt:       null,
      trialEndsAt:          null,
      gracePeriodStartedAt: null,
      gracePeriodEndsAt:    null,
      cancelledAt:          null,
      suspendedAt:          null,
    };
    const risk = deriveRiskSignalSummary("active", 5, sub, NOW);
    expect(risk.renewalApproaching).toBe(false);
    expect(risk.gracePeriodActive).toBe(false);
    expect(risk.subscriptionExpired).toBe(false);
  });

  it("riskLevel medium when grace period active", () => {
    const sub: RawSubscriptionRow = {
      planCode:             null,
      subscriptionStatus:   "active",
      billingPeriodStart:   daysFromNow(-60),
      billingPeriodEnd:     daysFromNow(-1),
      renewalDueAt:         null,
      trialStartedAt:       null,
      trialEndsAt:          null,
      gracePeriodStartedAt: daysFromNow(-1),
      gracePeriodEndsAt:    daysFromNow(7),
      cancelledAt:          null,
      suspendedAt:          null,
    };
    const risk = deriveRiskSignalSummary("active", 5, sub, NOW);
    expect(["medium", "high", "critical"]).toContain(risk.riskLevel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - PLAN_CODE_MAP: stable entries for all 5 plan codes
// ─────────────────────────────────────────────────────────────────────────────

describe("T15 - PLAN_CODE_MAP: stable entries", () => {
  it("has exactly 5 plan codes", () => {
    expect(ALL_PLAN_CODES).toHaveLength(5);
  });

  it("ALL_PLAN_CODES has no duplicates", () => {
    expect(new Set(ALL_PLAN_CODES).size).toBe(ALL_PLAN_CODES.length);
  });

  it("each plan code has required fields", () => {
    for (const code of ALL_PLAN_CODES) {
      const def = PLAN_CODE_MAP[code];
      expect(def.code).toBe(code);
      expect(typeof def.name).toBe("string");
      expect(typeof def.tier).toBe("string");
      expect(typeof def.order).toBe("number");
    }
  });

  it("order values are unique and sequential", () => {
    const orders = ALL_PLAN_CODES.map(c => PLAN_CODE_MAP[c].order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(ALL_PLAN_CODES.length - 1);
  });

  it("starter is the lowest tier (order 0)", () => {
    expect(PLAN_CODE_MAP.starter.order).toBe(0);
  });

  it("enterprise order is higher than business", () => {
    expect(PLAN_CODE_MAP.enterprise.order).toBeGreaterThan(PLAN_CODE_MAP.business.order);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - ALL_SUBSCRIPTION_STATUSES: 8 statuses, no duplicates
// ─────────────────────────────────────────────────────────────────────────────

describe("T16 - ALL_SUBSCRIPTION_STATUSES: complete and no duplicates", () => {
  it("has exactly 8 statuses", () => {
    expect(ALL_SUBSCRIPTION_STATUSES).toHaveLength(8);
  });

  it("has no duplicates", () => {
    expect(new Set(ALL_SUBSCRIPTION_STATUSES).size).toBe(ALL_SUBSCRIPTION_STATUSES.length);
  });

  it("contains all required statuses", () => {
    const required = [
      "trialing", "active", "renewal_due", "grace_period",
      "expired", "suspended", "cancelled", "unknown",
    ];
    for (const s of required) {
      expect(ALL_SUBSCRIPTION_STATUSES).toContain(s);
    }
  });

  it("REASON_MIN_LENGTH is 10 (consistent with P13-B)", () => {
    expect(REASON_MIN_LENGTH).toBe(10);
  });

  it("RENEWAL_WARNING_DAYS is a positive integer", () => {
    expect(RENEWAL_WARNING_DAYS).toBeGreaterThan(0);
    expect(Number.isInteger(RENEWAL_WARNING_DAYS)).toBe(true);
  });
});
