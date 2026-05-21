/**
 * @phase P16-D - Policy evaluation helper tests
 */

import { describe, it, expect } from "vitest";
import {
  evaluateSubscriptionPolicy,
  computeDaysSinceEndDate,
} from "../workspace-subscription-policy-evaluator";
import { DEFAULT_SUBSCRIPTION_POLICY } from "../subscription-policy-defaults";

const policy = { ...DEFAULT_SUBSCRIPTION_POLICY };

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("evaluateSubscriptionPolicy", () => {
  it("returns review_required when no subscription", () => {
    const r = evaluateSubscriptionPolicy({ subscription: null, policy });
    expect(r.recommendedStatus).toBe("review_required");
    expect(r.recommendedAction).toBe("review_required");
    expect(r.isAutomaticAllowed).toBe(false);
  });

  it("returns no_change for archived/terminated subscription", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "terminated", endDate: daysAgo(100) },
      policy,
    });
    expect(r.recommendedStatus).toBe("no_change");
    expect(r.recommendedAction).toBe("none");
  });

  it("returns active when endDate in future", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "active", endDate: daysAhead(10) },
      policy,
    });
    expect(r.recommendedStatus).toBe("active");
    expect(r.recommendedAction).toBe("none");
    expect(r.daysSinceEndDate).toBeLessThan(0);
  });

  it("recommends grace_period within grace window", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "active", endDate: daysAgo(3) },
      policy,
    });
    expect(r.recommendedStatus).toBe("grace_period");
    expect(r.recommendedAction).toBe("mark_grace_period");
  });

  it("recommends past_due after grace", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "grace_period", endDate: daysAgo(10) },
      policy,
    });
    expect(r.recommendedStatus).toBe("past_due");
    expect(r.recommendedAction).toBe("mark_past_due");
  });

  it("recommends suspended after past due window", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "past_due", endDate: daysAgo(20) },
      policy,
    });
    expect(r.recommendedStatus).toBe("suspended");
    expect(r.recommendedAction).toBe("mark_suspended");
  });

  it("recommends terminated after termination threshold", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "suspended", endDate: daysAgo(95) },
      policy,
    });
    expect(r.recommendedStatus).toBe("terminated");
    expect(r.recommendedAction).toBe("mark_terminated");
  });

  it("never allows automatic enforcement in P16-D", () => {
    const r = evaluateSubscriptionPolicy({
      subscription: { id: 1, status: "active", endDate: daysAgo(5) },
      policy: { ...policy, enforcementMode: "automatic_recommended" },
    });
    expect(r.isAutomaticAllowed).toBe(false);
    expect(r.enforcementMode).toBe("automatic_recommended");
  });

  it("does not mutate - returns advisory only", () => {
    const sub = { id: 1, status: "active", endDate: daysAgo(5) };
    evaluateSubscriptionPolicy({ subscription: sub, policy });
    expect(sub.status).toBe("active");
  });
});

describe("computeDaysSinceEndDate", () => {
  it("returns 0 on end date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(computeDaysSinceEndDate(today, new Date())).toBe(0);
  });
});
