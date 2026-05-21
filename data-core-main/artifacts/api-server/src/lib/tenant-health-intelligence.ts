/**
 * @file   lib/tenant-health-intelligence.ts
 * @phase  P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * Pure derivation library for Tenant Health profiles.
 * Aggregates lifecycle, subscription, renewal, usage, entitlement, and
 * governance signals into a single unified TenantHealthProfile.
 *
 * SAFETY CONTRACT:
 *   - All functions are pure (no DB, no HTTP, no side effects).
 *   - Read-only - no writes, no enforcement, no billing, no suspension.
 *   - Risk level only ever escalates - never downgrades.
 *   - Returns a defined "unknown" state when data is missing - never fabricates.
 *   - Super-admin visibility only; no tenant-facing exposure.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TenantHealthStatus =
  | "healthy"
  | "attention"
  | "degraded"
  | "restricted"
  | "suspended"
  | "archived"
  | "unknown";

export type TenantHealthRiskLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

export type TenantHealthSignalCode =
  | "workspace_active"
  | "workspace_suspended"
  | "workspace_locked"
  | "workspace_archived"
  | "subscription_unknown"
  | "subscription_active"
  | "renewal_attention"
  | "renewal_high_risk"
  | "grace_expired"
  | "usage_normal"
  | "usage_approaching_limit"
  | "usage_exceeded_limit"
  | "usage_unknown"
  | "entitlement_overrides_present"
  | "custom_plan"
  | "operational_data_missing"
  | "governance_warning_present"
  | "lifecycle_manual_review_required";

export type RecommendedTenantHealthAction =
  | "none"
  | "monitor"
  | "review_subscription"
  | "review_usage"
  | "review_entitlements"
  | "review_lifecycle"
  | "contact_customer"
  | "prepare_restriction_review"
  | "manual_review_required";

export const ALL_TENANT_HEALTH_SIGNAL_CODES: TenantHealthSignalCode[] = [
  "workspace_active",
  "workspace_suspended",
  "workspace_locked",
  "workspace_archived",
  "subscription_unknown",
  "subscription_active",
  "renewal_attention",
  "renewal_high_risk",
  "grace_expired",
  "usage_normal",
  "usage_approaching_limit",
  "usage_exceeded_limit",
  "usage_unknown",
  "entitlement_overrides_present",
  "custom_plan",
  "operational_data_missing",
  "governance_warning_present",
  "lifecycle_manual_review_required",
];

export const ALL_RECOMMENDED_TENANT_HEALTH_ACTIONS: RecommendedTenantHealthAction[] = [
  "none",
  "monitor",
  "review_subscription",
  "review_usage",
  "review_entitlements",
  "review_lifecycle",
  "contact_customer",
  "prepare_restriction_review",
  "manual_review_required",
];

// ─────────────────────────────────────────────────────────────────────────────
// Input types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantHealthUsageInput {
  capacityRiskLevel: string;   // "none" | "low" | "medium" | "high" | "critical" | "unknown"
  warningCount:      number;
  exceededCount:     number;
  unknownCount:      number;
}

export interface TenantHealthRenewalInput {
  urgency:       string;    // RenewalUrgency
  signals:       string[];  // RenewalSignalCode[]
  warnings:      string[];
}

export interface TenantHealthEntitlementInput {
  customEntitlementsCount: number;
  planCode:                string | null;
}

export interface TenantHealthGovernanceInput {
  hasWarnings: boolean;
}

export interface TenantHealthInput {
  tenantId:            string;
  workspaceId:         number;
  workspaceStatus:     string;   // raw DB status column ("active" | "suspended" | "locked" | "disabled" | "pending_activation")
  subscriptionStatus:  string;   // from subscription-lifecycle SubscriptionStatus
  renewal:             TenantHealthRenewalInput;
  usage:               TenantHealthUsageInput;
  entitlements:        TenantHealthEntitlementInput;
  governance?:         TenantHealthGovernanceInput;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile & component types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantHealthComponentSummary {
  name:     string;
  status:   "ok" | "attention" | "warning" | "critical" | "unknown";
  note:     string;
}

export interface TenantHealthProfile {
  tenantId:          string;
  workspaceId:       number;
  healthStatus:      TenantHealthStatus;
  riskLevel:         TenantHealthRiskLevel;
  signals:           TenantHealthSignalCode[];
  recommendedAction: RecommendedTenantHealthAction;
  warnings:          string[];
  summary:           string;
  components: {
    lifecycle:     TenantHealthComponentSummary;
    subscription:  TenantHealthComponentSummary;
    renewal:       TenantHealthComponentSummary;
    usage:         TenantHealthComponentSummary;
    entitlements:  TenantHealthComponentSummary;
    governance:    TenantHealthComponentSummary;
  };
  derivedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const RISK_ORDER: Record<TenantHealthRiskLevel, number> = {
  none:     0,
  unknown:  0,
  low:      1,
  medium:   2,
  high:     3,
  critical: 4,
};

function maxRisk(a: TenantHealthRiskLevel, b: TenantHealthRiskLevel): TenantHealthRiskLevel {
  return (RISK_ORDER[a] ?? 0) >= (RISK_ORDER[b] ?? 0) ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the full set of TenantHealthSignalCodes from a TenantHealthInput.
 * Each layer contributes independently; signals from different layers can coexist.
 */
export function deriveTenantHealthSignals(
  input: TenantHealthInput,
): TenantHealthSignalCode[] {
  const signals: TenantHealthSignalCode[] = [];
  const ws = input.workspaceStatus;

  // ── Lifecycle signals ─────────────────────────────────────────────────────
  if (ws === "active")     signals.push("workspace_active");
  if (ws === "suspended")  signals.push("workspace_suspended");
  if (ws === "locked")     signals.push("workspace_locked");
  if (ws === "disabled")   signals.push("workspace_archived");
  if (ws === "pending_activation") signals.push("lifecycle_manual_review_required");

  // ── Subscription signals ──────────────────────────────────────────────────
  const subStatus = input.subscriptionStatus;
  if (subStatus === "unknown") {
    signals.push("subscription_unknown");
    signals.push("operational_data_missing");
  } else if (subStatus === "active" || subStatus === "trialing") {
    signals.push("subscription_active");
  }

  // ── Renewal signals ───────────────────────────────────────────────────────
  const { urgency: renewalUrgency, signals: renewalSignals } = input.renewal;

  const graceExpiredPresent = renewalSignals.includes("grace_period_expired");
  if (graceExpiredPresent) {
    signals.push("grace_expired");
  }

  if (renewalUrgency === "critical" || renewalUrgency === "high" || graceExpiredPresent) {
    signals.push("renewal_high_risk");
  } else if (renewalUrgency === "medium") {
    signals.push("renewal_attention");
  }

  // ── Usage signals ─────────────────────────────────────────────────────────
  const cap = input.usage.capacityRiskLevel;
  if (input.usage.exceededCount > 0) {
    signals.push("usage_exceeded_limit");
  } else if (input.usage.warningCount > 0) {
    signals.push("usage_approaching_limit");
  } else if (cap === "unknown" || input.usage.unknownCount > 0) {
    signals.push("usage_unknown");
  } else {
    signals.push("usage_normal");
  }

  // ── Entitlement signals ───────────────────────────────────────────────────
  if (input.entitlements.customEntitlementsCount > 0) {
    signals.push("entitlement_overrides_present");
  }
  if (input.entitlements.planCode === "custom") {
    signals.push("custom_plan");
  }

  // ── Governance signals ────────────────────────────────────────────────────
  if (input.governance?.hasWarnings) {
    signals.push("governance_warning_present");
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk level derivation - only escalates, never downgrades
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives TenantHealthRiskLevel from signals.
 * Risk only escalates - the highest contributing layer wins.
 */
export function deriveTenantHealthRiskLevel(
  signals: TenantHealthSignalCode[],
  input:    TenantHealthInput,
): TenantHealthRiskLevel {
  let risk: TenantHealthRiskLevel = "none";

  const has = (s: TenantHealthSignalCode) => signals.includes(s);

  // Workspace-level overrides (absolute)
  if (has("workspace_archived"))                       risk = maxRisk(risk, "critical");
  if (has("grace_expired"))                            risk = maxRisk(risk, "critical");
  if (has("workspace_suspended"))                      risk = maxRisk(risk, "high");
  if (has("workspace_locked"))                         risk = maxRisk(risk, "high");
  if (has("renewal_high_risk"))                        risk = maxRisk(risk, "high");

  // Usage-based risk
  if (has("usage_exceeded_limit")) {
    const cap = input.usage.capacityRiskLevel;
    risk = maxRisk(risk, cap === "critical" ? "critical" : "high");
  }
  if (has("usage_approaching_limit"))                  risk = maxRisk(risk, "medium");

  // Renewal
  if (has("renewal_attention"))                        risk = maxRisk(risk, "medium");

  // Subscription unknown
  if (has("subscription_unknown"))                     risk = maxRisk(risk, "medium");

  // Lifecycle pending
  if (has("lifecycle_manual_review_required"))         risk = maxRisk(risk, "medium");

  // Governance
  if (has("governance_warning_present"))               risk = maxRisk(risk, "medium");

  // Entitlement overrides - low concern, informational
  if (has("entitlement_overrides_present"))            risk = maxRisk(risk, "low");
  if (has("custom_plan"))                              risk = maxRisk(risk, "low");

  // Unknown usage - bump to at least low
  if (has("usage_unknown"))                            risk = maxRisk(risk, "low");

  return risk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health status derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps workspace state + riskLevel to an overall TenantHealthStatus.
 * Workspace state takes absolute precedence for suspended/archived.
 */
export function deriveTenantHealthStatus(
  input:     TenantHealthInput,
  riskLevel: TenantHealthRiskLevel,
): TenantHealthStatus {
  const ws = input.workspaceStatus;

  if (ws === "disabled")            return "archived";
  if (ws === "suspended")           return "suspended";
  if (ws === "locked")              return "restricted";
  if (ws === "pending_activation")  return "attention";

  switch (riskLevel) {
    case "critical": return "restricted";
    case "high":     return "degraded";
    case "medium":   return "attention";
    case "low":      return "healthy";
    case "none":     return "healthy";
    case "unknown":  return "unknown";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended action derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the most appropriate internal operational recommendation.
 * Priority order: workspace state → grace/renewal → usage → subscription → entitlements → none.
 */
export function deriveRecommendedTenantHealthAction(
  signals:   TenantHealthSignalCode[],
  riskLevel: TenantHealthRiskLevel,
): RecommendedTenantHealthAction {
  const has = (s: TenantHealthSignalCode) => signals.includes(s);

  if (has("workspace_archived"))             return "review_lifecycle";
  if (has("workspace_suspended"))            return "review_lifecycle";
  if (has("workspace_locked"))               return "review_lifecycle";
  if (has("lifecycle_manual_review_required")) return "manual_review_required";

  if (has("grace_expired"))                  return "contact_customer";
  if (has("renewal_high_risk"))              return "contact_customer";
  if (has("usage_exceeded_limit"))           return "review_usage";
  if (has("renewal_attention"))              return "review_subscription";
  if (has("subscription_unknown"))           return "review_subscription";
  if (has("usage_approaching_limit"))        return "review_usage";
  if (has("governance_warning_present"))     return "prepare_restriction_review";
  if (has("entitlement_overrides_present"))  return "review_entitlements";

  if (riskLevel === "low")                   return "monitor";

  return "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// Component summary builders
// ─────────────────────────────────────────────────────────────────────────────

function buildLifecycleComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  const ws = input.workspaceStatus;
  if (ws === "active")              return { name: "Lifecycle", status: "ok",       note: "Workspace is active." };
  if (ws === "suspended")           return { name: "Lifecycle", status: "critical",  note: "Workspace is suspended." };
  if (ws === "locked")              return { name: "Lifecycle", status: "critical",  note: "Workspace is locked." };
  if (ws === "disabled")            return { name: "Lifecycle", status: "critical",  note: "Workspace is archived." };
  if (ws === "pending_activation")  return { name: "Lifecycle", status: "warning",  note: "Workspace pending activation - review required." };
  return { name: "Lifecycle", status: "unknown", note: "Workspace status is unknown." };
}

function buildSubscriptionComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  const s = input.subscriptionStatus;
  if (s === "active")       return { name: "Subscription", status: "ok",       note: "Subscription is active." };
  if (s === "trialing")     return { name: "Subscription", status: "ok",       note: "Subscription is in trial." };
  if (s === "renewal_due")  return { name: "Subscription", status: "attention", note: "Renewal is due." };
  if (s === "grace_period") return { name: "Subscription", status: "warning",  note: "Subscription in grace period." };
  if (s === "expired")      return { name: "Subscription", status: "critical",  note: "Subscription has expired." };
  if (s === "suspended")    return { name: "Subscription", status: "critical",  note: "Subscription is suspended." };
  if (s === "cancelled")    return { name: "Subscription", status: "critical",  note: "Subscription has been cancelled." };
  return { name: "Subscription", status: "unknown", note: "Subscription status is unknown." };
}

function buildRenewalComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  const { urgency, signals } = input.renewal;
  const graceExpired = signals.includes("grace_period_expired");
  if (graceExpired)              return { name: "Renewal", status: "critical",  note: "Grace period has expired." };
  if (urgency === "critical")    return { name: "Renewal", status: "critical",  note: "Renewal urgency is critical." };
  if (urgency === "high")        return { name: "Renewal", status: "warning",  note: "Renewal urgency is high." };
  if (urgency === "medium")      return { name: "Renewal", status: "attention", note: "Renewal requires attention." };
  if (urgency === "low")         return { name: "Renewal", status: "ok",       note: "Renewal is low urgency." };
  if (urgency === "none")        return { name: "Renewal", status: "ok",       note: "No renewal urgency detected." };
  return { name: "Renewal", status: "unknown", note: "Renewal urgency is unknown." };
}

function buildUsageComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  const { capacityRiskLevel, warningCount, exceededCount } = input.usage;
  if (exceededCount > 0) {
    const note = `${exceededCount} metric${exceededCount > 1 ? "s" : ""} exceeded limit.`;
    return { name: "Usage", status: capacityRiskLevel === "critical" ? "critical" : "warning", note };
  }
  if (warningCount > 0) {
    return { name: "Usage", status: "attention", note: `${warningCount} metric${warningCount > 1 ? "s" : ""} approaching limit.` };
  }
  if (capacityRiskLevel === "unknown") return { name: "Usage", status: "unknown", note: "Usage data unavailable." };
  return { name: "Usage", status: "ok", note: "Usage is within limits." };
}

function buildEntitlementsComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  const { customEntitlementsCount, planCode } = input.entitlements;
  if (planCode === "custom") return { name: "Entitlements", status: "attention", note: "Custom plan with overrides." };
  if (customEntitlementsCount > 0) {
    return { name: "Entitlements", status: "attention", note: `${customEntitlementsCount} custom entitlement override${customEntitlementsCount > 1 ? "s" : ""} active.` };
  }
  return { name: "Entitlements", status: "ok", note: "Standard plan entitlements - no overrides." };
}

function buildGovernanceComponent(input: TenantHealthInput): TenantHealthComponentSummary {
  if (input.governance?.hasWarnings) {
    return { name: "Governance", status: "warning", note: "Governance warnings present." };
  }
  return { name: "Governance", status: "ok", note: "No governance warnings." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Warning builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a list of human-readable operational warning messages from a TenantHealthProfile.
 * Returns empty array when everything is healthy.
 */
export function buildTenantHealthWarnings(profile: TenantHealthProfile): string[] {
  const warnings: string[] = [];
  const has = (s: TenantHealthSignalCode) => profile.signals.includes(s);

  if (has("workspace_archived"))             warnings.push("Workspace is archived.");
  if (has("workspace_suspended"))            warnings.push("Workspace is suspended.");
  if (has("workspace_locked"))               warnings.push("Workspace is locked.");
  if (has("lifecycle_manual_review_required")) warnings.push("Workspace requires manual lifecycle review.");
  if (has("grace_expired"))                  warnings.push("Subscription grace period has expired.");
  if (has("renewal_high_risk"))              warnings.push("Subscription renewal is at high risk - customer contact recommended.");
  if (has("usage_exceeded_limit"))           warnings.push("One or more usage limits have been exceeded.");
  if (has("usage_approaching_limit"))        warnings.push("One or more usage limits are approaching capacity.");
  if (has("subscription_unknown"))           warnings.push("Subscription status is unknown - operational data may be missing.");
  if (has("operational_data_missing"))       warnings.push("Operational data is incomplete for this tenant.");
  if (has("governance_warning_present"))     warnings.push("Governance warnings are present - review recommended.");
  if (has("renewal_attention"))              warnings.push("Subscription renewal requires attention.");

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary text builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a concise human-readable summary of the overall tenant health status.
 */
export function buildTenantHealthSummary(profile: TenantHealthProfile): string {
  const { healthStatus, riskLevel, signals, recommendedAction } = profile;
  const has = (s: TenantHealthSignalCode) => signals.includes(s);

  if (healthStatus === "archived")    return "This tenant workspace is archived and no longer active.";
  if (healthStatus === "suspended")   return "This tenant workspace is suspended - service is restricted.";
  if (healthStatus === "restricted")  return "This tenant has critical issues that require immediate review.";
  if (healthStatus === "degraded")    return "This tenant shows degraded health signals - action is recommended.";

  if (riskLevel === "none" && has("workspace_active")) {
    return "Tenant is in a healthy operational state with no outstanding signals.";
  }

  const parts: string[] = [];
  if (has("renewal_attention") || has("renewal_high_risk")) {
    parts.push("renewal risk present");
  }
  if (has("usage_exceeded_limit") || has("usage_approaching_limit")) {
    parts.push("usage capacity concern");
  }
  if (has("subscription_unknown")) {
    parts.push("subscription status unknown");
  }
  if (has("entitlement_overrides_present")) {
    parts.push("entitlement overrides active");
  }

  if (parts.length > 0) {
    return `Tenant health requires attention: ${parts.join(", ")}. Recommended action: ${recommendedAction.replace(/_/g, " ")}.`;
  }

  return "Tenant health status: " + healthStatus + ".";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main derivation entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the full TenantHealthProfile from a TenantHealthInput.
 * This is the primary entry point for P13-G - call once per request.
 *
 * @param input  All intelligence layer inputs aggregated by the route handler.
 * @param now    Optional - defaults to new Date() for deterministic tests.
 */
export function deriveTenantHealthProfile(
  input: TenantHealthInput,
  now?:  Date,
): TenantHealthProfile {
  const derivedAt = (now ?? new Date()).toISOString();

  const signals           = deriveTenantHealthSignals(input);
  const riskLevel         = deriveTenantHealthRiskLevel(signals, input);
  const healthStatus      = deriveTenantHealthStatus(input, riskLevel);
  const recommendedAction = deriveRecommendedTenantHealthAction(signals, riskLevel);

  const components = {
    lifecycle:    buildLifecycleComponent(input),
    subscription: buildSubscriptionComponent(input),
    renewal:      buildRenewalComponent(input),
    usage:        buildUsageComponent(input),
    entitlements: buildEntitlementsComponent(input),
    governance:   buildGovernanceComponent(input),
  };

  const partialProfile: TenantHealthProfile = {
    tenantId:          input.tenantId,
    workspaceId:       input.workspaceId,
    healthStatus,
    riskLevel,
    signals,
    recommendedAction,
    warnings:          [],   // filled below
    summary:           "",   // filled below
    components,
    derivedAt,
  };

  partialProfile.warnings = buildTenantHealthWarnings(partialProfile);
  partialProfile.summary  = buildTenantHealthSummary(partialProfile);

  return partialProfile;
}
