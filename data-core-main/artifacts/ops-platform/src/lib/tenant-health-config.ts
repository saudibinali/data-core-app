/**
 * @file   lib/tenant-health-config.ts
 * @phase  P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * Frontend configuration for Tenant Health panels.
 * Provides display labels, badge classes, and safety contracts for all
 * health status, risk level, signal, and action codes.
 *
 * SAFETY CONTRACT:
 *   - All exports are read-only constants.
 *   - No API mutation hooks are defined here.
 *   - No payment, billing, suspension, enforcement, or legal wording.
 *   - Super-admin only - informational visibility layer.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrored from backend tenant-health-intelligence.ts)
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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

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
// Health Status Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_STATUS_CONFIG: Record<
  TenantHealthStatus,
  { label: string; description: string; badgeClass: string }
> = {
  healthy:    { label: "Healthy",    description: "Tenant is in a healthy operational state.",                     badgeClass: "bg-green-100 text-green-800 border-green-200" },
  attention:  { label: "Attention",  description: "Tenant has signals that require monitoring.",                   badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  degraded:   { label: "Degraded",   description: "Tenant shows degraded health - action is recommended.",        badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  restricted: { label: "Restricted", description: "Tenant has critical issues limiting normal operation.",         badgeClass: "bg-red-100 text-red-800 border-red-200" },
  suspended:  { label: "Suspended",  description: "Tenant workspace is suspended.",                               badgeClass: "bg-red-200 text-red-900 border-red-300" },
  archived:   { label: "Archived",   description: "Tenant workspace is archived and no longer active.",           badgeClass: "bg-gray-200 text-gray-700 border-gray-300" },
  unknown:    { label: "Unknown",    description: "Health status cannot be determined due to missing data.",       badgeClass: "bg-gray-100 text-gray-500 border-gray-200" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Health Risk Level Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_RISK_CONFIG: Record<
  TenantHealthRiskLevel,
  { label: string; description: string; badgeClass: string }
> = {
  none:     { label: "None",     description: "No risk signals detected.",                        badgeClass: "bg-green-50 text-green-700 border-green-200" },
  low:      { label: "Low",      description: "Minor signals present - monitoring recommended.",   badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  medium:   { label: "Medium",   description: "Moderate risk signals - review recommended.",       badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  high:     { label: "High",     description: "High risk signals - prompt action recommended.",    badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  critical: { label: "Critical", description: "Critical risk - immediate review required.",        badgeClass: "bg-red-100 text-red-800 border-red-200" },
  unknown:  { label: "Unknown",  description: "Risk level cannot be determined.",                  badgeClass: "bg-gray-100 text-gray-500 border-gray-200" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Signal Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_SIGNAL_CONFIG: Record<
  TenantHealthSignalCode,
  { label: string; description: string; severity: "info" | "warning" | "critical"; badgeClass: string }
> = {
  workspace_active:               { label: "Active",                      description: "Workspace is active and operational.",                        severity: "info",     badgeClass: "bg-green-100 text-green-800 border-green-200" },
  workspace_suspended:            { label: "Suspended",                   description: "Workspace has been suspended.",                               severity: "critical", badgeClass: "bg-red-200 text-red-900 border-red-300" },
  workspace_locked:               { label: "Locked",                      description: "Workspace is locked.",                                        severity: "critical", badgeClass: "bg-red-100 text-red-800 border-red-200" },
  workspace_archived:             { label: "Archived",                    description: "Workspace is archived and no longer active.",                 severity: "critical", badgeClass: "bg-gray-200 text-gray-700 border-gray-300" },
  subscription_unknown:           { label: "Subscription Unknown",        description: "Subscription status cannot be determined.",                   severity: "warning",  badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  subscription_active:            { label: "Subscription Active",         description: "Subscription is active.",                                     severity: "info",     badgeClass: "bg-green-100 text-green-800 border-green-200" },
  renewal_attention:              { label: "Renewal Attention",           description: "Subscription renewal requires attention.",                    severity: "warning",  badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  renewal_high_risk:              { label: "Renewal High Risk",           description: "Subscription renewal is at high risk.",                       severity: "critical", badgeClass: "bg-red-100 text-red-800 border-red-200" },
  grace_expired:                  { label: "Grace Expired",               description: "Subscription grace period has expired.",                      severity: "critical", badgeClass: "bg-red-200 text-red-900 border-red-300" },
  usage_normal:                   { label: "Usage Normal",                description: "All usage metrics are within normal limits.",                 severity: "info",     badgeClass: "bg-green-100 text-green-800 border-green-200" },
  usage_approaching_limit:        { label: "Usage Approaching Limit",     description: "One or more usage metrics are approaching their limit.",       severity: "warning",  badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  usage_exceeded_limit:           { label: "Usage Exceeded",              description: "One or more usage limits have been exceeded.",                 severity: "critical", badgeClass: "bg-red-100 text-red-800 border-red-200" },
  usage_unknown:                  { label: "Usage Unknown",               description: "Usage data is unavailable for one or more metrics.",           severity: "warning",  badgeClass: "bg-gray-100 text-gray-500 border-gray-200" },
  entitlement_overrides_present:  { label: "Entitlement Overrides",       description: "Custom entitlement overrides are active for this tenant.",    severity: "info",     badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  custom_plan:                    { label: "Custom Plan",                  description: "Tenant is on a custom plan configuration.",                    severity: "info",     badgeClass: "bg-purple-100 text-purple-800 border-purple-200" },
  operational_data_missing:       { label: "Data Missing",                description: "Operational data is incomplete for this tenant.",              severity: "warning",  badgeClass: "bg-gray-100 text-gray-500 border-gray-200" },
  governance_warning_present:     { label: "Governance Warning",          description: "Governance warnings are present - internal review recommended.", severity: "warning", badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  lifecycle_manual_review_required: { label: "Manual Review Required",   description: "Tenant lifecycle state requires manual internal review.",      severity: "warning",  badgeClass: "bg-amber-100 text-amber-800 border-amber-200" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Action Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_ACTION_CONFIG: Record<
  RecommendedTenantHealthAction,
  { label: string; description: string; badgeClass: string }
> = {
  none:                    { label: "None",                    description: "No action required - tenant is in good standing.",                    badgeClass: "bg-green-50 text-green-700 border-green-200" },
  monitor:                 { label: "Monitor",                 description: "Continue monitoring this tenant - no immediate action needed.",       badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  review_subscription:     { label: "Review Subscription",     description: "Subscription state should be reviewed internally.",                   badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  review_usage:            { label: "Review Usage",            description: "Usage capacity should be reviewed - tenant may be near limits.",      badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  review_entitlements:     { label: "Review Entitlements",     description: "Custom entitlement overrides are active - review for accuracy.",     badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  review_lifecycle:        { label: "Review Lifecycle",        description: "Workspace lifecycle state requires internal review.",                  badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  contact_customer:        { label: "Contact Customer",        description: "Internal suggestion to contact this tenant's account representative.", badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  prepare_restriction_review: { label: "Prepare Review",      description: "Prepare an internal review related to tenant restrictions.",           badgeClass: "bg-red-100 text-red-800 border-red-200" },
  manual_review_required:  { label: "Manual Review Required",  description: "Manual internal review is required for this tenant.",                 badgeClass: "bg-red-200 text-red-900 border-red-300" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TENANT_HEALTH_SAFETY_CONTRACT - all properties must remain true.
 * A runtime guard in the UI throws if any property is ever false.
 * Ensures tenant health panels can never perform destructive or billing actions.
 */
export const TENANT_HEALTH_SAFETY_CONTRACT = {
  superAdminOnly:              true,
  readOnly:                    true,
  noPaymentProcessing:         true,
  noInvoiceGeneration:         true,
  noChargeCollection:          true,
  noAutoWorkspaceSuspension:   true,
  noWorkspaceLocking:          true,
  noEntitlementEnforcement:    true,
  noEmailOrLegalNotices:       true,
  recommendationsOnly:         true,
  noDestructiveTenantActions:  true,
  failsClosedOnMissingData:    true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty / loading states
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_EMPTY_STATE = {
  noData:       "Tenant health data is not available.",
  loading:      "Loading tenant health intelligence...",
  noSignals:    "No health signals detected.",
  noWarnings:   "No operational warnings.",
  safetyNotice: "Informational view only. No automatic actions are taken by this panel.",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Read hook registry (no mutation hooks)
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_READ_HOOK_NAMES = [
  "useTenantHealth",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// API path builders
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_HEALTH_API_PATHS = {
  get: (tenantId: string) => `/api/platform/tenants/${tenantId}/health`,
} as const;
