/**
 * @file   lib/subscription-renewal-intelligence.ts
 * @phase  P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
 *
 * Pure derivation library for subscription renewal signals, urgency, and
 * recommended platform actions. No DB, no HTTP, no side effects.
 *
 * SAFETY CONTRACT:
 *   - Read-only derivation only. No billing, payment, invoice, charge, or tax logic.
 *   - No automatic workspace suspension or locking.
 *   - No entitlement enforcement or module access enforcement.
 *   - No email or legal notices.
 *   - Recommendations are operational suggestions for platform operators only -
 *     they are never executed automatically.
 *   - Invalid dates → fail closed (critical urgency, fix_subscription_metadata).
 *   - Prefer "unknown" urgency over unsafe inference when data is absent.
 *   - All derivation functions accept `now` as a parameter → fully deterministic.
 */

import {
  type SubscriptionFields,
} from "./subscription-lifecycle";

// ─────────────────────────────────────────────────────────────────────────────
// Threshold Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Days before billingPeriodEnd at which renewal_due_soon signal fires. */
export const RENEWAL_DUE_SOON_DAYS   = 14;

/** Days before trialEndsAt at which trial_ending_soon signal fires. */
export const TRIAL_ENDING_SOON_DAYS  = 7;

/** Days before gracePeriodEndsAt at which grace_period_ending_soon signal fires. */
export const GRACE_ENDING_SOON_DAYS  = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Signal Codes
// ─────────────────────────────────────────────────────────────────────────────

export type RenewalSignalCode =
  | "no_subscription_metadata"
  | "trial_active"
  | "trial_ending_soon"
  | "trial_expired"
  | "subscription_active"
  | "renewal_due_soon"
  | "renewal_due_now"
  | "billing_period_expired"
  | "grace_period_active"
  | "grace_period_ending_soon"
  | "grace_period_expired"
  | "subscription_cancelled"
  | "subscription_suspended"
  | "invalid_subscription_dates";

export const ALL_RENEWAL_SIGNAL_CODES: RenewalSignalCode[] = [
  "no_subscription_metadata",
  "trial_active",
  "trial_ending_soon",
  "trial_expired",
  "subscription_active",
  "renewal_due_soon",
  "renewal_due_now",
  "billing_period_expired",
  "grace_period_active",
  "grace_period_ending_soon",
  "grace_period_expired",
  "subscription_cancelled",
  "subscription_suspended",
  "invalid_subscription_dates",
];

// ─────────────────────────────────────────────────────────────────────────────
// Urgency
// ─────────────────────────────────────────────────────────────────────────────

export type RenewalUrgency =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Platform Action
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendedPlatformAction =
  | "none"
  | "monitor"
  | "contact_customer"
  | "prepare_grace_period"
  | "review_for_suspension"
  | "renew_subscription_metadata"
  | "fix_subscription_metadata"
  | "manual_review_required";

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionRenewalProfile {
  subscriptionId:        string | null;
  workspaceId:           number;
  planCode:              string | null;
  subscriptionStatus:    string;
  signals:               RenewalSignalCode[];
  urgency:               RenewalUrgency;
  recommendedAction:     RecommendedPlatformAction;
  daysUntilBillingEnd:   number | null;
  daysUntilTrialEnd:     number | null;
  daysUntilGraceEnd:     number | null;
  daysPastDue:           number | null;
  warnings:              string[];
  derivedAt:             string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Consistency Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewalDateConsistencyResult {
  valid:  boolean;
  errors: string[];
}

/**
 * Validates date field ordering and basic consistency.
 * Returns { valid: true, errors: [] } when all checks pass.
 * Fails closed - invalid → treat as invalid_subscription_dates signal.
 */
export function validateRenewalDateConsistency(
  sub: Partial<SubscriptionFields> | null | undefined,
): RenewalDateConsistencyResult {
  if (!sub) return { valid: true, errors: [] };

  const errors: string[] = [];

  // billingPeriodStart < billingPeriodEnd
  if (sub.billingPeriodStart instanceof Date && sub.billingPeriodEnd instanceof Date) {
    if (isNaN(sub.billingPeriodStart.getTime())) {
      errors.push("billingPeriodStart is an invalid date");
    } else if (isNaN(sub.billingPeriodEnd.getTime())) {
      errors.push("billingPeriodEnd is an invalid date");
    } else if (sub.billingPeriodStart >= sub.billingPeriodEnd) {
      errors.push("billingPeriodStart must be strictly before billingPeriodEnd");
    }
  }

  // trialStartedAt ≤ trialEndsAt
  if (sub.trialStartedAt instanceof Date && sub.trialEndsAt instanceof Date) {
    if (isNaN(sub.trialStartedAt.getTime())) {
      errors.push("trialStartedAt is an invalid date");
    } else if (isNaN(sub.trialEndsAt.getTime())) {
      errors.push("trialEndsAt is an invalid date");
    } else if (sub.trialStartedAt > sub.trialEndsAt) {
      errors.push("trialStartedAt must not be after trialEndsAt");
    }
  }

  // gracePeriodStartedAt ≤ gracePeriodEndsAt
  if (sub.gracePeriodStartedAt instanceof Date && sub.gracePeriodEndsAt instanceof Date) {
    if (isNaN(sub.gracePeriodStartedAt.getTime())) {
      errors.push("gracePeriodStartedAt is an invalid date");
    } else if (isNaN(sub.gracePeriodEndsAt.getTime())) {
      errors.push("gracePeriodEndsAt is an invalid date");
    } else if (sub.gracePeriodStartedAt > sub.gracePeriodEndsAt) {
      errors.push("gracePeriodStartedAt must not be after gracePeriodEndsAt");
    }
  }

  // gracePeriodEndsAt should be >= billingPeriodEnd (grace starts after billing ends)
  if (sub.billingPeriodEnd instanceof Date && sub.gracePeriodEndsAt instanceof Date) {
    if (
      !isNaN(sub.billingPeriodEnd.getTime()) &&
      !isNaN(sub.gracePeriodEndsAt.getTime()) &&
      sub.gracePeriodEndsAt < sub.billingPeriodEnd
    ) {
      errors.push("gracePeriodEndsAt must not be before billingPeriodEnd");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Day Calculation Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysUntil(date: Date | null | undefined, now: Date): number | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function daysPast(date: Date | null | undefined, now: Date): number | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  const diff = now.getTime() - date.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveRenewalSignals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the set of active renewal signal codes for a subscription.
 * Accepts `now` as a parameter - fully deterministic / testable.
 *
 * Signal precedence rules:
 *   - invalid_subscription_dates - checked first, overrides everything
 *   - subscription_cancelled / subscription_suspended - terminal states
 *   - trial signals - checked against trialEndsAt
 *   - billing/grace signals - checked against billingPeriodEnd + gracePeriodEndsAt
 *   - renewal_due_soon / renewal_due_now - checked against billingPeriodEnd + renewalDueAt
 *   - no_subscription_metadata - if no meaningful fields are present
 */
export function deriveRenewalSignals(
  sub: Partial<SubscriptionFields> | null | undefined,
  now: Date,
): RenewalSignalCode[] {
  const signals: RenewalSignalCode[] = [];

  if (!sub) {
    signals.push("no_subscription_metadata");
    return signals;
  }

  // Date consistency check
  const consistency = validateRenewalDateConsistency(sub);
  if (!consistency.valid) {
    signals.push("invalid_subscription_dates");
    return signals;
  }

  const nowMs = now.getTime();

  // Terminal states take precedence
  if (sub.cancelledAt instanceof Date && !isNaN(sub.cancelledAt.getTime())) {
    signals.push("subscription_cancelled");
    return signals;
  }
  if (sub.subscriptionStatus === "suspended") {
    signals.push("subscription_suspended");
    return signals;
  }

  // Trial signals
  const trialDaysLeft = daysUntil(sub.trialEndsAt ?? null, now);
  if (sub.trialEndsAt instanceof Date && !isNaN(sub.trialEndsAt.getTime())) {
    if (sub.trialEndsAt.getTime() > nowMs) {
      signals.push("trial_active");
      if (trialDaysLeft !== null && trialDaysLeft <= TRIAL_ENDING_SOON_DAYS) {
        signals.push("trial_ending_soon");
      }
    } else {
      signals.push("trial_expired");
    }
  }

  // Billing period signals
  if (sub.billingPeriodEnd instanceof Date && !isNaN(sub.billingPeriodEnd.getTime())) {
    const billingEndMs   = sub.billingPeriodEnd.getTime();
    const billingDaysLeft = daysUntil(sub.billingPeriodEnd, now);

    if (billingEndMs <= nowMs) {
      // Billing period ended
      signals.push("billing_period_expired");

      // Grace period evaluation
      if (sub.gracePeriodEndsAt instanceof Date && !isNaN(sub.gracePeriodEndsAt.getTime())) {
        if (sub.gracePeriodEndsAt.getTime() > nowMs) {
          signals.push("grace_period_active");
          const graceDaysLeft = daysUntil(sub.gracePeriodEndsAt, now);
          if (graceDaysLeft !== null && graceDaysLeft <= GRACE_ENDING_SOON_DAYS) {
            signals.push("grace_period_ending_soon");
          }
        } else {
          signals.push("grace_period_expired");
        }
      } else {
        // No grace period configured → already expired past billing end
        signals.push("grace_period_expired");
      }
    } else {
      // Billing period still active
      // Check renewalDueAt first
      if (sub.renewalDueAt instanceof Date && !isNaN(sub.renewalDueAt.getTime())) {
        if (sub.renewalDueAt.getTime() <= nowMs) {
          signals.push("renewal_due_now");
        } else if (billingDaysLeft !== null && billingDaysLeft <= RENEWAL_DUE_SOON_DAYS) {
          signals.push("renewal_due_soon");
        } else {
          signals.push("subscription_active");
        }
      } else {
        // No renewalDueAt - fall back to billingPeriodEnd proximity
        if (billingDaysLeft !== null && billingDaysLeft <= RENEWAL_DUE_SOON_DAYS) {
          signals.push("renewal_due_soon");
        } else {
          signals.push("subscription_active");
        }
      }
    }
  } else if (signals.length === 0) {
    // No meaningful data at all
    signals.push("no_subscription_metadata");
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveRenewalUrgency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a set of renewal signals to a single urgency level.
 * Highest-urgency signal wins.
 */
export function deriveRenewalUrgency(signals: RenewalSignalCode[]): RenewalUrgency {
  if (signals.length === 0) return "unknown";

  // Critical signals
  if (signals.includes("invalid_subscription_dates")) return "critical";
  if (signals.includes("grace_period_expired"))        return "critical";

  // High signals
  if (signals.includes("subscription_suspended"))      return "high";
  if (signals.includes("subscription_cancelled"))      return "high";
  if (signals.includes("billing_period_expired") && !signals.includes("grace_period_active")) return "high";
  if (signals.includes("grace_period_ending_soon"))    return "high";

  // Medium signals
  if (signals.includes("renewal_due_now"))             return "medium";
  if (signals.includes("renewal_due_soon"))            return "medium";
  if (signals.includes("trial_ending_soon"))           return "medium";

  // Low signals
  if (signals.includes("trial_active"))                return "low";
  if (signals.includes("grace_period_active"))         return "low";
  if (signals.includes("trial_expired"))               return "low";

  // None / unknown
  if (signals.includes("subscription_active"))         return "none";
  if (signals.includes("no_subscription_metadata"))    return "unknown";

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveRecommendedPlatformAction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps signals + urgency to a single recommended platform action.
 * This is an operational suggestion for the super-admin only.
 * It is NEVER executed automatically.
 */
export function deriveRecommendedPlatformAction(
  signals:  RenewalSignalCode[],
  urgency:  RenewalUrgency,
): RecommendedPlatformAction {
  if (signals.includes("invalid_subscription_dates")) return "fix_subscription_metadata";
  if (signals.includes("no_subscription_metadata"))   return "manual_review_required";

  if (signals.includes("grace_period_expired"))       return "review_for_suspension";
  if (signals.includes("grace_period_ending_soon"))   return "review_for_suspension";
  if (signals.includes("subscription_cancelled"))     return "review_for_suspension";
  if (signals.includes("subscription_suspended"))     return "manual_review_required";

  if (signals.includes("billing_period_expired") && signals.includes("grace_period_active")) {
    return "contact_customer";
  }
  if (signals.includes("billing_period_expired"))     return "review_for_suspension";

  if (signals.includes("renewal_due_now"))            return "renew_subscription_metadata";
  if (signals.includes("grace_period_active"))        return "contact_customer";

  if (signals.includes("renewal_due_soon"))           return "contact_customer";
  if (signals.includes("trial_ending_soon"))          return "contact_customer";

  if (signals.includes("trial_expired"))              return "prepare_grace_period";
  if (signals.includes("trial_active"))               return "monitor";
  if (signals.includes("subscription_active"))        return "none";

  if (urgency === "unknown")                          return "manual_review_required";
  return "monitor";
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRenewalWarningMessages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds human-readable warning strings from a renewal profile.
 * Returns only non-empty warnings for actionable states.
 */
export function buildRenewalWarningMessages(profile: SubscriptionRenewalProfile): string[] {
  const warnings: string[] = [];

  for (const signal of profile.signals) {
    switch (signal) {
      case "invalid_subscription_dates":
        warnings.push("Subscription dates are inconsistent - metadata must be corrected.");
        break;
      case "no_subscription_metadata":
        warnings.push("No subscription metadata configured for this tenant.");
        break;
      case "grace_period_expired":
        warnings.push(
          `Grace period has expired${profile.daysPastDue !== null ? ` - ${profile.daysPastDue} day(s) past due` : ""}. Manual review required.`,
        );
        break;
      case "grace_period_ending_soon":
        warnings.push(
          `Grace period ending soon${profile.daysUntilGraceEnd !== null ? ` - ${profile.daysUntilGraceEnd} day(s) remaining` : ""}.`,
        );
        break;
      case "grace_period_active":
        warnings.push(
          `Tenant is in grace period${profile.daysUntilGraceEnd !== null ? ` - ${profile.daysUntilGraceEnd} day(s) remaining` : ""}.`,
        );
        break;
      case "billing_period_expired":
        if (!profile.signals.includes("grace_period_active") && !profile.signals.includes("grace_period_expired")) {
          warnings.push(
            `Billing period expired${profile.daysPastDue !== null ? ` - ${profile.daysPastDue} day(s) ago` : ""}.`,
          );
        }
        break;
      case "renewal_due_now":
        warnings.push("Renewal is due. Subscription metadata should be updated.");
        break;
      case "renewal_due_soon":
        warnings.push(
          `Renewal approaching${profile.daysUntilBillingEnd !== null ? ` - ${profile.daysUntilBillingEnd} day(s) remaining` : ""}.`,
        );
        break;
      case "trial_ending_soon":
        warnings.push(
          `Trial ending soon${profile.daysUntilTrialEnd !== null ? ` - ${profile.daysUntilTrialEnd} day(s) remaining` : ""}.`,
        );
        break;
      case "trial_expired":
        warnings.push("Trial period has ended. No active subscription window detected.");
        break;
      case "subscription_cancelled":
        warnings.push("Subscription has been cancelled.");
        break;
      case "subscription_suspended":
        warnings.push("Subscription is administratively suspended.");
        break;
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveSubscriptionRenewalProfile - main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a full SubscriptionRenewalProfile from a raw subscription row.
 * Accepts `now` - fully deterministic.
 */
export function deriveSubscriptionRenewalProfile(
  workspaceId:    number,
  sub:            Partial<SubscriptionFields> | null | undefined,
  now:            Date,
  subscriptionId: string | null = null,
): SubscriptionRenewalProfile {
  const signals         = deriveRenewalSignals(sub, now);
  const urgency         = deriveRenewalUrgency(signals);
  const recommendedAction = deriveRecommendedPlatformAction(signals, urgency);

  const daysUntilBillingEnd = sub ? daysUntil(sub.billingPeriodEnd ?? null, now) : null;
  const daysUntilTrialEnd   = sub ? daysUntil(sub.trialEndsAt      ?? null, now) : null;
  const daysUntilGraceEnd   = sub ? daysUntil(sub.gracePeriodEndsAt ?? null, now) : null;
  const daysPastDue         = sub ? daysPast(sub.billingPeriodEnd   ?? null, now) : null;

  const profile: SubscriptionRenewalProfile = {
    subscriptionId,
    workspaceId,
    planCode:           sub?.planCode          ?? null,
    subscriptionStatus: sub?.subscriptionStatus ?? "unknown",
    signals,
    urgency,
    recommendedAction,
    daysUntilBillingEnd: daysUntilBillingEnd !== null && daysUntilBillingEnd > 0 ? daysUntilBillingEnd : null,
    daysUntilTrialEnd:   daysUntilTrialEnd   !== null && daysUntilTrialEnd   > 0 ? daysUntilTrialEnd   : null,
    daysUntilGraceEnd:   daysUntilGraceEnd   !== null && daysUntilGraceEnd   > 0 ? daysUntilGraceEnd   : null,
    daysPastDue,
    warnings:           [],
    derivedAt:          now.toISOString(),
  };

  profile.warnings = buildRenewalWarningMessages(profile);
  return profile;
}
