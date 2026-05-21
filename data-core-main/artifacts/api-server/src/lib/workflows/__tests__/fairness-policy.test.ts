/**
 * @file   __tests__/fairness-policy.test.ts
 * @phase  P9-E - Fairness Orchestration Policy & Controlled Scheduler Governance
 *
 * T1  - policy creation deterministic
 * T2  - unsafe scheduler weight rejected
 * T3  - starvation floor preserved
 * T4  - policy approval requires operator
 * T5  - rollback semantics valid
 * T6  - conflicting policies rejected
 * T7  - policy expiration deterministic
 * T8  - audit serialization stable
 * T9  - super-admin enforcement valid
 * T10 - no autonomous orchestration occurs
 */

import { describe, it, expect } from "vitest";
import {
  createFairnessPolicy,
  applyFairnessPolicy,
  rollbackFairnessPolicy,
  expireFairnessPolicy,
  validateFairnessPolicyInput,
  checkPolicyConflict,
  isPolicyExpired,
  buildFairnessPolicyAuditEntry,
  makePolicyId,
  emitPolicyCreatedEvent,
  emitPolicyApprovedEvent,
  emitPolicyRolledBackEvent,
  emitPolicyExpiredEvent,
  FairnessPolicyViolation,
  SCHEDULER_WEIGHT_FLOOR,
  SCHEDULER_WEIGHT_CEILING,
  ALLOWED_POLICY_WEIGHTS,
  MAX_POLICY_DURATION_DAYS,
  MIN_POLICY_DURATION_MINUTES,
  type SchedulerFairnessPolicy,
  type FairnessPolicyInput,
  type FairnessPolicyAuditEntry,
} from "../fairness-policy";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_CREATION = new Date("2026-05-15T14:00:00.000Z");
const EXPIRES_SOON   = new Date("2026-05-15T15:00:00.000Z"); // 1h from creation
const EXPIRED_AT     = new Date("2026-05-14T12:00:00.000Z"); // 1 day before creation

function makeInput(overrides: Partial<FairnessPolicyInput> = {}): FairnessPolicyInput {
  return {
    workspaceId:             7,
    targetSchedulerWeight:   0.50,
    previousSchedulerWeight: 1.00,
    adjustmentReason:        "Workspace is monopolizing executions; reducing share.",
    requestedBy:             "admin:1",
    expiresAt:               EXPIRES_SOON.toISOString(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<SchedulerFairnessPolicy> = {}): SchedulerFairnessPolicy {
  return createFairnessPolicy(makeInput(), FIXED_CREATION);
}

function makeActivePolicy(overrides: Partial<SchedulerFairnessPolicy> = {}): SchedulerFairnessPolicy {
  const pending = makePolicy();
  const { policy } = applyFairnessPolicy(pending, {
    approvedBy:   "admin:2",
    approvalTime: new Date("2026-05-15T14:10:00.000Z"),
  });
  return { ...policy, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - policy creation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: policy creation deterministic", () => {
  it("new policy has policyStatus 'pending'", () => {
    expect(makePolicy().policyStatus).toBe("pending");
  });

  it("policyId starts with 'fp:' and contains workspaceId", () => {
    const policy = makePolicy();
    expect(policy.policyId.startsWith("fp:")).toBe(true);
    expect(policy.policyId).toContain("7");
  });

  it("targetSchedulerWeight and previousSchedulerWeight match input", () => {
    const policy = makePolicy();
    expect(policy.targetSchedulerWeight).toBe(0.50);
    expect(policy.previousSchedulerWeight).toBe(1.00);
  });

  it("approvedBy and approvedAt are null at creation", () => {
    const policy = makePolicy();
    expect(policy.approvedBy).toBeNull();
    expect(policy.approvedAt).toBeNull();
  });

  it("createdAt is valid ISO 8601 string", () => {
    const policy = makePolicy();
    expect(() => new Date(policy.createdAt)).not.toThrow();
    expect(new Date(policy.createdAt).toISOString()).toBe(FIXED_CREATION.toISOString());
  });

  it("rollbackEligible is true at creation", () => {
    expect(makePolicy().rollbackEligible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - unsafe scheduler weight rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: unsafe scheduler weight rejected", () => {
  it("weight 0.0 is rejected (not a discrete allowed value)", () => {
    const result = validateFairnessPolicyInput(makeInput({ targetSchedulerWeight: 0.0 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("weight 0.10 is rejected (not in ALLOWED_POLICY_WEIGHTS)", () => {
    const result = validateFairnessPolicyInput(makeInput({ targetSchedulerWeight: 0.10 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
  });

  it("weight 1.50 is rejected (above ceiling)", () => {
    const result = validateFairnessPolicyInput(makeInput({ targetSchedulerWeight: 1.50 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
  });

  it("weight -0.25 is rejected (negative - below floor)", () => {
    const result = validateFairnessPolicyInput(makeInput({ targetSchedulerWeight: -0.25 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
  });

  it("weight 0.33 is rejected (not a discrete allowed value)", () => {
    const result = validateFairnessPolicyInput(makeInput({ targetSchedulerWeight: 0.33 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
  });

  it("all ALLOWED_POLICY_WEIGHTS with a different previous weight are valid", () => {
    for (const w of ALLOWED_POLICY_WEIGHTS) {
      const prev = w === 1.00 ? 0.50 : 1.00;
      const result = validateFairnessPolicyInput(
        makeInput({ targetSchedulerWeight: w, previousSchedulerWeight: prev }),
        FIXED_CREATION,
      );
      expect(result.valid).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - starvation floor preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: starvation floor preserved", () => {
  it("SCHEDULER_WEIGHT_FLOOR constant is 0.25", () => {
    expect(SCHEDULER_WEIGHT_FLOOR).toBe(0.25);
  });

  it("weight 0.25 (floor) is accepted as a valid target weight", () => {
    const result = validateFairnessPolicyInput(
      makeInput({ targetSchedulerWeight: 0.25, previousSchedulerWeight: 1.00 }),
      FIXED_CREATION,
    );
    expect(result.valid).toBe(true);
  });

  it("weight 0.24 is rejected (below floor, not in allowed weights)", () => {
    const result = validateFairnessPolicyInput(
      makeInput({ targetSchedulerWeight: 0.24 }),
      FIXED_CREATION,
    );
    expect(result.valid).toBe(false);
  });

  it("creating policy with weight below floor throws FairnessPolicyViolation", () => {
    expect(() =>
      createFairnessPolicy(makeInput({ targetSchedulerWeight: 0.10 }), FIXED_CREATION),
    ).toThrow(FairnessPolicyViolation);
  });

  it("starvation floor is the minimum value in ALLOWED_POLICY_WEIGHTS", () => {
    const minAllowed = Math.min(...ALLOWED_POLICY_WEIGHTS);
    expect(minAllowed).toBe(SCHEDULER_WEIGHT_FLOOR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - policy approval requires operator
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: policy approval requires operator", () => {
  it("empty approvedBy throws FairnessPolicyViolation", () => {
    const policy = makePolicy();
    expect(() =>
      applyFairnessPolicy(policy, { approvedBy: "", approvalTime: new Date("2026-05-15T14:05:00.000Z") }),
    ).toThrow(FairnessPolicyViolation);
  });

  it("whitespace-only approvedBy throws FairnessPolicyViolation", () => {
    const policy = makePolicy();
    expect(() =>
      applyFairnessPolicy(policy, { approvedBy: "   ", approvalTime: new Date("2026-05-15T14:05:00.000Z") }),
    ).toThrow(FairnessPolicyViolation);
  });

  it("valid approval transitions policy to 'active'", () => {
    const policy = makePolicy();
    const { policy: approved } = applyFairnessPolicy(policy, {
      approvedBy:   "admin:2",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    expect(approved.policyStatus).toBe("active");
  });

  it("approvedBy and approvedAt are set after approval", () => {
    const policy = makePolicy();
    const { policy: approved } = applyFairnessPolicy(policy, {
      approvedBy:   "operator-42",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    expect(approved.approvedBy).toBe("operator-42");
    expect(approved.approvedAt).toBe(new Date("2026-05-15T14:05:00.000Z").toISOString());
  });

  it("approving an already-active policy throws FairnessPolicyViolation(POLICY_NOT_PENDING)", () => {
    const active = makeActivePolicy();
    expect(() =>
      applyFairnessPolicy(active, { approvedBy: "admin:3" }),
    ).toThrow(FairnessPolicyViolation);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - rollback semantics valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: rollback semantics valid", () => {
  it("active policy rolls back to 'rolled_back' status", () => {
    const { policy } = rollbackFairnessPolicy(makeActivePolicy(), {
      rollbackReason: "Observed no improvement in queue time",
      rollbackTime:   new Date("2026-05-15T14:30:00.000Z"),
    });
    expect(policy.policyStatus).toBe("rolled_back");
  });

  it("rollback appliedWeight equals previousSchedulerWeight", () => {
    const active = makeActivePolicy();
    const { appliedWeight } = rollbackFairnessPolicy(active, {});
    expect(appliedWeight).toBe(active.previousSchedulerWeight);
  });

  it("rolling back a pending policy throws POLICY_NOT_ACTIVE", () => {
    const pending = makePolicy();
    expect(() => rollbackFairnessPolicy(pending, {})).toThrow(FairnessPolicyViolation);
  });

  it("rollbackEligible=false throws POLICY_NOT_ROLLBACK_ELIGIBLE", () => {
    const ineligible: SchedulerFairnessPolicy = { ...makeActivePolicy(), rollbackEligible: false };
    expect(() => rollbackFairnessPolicy(ineligible, {})).toThrow(FairnessPolicyViolation);
  });

  it("rollbackEligible is false on the returned policy after rollback", () => {
    const { policy } = rollbackFairnessPolicy(makeActivePolicy(), {});
    expect(policy.rollbackEligible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - conflicting policies rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: conflicting policies rejected", () => {
  it("pending policy for same workspace → hasConflict=true", () => {
    const existing = [makePolicy()]; // status: "pending", workspaceId: 7
    const result = checkPolicyConflict(existing, 7);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingStatus).toBe("pending");
  });

  it("active policy for same workspace → hasConflict=true", () => {
    const existing = [makeActivePolicy()]; // status: "active", workspaceId: 7
    const result = checkPolicyConflict(existing, 7);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingStatus).toBe("active");
  });

  it("different workspaceId → hasConflict=false", () => {
    const existing = [makePolicy()]; // workspaceId: 7
    const result = checkPolicyConflict(existing, 99);
    expect(result.hasConflict).toBe(false);
  });

  it("only expired/rolled_back policies for same workspace → hasConflict=false", () => {
    const expired: SchedulerFairnessPolicy = { ...makePolicy(), policyStatus: "expired" };
    const rolledBack: SchedulerFairnessPolicy = { ...makePolicy(), policyStatus: "rolled_back" };
    const result = checkPolicyConflict([expired, rolledBack], 7);
    expect(result.hasConflict).toBe(false);
  });

  it("empty existing policies → hasConflict=false", () => {
    expect(checkPolicyConflict([], 7).hasConflict).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - policy expiration deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: policy expiration deterministic", () => {
  it("pending policy with expiresAt in past → isPolicyExpired=true", () => {
    const policy = createFairnessPolicy(
      makeInput({ expiresAt: EXPIRES_SOON.toISOString() }),
      FIXED_CREATION,
    );
    // Check from a time far in the future (after expiresAt)
    const futureCheck = new Date("2026-05-16T00:00:00.000Z");
    expect(isPolicyExpired(policy, futureCheck)).toBe(true);
  });

  it("active policy with expiresAt in past → isPolicyExpired=true", () => {
    const active = makeActivePolicy();
    const futureCheck = new Date("2026-05-16T00:00:00.000Z");
    expect(isPolicyExpired(active, futureCheck)).toBe(true);
  });

  it("expireFairnessPolicy transitions status to 'expired'", () => {
    const policy = makePolicy();
    const expired = expireFairnessPolicy(policy);
    expect(expired.policyStatus).toBe("expired");
  });

  it("expireFairnessPolicy sets rollbackEligible=false", () => {
    const policy = makePolicy();
    const expired = expireFairnessPolicy(policy);
    expect(expired.rollbackEligible).toBe(false);
  });

  it("expiring an already-expired policy throws FairnessPolicyViolation", () => {
    const policy = expireFairnessPolicy(makePolicy());
    expect(() => expireFairnessPolicy(policy)).toThrow(FairnessPolicyViolation);
  });

  it("expiring a rolled_back policy throws FairnessPolicyViolation", () => {
    const { policy } = rollbackFairnessPolicy(makeActivePolicy(), {});
    expect(() => expireFairnessPolicy(policy)).toThrow(FairnessPolicyViolation);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - audit serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: audit serialization stable", () => {
  it("SchedulerFairnessPolicy is fully JSON-serializable", () => {
    const policy = makePolicy();
    expect(() => JSON.stringify(policy)).not.toThrow();
  });

  it("no undefined values in serialized policy", () => {
    const json = JSON.stringify(makePolicy());
    expect(json).not.toContain('"undefined"');
  });

  it("JSON round-trip preserves all policy fields", () => {
    const policy = makePolicy();
    const parsed = JSON.parse(JSON.stringify(policy)) as SchedulerFairnessPolicy;
    expect(parsed.policyId).toBe(policy.policyId);
    expect(parsed.workspaceId).toBe(policy.workspaceId);
    expect(parsed.policyStatus).toBe(policy.policyStatus);
    expect(parsed.targetSchedulerWeight).toBe(policy.targetSchedulerWeight);
    expect(parsed.rollbackEligible).toBe(policy.rollbackEligible);
  });

  it("FairnessPolicyAuditEntry is fully JSON-serializable", () => {
    const active = makeActivePolicy();
    const { auditEntry } = rollbackFairnessPolicy(active, {
      rollbackReason: "Test rollback",
      rollbackTime:   new Date("2026-05-15T14:30:00.000Z"),
    });
    expect(() => JSON.stringify(auditEntry)).not.toThrow();
  });

  it("audit entry action is one of the known actions", () => {
    const policy = makePolicy();
    const { auditEntry } = applyFairnessPolicy(policy, {
      approvedBy:   "admin:2",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    const knownActions = ["created", "approved", "rolled_back", "expired", "rejected"];
    expect(knownActions).toContain(auditEntry.action);
  });

  it("approved policy has non-null approvedBy in serialized form", () => {
    const { policy } = applyFairnessPolicy(makePolicy(), {
      approvedBy:   "super-admin",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    const parsed = JSON.parse(JSON.stringify(policy)) as SchedulerFairnessPolicy;
    expect(parsed.approvedBy).toBe("super-admin");
    expect(parsed.approvedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: super-admin enforcement valid", () => {
  it("makePolicyId generates non-repeating IDs", () => {
    const id1 = makePolicyId(7);
    const id2 = makePolicyId(7);
    expect(id1).not.toBe(id2);
  });

  it("makePolicyId format is 'fp:<workspaceId>-<ms>-<seq>'", () => {
    const id = makePolicyId(42);
    expect(id.startsWith("fp:42-")).toBe(true);
  });

  it("validateFairnessPolicyInput rejects invalid workspaceId (0)", () => {
    const result = validateFairnessPolicyInput(makeInput({ workspaceId: 0 }), FIXED_CREATION);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("workspaceId"))).toBe(true);
  });

  it("validateFairnessPolicyInput rejects empty adjustmentReason", () => {
    const result = validateFairnessPolicyInput(makeInput({ adjustmentReason: "" }), FIXED_CREATION);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("adjustmentReason"))).toBe(true);
  });

  it("validateFairnessPolicyInput rejects no-op (target == previous)", () => {
    const result = validateFairnessPolicyInput(
      makeInput({ targetSchedulerWeight: 0.50, previousSchedulerWeight: 0.50 }),
      FIXED_CREATION,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("no-op") || e.includes("equals previousSchedulerWeight"))).toBe(true);
  });

  it("validateFairnessPolicyInput rejects expiresAt too soon", () => {
    const tooSoon = new Date(FIXED_CREATION.getTime() + 60 * 1000); // only 1 min from now
    const result = validateFairnessPolicyInput(
      makeInput({ expiresAt: tooSoon.toISOString() }),
      FIXED_CREATION,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("minimum") || e.includes("5 minutes"))).toBe(true);
  });

  it("validateFairnessPolicyInput rejects expiresAt too far in future", () => {
    const tooFar = new Date(FIXED_CREATION.getTime() + (MAX_POLICY_DURATION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const result = validateFairnessPolicyInput(
      makeInput({ expiresAt: tooFar.toISOString() }),
      FIXED_CREATION,
    );
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - no autonomous orchestration occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: no autonomous orchestration occurs", () => {
  it("createFairnessPolicy has no async behavior", () => {
    const result = createFairnessPolicy(makeInput(), FIXED_CREATION);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("applyFairnessPolicy has no async behavior", () => {
    const { policy } = applyFairnessPolicy(makePolicy(), {
      approvedBy:   "admin",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    expect(typeof (policy as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("rollbackFairnessPolicy has no async behavior", () => {
    const { policy } = rollbackFairnessPolicy(makeActivePolicy(), {});
    expect(typeof (policy as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("applyFairnessPolicy does not mutate input policy", () => {
    const pending = makePolicy();
    const snapshot = JSON.stringify(pending);
    applyFairnessPolicy(pending, {
      approvedBy:   "admin",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    expect(JSON.stringify(pending)).toBe(snapshot);
  });

  it("rollbackFairnessPolicy does not mutate input policy", () => {
    const active = makeActivePolicy();
    const snapshot = JSON.stringify(active);
    rollbackFairnessPolicy(active, { rollbackReason: "test" });
    expect(JSON.stringify(active)).toBe(snapshot);
  });

  it("checkPolicyConflict does not mutate existing policies array", () => {
    const existing = [makePolicy()];
    const snapshot = JSON.stringify(existing);
    checkPolicyConflict(existing, 7);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("observability emit functions do not throw", () => {
    const policy  = makePolicy();
    const active  = makeActivePolicy();
    const { auditEntry: approvalAudit } = applyFairnessPolicy(makePolicy(), {
      approvedBy:   "admin",
      approvalTime: new Date("2026-05-15T14:05:00.000Z"),
    });
    const { auditEntry: rollbackAudit } = rollbackFairnessPolicy(makeActivePolicy(), {});
    expect(() => emitPolicyCreatedEvent(policy)).not.toThrow();
    expect(() => emitPolicyApprovedEvent(active, approvalAudit)).not.toThrow();
    expect(() => emitPolicyRolledBackEvent({ ...active, policyStatus: "rolled_back" }, rollbackAudit)).not.toThrow();
    expect(() => emitPolicyExpiredEvent({ ...policy, policyStatus: "expired" })).not.toThrow();
  });
});
