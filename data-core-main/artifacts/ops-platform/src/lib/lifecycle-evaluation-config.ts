/**
 * @file   lib/lifecycle-evaluation-config.ts
 * @phase  P13-I - Automated Lifecycle Evaluation Engine
 *
 * Frontend configuration for the Lifecycle Evaluation Engine panel.
 *
 * SAFETY CONTRACT:
 *   - Advisory only - no execution buttons.
 *   - Super-admin visibility only.
 *   - No payment, billing, suspension, enforcement, or email wording.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_EVALUATION_SAFETY_CONTRACT = {
  superAdminOnly:            true,
  readOnly:                  true,
  recommendationsOnly:       true,
  noPaymentProcessing:       true,
  noInvoiceGeneration:       true,
  noChargeCollection:        true,
  noAutoWorkspaceSuspension: true,
  noAutoWorkspaceLocking:    true,
  noEntitlementEnforcement:  true,
  noEmailOrLegalNotices:     true,
  noDestructiveTenantActions: true,
  noStateMutation:           true,
  failsClosedOnMissingData:  true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Signal Codes
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationSignalCode =
  | "subscription_metadata_missing"
  | "trial_ending_requires_review"
  | "renewal_due_requires_review"
  | "grace_period_active_requires_monitoring"
  | "grace_period_expired_requires_review"
  | "subscription_expired_requires_review"
  | "workspace_suspended_requires_review"
  | "workspace_locked_requires_review"
  | "usage_approaching_requires_review"
  | "usage_exceeded_requires_review"
  | "entitlement_overrides_require_review"
  | "custom_plan_requires_review"
  | "health_high_risk_requires_review"
  | "health_critical_requires_review"
  | "governance_warning_requires_review"
  | "operational_data_missing_requires_review"
  | "manual_review_required";

export const ALL_EVALUATION_SIGNAL_CODES: EvaluationSignalCode[] = [
  "subscription_metadata_missing",
  "trial_ending_requires_review",
  "renewal_due_requires_review",
  "grace_period_active_requires_monitoring",
  "grace_period_expired_requires_review",
  "subscription_expired_requires_review",
  "workspace_suspended_requires_review",
  "workspace_locked_requires_review",
  "usage_approaching_requires_review",
  "usage_exceeded_requires_review",
  "entitlement_overrides_require_review",
  "custom_plan_requires_review",
  "health_high_risk_requires_review",
  "health_critical_requires_review",
  "governance_warning_requires_review",
  "operational_data_missing_requires_review",
  "manual_review_required",
];

export interface EvaluationSignalConfig {
  code:        EvaluationSignalCode;
  label:       string;
  description: string;
  badgeClass:  string;
  severity:    "info" | "low" | "medium" | "high" | "critical";
}

export const LIFECYCLE_EVALUATION_SIGNAL_CONFIG: Record<EvaluationSignalCode, EvaluationSignalConfig> = {
  subscription_metadata_missing: {
    code:        "subscription_metadata_missing",
    label:       "Metadata Missing",
    description: "Subscription metadata is missing or incomplete.",
    badgeClass:  "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    severity:    "info",
  },
  trial_ending_requires_review: {
    code:        "trial_ending_requires_review",
    label:       "Trial Ending",
    description: "Trial period is ending soon. Subscription review required.",
    badgeClass:  "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
    severity:    "low",
  },
  renewal_due_requires_review: {
    code:        "renewal_due_requires_review",
    label:       "Renewal Due",
    description: "Subscription renewal is due soon.",
    badgeClass:  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    severity:    "medium",
  },
  grace_period_active_requires_monitoring: {
    code:        "grace_period_active_requires_monitoring",
    label:       "Grace Period Active",
    description: "Tenant is in a grace period. Monitoring is recommended.",
    badgeClass:  "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
    severity:    "medium",
  },
  grace_period_expired_requires_review: {
    code:        "grace_period_expired_requires_review",
    label:       "Grace Expired",
    description: "Grace period has expired. Suspension review is now eligible.",
    badgeClass:  "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
    severity:    "high",
  },
  subscription_expired_requires_review: {
    code:        "subscription_expired_requires_review",
    label:       "Subscription Expired",
    description: "Subscription has expired. Renewal review is required.",
    badgeClass:  "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-700",
    severity:    "high",
  },
  workspace_suspended_requires_review: {
    code:        "workspace_suspended_requires_review",
    label:       "Workspace Suspended",
    description: "Workspace is currently suspended. Lifecycle review recommended.",
    badgeClass:  "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-700",
    severity:    "high",
  },
  workspace_locked_requires_review: {
    code:        "workspace_locked_requires_review",
    label:       "Workspace Locked",
    description: "Workspace is locked. Manual review is required.",
    badgeClass:  "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    severity:    "critical",
  },
  usage_approaching_requires_review: {
    code:        "usage_approaching_requires_review",
    label:       "Usage Approaching",
    description: "Usage is approaching one or more limits.",
    badgeClass:  "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700",
    severity:    "medium",
  },
  usage_exceeded_requires_review: {
    code:        "usage_exceeded_requires_review",
    label:       "Usage Exceeded",
    description: "One or more usage limits have been exceeded.",
    badgeClass:  "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-700",
    severity:    "high",
  },
  entitlement_overrides_require_review: {
    code:        "entitlement_overrides_require_review",
    label:       "Entitlement Overrides",
    description: "Custom entitlement overrides are active.",
    badgeClass:  "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
    severity:    "low",
  },
  custom_plan_requires_review: {
    code:        "custom_plan_requires_review",
    label:       "Custom Plan",
    description: "Tenant is on a custom plan. Periodic review recommended.",
    badgeClass:  "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
    severity:    "low",
  },
  health_high_risk_requires_review: {
    code:        "health_high_risk_requires_review",
    label:       "Health High Risk",
    description: "Tenant health risk level is high.",
    badgeClass:  "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700",
    severity:    "high",
  },
  health_critical_requires_review: {
    code:        "health_critical_requires_review",
    label:       "Health Critical",
    description: "Tenant health is critical. Immediate attention advised.",
    badgeClass:  "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    severity:    "critical",
  },
  governance_warning_requires_review: {
    code:        "governance_warning_requires_review",
    label:       "Governance Warning",
    description: "Governance warnings are present.",
    badgeClass:  "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-800",
    severity:    "medium",
  },
  operational_data_missing_requires_review: {
    code:        "operational_data_missing_requires_review",
    label:       "Data Missing",
    description: "Operational data is missing for multiple metrics.",
    badgeClass:  "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
    severity:    "medium",
  },
  manual_review_required: {
    code:        "manual_review_required",
    label:       "Manual Review Required",
    description: "Multiple critical risk factors detected. Manual review is required.",
    badgeClass:  "bg-rose-200 text-rose-900 border-rose-400 font-semibold dark:bg-rose-950 dark:text-rose-100 dark:border-rose-700",
    severity:    "critical",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Severity Config
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationSeverity =
  | "none"
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

export interface EvaluationSeverityConfig {
  label:      string;
  badgeClass: string;
  icon:       string;
}

export const LIFECYCLE_EVALUATION_SEVERITY_CONFIG: Record<EvaluationSeverity, EvaluationSeverityConfig> = {
  none: {
    label:      "None",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    icon:       "CheckCircle2",
  },
  info: {
    label:      "Info",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
    icon:       "Info",
  },
  low: {
    label:      "Low",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    icon:       "AlertCircle",
  },
  medium: {
    label:      "Medium",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    icon:       "AlertTriangle",
  },
  high: {
    label:      "High",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700",
    icon:       "AlertTriangle",
  },
  critical: {
    label:      "Critical",
    badgeClass: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    icon:       "XCircle",
  },
  unknown: {
    label:      "Unknown",
    badgeClass: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700",
    icon:       "HelpCircle",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Action Config
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationRecommendedAction =
  | "none"
  | "monitor"
  | "review_subscription"
  | "review_usage"
  | "review_entitlements"
  | "review_lifecycle"
  | "review_governance"
  | "prepare_customer_contact"
  | "prepare_restriction_review"
  | "manual_review_required";

export interface EvaluationActionConfig {
  label:       string;
  description: string;
  badgeClass:  string;
}

export const LIFECYCLE_EVALUATION_ACTION_CONFIG: Record<EvaluationRecommendedAction, EvaluationActionConfig> = {
  none: {
    label:       "None",
    description: "No action recommended at this time.",
    badgeClass:  "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  },
  monitor: {
    label:       "Monitor",
    description: "Continue monitoring the tenant. No immediate action required.",
    badgeClass:  "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
  review_subscription: {
    label:       "Review Subscription",
    description: "Review subscription metadata, plan, and billing period dates.",
    badgeClass:  "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  },
  review_usage: {
    label:       "Review Usage",
    description: "Review capacity utilisation and usage limits.",
    badgeClass:  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  },
  review_entitlements: {
    label:       "Review Entitlements",
    description: "Review module access and feature limit overrides.",
    badgeClass:  "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
  },
  review_lifecycle: {
    label:       "Review Lifecycle",
    description: "Review workspace lifecycle state and determine if restoration is appropriate.",
    badgeClass:  "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
  },
  review_governance: {
    label:       "Review Governance",
    description: "Review governance warnings and determine appropriate response.",
    badgeClass:  "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-800",
  },
  prepare_customer_contact: {
    label:       "Prepare Contact",
    description: "Prepare internal context before initiating customer contact.",
    badgeClass:  "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
  },
  prepare_restriction_review: {
    label:       "Restriction Review",
    description: "Prepare a restriction review. Evaluate eligibility for suspension or grace extension.",
    badgeClass:  "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  },
  manual_review_required: {
    label:       "Manual Review Required",
    description: "Immediate manual platform operator review is required due to multiple critical signals.",
    badgeClass:  "bg-rose-100 text-rose-900 border-rose-300 font-semibold dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Review Eligibility Config
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewEligibilityConfig {
  key:         string;
  label:       string;
  description: string;
}

export const REVIEW_ELIGIBILITY_CONFIG: ReviewEligibilityConfig[] = [
  {
    key:         "renewalReviewEligible",
    label:       "Renewal",
    description: "Subscription renewal review is eligible.",
  },
  {
    key:         "graceReviewEligible",
    label:       "Grace Period",
    description: "Grace period review is eligible.",
  },
  {
    key:         "suspensionReviewEligible",
    label:       "Suspension",
    description: "Suspension review is eligible.",
  },
  {
    key:         "usageReviewEligible",
    label:       "Usage",
    description: "Usage capacity review is eligible.",
  },
  {
    key:         "entitlementReviewEligible",
    label:       "Entitlements",
    description: "Entitlement configuration review is eligible.",
  },
  {
    key:         "lifecycleReviewEligible",
    label:       "Lifecycle",
    description: "Workspace lifecycle state review is eligible.",
  },
  {
    key:         "governanceReviewEligible",
    label:       "Governance",
    description: "Governance warning review is eligible.",
  },
  {
    key:         "manualReviewRequired",
    label:       "Manual Review",
    description: "Immediate manual review is required.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// API Paths
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_EVALUATION_API_PATHS = {
  get: (tenantId: string) => `/api/platform/tenants/${tenantId}/lifecycle-evaluation`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty States
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_EVALUATION_EMPTY_STATE = {
  loading:      "Deriving lifecycle evaluation...",
  noData:       "No evaluation data available.",
  noSignals:    "No active evaluation signals. Tenant is within normal parameters.",
  safetyNotice: "Evaluation is advisory only. No automated lifecycle action is performed. All recommendations require explicit super-admin review and manual action.",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden wording (for test safety contract verification)
// ─────────────────────────────────────────────────────────────────────────────

export const EVALUATION_FORBIDDEN_WORDING = [
  "payment",
  "invoice",
  "charge",
  "billing portal",
  "tax",
  "auto-suspend",
  "auto suspend",
  "auto-lock",
  "auto lock",
  "enforce entitlement",
  "entitlement enforcement",
  "send email",
  "legal notice",
  "terminate",
  "execute action",
] as const;
