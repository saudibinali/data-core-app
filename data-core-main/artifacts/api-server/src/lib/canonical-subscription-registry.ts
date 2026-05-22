/**
 * Canonical subscription fields for tenant registry (P13 registry UI).
 * Single source: workspace_subscriptions.
 */

import type { WorkspaceSubscription } from "@workspace/db";
import {
  PLAN_CODE_MAP,
  ALL_PLAN_CODES,
  type SubscriptionStatus,
} from "./subscription-lifecycle";

export type CanonicalSubscriptionSnapshot = {
  planCode: string | null;
  planName: string | null;
  planTier: string | null;
  subscriptionStatus: SubscriptionStatus;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  renewalDueAt: Date | null;
  trialEndsAt: Date | null;
  gracePeriodEndsAt: Date | null;
};

function parsePlanCode(sub: WorkspaceSubscription): string | null {
  if (sub.planName && ALL_PLAN_CODES.includes(sub.planName as never)) {
    return sub.planName;
  }
  const m = /^PLAN-([a-z0-9_]+)$/i.exec(sub.subscriptionCode ?? "");
  if (m?.[1] && ALL_PLAN_CODES.includes(m[1] as never)) return m[1];
  return sub.planName ?? null;
}

/** Map workspace_subscriptions.status → registry SubscriptionStatus for filters/cards. */
export function mapWorkspaceStatusToRegistryStatus(
  status: string,
  now: Date,
  sub: WorkspaceSubscription,
): SubscriptionStatus {
  const end = sub.endDate ? new Date(`${sub.endDate}T00:00:00.000Z`) : null;
  const renewal = sub.renewalDate ? new Date(`${sub.renewalDate}T00:00:00.000Z`) : null;
  const graceEnd = sub.gracePeriodEndsAt;

  switch (status) {
    case "trial":
      return "trialing";
    case "active":
      if (renewal && renewal.getTime() - now.getTime() < 30 * 86400000) return "renewal_due";
      return "active";
    case "grace_period":
      return "grace_period";
    case "past_due":
      return "expired";
    case "suspended":
      return "suspended";
    case "terminated":
    case "archived":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** Adapter for P13 registry / renewal / health derivations. */
export function snapshotToRawSubscriptionRow(
  snap: CanonicalSubscriptionSnapshot,
): {
  planCode: string | null;
  subscriptionStatus: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  renewalDueAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  gracePeriodStartedAt: Date | null;
  gracePeriodEndsAt: Date | null;
  cancelledAt: Date | null;
  suspendedAt: Date | null;
} {
  return {
    planCode: snap.planCode,
    subscriptionStatus: snap.subscriptionStatus,
    billingPeriodStart: snap.billingPeriodStart,
    billingPeriodEnd: snap.billingPeriodEnd,
    renewalDueAt: snap.renewalDueAt,
    trialStartedAt: null,
    trialEndsAt: snap.trialEndsAt,
    gracePeriodStartedAt: null,
    gracePeriodEndsAt: snap.gracePeriodEndsAt,
    cancelledAt: snap.subscriptionStatus === "cancelled" ? snap.billingPeriodEnd : null,
    suspendedAt: snap.subscriptionStatus === "suspended" ? new Date() : null,
  };
}

export function workspaceSubscriptionToSnapshot(
  sub: WorkspaceSubscription,
  now: Date,
): CanonicalSubscriptionSnapshot {
  const planCode = parsePlanCode(sub);
  const knownPlan =
    planCode && ALL_PLAN_CODES.includes(planCode as never)
      ? PLAN_CODE_MAP[planCode as keyof typeof PLAN_CODE_MAP]
      : null;

  const billingPeriodStart = sub.startDate
    ? new Date(`${sub.startDate}T00:00:00.000Z`)
    : null;
  const billingPeriodEnd = sub.endDate ? new Date(`${sub.endDate}T00:00:00.000Z`) : null;
  const renewalDueAt = sub.renewalDate
    ? new Date(`${sub.renewalDate}T00:00:00.000Z`)
    : null;

  return {
    planCode,
    planName: knownPlan?.name ?? sub.planName ?? sub.subscriptionName,
    planTier: knownPlan?.tier ?? null,
    subscriptionStatus: mapWorkspaceStatusToRegistryStatus(sub.status, now, sub),
    billingPeriodStart,
    billingPeriodEnd,
    renewalDueAt,
    trialEndsAt: sub.status === "trial" && sub.endDate
      ? new Date(`${sub.endDate}T00:00:00.000Z`)
      : null,
    gracePeriodEndsAt: sub.gracePeriodEndsAt ?? null,
  };
}
