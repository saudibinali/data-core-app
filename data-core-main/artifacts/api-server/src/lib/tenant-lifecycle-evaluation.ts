/**
 * @file   lib/tenant-lifecycle-evaluation.ts
 * @phase  P13-I - Automated Lifecycle Evaluation Engine
 *
 * Pure derivation library for Tenant Lifecycle Evaluation profiles.
 * Aggregates all intelligence layers (health, renewal, usage, entitlements,
 * lifecycle state) into a single advisory EvaluationProfile.
 *
 * SAFETY CONTRACT:
 *   - All functions are pure - no DB, no HTTP, no side effects.
 *   - Read-only - no writes, no enforcement, no billing, no suspension.
 *   - Recommendations are advisory only - never executed automatically.
 *   - No automatic workspace status changes, locking, or suspension.
 *   - No payment, invoice, charge, or tax logic.
 *   - No email or legal notices.
 *   - No entitlement enforcement or module access enforcement.
 *   - Fails closed on missing data - unknown/critical over fabrication.
 *   - Super-admin visibility only; never exposed to tenants.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_EVALUATION_SAFETY_CONTRACT = {
  superAdminOnly:              true,
  readOnly:                    true,
  recommendationsOnly:         true,
  noPaymentProcessing:         true,
  noInvoiceGeneration:         true,
  noChargeCollection:          true,
  noAutoWorkspaceSuspension:   true,
  noAutoWorkspaceLocking:      true,
  noEntitlementEnforcement:    true,
  noEmailOrLegalNotices:       true,
  noDestructiveTenantActions:  true,
  noStateMutation:             true,
  failsClosedOnMissingData:    true,
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

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationSeverity =
  | "none"
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

export const EVALUATION_SEVERITY_ORDER: Record<EvaluationSeverity, number> = {
  none:     0,
  info:     1,
  low:      2,
  medium:   3,
  high:     4,
  critical: 5,
  unknown:  0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Action
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

export const ALL_EVALUATION_RECOMMENDED_ACTIONS: EvaluationRecommendedAction[] = [
  "none",
  "monitor",
  "review_subscription",
  "review_usage",
  "review_entitlements",
  "review_lifecycle",
  "review_governance",
  "prepare_customer_contact",
  "prepare_restriction_review",
  "manual_review_required",
];

// Action priority: higher index = higher priority
const ACTION_PRIORITY: Record<EvaluationRecommendedAction, number> = {
  none:                    0,
  monitor:                 1,
  review_entitlements:     2,
  review_governance:       3,
  review_usage:            4,
  review_subscription:     5,
  prepare_customer_contact: 6,
  review_lifecycle:        7,
  prepare_restriction_review: 8,
  manual_review_required:  9,
};

// ─────────────────────────────────────────────────────────────────────────────
// Review Eligibility
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewEligibility {
  renewalReviewEligible:     boolean;
  graceReviewEligible:       boolean;
  suspensionReviewEligible:  boolean;
  usageReviewEligible:       boolean;
  entitlementReviewEligible: boolean;
  lifecycleReviewEligible:   boolean;
  governanceReviewEligible:  boolean;
  manualReviewRequired:      boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluationLifecycleInput {
  workspaceStatus: string;       // "active" | "suspended" | "locked" | "disabled" | ...
  lifecycleState:  string;       // WorkspaceLifecycleState
}

export interface EvaluationSubscriptionInput {
  subscriptionStatus:   string;  // SubscriptionStatus
  planCode:             string | null;
  renewalDueSoon:       boolean;
  renewalDueNow:        boolean;
  trialEndingSoon:      boolean;
  gracePeriodActive:    boolean;
  graceEndingSoon:      boolean;
  graceExpired:         boolean;
  subscriptionExpired:  boolean;
  hasMissingMetadata:   boolean;
}

export interface EvaluationUsageInput {
  capacityRiskLevel:    string;  // "none" | "low" | "medium" | "high" | "critical" | "unknown"
  warningCount:         number;
  exceededCount:        number;
  unknownCount:         number;
}

export interface EvaluationEntitlementInput {
  customEntitlementsCount: number;
  planCode:                string | null;
}

export interface EvaluationHealthInput {
  healthRiskLevel:           string;  // "none" | "low" | "medium" | "high" | "critical" | "unknown"
  healthStatus:              string;
  healthRecommendedAction:   string;
  healthWarningCount:        number;
}

export interface EvaluationGovernanceInput {
  hasWarnings: boolean;
}

export interface TenantLifecycleEvaluationInput {
  tenantId:      string;
  workspaceId:   number;
  lifecycle:     EvaluationLifecycleInput;
  subscription:  EvaluationSubscriptionInput;
  usage:         EvaluationUsageInput;
  entitlements:  EvaluationEntitlementInput;
  health:        EvaluationHealthInput;
  governance?:   EvaluationGovernanceInput;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantLifecycleEvaluationProfile {
  tenantId:          string;
  workspaceId:       number;
  signals:           EvaluationSignalCode[];
  severity:          EvaluationSeverity;
  recommendedAction: EvaluationRecommendedAction;
  reviewEligibility: ReviewEligibility;
  warnings:          string[];
  summary:           string;
  evaluatedAt:       string;
  safetyNotice:      string;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLifecycleEvaluationSignals
// ─────────────────────────────────────────────────────────────────────────────

export function deriveLifecycleEvaluationSignals(
  input: TenantLifecycleEvaluationInput,
): EvaluationSignalCode[] {
  const signals: EvaluationSignalCode[] = [];
  const { lifecycle, subscription, usage, entitlements, health, governance } = input;

  // ── Subscription metadata ──────────────────────────────────────────────────
  if (subscription.hasMissingMetadata || subscription.subscriptionStatus === "unknown") {
    signals.push("subscription_metadata_missing");
  }

  // ── Trial ─────────────────────────────────────────────────────────────────
  if (subscription.trialEndingSoon) {
    signals.push("trial_ending_requires_review");
  }

  // ── Renewal ───────────────────────────────────────────────────────────────
  if (subscription.renewalDueSoon || subscription.renewalDueNow) {
    signals.push("renewal_due_requires_review");
  }

  // ── Grace Period ──────────────────────────────────────────────────────────
  if (subscription.gracePeriodActive || subscription.graceEndingSoon) {
    signals.push("grace_period_active_requires_monitoring");
  }
  if (subscription.graceExpired) {
    signals.push("grace_period_expired_requires_review");
  }

  // ── Subscription Expired ──────────────────────────────────────────────────
  if (subscription.subscriptionExpired &&
      !["suspended", "locked", "disabled"].includes(lifecycle.workspaceStatus)) {
    signals.push("subscription_expired_requires_review");
  }

  // ── Workspace State ───────────────────────────────────────────────────────
  if (lifecycle.workspaceStatus === "suspended" || lifecycle.lifecycleState === "suspended") {
    signals.push("workspace_suspended_requires_review");
  }
  if (lifecycle.workspaceStatus === "locked" || lifecycle.lifecycleState === "locked") {
    signals.push("workspace_locked_requires_review");
  }

  // ── Usage ─────────────────────────────────────────────────────────────────
  if (usage.warningCount > 0) {
    signals.push("usage_approaching_requires_review");
  }
  if (usage.exceededCount > 0) {
    signals.push("usage_exceeded_requires_review");
  }

  // ── Missing operational data ───────────────────────────────────────────────
  if (usage.unknownCount > 3 || (usage.capacityRiskLevel === "unknown" && usage.unknownCount > 0)) {
    signals.push("operational_data_missing_requires_review");
  }

  // ── Entitlements ──────────────────────────────────────────────────────────
  if (entitlements.customEntitlementsCount > 0) {
    signals.push("entitlement_overrides_require_review");
  }
  if (entitlements.planCode === "custom") {
    signals.push("custom_plan_requires_review");
  }

  // ── Health ────────────────────────────────────────────────────────────────
  const hrl = health.healthRiskLevel;
  if (hrl === "high") {
    signals.push("health_high_risk_requires_review");
  } else if (hrl === "critical") {
    signals.push("health_critical_requires_review");
  }

  // ── Governance ────────────────────────────────────────────────────────────
  if (governance?.hasWarnings) {
    signals.push("governance_warning_requires_review");
  }

  // ── Manual Review (escalation) ────────────────────────────────────────────
  const hasManualTrigger =
    signals.includes("workspace_locked_requires_review") ||
    signals.includes("health_critical_requires_review") ||
    signals.includes("grace_period_expired_requires_review") ||
    (signals.includes("subscription_expired_requires_review") &&
     signals.includes("usage_exceeded_requires_review"));

  if (hasManualTrigger) {
    signals.push("manual_review_required");
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveEvaluationSeverity
// ─────────────────────────────────────────────────────────────────────────────

export function deriveEvaluationSeverity(
  signals: EvaluationSignalCode[],
): EvaluationSeverity {
  if (signals.length === 0) return "none";

  const CRITICAL_SIGNALS: EvaluationSignalCode[] = [
    "manual_review_required",
    "workspace_locked_requires_review",
    "health_critical_requires_review",
  ];
  const HIGH_SIGNALS: EvaluationSignalCode[] = [
    "grace_period_expired_requires_review",
    "subscription_expired_requires_review",
    "workspace_suspended_requires_review",
    "usage_exceeded_requires_review",
    "health_high_risk_requires_review",
  ];
  const MEDIUM_SIGNALS: EvaluationSignalCode[] = [
    "renewal_due_requires_review",
    "grace_period_active_requires_monitoring",
    "usage_approaching_requires_review",
    "governance_warning_requires_review",
    "operational_data_missing_requires_review",
  ];
  const LOW_SIGNALS: EvaluationSignalCode[] = [
    "trial_ending_requires_review",
    "entitlement_overrides_require_review",
    "custom_plan_requires_review",
  ];
  const INFO_SIGNALS: EvaluationSignalCode[] = [
    "subscription_metadata_missing",
  ];

  if (signals.some(s => CRITICAL_SIGNALS.includes(s))) return "critical";
  if (signals.some(s => HIGH_SIGNALS.includes(s)))     return "high";
  if (signals.some(s => MEDIUM_SIGNALS.includes(s)))   return "medium";
  if (signals.some(s => LOW_SIGNALS.includes(s)))      return "low";
  if (signals.some(s => INFO_SIGNALS.includes(s)))     return "info";
  return "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveEvaluationRecommendedAction
// ─────────────────────────────────────────────────────────────────────────────

export function deriveEvaluationRecommendedAction(
  signals:  EvaluationSignalCode[],
  severity: EvaluationSeverity,
): EvaluationRecommendedAction {
  if (signals.length === 0 || severity === "none") return "none";

  let best: EvaluationRecommendedAction = "none";

  function trySet(action: EvaluationRecommendedAction): void {
    if ((ACTION_PRIORITY[action] ?? 0) > (ACTION_PRIORITY[best] ?? 0)) {
      best = action;
    }
  }

  if (signals.includes("manual_review_required") ||
      signals.includes("workspace_locked_requires_review") ||
      signals.includes("health_critical_requires_review")) {
    trySet("manual_review_required");
  }
  if (signals.includes("grace_period_expired_requires_review") ||
      signals.includes("subscription_expired_requires_review") ||
      signals.includes("workspace_suspended_requires_review")) {
    trySet("prepare_restriction_review");
  }
  if (signals.includes("workspace_suspended_requires_review") ||
      signals.includes("workspace_locked_requires_review")) {
    trySet("review_lifecycle");
  }
  if (signals.includes("renewal_due_requires_review") ||
      signals.includes("grace_period_active_requires_monitoring") ||
      signals.includes("grace_period_expired_requires_review") ||
      signals.includes("subscription_expired_requires_review") ||
      signals.includes("subscription_metadata_missing") ||
      signals.includes("trial_ending_requires_review")) {
    trySet("review_subscription");
  }
  if (signals.includes("usage_exceeded_requires_review") ||
      signals.includes("usage_approaching_requires_review")) {
    trySet("review_usage");
  }
  if (signals.includes("entitlement_overrides_require_review") ||
      signals.includes("custom_plan_requires_review")) {
    trySet("review_entitlements");
  }
  if (signals.includes("governance_warning_requires_review")) {
    trySet("review_governance");
  }
  if (signals.includes("health_high_risk_requires_review")) {
    trySet("prepare_customer_contact");
  }
  if (severity === "info" || signals.includes("subscription_metadata_missing")) {
    trySet("monitor");
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveReviewEligibility
// ─────────────────────────────────────────────────────────────────────────────

export function deriveReviewEligibility(
  signals:  EvaluationSignalCode[],
  severity: EvaluationSeverity,
): ReviewEligibility {
  const has = (code: EvaluationSignalCode): boolean => signals.includes(code);

  const renewalReviewEligible =
    has("renewal_due_requires_review") ||
    has("subscription_expired_requires_review") ||
    has("grace_period_active_requires_monitoring") ||
    has("subscription_metadata_missing");

  const graceReviewEligible =
    has("grace_period_active_requires_monitoring") ||
    has("grace_period_expired_requires_review");

  const suspensionReviewEligible =
    has("workspace_suspended_requires_review") ||
    has("grace_period_expired_requires_review") ||
    has("subscription_expired_requires_review");

  const usageReviewEligible =
    has("usage_approaching_requires_review") ||
    has("usage_exceeded_requires_review");

  const entitlementReviewEligible =
    has("entitlement_overrides_require_review") ||
    has("custom_plan_requires_review");

  const lifecycleReviewEligible =
    has("workspace_suspended_requires_review") ||
    has("workspace_locked_requires_review");

  const governanceReviewEligible =
    has("governance_warning_requires_review");

  const manualReviewRequired =
    has("manual_review_required") ||
    has("workspace_locked_requires_review") ||
    has("health_critical_requires_review") ||
    has("operational_data_missing_requires_review") ||
    severity === "critical";

  return {
    renewalReviewEligible,
    graceReviewEligible,
    suspensionReviewEligible,
    usageReviewEligible,
    entitlementReviewEligible,
    lifecycleReviewEligible,
    governanceReviewEligible,
    manualReviewRequired,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEvaluationWarnings
// ─────────────────────────────────────────────────────────────────────────────

export function buildEvaluationWarnings(
  signals:  EvaluationSignalCode[],
  severity: EvaluationSeverity,
): string[] {
  const warnings: string[] = [];

  const SIGNAL_WARNINGS: Partial<Record<EvaluationSignalCode, string>> = {
    manual_review_required:               "Manual review required - multiple critical risk factors detected.",
    workspace_locked_requires_review:     "Workspace is locked. Lifecycle review is strongly recommended.",
    health_critical_requires_review:      "Tenant health is critical. Immediate operational attention advised.",
    grace_period_expired_requires_review: "Grace period has expired. Suspension review is now eligible.",
    subscription_expired_requires_review: "Subscription has expired. Renewal review is required.",
    workspace_suspended_requires_review:  "Workspace is currently suspended. Lifecycle review is recommended.",
    usage_exceeded_requires_review:       "One or more usage limits have been exceeded. Usage review required.",
    health_high_risk_requires_review:     "Tenant health risk level is high. Review is recommended.",
    renewal_due_requires_review:          "Subscription renewal is due soon. Review is recommended.",
    grace_period_active_requires_monitoring: "Tenant is in a grace period. Monitoring is active.",
    usage_approaching_requires_review:    "Usage is approaching one or more limits. Capacity review is advised.",
    governance_warning_requires_review:   "Governance warnings are present. Review is recommended.",
    trial_ending_requires_review:         "Trial period is ending soon. Subscription review required.",
    entitlement_overrides_require_review: "Custom entitlement overrides are active. Periodic review is recommended.",
    custom_plan_requires_review:          "Tenant is on a custom plan. Entitlement review is recommended.",
    subscription_metadata_missing:        "Subscription metadata is missing or incomplete. Configuration review required.",
    operational_data_missing_requires_review: "Operational data is missing for multiple metrics. Manual review required.",
  };

  for (const signal of signals) {
    const warning = SIGNAL_WARNINGS[signal];
    if (warning) warnings.push(warning);
  }

  if (severity === "critical" && !signals.includes("manual_review_required")) {
    warnings.push("Overall evaluation severity is critical. Escalation to a platform operator is recommended.");
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEvaluationSummary
// ─────────────────────────────────────────────────────────────────────────────

export function buildEvaluationSummary(
  signals:           EvaluationSignalCode[],
  severity:          EvaluationSeverity,
  recommendedAction: EvaluationRecommendedAction,
): string {
  if (signals.length === 0 || severity === "none") {
    return "No active evaluation signals. Tenant is within expected operational parameters.";
  }

  const parts: string[] = [];

  const ACTION_DESCRIPTIONS: Record<EvaluationRecommendedAction, string> = {
    none:                    "No action recommended.",
    monitor:                 "Continued monitoring is recommended.",
    review_subscription:     "Subscription review is recommended.",
    review_usage:            "Usage and capacity review is recommended.",
    review_entitlements:     "Entitlement configuration review is recommended.",
    review_lifecycle:        "Lifecycle state review is recommended.",
    review_governance:       "Governance issue review is recommended.",
    prepare_customer_contact: "Preparing for customer contact is recommended.",
    prepare_restriction_review: "Restriction review preparation is recommended.",
    manual_review_required:  "Manual platform operator review is required.",
  };

  parts.push(
    `Evaluation severity: ${severity.toUpperCase()}.`,
    `${signals.length} evaluation signal${signals.length !== 1 ? "s" : ""} active.`,
    ACTION_DESCRIPTIONS[recommendedAction] ?? "Review recommended.",
  );

  if (signals.includes("manual_review_required")) {
    parts.push("Immediate operator attention is required.");
  }

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantLifecycleEvaluationProfile  (main entry point)
// ─────────────────────────────────────────────────────────────────────────────

export function deriveTenantLifecycleEvaluationProfile(
  input: TenantLifecycleEvaluationInput,
  now?: Date,
): TenantLifecycleEvaluationProfile {
  const evaluatedAt = (now ?? new Date()).toISOString();

  const signals           = deriveLifecycleEvaluationSignals(input);
  const severity          = deriveEvaluationSeverity(signals);
  const recommendedAction = deriveEvaluationRecommendedAction(signals, severity);
  const reviewEligibility = deriveReviewEligibility(signals, severity);
  const warnings          = buildEvaluationWarnings(signals, severity);
  const summary           = buildEvaluationSummary(signals, severity, recommendedAction);

  return {
    tenantId:    input.tenantId,
    workspaceId: input.workspaceId,
    signals,
    severity,
    recommendedAction,
    reviewEligibility,
    warnings,
    summary,
    evaluatedAt,
    safetyNotice:
      "Evaluation is advisory only. No automated lifecycle action is performed. " +
      "All recommendations require explicit super-admin review and manual action.",
  };
}
