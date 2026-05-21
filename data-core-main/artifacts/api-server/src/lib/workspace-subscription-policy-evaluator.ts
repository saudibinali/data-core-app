/**
 * @file   workspace-subscription-policy-evaluator.ts
 * @phase  P16-D - Read-only subscription policy evaluation (no mutations)
 */

import type { SubscriptionPolicyFields } from "./subscription-policy-defaults";

export type RecommendedSubscriptionStatus =
  | "active"
  | "grace_period"
  | "past_due"
  | "suspended"
  | "terminated"
  | "no_change"
  | "review_required";

export type RecommendedSubscriptionAction =
  | "none"
  | "mark_grace_period"
  | "mark_past_due"
  | "mark_suspended"
  | "mark_terminated"
  | "review_required";

export interface SubscriptionPolicyEvaluationInput {
  subscription: {
    id: number;
    status: string;
    endDate: string | null;
  } | null;
  policy: SubscriptionPolicyFields;
  asOf?: Date;
}

export interface SubscriptionPolicyEvaluationResult {
  currentSubscriptionStatus: string;
  daysSinceEndDate: number | null;
  recommendedStatus: RecommendedSubscriptionStatus;
  recommendedAction: RecommendedSubscriptionAction;
  reasons: string[];
  policy: SubscriptionPolicyFields;
  isAutomaticAllowed: false;
  enforcementMode: string;
}

const TERMINAL_STATUSES = new Set(["archived", "terminated"]);

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function computeDaysSinceEndDate(endDate: string, asOf: Date): number {
  const end = utcDayStart(new Date(`${endDate}T00:00:00.000Z`));
  const today = utcDayStart(asOf);
  const diffMs = today.getTime() - end.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function actionForStatus(status: RecommendedSubscriptionStatus): RecommendedSubscriptionAction {
  switch (status) {
    case "grace_period":
      return "mark_grace_period";
    case "past_due":
      return "mark_past_due";
    case "suspended":
      return "mark_suspended";
    case "terminated":
      return "mark_terminated";
    case "active":
    case "no_change":
      return "none";
    default:
      return "review_required";
  }
}

export function evaluateSubscriptionPolicy(
  input: SubscriptionPolicyEvaluationInput,
): SubscriptionPolicyEvaluationResult {
  const asOf = input.asOf ?? new Date();
  const reasons: string[] = [];
  const sub = input.subscription;

  if (!sub) {
    reasons.push("No workspace subscription record exists for evaluation.");
    return {
      currentSubscriptionStatus: "none",
      daysSinceEndDate: null,
      recommendedStatus: "review_required",
      recommendedAction: "review_required",
      reasons,
      policy: input.policy,
      isAutomaticAllowed: false,
      enforcementMode: input.policy.enforcementMode,
    };
  }

  const currentSubscriptionStatus = sub.status;

  if (TERMINAL_STATUSES.has(sub.status)) {
    reasons.push(`Subscription status is ${sub.status}; no policy-driven change recommended.`);
    return {
      currentSubscriptionStatus,
      daysSinceEndDate: null,
      recommendedStatus: "no_change",
      recommendedAction: "none",
      reasons,
      policy: input.policy,
      isAutomaticAllowed: false,
      enforcementMode: input.policy.enforcementMode,
    };
  }

  if (!sub.endDate) {
    reasons.push("Subscription has no endDate; treated as active with no policy escalation.");
    return {
      currentSubscriptionStatus,
      daysSinceEndDate: null,
      recommendedStatus: "active",
      recommendedAction: "none",
      reasons,
      policy: input.policy,
      isAutomaticAllowed: false,
      enforcementMode: input.policy.enforcementMode,
    };
  }

  const daysSinceEndDate = computeDaysSinceEndDate(sub.endDate, asOf);

  if (daysSinceEndDate < 0) {
    reasons.push("Subscription endDate is in the future; subscription remains active.");
    return {
      currentSubscriptionStatus,
      daysSinceEndDate,
      recommendedStatus: "active",
      recommendedAction: "none",
      reasons,
      policy: input.policy,
      isAutomaticAllowed: false,
      enforcementMode: input.policy.enforcementMode,
    };
  }

  const {
    gracePeriodDays,
    pastDueAfterDays,
    suspensionAfterDays,
    terminationAfterDays,
  } = input.policy;

  let recommendedStatus: RecommendedSubscriptionStatus;

  if (daysSinceEndDate <= gracePeriodDays) {
    recommendedStatus = "grace_period";
    reasons.push(
      `${daysSinceEndDate} day(s) since endDate (within grace period of ${gracePeriodDays} days).`,
    );
  } else if (daysSinceEndDate <= pastDueAfterDays) {
    recommendedStatus = "past_due";
    reasons.push(
      `${daysSinceEndDate} day(s) since endDate (past grace; within past-due window of ${pastDueAfterDays} days).`,
    );
  } else if (daysSinceEndDate <= suspensionAfterDays) {
    recommendedStatus = "suspended";
    reasons.push(
      `${daysSinceEndDate} day(s) since endDate (within suspension window of ${suspensionAfterDays} days).`,
    );
  } else if (
    terminationAfterDays != null &&
    daysSinceEndDate > terminationAfterDays
  ) {
    recommendedStatus = "terminated";
    reasons.push(
      `${daysSinceEndDate} day(s) since endDate (exceeds termination threshold of ${terminationAfterDays} days).`,
    );
  } else {
    recommendedStatus = "suspended";
    reasons.push(
      `${daysSinceEndDate} day(s) since endDate (past suspension window; termination threshold not configured or not yet reached).`,
    );
  }

  if (sub.status === recommendedStatus) {
    reasons.push(`Current status already matches recommended status (${recommendedStatus}).`);
    return {
      currentSubscriptionStatus,
      daysSinceEndDate,
      recommendedStatus: "no_change",
      recommendedAction: "none",
      reasons,
      policy: input.policy,
      isAutomaticAllowed: false,
      enforcementMode: input.policy.enforcementMode,
    };
  }

  const recommendedAction = actionForStatus(recommendedStatus);
  reasons.push(`Advisory recommendation only (enforcementMode=${input.policy.enforcementMode}).`);

  return {
    currentSubscriptionStatus,
    daysSinceEndDate,
    recommendedStatus,
    recommendedAction,
    reasons,
    policy: input.policy,
    isAutomaticAllowed: false,
    enforcementMode: input.policy.enforcementMode,
  };
}
