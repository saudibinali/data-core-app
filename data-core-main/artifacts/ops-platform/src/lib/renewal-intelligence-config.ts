/**
 * @file   lib/renewal-intelligence-config.ts
 * @phase  P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
 *
 * Static UI configuration for renewal signals, urgency levels, and recommended
 * platform actions. Pure config - no API calls, no mutations.
 *
 * SAFETY CONTRACT (all properties must be true - enforced in T19):
 *   - superAdminOnly
 *   - readOnly
 *   - noPaymentProcessing
 *   - noInvoiceGeneration
 *   - noChargeCollection
 *   - noAutoWorkspaceSuspension
 *   - noWorkspaceLocking
 *   - noEntitlementEnforcement
 *   - noEmailOrLegalNotices
 *   - recommendationsOnly
 *   - failsClosedOnInvalidDates
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
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

export type RenewalUrgency =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

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
// Threshold Constants (mirrors backend)
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_DUE_SOON_DAYS  = 14;
export const TRIAL_ENDING_SOON_DAYS = 7;
export const GRACE_ENDING_SOON_DAYS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Signal Config
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewalSignalConfig {
  code:        RenewalSignalCode;
  label:       string;
  description: string;
  severity:    "info" | "warning" | "high" | "critical" | "muted";
  badgeClass:  string;
}

export const RENEWAL_SIGNAL_CONFIG: Record<RenewalSignalCode, RenewalSignalConfig> = {
  no_subscription_metadata: {
    code:        "no_subscription_metadata",
    label:       "No Metadata",
    description: "No subscription metadata has been configured for this tenant.",
    severity:    "muted",
    badgeClass:  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  },
  trial_active: {
    code:        "trial_active",
    label:       "Trial Active",
    description: "Tenant is currently in an active trial period.",
    severity:    "info",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  trial_ending_soon: {
    code:        "trial_ending_soon",
    label:       "Trial Ending Soon",
    description: `Trial period ends within ${TRIAL_ENDING_SOON_DAYS} days.`,
    severity:    "warning",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  trial_expired: {
    code:        "trial_expired",
    label:       "Trial Expired",
    description: "Trial period has ended with no active subscription window.",
    severity:    "warning",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  subscription_active: {
    code:        "subscription_active",
    label:       "Active",
    description: "Subscription is current and in good standing.",
    severity:    "info",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  renewal_due_soon: {
    code:        "renewal_due_soon",
    label:       "Renewal Due Soon",
    description: `Billing period ends within ${RENEWAL_DUE_SOON_DAYS} days.`,
    severity:    "warning",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  renewal_due_now: {
    code:        "renewal_due_now",
    label:       "Renewal Due",
    description: "Renewal date has passed. Subscription metadata should be updated.",
    severity:    "high",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  billing_period_expired: {
    code:        "billing_period_expired",
    label:       "Billing Period Expired",
    description: "The billing period has ended.",
    severity:    "high",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  grace_period_active: {
    code:        "grace_period_active",
    label:       "Grace Period",
    description: "Tenant is in a grace window following billing period expiry.",
    severity:    "warning",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  grace_period_ending_soon: {
    code:        "grace_period_ending_soon",
    label:       "Grace Ending Soon",
    description: `Grace period ends within ${GRACE_ENDING_SOON_DAYS} days.`,
    severity:    "high",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  grace_period_expired: {
    code:        "grace_period_expired",
    label:       "Grace Expired",
    description: "Grace period has expired with no renewal recorded.",
    severity:    "critical",
    badgeClass:  "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100 font-semibold",
  },
  subscription_cancelled: {
    code:        "subscription_cancelled",
    label:       "Cancelled",
    description: "Subscription has been cancelled.",
    severity:    "high",
    badgeClass:  "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  },
  subscription_suspended: {
    code:        "subscription_suspended",
    label:       "Suspended",
    description: "Subscription is administratively suspended.",
    severity:    "high",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  invalid_subscription_dates: {
    code:        "invalid_subscription_dates",
    label:       "Invalid Dates",
    description: "Subscription date fields are inconsistent and must be corrected.",
    severity:    "critical",
    badgeClass:  "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100 font-semibold",
  },
} as const;

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
// Renewal Urgency Config
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewalUrgencyConfig {
  urgency:     RenewalUrgency;
  label:       string;
  description: string;
  badgeClass:  string;
}

export const RENEWAL_URGENCY_CONFIG: Record<RenewalUrgency, RenewalUrgencyConfig> = {
  none: {
    urgency:     "none",
    label:       "None",
    description: "Subscription is in good standing with no action required.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  low: {
    urgency:     "low",
    label:       "Low",
    description: "Early signals present - monitoring recommended.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  },
  medium: {
    urgency:     "medium",
    label:       "Medium",
    description: "Renewal or trial deadline approaching - operator awareness needed.",
    badgeClass:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  high: {
    urgency:     "high",
    label:       "High",
    description: "Subscription window has ended or critical deadline approaching.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  },
  critical: {
    urgency:     "critical",
    label:       "Critical",
    description: "Grace period expired or date inconsistency detected. Immediate review.",
    badgeClass:  "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100 font-semibold",
  },
  unknown: {
    urgency:     "unknown",
    label:       "Unknown",
    description: "Insufficient subscription metadata to determine urgency.",
    badgeClass:  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Platform Action Config
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendedActionConfig {
  action:      RecommendedPlatformAction;
  label:       string;
  description: string;
  badgeClass:  string;
}

export const RECOMMENDED_PLATFORM_ACTION_CONFIG: Record<RecommendedPlatformAction, RecommendedActionConfig> = {
  none: {
    action:      "none",
    label:       "None",
    description: "No action required at this time.",
    badgeClass:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  monitor: {
    action:      "monitor",
    label:       "Monitor",
    description: "Continue monitoring - no immediate action needed.",
    badgeClass:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  contact_customer: {
    action:      "contact_customer",
    label:       "Contact Customer",
    description: "Operator should reach out to the customer to discuss renewal.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  },
  prepare_grace_period: {
    action:      "prepare_grace_period",
    label:       "Prepare Grace Period",
    description: "Consider configuring a grace window to allow transition time.",
    badgeClass:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  review_for_suspension: {
    action:      "review_for_suspension",
    label:       "Review for Suspension",
    description: "Operator should manually review whether workspace access should continue.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  },
  renew_subscription_metadata: {
    action:      "renew_subscription_metadata",
    label:       "Update Subscription Metadata",
    description: "Update the subscription metadata to reflect the renewed period.",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  },
  fix_subscription_metadata: {
    action:      "fix_subscription_metadata",
    label:       "Fix Metadata",
    description: "Subscription date fields are inconsistent and must be corrected.",
    badgeClass:  "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
  },
  manual_review_required: {
    action:      "manual_review_required",
    label:       "Manual Review",
    description: "Operator manual review is required to determine next steps.",
    badgeClass:  "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  },
} as const;

export const ALL_RECOMMENDED_PLATFORM_ACTIONS: RecommendedPlatformAction[] = [
  "none",
  "monitor",
  "contact_customer",
  "prepare_grace_period",
  "review_for_suspension",
  "renew_subscription_metadata",
  "fix_subscription_metadata",
  "manual_review_required",
];

// ─────────────────────────────────────────────────────────────────────────────
// API Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_INTELLIGENCE_API_PATHS = {
  get: (tenantId: string) => `/api/platform/tenants/${tenantId}/renewal-intelligence`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hook Name Registry
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_READ_HOOK_NAMES = ["useTenantRenewalIntelligence"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract (all properties must be true - tested in T19)
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_INTELLIGENCE_SAFETY_CONTRACT = {
  superAdminOnly:            true,
  readOnly:                  true,
  noPaymentProcessing:       true,
  noInvoiceGeneration:       true,
  noChargeCollection:        true,
  noAutoWorkspaceSuspension: true,
  noWorkspaceLocking:        true,
  noEntitlementEnforcement:  true,
  noEmailOrLegalNotices:     true,
  recommendationsOnly:       true,
  failsClosedOnInvalidDates: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty State Strings
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_EMPTY_STATE = {
  noData:      "Renewal intelligence data is not available.",
  loading:     "Loading renewal intelligence...",
  noSignals:   "No renewal signals detected.",
  noWarnings:  "No renewal warnings.",
  safetyNotice: "Informational view only. No automatic actions are taken by this view.",
} as const;
