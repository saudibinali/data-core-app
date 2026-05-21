/**
 * @file   lib/subscription-lifecycle-config.ts
 * @phase  P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * Static UI configuration for subscription plan codes and subscription statuses.
 * Mirrors backend subscription-lifecycle.ts - pure values, no API calls.
 *
 * SAFETY CONTRACT:
 *   - All maps are declared "as const" - TypeScript-enforced immutability.
 *   - No payment, invoice, charge, tax, card, billing portal, or legal wording.
 *   - All status labels and descriptions are informational only.
 *   - No automatic workspace suspension logic.
 *   - All SUBSCRIPTION_SAFETY_CONTRACT properties are true (tested).
 *   - Exactly ONE mutation hook name in SUBSCRIPTION_MUTATION_HOOK_NAMES.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Plan Code UI Config
// ─────────────────────────────────────────────────────────────────────────────

export type PlanCode =
  | "starter"
  | "growth"
  | "business"
  | "enterprise"
  | "custom";

export interface PlanCodeConfig {
  code:        PlanCode;
  name:        string;
  tier:        string;
  order:       number;
  description: string;
  badgeClass:  string;
}

export const PLAN_CODE_CONFIG: Record<PlanCode, PlanCodeConfig> = {
  starter: {
    code:        "starter",
    name:        "Starter",
    tier:        "basic",
    order:       0,
    description: "Entry-level plan for small teams.",
    badgeClass:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  growth: {
    code:        "growth",
    name:        "Growth",
    tier:        "standard",
    order:       1,
    description: "Standard plan for growing organisations.",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  business: {
    code:        "business",
    name:        "Business",
    tier:        "premium",
    order:       2,
    description: "Premium plan for established businesses.",
    badgeClass:  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  },
  enterprise: {
    code:        "enterprise",
    name:        "Enterprise",
    tier:        "enterprise",
    order:       3,
    description: "Full-featured enterprise plan.",
    badgeClass:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  custom: {
    code:        "custom",
    name:        "Custom",
    tier:        "custom",
    order:       4,
    description: "Custom plan negotiated individually.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
} as const;

export const ALL_PLAN_CODES: PlanCode[] = [
  "starter", "growth", "business", "enterprise", "custom",
];

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Status UI Config
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionStatusKey =
  | "trialing"
  | "active"
  | "renewal_due"
  | "grace_period"
  | "expired"
  | "suspended"
  | "cancelled"
  | "unknown";

export interface SubscriptionStatusConfig {
  label:       string;
  description: string;
  tier:        "good" | "neutral" | "attention" | "critical" | "muted";
  badgeClass:  string;
  alertClass:  string;
  order:       number;
}

export const SUBSCRIPTION_STATUS_CONFIG: Record<SubscriptionStatusKey, SubscriptionStatusConfig> = {
  trialing: {
    label:       "Trialing",
    description: "Workspace is currently in a free trial period.",
    tier:        "neutral",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    alertClass:  "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    order:       0,
  },
  active: {
    label:       "Active",
    description: "Subscription is current and in good standing.",
    tier:        "good",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    alertClass:  "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    order:       1,
  },
  renewal_due: {
    label:       "Renewal Due",
    description: "Subscription period is ending soon - renewal approaching.",
    tier:        "attention",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    alertClass:  "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200",
    order:       2,
  },
  grace_period: {
    label:       "Grace Period",
    description: "Billing period ended. Workspace is in a grace window.",
    tier:        "attention",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    alertClass:  "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
    order:       3,
  },
  expired: {
    label:       "Expired",
    description: "Subscription period has ended and the grace window has closed.",
    tier:        "critical",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    alertClass:  "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
    order:       4,
  },
  suspended: {
    label:       "Suspended",
    description: "Subscription administratively suspended.",
    tier:        "critical",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    alertClass:  "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
    order:       5,
  },
  cancelled: {
    label:       "Cancelled",
    description: "Subscription has been cancelled.",
    tier:        "muted",
    badgeClass:  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    alertClass:  "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
    order:       6,
  },
  unknown: {
    label:       "Not Configured",
    description: "No subscription metadata has been configured for this workspace.",
    tier:        "muted",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    alertClass:  "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
    order:       7,
  },
} as const;

export const ALL_SUBSCRIPTION_STATUSES: SubscriptionStatusKey[] = [
  "trialing", "active", "renewal_due", "grace_period",
  "expired", "suspended", "cancelled", "unknown",
];

// ─────────────────────────────────────────────────────────────────────────────
// Status Derivation (mirrors backend logic - no external imports)
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_WARNING_DAYS = 14;
export const REASON_MIN_LENGTH    = 10;

export interface SubscriptionDateFields {
  subscriptionStatus?:  string;
  billingPeriodEnd?:    string | null;
  gracePeriodEndsAt?:   string | null;
  trialEndsAt?:         string | null;
  cancelledAt?:         string | null;
}

/**
 * Client-side replica of backend deriveSubscriptionStatus.
 * Takes ISO string dates (as returned from the API).
 */
export function deriveSubscriptionStatusFromFields(
  fields: SubscriptionDateFields | null | undefined,
  now:    Date = new Date(),
): SubscriptionStatusKey {
  if (!fields) return "unknown";

  const nowMs = now.getTime();

  if (fields.cancelledAt) return "cancelled";
  if (fields.subscriptionStatus === "suspended") return "suspended";

  if (fields.trialEndsAt) {
    const t = new Date(fields.trialEndsAt);
    if (!isNaN(t.getTime()) && t.getTime() > nowMs) return "trialing";
  }

  if (fields.billingPeriodEnd) {
    const endMs = new Date(fields.billingPeriodEnd).getTime();
    if (!isNaN(endMs)) {
      if (endMs <= nowMs) {
        if (fields.gracePeriodEndsAt) {
          const graceMs = new Date(fields.gracePeriodEndsAt).getTime();
          if (!isNaN(graceMs) && graceMs > nowMs) return "grace_period";
        }
        return "expired";
      }
      const daysRemaining = (endMs - nowMs) / (1000 * 60 * 60 * 24);
      if (daysRemaining <= RENEWAL_WARNING_DAYS) return "renewal_due";
      return "active";
    }
  }

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionFormState {
  planCode:             string;
  subscriptionStatus:   string;
  billingPeriodStart:   string;
  billingPeriodEnd:     string;
  renewalDueAt:         string;
  trialStartedAt:       string;
  trialEndsAt:          string;
  gracePeriodStartedAt: string;
  gracePeriodEndsAt:    string;
  cancelledAt:          string;
  suspendedAt:          string;
  reason:               string;
  confirmation:         boolean;
}

export function isSubscriptionFormValid(form: SubscriptionFormState): boolean {
  if (!form.reason || form.reason.trim().length < REASON_MIN_LENGTH) return false;
  if (form.confirmation !== true) return false;
  return true;
}

export function getSubscriptionFormError(form: SubscriptionFormState): string | null {
  if (!form.reason || form.reason.trim().length === 0) {
    return "Reason is required.";
  }
  if (form.reason.trim().length < REASON_MIN_LENGTH) {
    return `Reason must be at least ${REASON_MIN_LENGTH} characters (currently ${form.reason.trim().length}).`;
  }
  if (!form.confirmation) {
    return "You must confirm before saving.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_API_PATHS = {
  get:    (tenantId: string) => `/api/platform/tenants/${tenantId}/subscription`,
  update: (tenantId: string) => `/api/platform/tenants/${tenantId}/subscription`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hook Name Registry
// ─────────────────────────────────────────────────────────────────────────────

/** Exactly one mutation hook is permitted for subscription metadata. */
export const SUBSCRIPTION_MUTATION_HOOK_NAMES = [
  "useUpdateTenantSubscription",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract (tested - all properties must be true)
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_SAFETY_CONTRACT = {
  superAdminOnly:                true,
  requiresReason:                true,
  requiresConfirmation:          true,
  noPaymentProcessing:           true,
  noInvoiceGeneration:           true,
  noChargeCollection:            true,
  noTaxLogic:                    true,
  noCardOrPaymentData:           true,
  noAutomaticWorkspaceSuspension:true,
  noEntitlementEnforcement:      true,
  noEmailNotifications:          true,
  noExternalLegalNotices:        true,
  noBillingPortal:               true,
  failClosedOnInvalidDates:      true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty State Strings
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_EMPTY_STATE = {
  noPlan:         "No plan assigned",
  noSubscription: "Not configured",
  noDates:        "-",
  noMetadata:     "Metadata only - no payment processing",
} as const;
