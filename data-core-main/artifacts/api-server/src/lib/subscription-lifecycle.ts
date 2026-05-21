/**
 * @file   lib/subscription-lifecycle.ts
 * @phase  P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * Pure functions for deriving subscription status, validating metadata updates,
 * and building audit payloads. No DB, no HTTP - fully testable in isolation.
 *
 * SAFETY CONTRACT:
 *   - All functions are pure - no side effects, no DB writes, no mutations.
 *   - No payment provider, invoice, charge, tax, or card/payment logic anywhere.
 *   - No automatic workspace suspension or entitlement enforcement.
 *   - No email/legal/billing notifications.
 *   - Risk signals are informational only - they do NOT change workspace.status.
 *   - Reason (min REASON_MIN_LENGTH chars) + confirmation (true) required for all writes.
 *   - Invalid dates → fail closed (INVALID_DATE error code).
 *   - Impossible combinations (e.g. active + cancelledAt) → rejected.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Plan Code Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlanCode =
  | "starter"
  | "growth"
  | "business"
  | "enterprise"
  | "custom";

export interface PlanCodeDef {
  code:        PlanCode;
  name:        string;
  tier:        string;
  order:       number;
}

export const PLAN_CODE_MAP: Record<PlanCode, PlanCodeDef> = {
  starter:    { code: "starter",    name: "Starter",    tier: "basic",      order: 0 },
  growth:     { code: "growth",     name: "Growth",     tier: "standard",   order: 1 },
  business:   { code: "business",   name: "Business",   tier: "premium",    order: 2 },
  enterprise: { code: "enterprise", name: "Enterprise", tier: "enterprise", order: 3 },
  custom:     { code: "custom",     name: "Custom",     tier: "custom",     order: 4 },
} as const;

export const ALL_PLAN_CODES: PlanCode[] = [
  "starter", "growth", "business", "enterprise", "custom",
];

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Status Types
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "renewal_due"
  | "grace_period"
  | "expired"
  | "suspended"
  | "cancelled"
  | "unknown";

export const ALL_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "trialing", "active", "renewal_due", "grace_period",
  "expired", "suspended", "cancelled", "unknown",
];

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Warning Window
// ─────────────────────────────────────────────────────────────────────────────

/** Days before billingPeriodEnd at which status shifts to "renewal_due". */
export const RENEWAL_WARNING_DAYS = 14;

/** Minimum characters required in reason field for any subscription update. */
export const REASON_MIN_LENGTH = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Fields Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionFields {
  planCode:             string | null;
  subscriptionStatus:   string;
  billingPeriodStart:   Date | null;
  billingPeriodEnd:     Date | null;
  renewalDueAt:         Date | null;
  trialStartedAt:       Date | null;
  trialEndsAt:          Date | null;
  gracePeriodStartedAt: Date | null;
  gracePeriodEndsAt:    Date | null;
  cancelledAt:          Date | null;
  suspendedAt:          Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the effective subscription status from stored metadata + current time.
 *
 * Priority order (highest wins):
 *   1. cancelled   - cancelledAt is set
 *   2. suspended   - admin set subscriptionStatus = "suspended"
 *   3. trialing    - trialEndsAt is in the future
 *   4. grace_period - billingPeriodEnd passed but gracePeriodEndsAt still future
 *   5. expired     - billingPeriodEnd passed with no valid grace window
 *   6. renewal_due - billingPeriodEnd is within RENEWAL_WARNING_DAYS
 *   7. active      - billingPeriodEnd is in the future beyond the renewal window
 *   8. unknown     - no meaningful data present
 *
 * This function is the single source of truth for subscription status display.
 * It does NOT write to the database and does NOT change workspace.status.
 */
export function deriveSubscriptionStatus(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): SubscriptionStatus {
  if (!sub) return "unknown";

  const nowMs = now.getTime();

  // 1. Cancelled takes highest precedence
  if (sub.cancelledAt && sub.cancelledAt instanceof Date) {
    return "cancelled";
  }

  // 2. Admin-suspended
  if (sub.subscriptionStatus === "suspended") return "suspended";

  // 3. Trialing (trial window still open)
  if (sub.trialEndsAt instanceof Date && sub.trialEndsAt.getTime() > nowMs) {
    return "trialing";
  }

  // 4-5. Billing period evaluation
  if (sub.billingPeriodEnd instanceof Date) {
    const endMs = sub.billingPeriodEnd.getTime();

    if (endMs <= nowMs) {
      // Period ended - check for active grace window
      if (
        sub.gracePeriodEndsAt instanceof Date &&
        sub.gracePeriodEndsAt.getTime() > nowMs
      ) {
        return "grace_period";
      }
      return "expired";
    }

    // Period still active - check for renewal warning window
    const msRemaining    = endMs - nowMs;
    const daysRemaining  = msRemaining / (1000 * 60 * 60 * 24);
    if (daysRemaining <= RENEWAL_WARNING_DAYS) return "renewal_due";
    return "active";
  }

  // 8. No data → unknown
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Signal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when billingPeriodEnd is set and within RENEWAL_WARNING_DAYS from now. */
export function isRenewalApproaching(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): boolean {
  if (!sub?.billingPeriodEnd || !(sub.billingPeriodEnd instanceof Date)) return false;
  const endMs = sub.billingPeriodEnd.getTime();
  const nowMs = now.getTime();
  if (endMs <= nowMs) return false;
  return (endMs - nowMs) / (1000 * 60 * 60 * 24) <= RENEWAL_WARNING_DAYS;
}

/** True when billingPeriodEnd has passed but gracePeriodEndsAt is still future. */
export function isGracePeriodActive(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): boolean {
  if (
    !sub?.billingPeriodEnd   || !(sub.billingPeriodEnd   instanceof Date) ||
    !sub?.gracePeriodEndsAt  || !(sub.gracePeriodEndsAt  instanceof Date)
  ) return false;
  const nowMs = now.getTime();
  return sub.billingPeriodEnd.getTime() <= nowMs &&
         sub.gracePeriodEndsAt.getTime() > nowMs;
}

/** True when billingPeriodEnd has passed and there is no active grace window. */
export function isSubscriptionExpired(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): boolean {
  if (!sub?.billingPeriodEnd || !(sub.billingPeriodEnd instanceof Date)) return false;
  const nowMs = now.getTime();
  if (sub.billingPeriodEnd.getTime() > nowMs) return false;
  if (
    sub.gracePeriodEndsAt instanceof Date &&
    sub.gracePeriodEndsAt.getTime() > nowMs
  ) return false;
  return true;
}

/** Days until billingPeriodEnd (positive = future, negative = past). Null if not set. */
export function calculateDaysUntilEnd(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): number | null {
  if (!sub?.billingPeriodEnd || !(sub.billingPeriodEnd instanceof Date)) return null;
  const diffMs = sub.billingPeriodEnd.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/** Days since billingPeriodEnd (positive = overdue). Null if not past due. */
export function calculateDaysPastDue(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): number | null {
  if (!sub?.billingPeriodEnd || !(sub.billingPeriodEnd instanceof Date)) return null;
  const diffMs = now.getTime() - sub.billingPeriodEnd.getTime();
  if (diffMs <= 0) return null;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionUpdateRequest {
  planCode?:             string;
  subscriptionStatus?:   string;
  billingPeriodStart?:   string | null;
  billingPeriodEnd?:     string | null;
  renewalDueAt?:         string | null;
  trialStartedAt?:       string | null;
  trialEndsAt?:          string | null;
  gracePeriodStartedAt?: string | null;
  gracePeriodEndsAt?:    string | null;
  cancelledAt?:          string | null;
  suspendedAt?:          string | null;
  metadataJson?:         Record<string, unknown>;
  reason:                string;
  confirmation:          boolean;
}

export type SubscriptionValidationResult =
  | { valid: false; error: string; code: string }
  | { valid: true };

const DATE_FIELDS = [
  "billingPeriodStart",
  "billingPeriodEnd",
  "renewalDueAt",
  "trialStartedAt",
  "trialEndsAt",
  "gracePeriodStartedAt",
  "gracePeriodEndsAt",
  "cancelledAt",
  "suspendedAt",
] as const;

type DateFieldKey = typeof DATE_FIELDS[number];

/**
 * Validates a subscription metadata update request.
 * Returns { valid: true } on success.
 * Returns { valid: false, error, code } on any validation failure.
 *
 * Validation order:
 *   1. reason ≥ REASON_MIN_LENGTH chars
 *   2. confirmation === true
 *   3. planCode (if provided) must be a known plan code
 *   4. subscriptionStatus (if provided) must be a known status
 *   5. All date fields (if provided and non-null) must parse as valid ISO dates
 *   6. billingPeriodStart < billingPeriodEnd (if both provided)
 *   7. trialStartedAt ≤ trialEndsAt (if both provided)
 *   8. gracePeriodStartedAt ≤ gracePeriodEndsAt (if both provided)
 *   9. Impossible combo: subscriptionStatus="active" + cancelledAt set
 */
export function validateSubscriptionMetadataUpdate(
  input: SubscriptionUpdateRequest,
): SubscriptionValidationResult {
  // 1. Reason required
  if (
    !input.reason ||
    typeof input.reason !== "string" ||
    input.reason.trim().length < REASON_MIN_LENGTH
  ) {
    return {
      valid: false,
      error: `Reason is required and must be at least ${REASON_MIN_LENGTH} characters`,
      code:  "REASON_REQUIRED",
    };
  }

  // 2. Confirmation required
  if (input.confirmation !== true) {
    return {
      valid: false,
      error: "Confirmation is required to update subscription metadata",
      code:  "CONFIRMATION_REQUIRED",
    };
  }

  // 3. planCode validity
  if (input.planCode !== undefined && input.planCode !== null) {
    if (!ALL_PLAN_CODES.includes(input.planCode as PlanCode)) {
      return {
        valid: false,
        error: `Unknown plan code: "${input.planCode}". Valid values: ${ALL_PLAN_CODES.join(", ")}`,
        code:  "INVALID_PLAN_CODE",
      };
    }
  }

  // 4. subscriptionStatus validity
  if (input.subscriptionStatus !== undefined && input.subscriptionStatus !== null) {
    if (!ALL_SUBSCRIPTION_STATUSES.includes(input.subscriptionStatus as SubscriptionStatus)) {
      return {
        valid: false,
        error: `Unknown subscription status: "${input.subscriptionStatus}"`,
        code:  "INVALID_STATUS",
      };
    }
  }

  // 5. Date field format validation
  const parsedDates: Partial<Record<DateFieldKey, Date>> = {};
  for (const field of DATE_FIELDS) {
    const val = (input as unknown as Record<string, unknown>)[field];
    if (val !== undefined && val !== null && val !== "") {
      const d = new Date(val as string);
      if (isNaN(d.getTime())) {
        return {
          valid: false,
          error: `Invalid date value for "${field}": "${val}"`,
          code:  "INVALID_DATE",
        };
      }
      parsedDates[field] = d;
    }
  }

  // 6. billingPeriodStart < billingPeriodEnd
  if (parsedDates.billingPeriodStart && parsedDates.billingPeriodEnd) {
    if (parsedDates.billingPeriodStart >= parsedDates.billingPeriodEnd) {
      return {
        valid: false,
        error: "billingPeriodStart must be strictly before billingPeriodEnd",
        code:  "INVALID_BILLING_PERIOD",
      };
    }
  }

  // 7. trialStartedAt ≤ trialEndsAt
  if (parsedDates.trialStartedAt && parsedDates.trialEndsAt) {
    if (parsedDates.trialStartedAt > parsedDates.trialEndsAt) {
      return {
        valid: false,
        error: "trialStartedAt must not be after trialEndsAt",
        code:  "INVALID_TRIAL_PERIOD",
      };
    }
  }

  // 8. gracePeriodStartedAt ≤ gracePeriodEndsAt
  if (parsedDates.gracePeriodStartedAt && parsedDates.gracePeriodEndsAt) {
    if (parsedDates.gracePeriodStartedAt > parsedDates.gracePeriodEndsAt) {
      return {
        valid: false,
        error: "gracePeriodStartedAt must not be after gracePeriodEndsAt",
        code:  "INVALID_GRACE_PERIOD",
      };
    }
  }

  // 9. Impossible combo: active status + cancelledAt
  if (input.subscriptionStatus === "active" && parsedDates.cancelledAt) {
    return {
      valid: false,
      error: 'Cannot set subscriptionStatus to "active" when cancelledAt is specified',
      code:  "IMPOSSIBLE_COMBINATION",
    };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Payload Builder
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionAuditPayload {
  eventType:                   "subscription_metadata_updated";
  tenantId:                    string;
  workspaceId:                 number;
  actorId:                     number;
  previousSubscriptionStatus:  string;
  newSubscriptionStatus:       string;
  previousPlanCode:            string | null;
  newPlanCode:                 string | null;
  changedFields:               string[];
  reason:                      string;
  occurredAt:                  string;
}

/**
 * Builds a structured audit payload for a subscription metadata update.
 * Pure function - no side effects, no DB writes.
 * The caller is responsible for persisting this payload to activity_logs.
 */
export function buildSubscriptionAuditPayload(params: {
  tenantId:                   string;
  workspaceId:                number;
  actorId:                    number;
  previousSubscriptionStatus: string;
  newSubscriptionStatus:      string;
  previousPlanCode:           string | null;
  newPlanCode:                string | null;
  changedFields:              string[];
  reason:                     string;
  now:                        Date;
}): SubscriptionAuditPayload {
  return {
    eventType:                  "subscription_metadata_updated",
    tenantId:                   params.tenantId,
    workspaceId:                params.workspaceId,
    actorId:                    params.actorId,
    previousSubscriptionStatus: params.previousSubscriptionStatus,
    newSubscriptionStatus:      params.newSubscriptionStatus,
    previousPlanCode:           params.previousPlanCode,
    newPlanCode:                params.newPlanCode,
    changedFields:              params.changedFields,
    reason:                     params.reason,
    occurredAt:                 params.now.toISOString(),
  };
}
