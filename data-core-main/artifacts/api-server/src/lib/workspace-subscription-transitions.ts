/**
 * @file   workspace-subscription-transitions.ts
 * @phase  P16-A - Subscription State Model
 *
 * Validates workspace subscription status transitions only.
 * Does not apply enforcement, module blocking, or login suspension.
 */

export const WORKSPACE_SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "grace_period",
  "past_due",
  "suspended",
  "terminated",
  "archived",
] as const;

export type WorkspaceSubscriptionStatus = (typeof WORKSPACE_SUBSCRIPTION_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<
  WorkspaceSubscriptionStatus,
  readonly WorkspaceSubscriptionStatus[]
> = {
  trial: ["active", "grace_period"],
  active: ["grace_period", "past_due", "suspended", "terminated"],
  grace_period: ["active", "past_due", "suspended"],
  past_due: ["active", "suspended"],
  suspended: ["active", "terminated"],
  terminated: ["archived"],
  archived: [],
};

export function isWorkspaceSubscriptionStatus(v: string): v is WorkspaceSubscriptionStatus {
  return (WORKSPACE_SUBSCRIPTION_STATUSES as readonly string[]).includes(v);
}

export interface SubscriptionTransitionResult {
  allowed: boolean;
  reason?: string;
}

export function canTransitionWorkspaceSubscriptionStatus(
  from: WorkspaceSubscriptionStatus,
  to: WorkspaceSubscriptionStatus,
): SubscriptionTransitionResult {
  if (from === to) {
    return { allowed: false, reason: "Status is unchanged" };
  }

  if (from === "archived") {
    return {
      allowed: false,
      reason: "Archived subscriptions cannot transition to any other status",
    };
  }

  if (from === "terminated" && to === "active") {
    return {
      allowed: false,
      reason: "Terminated subscriptions cannot return to active directly",
    };
  }

  if (from === "suspended" && to === "trial") {
    return {
      allowed: false,
      reason: "Suspended subscriptions cannot return to trial",
    };
  }

  if (from === "past_due" && to === "trial") {
    return {
      allowed: false,
      reason: "Past-due subscriptions cannot return to trial",
    };
  }

  const allowedTargets = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowedTargets.includes(to)) {
    return {
      allowed: false,
      reason: `Transition from ${from} to ${to} is not allowed`,
    };
  }

  return { allowed: true };
}
