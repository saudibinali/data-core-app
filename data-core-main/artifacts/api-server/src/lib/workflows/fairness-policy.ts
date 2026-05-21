/**
 * @file   lib/workflows/fairness-policy.ts
 * @phase  P9-E - Fairness Orchestration Policy & Controlled Scheduler Governance
 *
 * Pure deterministic fairness orchestration policy engine.
 * No DB, no async, no automatic throttling, no scheduler mutation.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Converts the read-only fairness intelligence from P9-A/B/C/D into
 *   controlled governance policy infrastructure. A SchedulerFairnessPolicy
 *   is a human-approved, auditable, reversible scheduler weight adjustment
 *   that a super-admin explicitly approves, and can roll back.
 *
 *   createFairnessPolicy(input)              → SchedulerFairnessPolicy (pending)
 *   applyFairnessPolicy(policy, approval)    → FairnessPolicyApplication (active)
 *   rollbackFairnessPolicy(policy, rollback) → FairnessPolicyApplication (rolled_back)
 *   expireFairnessPolicy(policy)             → SchedulerFairnessPolicy (expired)
 *   validateFairnessPolicyInput(input)       → FairnessPolicyValidationResult
 *   checkPolicyConflict(existing, wsId)      → FairnessPolicyConflict
 *   isPolicyExpired(policy, now?)            → boolean
 *
 * ── SCHEDULER WEIGHT SEMANTICS ───────────────────────────────────────────────
 *
 *   The advisory schedulerWeight from P9-B is the source of truth for the
 *   "previous" weight recorded at policy creation. Valid policy weights are
 *   the same four discrete values used by computeSchedulerWeight():
 *
 *     0.25 - minimum guaranteed share (starvation floor, NEVER below this)
 *     0.50 - reduced share (pressured workspace)
 *     0.75 - slightly reduced share (at_risk workspace)
 *     1.00 - full share (contained workspace, default)
 *
 *   A policy always targets a DIFFERENT weight than the current weight.
 *   No-op policies (target == previous) are rejected at validation.
 *
 * ── POLICY LIFECYCLE ─────────────────────────────────────────────────────────
 *
 *   pending     → [approve]       → active
 *   pending     → [expire]        → expired      (no approval before expiresAt)
 *   pending     → [reject]        → rejected     (operator explicit rejection)
 *   active      → [rollback]      → rolled_back  (operator reverts)
 *   active      → [expire]        → expired      (active past expiresAt)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   HUMAN-APPROVAL-REQUIRED:  createFairnessPolicy() produces status "pending";
 *     only applyFairnessPolicy() (with an approver identity) makes it "active".
 *   STARVATION FLOOR:         targetSchedulerWeight cannot be < 0.25.
 *   DISCRETE VALUES ONLY:     weight must be one of {0.25, 0.50, 0.75, 1.00}.
 *   NO-OP PREVENTION:         target must differ from previousSchedulerWeight.
 *   CONFLICT PREVENTION:      one active/pending policy per workspace at a time.
 *   EXPIRY REQUIRED:          every policy must expire within MAX_POLICY_DURATION_DAYS.
 *   AUDIT TRAIL:              every state change produces a FairnessPolicyAuditEntry.
 *   READ-ONLY ENGINE:         no DB calls, no async, no scheduler mutations.
 *   FAIL-CLOSED:              ambiguous inputs throw FairnessPolicyViolation.
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum allowed schedulerWeight - starvation floor guarantee. */
export const SCHEDULER_WEIGHT_FLOOR   = 0.25;

/** Maximum allowed schedulerWeight - full scheduler share. */
export const SCHEDULER_WEIGHT_CEILING = 1.00;

/**
 * Discrete scheduler weights that a policy may target.
 * Mirrors the four values produced by computeSchedulerWeight() in P9-B.
 */
export const ALLOWED_POLICY_WEIGHTS: ReadonlyArray<number> = [0.25, 0.50, 0.75, 1.00];

/**
 * Maximum policy duration from creation to expiry.
 * A policy that has not been approved within this window auto-expires.
 */
export const MAX_POLICY_DURATION_DAYS    = 30;

/**
 * Minimum time before a policy expires (from now at creation).
 * Prevents policies with no useful approval window.
 */
export const MIN_POLICY_DURATION_MINUTES = 5;

/** Maximum character length for adjustmentReason field. */
export const MAX_ADJUSTMENT_REASON_LENGTH = 500;

/** Maximum character length for requestedBy / approvedBy fields. */
export const MAX_OPERATOR_IDENTITY_LENGTH = 200;

// ─────────────────────────────────────────────────────────────────────────────
// VIOLATION - typed error class
// ─────────────────────────────────────────────────────────────────────────────

export type FairnessPolicyViolationCode =
  | "INVALID_SCHEDULER_WEIGHT"       // weight not in ALLOWED_POLICY_WEIGHTS
  | "WEIGHT_BELOW_STARVATION_FLOOR"  // weight < SCHEDULER_WEIGHT_FLOOR
  | "WEIGHT_ABOVE_CEILING"           // weight > SCHEDULER_WEIGHT_CEILING
  | "NO_OP_WEIGHT_UNCHANGED"         // targetWeight equals previousWeight
  | "MISSING_ADJUSTMENT_REASON"      // adjustmentReason empty or too long
  | "INVALID_EXPIRY_TOO_SOON"        // expiresAt < now + MIN_POLICY_DURATION_MINUTES
  | "INVALID_EXPIRY_TOO_FAR"         // expiresAt > now + MAX_POLICY_DURATION_DAYS
  | "INVALID_EXPIRY_TIMESTAMP"       // expiresAt is not a valid ISO string
  | "POLICY_NOT_PENDING"             // attempted approval on non-pending policy
  | "POLICY_NOT_ACTIVE"              // attempted rollback on non-active policy
  | "POLICY_ALREADY_EXPIRED"         // attempted expiry on already-expired policy
  | "POLICY_NOT_ROLLBACK_ELIGIBLE"   // rollbackEligible = false
  | "POLICY_CONFLICT_EXISTS"         // active/pending policy already exists for workspace
  | "MISSING_OPERATOR_IDENTITY"      // approvedBy / requestedBy empty
  | "INVALID_WORKSPACE_ID";          // workspaceId ≤ 0 or not an integer

/**
 * Thrown on safety violations that must fail closed.
 * Parallel to TenantIsolationViolation from P9-A.
 */
export class FairnessPolicyViolation extends Error {
  readonly name = "FairnessPolicyViolation";
  constructor(
    public readonly code: FairnessPolicyViolationCode,
    message: string,
  ) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - policy lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Policy lifecycle status.
 *
 *   "pending"     - created, awaiting operator approval
 *   "active"      - approved; targetSchedulerWeight is advisory-effective
 *   "expired"     - reached expiresAt without approval, or was active and expired
 *   "rolled_back" - operator reverted; previousSchedulerWeight is now advisory-effective
 *   "rejected"    - operator explicitly rejected before approval
 */
export type FairnessPolicyStatus = "pending" | "active" | "expired" | "rolled_back" | "rejected";

/**
 * A scheduler fairness adjustment policy.
 *
 * Pure value object - no class methods. Safe to serialize to JSON and persist
 * to the DB as-is. All timestamps are ISO 8601 strings.
 *
 * Advisory-only: the targetSchedulerWeight is a RECOMMENDATION to the scheduler
 * operator. No engine automatically enforces it; it is visible via governance
 * APIs for operator-driven scheduler configuration.
 */
export interface SchedulerFairnessPolicy {
  /** Unique policy identifier. Format: "fp:<workspaceId>-<ms>-<seq>" */
  policyId:                string;
  /** Workspace DB primary key this policy targets. */
  workspaceId:             number;
  /**
   * Desired scheduler weight after approval. Always in ALLOWED_POLICY_WEIGHTS.
   * NEVER below SCHEDULER_WEIGHT_FLOOR (0.25).
   */
  targetSchedulerWeight:   number;
  /**
   * Scheduler weight at policy creation time. This is the rollback value -
   * restoring this weight undoes the policy's effect.
   */
  previousSchedulerWeight: number;
  /** Human-readable rationale for the scheduler weight change. */
  adjustmentReason:        string;
  /** Super-admin userId/name who created this policy. */
  requestedBy:             string;
  /** Super-admin userId/name who approved this policy. Null until approved. */
  approvedBy:              string | null;
  /** ISO 8601 timestamp when this policy was approved. Null until approved. */
  approvedAt:              string | null;
  /** ISO 8601 timestamp after which this policy automatically expires. */
  expiresAt:               string;
  /** Whether an active policy can be rolled back. False after rollback. */
  rollbackEligible:        boolean;
  /** Current lifecycle status. */
  policyStatus:            FairnessPolicyStatus;
  /** ISO 8601 creation timestamp. */
  createdAt:               string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - input / output
// ─────────────────────────────────────────────────────────────────────────────

/** Input required to create a new fairness policy. */
export interface FairnessPolicyInput {
  workspaceId:             number;
  /** Desired scheduler weight. Must be in ALLOWED_POLICY_WEIGHTS. */
  targetSchedulerWeight:   number;
  /** Current advisory scheduler weight (from P9-B evaluateWorkloadContainment). */
  previousSchedulerWeight: number;
  /** Human-readable rationale (max MAX_ADJUSTMENT_REASON_LENGTH chars). */
  adjustmentReason:        string;
  /** Super-admin identity (userId string or display name) creating this policy. */
  requestedBy:             string;
  /** ISO 8601 expiry timestamp. Must be 5m-30d from validationTime. */
  expiresAt:               string;
}

/** Validation result returned by validateFairnessPolicyInput(). */
export interface FairnessPolicyValidationResult {
  valid:    boolean;
  /** Blocking validation errors (policy cannot be created). */
  errors:   string[];
  /** Non-blocking advisory warnings. */
  warnings: string[];
}

/** Input required to approve a pending policy. */
export interface FairnessPolicyApprovalInput {
  /** Super-admin identity (userId/display name) granting approval. */
  approvedBy:    string;
  /** Override approval timestamp (tests). Defaults to new Date(). */
  approvalTime?: Date;
}

/** Input required to roll back an active policy. */
export interface FairnessPolicyRollbackInput {
  /** Human-readable reason for the rollback (optional). */
  rollbackReason?: string;
  /** Override rollback timestamp (tests). Defaults to new Date(). */
  rollbackTime?:   Date;
}

/** Result of an applyFairnessPolicy or rollbackFairnessPolicy call. */
export interface FairnessPolicyApplication {
  /** Updated policy with new status/fields. Does NOT mutate the input policy. */
  policy:         SchedulerFairnessPolicy;
  /**
   * Weight that becomes advisory-effective after this operation.
   * For approval:  targetSchedulerWeight.
   * For rollback:  previousSchedulerWeight.
   */
  appliedWeight:  number;
  /**
   * Weight to revert to if this application is later rolled back.
   * For approval:  previousSchedulerWeight.
   * For rollback:  not applicable (rollback is terminal for the policy).
   */
  rollbackWeight: number;
  /** Immutable audit record of this state transition. */
  auditEntry:     FairnessPolicyAuditEntry;
}

/** Immutable audit record of a single policy state transition. */
export interface FairnessPolicyAuditEntry {
  /** ISO 8601 timestamp of this state change. */
  timestamp:    string;
  /** Action performed: "created" | "approved" | "rolled_back" | "expired" | "rejected" */
  action:       "created" | "approved" | "rolled_back" | "expired" | "rejected";
  policyId:     string;
  workspaceId:  number;
  /** Identity of the operator who performed this action. */
  performedBy:  string;
  /** Weight before this action. */
  fromWeight:   number;
  /** Weight after this action (advisory effective weight). */
  toWeight:     number;
  /** Reason or rationale for this action. */
  reason:       string;
  /** Resulting policy status after this action. */
  policyStatus: FairnessPolicyStatus;
}

/** Result of a conflict check for a workspace. */
export interface FairnessPolicyConflict {
  hasConflict:          boolean;
  /** policyId of the conflicting policy, if any. */
  conflictingPolicyId?: string;
  /** Status of the conflicting policy ("pending" or "active"). */
  conflictingStatus?:   FairnessPolicyStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

let _policySeq = 0;

/**
 * Generates a unique policyId for a workspace.
 * Format: "fp:<workspaceId>-<ms>-<seq>"
 */
export function makePolicyId(workspaceId: number): string {
  _policySeq += 1;
  return `fp:${workspaceId}-${Date.now()}-${_policySeq}`;
}

/** Resets the policy sequence counter. Use only in tests. */
export function resetPolicySeq(): void {
  _policySeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a FairnessPolicyInput before creation.
 *
 * Returns a FairnessPolicyValidationResult with errors (blocking) and
 * warnings (advisory). Does NOT throw - callers inspect `valid` and decide.
 *
 * @param input          - the policy input to validate
 * @param validationTime - override "now" for expiry checks (tests)
 */
export function validateFairnessPolicyInput(
  input:           FairnessPolicyInput,
  validationTime?: Date,
): FairnessPolicyValidationResult {
  const errors:   string[] = [];
  const warnings: string[] = [];
  const now = validationTime ?? new Date();

  // workspace ID
  if (!Number.isInteger(input.workspaceId) || input.workspaceId <= 0) {
    errors.push(`workspaceId must be a positive integer; got ${input.workspaceId}`);
  }

  // target weight - discrete value check
  if (!ALLOWED_POLICY_WEIGHTS.includes(input.targetSchedulerWeight)) {
    errors.push(
      `targetSchedulerWeight must be one of [${ALLOWED_POLICY_WEIGHTS.join(", ")}]; ` +
      `got ${input.targetSchedulerWeight}`,
    );
  }

  // target weight - starvation floor
  if (input.targetSchedulerWeight < SCHEDULER_WEIGHT_FLOOR) {
    errors.push(
      `targetSchedulerWeight ${input.targetSchedulerWeight} is below the starvation ` +
      `floor of ${SCHEDULER_WEIGHT_FLOOR}. No tenant may be denied their minimum share.`,
    );
  }

  // target weight - ceiling
  if (input.targetSchedulerWeight > SCHEDULER_WEIGHT_CEILING) {
    errors.push(
      `targetSchedulerWeight ${input.targetSchedulerWeight} exceeds maximum allowed ` +
      `value of ${SCHEDULER_WEIGHT_CEILING}.`,
    );
  }

  // no-op prevention
  if (
    ALLOWED_POLICY_WEIGHTS.includes(input.targetSchedulerWeight) &&
    ALLOWED_POLICY_WEIGHTS.includes(input.previousSchedulerWeight) &&
    input.targetSchedulerWeight === input.previousSchedulerWeight
  ) {
    errors.push(
      `targetSchedulerWeight equals previousSchedulerWeight (${input.targetSchedulerWeight}). ` +
      `A policy must change the scheduler weight; no-op policies are not permitted.`,
    );
  }

  // adjustment reason
  if (!input.adjustmentReason || input.adjustmentReason.trim().length === 0) {
    errors.push("adjustmentReason must be a non-empty string.");
  } else if (input.adjustmentReason.length > MAX_ADJUSTMENT_REASON_LENGTH) {
    errors.push(
      `adjustmentReason exceeds maximum length of ${MAX_ADJUSTMENT_REASON_LENGTH} characters ` +
      `(got ${input.adjustmentReason.length}).`,
    );
  }

  // requestedBy
  if (!input.requestedBy || input.requestedBy.trim().length === 0) {
    errors.push("requestedBy must identify the operator creating this policy.");
  } else if (input.requestedBy.length > MAX_OPERATOR_IDENTITY_LENGTH) {
    errors.push(
      `requestedBy exceeds maximum length of ${MAX_OPERATOR_IDENTITY_LENGTH} characters.`,
    );
  }

  // expiresAt - parse
  let expiresAtDate: Date | null = null;
  if (!input.expiresAt || input.expiresAt.trim().length === 0) {
    errors.push("expiresAt is required. Every policy must have an expiry timestamp.");
  } else {
    expiresAtDate = new Date(input.expiresAt);
    if (isNaN(expiresAtDate.getTime())) {
      errors.push(`expiresAt "${input.expiresAt}" is not a valid ISO 8601 timestamp.`);
      expiresAtDate = null;
    }
  }

  // expiresAt - min duration
  if (expiresAtDate !== null) {
    const minExpiryMs = now.getTime() + MIN_POLICY_DURATION_MINUTES * 60 * 1000;
    if (expiresAtDate.getTime() < minExpiryMs) {
      errors.push(
        `expiresAt must be at least ${MIN_POLICY_DURATION_MINUTES} minutes in the future ` +
        `from the time of creation. Got "${input.expiresAt}".`,
      );
    }

    // expiresAt - max duration
    const maxExpiryMs = now.getTime() + MAX_POLICY_DURATION_DAYS * 24 * 60 * 60 * 1000;
    if (expiresAtDate.getTime() > maxExpiryMs) {
      errors.push(
        `expiresAt cannot exceed ${MAX_POLICY_DURATION_DAYS} days from now. ` +
        `Got "${input.expiresAt}".`,
      );
    }
  }

  // advisory warning: lowering weight on already-minimum workspace
  if (
    input.previousSchedulerWeight === SCHEDULER_WEIGHT_FLOOR &&
    input.targetSchedulerWeight   === SCHEDULER_WEIGHT_FLOOR
  ) {
    warnings.push(
      `Workspace already at starvation floor (${SCHEDULER_WEIGHT_FLOOR}). ` +
      `This policy produces no effective weight change.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new fairness policy in "pending" status.
 *
 * Throws FairnessPolicyViolation if validation fails (fail-closed).
 * Pure: does not write to DB; caller persists the returned object.
 *
 * @param input        - validated policy creation input
 * @param creationTime - override creation timestamp (tests)
 */
export function createFairnessPolicy(
  input:         FairnessPolicyInput,
  creationTime?: Date,
): SchedulerFairnessPolicy {
  const validation = validateFairnessPolicyInput(input, creationTime);
  if (!validation.valid) {
    throw new FairnessPolicyViolation(
      _firstViolationCode(validation.errors),
      `Fairness policy creation failed: ${validation.errors.join("; ")}`,
    );
  }

  const now    = (creationTime ?? new Date()).toISOString();
  const policy: SchedulerFairnessPolicy = {
    policyId:                makePolicyId(input.workspaceId),
    workspaceId:             input.workspaceId,
    targetSchedulerWeight:   input.targetSchedulerWeight,
    previousSchedulerWeight: input.previousSchedulerWeight,
    adjustmentReason:        input.adjustmentReason.trim(),
    requestedBy:             input.requestedBy.trim(),
    approvedBy:              null,
    approvedAt:              null,
    expiresAt:               new Date(input.expiresAt).toISOString(),
    rollbackEligible:        true,
    policyStatus:            "pending",
    createdAt:               now,
  };

  emitPolicyCreatedEvent(policy);
  return policy;
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY APPROVAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approves a pending fairness policy, transitioning it to "active".
 *
 * Throws FairnessPolicyViolation if:
 *   - policy.policyStatus !== "pending"
 *   - policy has already expired (isPolicyExpired)
 *   - approvalInput.approvedBy is empty
 *
 * Pure: does not write to DB. Returns a new policy object (input unchanged).
 *
 * @param policy        - existing pending policy
 * @param approvalInput - approver identity and optional approval timestamp
 */
export function applyFairnessPolicy(
  policy:        SchedulerFairnessPolicy,
  approvalInput: FairnessPolicyApprovalInput,
): FairnessPolicyApplication {
  const approvalTime = approvalInput.approvalTime ?? new Date();

  if (policy.policyStatus !== "pending") {
    throw new FairnessPolicyViolation(
      "POLICY_NOT_PENDING",
      `Policy ${policy.policyId} cannot be approved - current status is ` +
      `"${policy.policyStatus}". Only "pending" policies can be approved.`,
    );
  }

  if (isPolicyExpired(policy, approvalTime)) {
    throw new FairnessPolicyViolation(
      "POLICY_ALREADY_EXPIRED",
      `Policy ${policy.policyId} has expired (expiresAt: ${policy.expiresAt}). ` +
      `Expire it first before attempting further operations.`,
    );
  }

  if (!approvalInput.approvedBy || approvalInput.approvedBy.trim().length === 0) {
    throw new FairnessPolicyViolation(
      "MISSING_OPERATOR_IDENTITY",
      `Policy approval requires a non-empty approvedBy identity. ` +
      `Approval must be attributed to a specific operator.`,
    );
  }

  const approvedAt = approvalTime.toISOString();
  const updatedPolicy: SchedulerFairnessPolicy = {
    ...policy,
    policyStatus: "active",
    approvedBy:   approvalInput.approvedBy.trim(),
    approvedAt,
  };

  const auditEntry = buildFairnessPolicyAuditEntry({
    timestamp:    approvedAt,
    action:       "approved",
    policy:       updatedPolicy,
    performedBy:  approvalInput.approvedBy.trim(),
    fromWeight:   policy.previousSchedulerWeight,
    toWeight:     policy.targetSchedulerWeight,
    reason:       `Policy approved: ${policy.adjustmentReason}`,
  });

  emitPolicyApprovedEvent(updatedPolicy, auditEntry);

  return {
    policy:         updatedPolicy,
    appliedWeight:  policy.targetSchedulerWeight,
    rollbackWeight: policy.previousSchedulerWeight,
    auditEntry,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rolls back an active fairness policy, restoring the previous scheduler weight.
 *
 * Throws FairnessPolicyViolation if:
 *   - policy.policyStatus !== "active"
 *   - policy.rollbackEligible === false
 *
 * Pure: does not write to DB. Returns a new policy object (input unchanged).
 * Sets rollbackEligible = false on the returned policy to prevent double-rollback.
 *
 * @param policy        - existing active policy
 * @param rollbackInput - optional rollback reason and timestamp
 */
export function rollbackFairnessPolicy(
  policy:        SchedulerFairnessPolicy,
  rollbackInput: FairnessPolicyRollbackInput,
): FairnessPolicyApplication {
  const rollbackTime = rollbackInput.rollbackTime ?? new Date();

  if (policy.policyStatus !== "active") {
    throw new FairnessPolicyViolation(
      "POLICY_NOT_ACTIVE",
      `Policy ${policy.policyId} cannot be rolled back - current status is ` +
      `"${policy.policyStatus}". Only "active" policies can be rolled back.`,
    );
  }

  if (!policy.rollbackEligible) {
    throw new FairnessPolicyViolation(
      "POLICY_NOT_ROLLBACK_ELIGIBLE",
      `Policy ${policy.policyId} is not eligible for rollback ` +
      `(rollbackEligible = false). This policy has already been rolled back.`,
    );
  }

  const rolledBackAt = rollbackTime.toISOString();
  const reason       = rollbackInput.rollbackReason?.trim() || "Operator-initiated rollback";
  const updatedPolicy: SchedulerFairnessPolicy = {
    ...policy,
    policyStatus:    "rolled_back",
    rollbackEligible: false,
  };

  const auditEntry = buildFairnessPolicyAuditEntry({
    timestamp:    rolledBackAt,
    action:       "rolled_back",
    policy:       updatedPolicy,
    performedBy:  policy.approvedBy ?? policy.requestedBy,
    fromWeight:   policy.targetSchedulerWeight,
    toWeight:     policy.previousSchedulerWeight,
    reason,
  });

  emitPolicyRolledBackEvent(updatedPolicy, auditEntry);

  return {
    policy:         updatedPolicy,
    appliedWeight:  policy.previousSchedulerWeight,
    rollbackWeight: policy.previousSchedulerWeight,
    auditEntry,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY EXPIRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transitions a policy to "expired" status.
 *
 * Can be applied to "pending" or "active" policies that have passed expiresAt.
 * Throws FairnessPolicyViolation if the policy is already in a terminal state.
 *
 * Pure: does not write to DB. Returns a new policy object (input unchanged).
 */
export function expireFairnessPolicy(policy: SchedulerFairnessPolicy): SchedulerFairnessPolicy {
  if (policy.policyStatus === "expired" ||
      policy.policyStatus === "rolled_back" ||
      policy.policyStatus === "rejected") {
    throw new FairnessPolicyViolation(
      "POLICY_ALREADY_EXPIRED",
      `Policy ${policy.policyId} is already in terminal state "${policy.policyStatus}". ` +
      `Cannot expire a policy that has already been expired, rolled back, or rejected.`,
    );
  }

  const updatedPolicy: SchedulerFairnessPolicy = {
    ...policy,
    policyStatus:    "expired",
    rollbackEligible: false,
  };

  emitPolicyExpiredEvent(updatedPolicy);
  return updatedPolicy;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether any existing policy would conflict with a new policy
 * for the given workspaceId.
 *
 * A conflict exists if any policy for the same workspace has status
 * "pending" or "active" (i.e. a live policy already covers this workspace).
 *
 * Pure: does not mutate existingPolicies.
 */
export function checkPolicyConflict(
  existingPolicies: ReadonlyArray<SchedulerFairnessPolicy>,
  workspaceId:      number,
): FairnessPolicyConflict {
  const conflicting = existingPolicies.find(
    p =>
      p.workspaceId === workspaceId &&
      (p.policyStatus === "pending" || p.policyStatus === "active"),
  );

  if (!conflicting) {
    return { hasConflict: false };
  }

  return {
    hasConflict:          true,
    conflictingPolicyId:  conflicting.policyId,
    conflictingStatus:    conflicting.policyStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPIRY CHECK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the policy's expiresAt timestamp is in the past.
 * Does NOT check policy status - callers must handle terminal states separately.
 *
 * @param policy - policy to check
 * @param now    - override "now" (tests)
 */
export function isPolicyExpired(policy: SchedulerFairnessPolicy, now?: Date): boolean {
  const checkTime    = now ?? new Date();
  const expiresAtMs  = new Date(policy.expiresAt).getTime();
  return checkTime.getTime() >= expiresAtMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ENTRY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

interface AuditEntryInput {
  timestamp:    string;
  action:       FairnessPolicyAuditEntry["action"];
  policy:       SchedulerFairnessPolicy;
  performedBy:  string;
  fromWeight:   number;
  toWeight:     number;
  reason:       string;
}

export function buildFairnessPolicyAuditEntry(
  input: AuditEntryInput,
): FairnessPolicyAuditEntry {
  return {
    timestamp:    input.timestamp,
    action:       input.action,
    policyId:     input.policy.policyId,
    workspaceId:  input.policy.workspaceId,
    performedBy:  input.performedBy,
    fromWeight:   input.fromWeight,
    toWeight:     input.toWeight,
    reason:       input.reason,
    policyStatus: input.policy.policyStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────
//
// All events carry: policyId, workspaceId, targetSchedulerWeight,
// previousSchedulerWeight, approvedBy, policyStatus, action.

export function emitPolicyCreatedEvent(policy: SchedulerFairnessPolicy): void {
  logger.info(
    {
      event:                   "scheduler_fairness_policy_created",
      policyId:                policy.policyId,
      workspaceId:             policy.workspaceId,
      targetSchedulerWeight:   policy.targetSchedulerWeight,
      previousSchedulerWeight: policy.previousSchedulerWeight,
      approvedBy:              policy.approvedBy,
      policyStatus:            policy.policyStatus,
      action:                  "created",
    },
    "[fairness-policy] P9-E: scheduler_fairness_policy_created",
  );
}

export function emitPolicyApprovedEvent(
  policy:     SchedulerFairnessPolicy,
  auditEntry: FairnessPolicyAuditEntry,
): void {
  logger.info(
    {
      event:                   "scheduler_fairness_policy_approved",
      policyId:                policy.policyId,
      workspaceId:             policy.workspaceId,
      targetSchedulerWeight:   policy.targetSchedulerWeight,
      previousSchedulerWeight: policy.previousSchedulerWeight,
      approvedBy:              policy.approvedBy,
      policyStatus:            policy.policyStatus,
      action:                  "approved",
      appliedWeight:           auditEntry.toWeight,
    },
    "[fairness-policy] P9-E: scheduler_fairness_policy_approved",
  );
}

export function emitPolicyRolledBackEvent(
  policy:     SchedulerFairnessPolicy,
  auditEntry: FairnessPolicyAuditEntry,
): void {
  logger.info(
    {
      event:                   "scheduler_fairness_policy_rolled_back",
      policyId:                policy.policyId,
      workspaceId:             policy.workspaceId,
      targetSchedulerWeight:   policy.targetSchedulerWeight,
      previousSchedulerWeight: policy.previousSchedulerWeight,
      approvedBy:              policy.approvedBy,
      policyStatus:            policy.policyStatus,
      action:                  "rolled_back",
      restoredWeight:          auditEntry.toWeight,
    },
    "[fairness-policy] P9-E: scheduler_fairness_policy_rolled_back",
  );
}

export function emitPolicyExpiredEvent(policy: SchedulerFairnessPolicy): void {
  logger.info(
    {
      event:                   "scheduler_fairness_policy_expired",
      policyId:                policy.policyId,
      workspaceId:             policy.workspaceId,
      targetSchedulerWeight:   policy.targetSchedulerWeight,
      previousSchedulerWeight: policy.previousSchedulerWeight,
      approvedBy:              policy.approvedBy,
      policyStatus:            policy.policyStatus,
      action:                  "expired",
    },
    "[fairness-policy] P9-E: scheduler_fairness_policy_expired",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _firstViolationCode(errors: string[]): FairnessPolicyViolationCode {
  const first = errors[0] ?? "";
  if (first.includes("starvation floor"))        return "WEIGHT_BELOW_STARVATION_FLOOR";
  if (first.includes("maximum allowed"))         return "WEIGHT_ABOVE_CEILING";
  if (first.includes("ALLOWED_POLICY_WEIGHTS") || first.includes("one of")) return "INVALID_SCHEDULER_WEIGHT";
  if (first.includes("no-op") || first.includes("No-op") || first.includes("equals previousSchedulerWeight")) return "NO_OP_WEIGHT_UNCHANGED";
  if (first.includes("adjustmentReason"))        return "MISSING_ADJUSTMENT_REASON";
  if (first.includes("requestedBy"))             return "MISSING_OPERATOR_IDENTITY";
  if (first.includes("workspaceId"))             return "INVALID_WORKSPACE_ID";
  if (first.includes("not a valid ISO"))         return "INVALID_EXPIRY_TIMESTAMP";
  if (first.includes("minimum"))                 return "INVALID_EXPIRY_TOO_SOON";
  if (first.includes("exceed"))                  return "INVALID_EXPIRY_TOO_FAR";
  return "INVALID_SCHEDULER_WEIGHT";
}
