/**
 * @file   lib/tenant-registry.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *         P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *         P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * Pure functions for building PlatformTenantProfile from raw workspace + user data.
 * No DB, no HTTP - fully testable in isolation.
 *
 * SAFETY CONTRACT:
 *   - All functions are read-only - no DB writes, no mutations.
 *   - No payment, billing, invoicing, or suspension logic.
 *   - Risk signals are informational only - no enforcement actions.
 *   - Subscription fields are populated from tenant_subscriptions when provided.
 */

import {
  deriveSubscriptionStatus,
  isRenewalApproaching,
  isGracePeriodActive,
  isSubscriptionExpired,
  PLAN_CODE_MAP,
  ALL_PLAN_CODES,
  type SubscriptionFields,
} from "./subscription-lifecycle";
import {
  deriveRenewalSignals,
  deriveRenewalUrgency,
  deriveRecommendedPlatformAction,
  type RenewalSignalCode,
} from "./subscription-renewal-intelligence";
import { getModulesForPlan, PLAN_ENTITLEMENT_MAP } from "./plan-entitlements";
import {
  deriveTenantHealthSignals,
  deriveTenantHealthRiskLevel,
  deriveTenantHealthStatus,
  deriveRecommendedTenantHealthAction,
  type TenantHealthInput,
} from "./tenant-health-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Status Types
// ─────────────────────────────────────────────────────────────────────────────

export type TenantStatus =
  | "provisioning"
  | "active"
  | "trial"
  | "grace_period"
  | "suspended"
  | "archived"
  | "locked"
  | "pending_activation";

export type WorkspaceOperationalStatus =
  | "healthy"
  | "attention"
  | "degraded"
  | "restricted"
  | "suspended"
  | "archived"
  | "unknown";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "renewal_due"
  | "grace_period"
  | "expired"
  | "suspended"
  | "cancelled"
  | "unknown";

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical" | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// Summary Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantRiskSignalSummary {
  renewalApproaching:       boolean;
  subscriptionExpired:      boolean;
  gracePeriodActive:        boolean;
  usageLimitApproaching:    boolean;
  usageLimitExceeded:       boolean;
  governanceWarnings:       boolean;
  operationalWarnings:      boolean;
  riskLevel:                RiskLevel;
  // P13-F renewal intelligence signals
  renewalDueSoon:           boolean;
  renewalDueNow:            boolean;
  trialEndingSoon:          boolean;
  graceEndingSoon:          boolean;
  graceExpired:             boolean;
  renewalUrgency:           string;
  recommendedPlatformAction: string;
  // P13-G tenant health summary
  healthStatus:              string;
  healthRiskLevel:           string;
  healthRecommendedAction:   string;
  healthWarningCount:        number;
  operationalWarningCount:   number;
  // P13-I lifecycle evaluation summary
  lifecycleEvaluationSeverity:          string;
  lifecycleEvaluationRecommendedAction: string;
  manualReviewRequired:                 boolean;
  suspensionReviewEligible:             boolean;
  renewalReviewEligible:                boolean;
  usageReviewEligible:                  boolean;
  entitlementReviewEligible:            boolean;
  lifecycleReviewEligible:              boolean;
  governanceReviewEligible:             boolean;
}

export interface TenantPlanSummary {
  planCode:                string | null;
  planName:                string | null;
  planTier:                string | null;
  seatLimit:               number | null;
  storageLimit:            number | null;
  enabledModules:          string[];
  disabledModules:         string[];
  restrictedModules:       string[];
  customEntitlementsCount: number;
}

export interface TenantUsageSummary {
  activeUsers:        number;
  seatLimit:          number | null;
  storageUsed:        number | null;
  storageLimit:       number | null;
  monthlyApiUsage:    number | null;
  apiLimit:           number | null;
  documentsUsed:      number | null;
  documentsLimit:     number | null;
  lastCalculatedAt:   string;
  usageWarningCount:  number;
  usageExceededCount: number;
  capacityRiskLevel:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformTenantProfile {
  tenantId:              string;
  workspaceId:           number;
  workspaceName:         string;
  tenantDisplayName:     string;
  primaryOwnerUserId:    number | null;
  primaryOwnerEmail:     string | null;
  primaryOwnerFullName:  string | null;
  tenantStatus:          TenantStatus;
  workspaceStatus:       string;
  planCode:              string | null;
  planName:              string | null;
  planTier:              string | null;
  subscriptionStatus:    SubscriptionStatus;
  billingPeriodStart:    string | null;
  billingPeriodEnd:      string | null;
  renewalDueAt:          string | null;
  trialEndsAt:           string | null;
  gracePeriodEndsAt:     string | null;
  region:                string | null;
  dataResidency:         string | null;
  createdAt:             string;
  updatedAt:             string;
  lastActivityAt:        string | null;
  riskSignalSummary:     TenantRiskSignalSummary;
  moduleSummary:         TenantPlanSummary;
  usageSummary:          TenantUsageSummary;
  userCount:             number;
  ticketCount:           number;
  departmentCount:       number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw Row Types (as returned from DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawWorkspaceRow {
  id:              number;
  name:            string;
  slug:            string;
  status:          string;
  logoUrl:         string | null;
  primaryColor:    string | null;
  createdAt:       Date | string;
  updatedAt:       Date | string;
  userCount:       number;
  ticketCount:     number;
  departmentCount: number;
}

export interface RawOwnerRow {
  id:       number;
  email:    string | null;
  fullName: string;
}

/**
 * Raw subscription row as returned from the DB.
 * All date fields are Date objects (from Drizzle) or null.
 * Mirrors tenant_subscriptions table columns.
 */
export interface RawSubscriptionRow {
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
// Derivation Functions
// ─────────────────────────────────────────────────────────────────────────────

export function deriveTenantStatus(workspaceStatus: string): TenantStatus {
  switch (workspaceStatus) {
    case "active":    return "active";
    case "suspended": return "suspended";
    case "locked":    return "locked";
    case "disabled":  return "archived";
    default:          return "pending_activation";
  }
}

export function deriveWorkspaceOperationalStatus(
  workspaceStatus: string,
  userCount:        number,
): WorkspaceOperationalStatus {
  if (workspaceStatus === "suspended") return "suspended";
  if (workspaceStatus === "disabled")  return "archived";
  if (userCount === 0)                 return "attention";
  return "healthy";
}

export function deriveRiskSignalSummary(
  workspaceStatus: string,
  userCount:        number,
  subscription?:    RawSubscriptionRow | null,
  now?:             Date,
  usageSignals?:    { usageLimitApproaching: boolean; usageLimitExceeded: boolean },
): TenantRiskSignalSummary {
  const isSuspended = workspaceStatus === "suspended";
  const isDisabled  = workspaceStatus === "disabled";
  const isEmpty     = userCount === 0;

  const effectiveNow = now ?? new Date();

  const subFields: Partial<SubscriptionFields> | null = subscription
    ? {
        planCode:             subscription.planCode,
        subscriptionStatus:   subscription.subscriptionStatus,
        billingPeriodStart:   subscription.billingPeriodStart,
        billingPeriodEnd:     subscription.billingPeriodEnd,
        renewalDueAt:         subscription.renewalDueAt,
        trialStartedAt:       subscription.trialStartedAt,
        trialEndsAt:          subscription.trialEndsAt,
        gracePeriodStartedAt: subscription.gracePeriodStartedAt,
        gracePeriodEndsAt:    subscription.gracePeriodEndsAt,
        cancelledAt:          subscription.cancelledAt,
        suspendedAt:          subscription.suspendedAt,
      }
    : null;

  const renewalApproaching    = isRenewalApproaching(subFields, effectiveNow);
  const gracePeriodActive     = isGracePeriodActive(subFields, effectiveNow);
  const subscriptionExpired   = subscription
    ? isSubscriptionExpired(subFields, effectiveNow)
    : isDisabled;
  const usageLimitApproaching = usageSignals?.usageLimitApproaching ?? false;
  const usageLimitExceeded    = usageSignals?.usageLimitExceeded    ?? false;

  // P13-F - derive renewal signals
  const renewalSignals: RenewalSignalCode[] = subFields
    ? deriveRenewalSignals(subFields, effectiveNow)
    : [];
  const renewalUrgencyValue    = deriveRenewalUrgency(renewalSignals);
  const recommendedActionValue = deriveRecommendedPlatformAction(renewalSignals, renewalUrgencyValue);

  const renewalDueSoon   = renewalSignals.includes("renewal_due_soon");
  const renewalDueNow    = renewalSignals.includes("renewal_due_now");
  const trialEndingSoon  = renewalSignals.includes("trial_ending_soon");
  const graceEndingSoon  = renewalSignals.includes("grace_period_ending_soon");
  const graceExpired     = renewalSignals.includes("grace_period_expired");

  // riskLevel: starts from existing signals, then incorporate renewal urgency without downgrading
  let riskLevel: RiskLevel = "none";
  if (isDisabled)             riskLevel = "critical";
  else if (isSuspended)       riskLevel = "high";
  else if (subscriptionExpired || gracePeriodActive || usageLimitExceeded) riskLevel = "medium";
  else if (renewalApproaching || isEmpty || usageLimitApproaching)         riskLevel = "low";

  // Incorporate renewalUrgency - only elevate, never downgrade
  const urgencyToRiskLevel: Record<string, RiskLevel> = {
    critical: "critical",
    high:     "high",
    medium:   "medium",
    low:      "low",
    none:     "none",
    unknown:  "unknown",
  };
  const urgencyAsRisk = urgencyToRiskLevel[renewalUrgencyValue] ?? "none";
  const riskLevelOrder: Record<RiskLevel, number> = {
    none: 0, unknown: 0, low: 1, medium: 2, high: 3, critical: 4,
  };
  if ((riskLevelOrder[urgencyAsRisk] ?? 0) > (riskLevelOrder[riskLevel] ?? 0)) {
    riskLevel = urgencyAsRisk;
  }

  // P13-G - Derive tenant health summary from available signals
  const subStatusStr: string = isDisabled
    ? "archived"
    : isSuspended
    ? "suspended"
    : graceExpired || subscriptionExpired
    ? "expired"
    : gracePeriodActive
    ? "grace_period"
    : renewalApproaching
    ? "renewal_due"
    : subscription
    ? "active"
    : "unknown";

  const healthInput: TenantHealthInput = {
    tenantId:            "registry",   // placeholder - registry summary, not per-request
    workspaceId:         0,
    workspaceStatus:     workspaceStatus,
    subscriptionStatus:  subStatusStr,
    renewal: {
      urgency:  renewalUrgencyValue,
      signals:  renewalSignals as string[],
      warnings: [],
    },
    usage: {
      capacityRiskLevel: usageLimitExceeded ? "high" : usageLimitApproaching ? "medium" : "none",
      warningCount:      usageLimitApproaching ? 1 : 0,
      exceededCount:     usageLimitExceeded   ? 1 : 0,
      unknownCount:      0,
    },
    entitlements: {
      customEntitlementsCount: 0,
      planCode:                subscription?.planCode ?? null,
    },
    governance: {
      hasWarnings: isSuspended,
    },
  };

  const healthSignals        = deriveTenantHealthSignals(healthInput);
  const healthRiskLevelValue = deriveTenantHealthRiskLevel(healthSignals, healthInput);
  const healthStatusValue    = deriveTenantHealthStatus(healthInput, healthRiskLevelValue);
  const healthActionValue    = deriveRecommendedTenantHealthAction(healthSignals, healthRiskLevelValue);

  // Operational warnings: count of warning-bearing signals
  const HEALTH_WARNING_SIGNALS = [
    "workspace_suspended", "workspace_locked", "workspace_archived",
    "grace_expired", "renewal_high_risk", "usage_exceeded_limit",
    "usage_approaching_limit", "subscription_unknown", "operational_data_missing",
    "governance_warning_present", "renewal_attention",
  ];
  const healthWarningCount    = healthSignals.filter(s => HEALTH_WARNING_SIGNALS.includes(s)).length;
  const operationalWarningCount = healthWarningCount;

  // P13-I - Lifecycle Evaluation Summary (derived inline from existing signals)
  const evalManualRequired = isDisabled || (isSuspended && graceExpired);
  const evalSuspensionEligible = isSuspended || graceExpired || subscriptionExpired;
  const evalRenewalEligible    = renewalDueSoon || renewalDueNow || subscriptionExpired || gracePeriodActive;
  const evalUsageEligible      = usageLimitApproaching || usageLimitExceeded;
  const evalLifecycleEligible  = isSuspended;
  const evalGovernanceEligible = isSuspended;

  type EvalSev = "none" | "info" | "low" | "medium" | "high" | "critical" | "unknown";
  let evalSeverity: EvalSev = "none";
  if (evalManualRequired || isDisabled)                             evalSeverity = "critical";
  else if (graceExpired || subscriptionExpired || usageLimitExceeded || isSuspended) evalSeverity = "high";
  else if (renewalDueSoon || renewalDueNow || gracePeriodActive || usageLimitApproaching) evalSeverity = "medium";
  else if (trialEndingSoon || renewalApproaching)                  evalSeverity = "low";
  else if (!subscription)                                          evalSeverity = "info";

  type EvalAction = "none" | "monitor" | "review_subscription" | "review_usage" | "review_lifecycle" |
    "review_governance" | "prepare_restriction_review" | "manual_review_required";
  let evalRecommendedAction: EvalAction = "none";
  if (evalManualRequired || isDisabled)                       evalRecommendedAction = "manual_review_required";
  else if (graceExpired || (subscriptionExpired && isSuspended)) evalRecommendedAction = "prepare_restriction_review";
  else if (isSuspended)                                       evalRecommendedAction = "review_lifecycle";
  else if (renewalDueSoon || renewalDueNow || gracePeriodActive || subscriptionExpired) evalRecommendedAction = "review_subscription";
  else if (usageLimitExceeded || usageLimitApproaching)       evalRecommendedAction = "review_usage";
  else if (trialEndingSoon || renewalApproaching)             evalRecommendedAction = "monitor";

  return {
    renewalApproaching,
    subscriptionExpired,
    gracePeriodActive,
    usageLimitApproaching,
    usageLimitExceeded,
    governanceWarnings:        isSuspended,
    operationalWarnings:       isEmpty,
    riskLevel,
    renewalDueSoon,
    renewalDueNow,
    trialEndingSoon,
    graceEndingSoon,
    graceExpired,
    renewalUrgency:            renewalUrgencyValue,
    recommendedPlatformAction: recommendedActionValue,
    healthStatus:              healthStatusValue,
    healthRiskLevel:           healthRiskLevelValue,
    healthRecommendedAction:   healthActionValue,
    healthWarningCount,
    operationalWarningCount,
    lifecycleEvaluationSeverity:          evalSeverity,
    lifecycleEvaluationRecommendedAction: evalRecommendedAction,
    manualReviewRequired:                 evalManualRequired,
    suspensionReviewEligible:             evalSuspensionEligible,
    renewalReviewEligible:                evalRenewalEligible,
    usageReviewEligible:                  evalUsageEligible,
    entitlementReviewEligible:            false,
    lifecycleReviewEligible:              evalLifecycleEligible,
    governanceReviewEligible:             evalGovernanceEligible,
  };
}

export function buildDefaultModuleSummary(
  planCode?: string | null,
  customEntitlementsCount?: number,
): TenantPlanSummary {
  const knownPlan = planCode && ALL_PLAN_CODES.includes(planCode as never)
    ? PLAN_CODE_MAP[planCode as keyof typeof PLAN_CODE_MAP]
    : null;

  const { enabled, disabled } = getModulesForPlan(planCode ?? null);

  const planDef      = planCode ? PLAN_ENTITLEMENT_MAP[planCode] : null;
  const seatLimit    = planDef?.defaultLimits.seats       ?? null;
  const storageLimit = planDef?.defaultLimits.storage_gb  ?? null;

  return {
    planCode:                planCode ?? null,
    planName:                knownPlan?.name ?? null,
    planTier:                knownPlan?.tier ?? null,
    seatLimit,
    storageLimit,
    enabledModules:          enabled,
    disabledModules:         disabled,
    restrictedModules:       [],
    customEntitlementsCount: customEntitlementsCount ?? 0,
  };
}

export function buildUsageSummary(
  userCount: number,
  now:       Date,
  opts?: {
    seatLimit?:          number | null;
    storageLimit?:       number | null;
    apiLimit?:           number | null;
    documentsLimit?:     number | null;
    usageWarningCount?:  number;
    usageExceededCount?: number;
    capacityRiskLevel?:  string;
  },
): TenantUsageSummary {
  return {
    activeUsers:        userCount,
    seatLimit:          opts?.seatLimit         ?? null,
    storageUsed:        null,
    storageLimit:       opts?.storageLimit      ?? null,
    monthlyApiUsage:    null,
    apiLimit:           opts?.apiLimit          ?? null,
    documentsUsed:      null,
    documentsLimit:     opts?.documentsLimit    ?? null,
    lastCalculatedAt:   now.toISOString(),
    usageWarningCount:  opts?.usageWarningCount  ?? 0,
    usageExceededCount: opts?.usageExceededCount ?? 0,
    capacityRiskLevel:  opts?.capacityRiskLevel  ?? "unknown",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildTenantProfile(
  workspace:    RawWorkspaceRow,
  owner:        RawOwnerRow | null,
  now:          Date,
  subscription?: RawSubscriptionRow | null,
): PlatformTenantProfile {
  const tenantStatus = deriveTenantStatus(workspace.status);

  // Build subscription fields - derive status from date math when subscription exists
  let planCode:           string | null        = null;
  let planName:           string | null        = null;
  let planTier:           string | null        = null;
  let subscriptionStatus: SubscriptionStatus   = "unknown";
  let billingPeriodStart: string | null        = null;
  let billingPeriodEnd:   string | null        = null;
  let renewalDueAt:       string | null        = null;
  let trialEndsAt:        string | null        = null;
  let gracePeriodEndsAt:  string | null        = null;

  if (subscription) {
    const subFields: Partial<SubscriptionFields> = {
      planCode:             subscription.planCode,
      subscriptionStatus:   subscription.subscriptionStatus,
      billingPeriodStart:   subscription.billingPeriodStart,
      billingPeriodEnd:     subscription.billingPeriodEnd,
      renewalDueAt:         subscription.renewalDueAt,
      trialStartedAt:       subscription.trialStartedAt,
      trialEndsAt:          subscription.trialEndsAt,
      gracePeriodStartedAt: subscription.gracePeriodStartedAt,
      gracePeriodEndsAt:    subscription.gracePeriodEndsAt,
      cancelledAt:          subscription.cancelledAt,
      suspendedAt:          subscription.suspendedAt,
    };

    subscriptionStatus = deriveSubscriptionStatus(subFields, now);
    planCode           = subscription.planCode;

    const knownPlan = planCode && ALL_PLAN_CODES.includes(planCode as never)
      ? PLAN_CODE_MAP[planCode as keyof typeof PLAN_CODE_MAP]
      : null;
    planName = knownPlan?.name ?? null;
    planTier = knownPlan?.tier ?? null;

    billingPeriodStart = subscription.billingPeriodStart?.toISOString() ?? null;
    billingPeriodEnd   = subscription.billingPeriodEnd?.toISOString()   ?? null;
    renewalDueAt       = subscription.renewalDueAt?.toISOString()       ?? null;
    trialEndsAt        = subscription.trialEndsAt?.toISOString()        ?? null;
    gracePeriodEndsAt  = subscription.gracePeriodEndsAt?.toISOString()  ?? null;
  }

  const riskSignal    = deriveRiskSignalSummary(workspace.status, workspace.userCount, subscription ?? null, now);
  const moduleSummary = buildDefaultModuleSummary(planCode);
  const usageSummary  = buildUsageSummary(workspace.userCount, now);

  const createdAt = workspace.createdAt instanceof Date
    ? workspace.createdAt.toISOString()
    : String(workspace.createdAt);
  const updatedAt = workspace.updatedAt instanceof Date
    ? workspace.updatedAt.toISOString()
    : String(workspace.updatedAt);

  return {
    tenantId:             String(workspace.id),
    workspaceId:          workspace.id,
    workspaceName:        workspace.name,
    tenantDisplayName:    workspace.name,
    primaryOwnerUserId:   owner?.id       ?? null,
    primaryOwnerEmail:    owner?.email    ?? null,
    primaryOwnerFullName: owner?.fullName ?? null,
    tenantStatus,
    workspaceStatus:      workspace.status,
    planCode,
    planName,
    planTier,
    subscriptionStatus,
    billingPeriodStart,
    billingPeriodEnd,
    renewalDueAt,
    trialEndsAt,
    gracePeriodEndsAt,
    region:               null,
    dataResidency:        null,
    createdAt,
    updatedAt,
    lastActivityAt:       updatedAt,
    riskSignalSummary:    riskSignal,
    moduleSummary,
    usageSummary,
    userCount:            workspace.userCount,
    ticketCount:          workspace.ticketCount,
    departmentCount:      workspace.departmentCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter & Sort
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantFilterOptions {
  status?:             string;
  subscriptionStatus?: string;
  riskLevel?:          string;
  search?:             string;
}

export function applyTenantFilters(
  profiles: PlatformTenantProfile[],
  filters:  TenantFilterOptions,
): PlatformTenantProfile[] {
  let result = profiles;

  if (filters.status) {
    result = result.filter(p => p.tenantStatus === filters.status);
  }
  if (filters.subscriptionStatus) {
    result = result.filter(p => p.subscriptionStatus === filters.subscriptionStatus);
  }
  if (filters.riskLevel) {
    result = result.filter(p => p.riskSignalSummary.riskLevel === filters.riskLevel);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(p =>
      p.workspaceName.toLowerCase().includes(q) ||
      p.tenantDisplayName.toLowerCase().includes(q) ||
      (p.primaryOwnerEmail   ?? "").toLowerCase().includes(q) ||
      (p.primaryOwnerFullName ?? "").toLowerCase().includes(q),
    );
  }

  return result;
}

export function sortTenantsByName(profiles: PlatformTenantProfile[]): PlatformTenantProfile[] {
  return [...profiles].sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
}
