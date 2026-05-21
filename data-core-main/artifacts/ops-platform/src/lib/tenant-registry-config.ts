/**
 * @file   lib/tenant-registry-config.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *
 * Static maps, configs, safety contracts, and filter options for the
 * Platform Tenant Registry console.
 *
 * SAFETY CONTRACT:
 *   - All maps are declared "as const" - TypeScript-enforced immutability.
 *   - No map entry contains mutation, suspension, deletion, billing, or
 *     payment wording.
 *   - All status labels are informational only - no enforcement actions.
 *   - All safety contract properties are true and tested in tenant-registry.test.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TenantStatus Map  (8 statuses)
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_STATUS_MAP = {
  provisioning: {
    label:       "Provisioning",
    order:       0,
    tier:        "muted",
    description: "Workspace is being set up. Not yet accessible.",
    badgeClass:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  pending_activation: {
    label:       "Pending Activation",
    order:       1,
    tier:        "attention",
    description: "Workspace exists but has not been activated yet.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  trial: {
    label:       "Trial",
    order:       2,
    tier:        "neutral",
    description: "Workspace is in a trial period.",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  active: {
    label:       "Active",
    order:       3,
    tier:        "good",
    description: "Workspace is fully operational.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  grace_period: {
    label:       "Grace Period",
    order:       4,
    tier:        "attention",
    description: "Workspace is in a grace period. Access may be restricted soon.",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  locked: {
    label:       "Locked",
    order:       5,
    tier:        "critical",
    description: "Workspace is locked pending administrative review.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  suspended: {
    label:       "Suspended",
    order:       6,
    tier:        "critical",
    description: "Workspace access is currently suspended.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  archived: {
    label:       "Archived",
    order:       7,
    tier:        "muted",
    description: "Workspace has been archived and is no longer active.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
} as const;

export type TenantStatusKey = keyof typeof TENANT_STATUS_MAP;

export const ALL_TENANT_STATUS_KEYS = [
  "provisioning",
  "pending_activation",
  "trial",
  "active",
  "grace_period",
  "locked",
  "suspended",
  "archived",
] as const satisfies readonly TenantStatusKey[];

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceOperationalStatus Map (7 statuses)
// ─────────────────────────────────────────────────────────────────────────────

export const WORKSPACE_OPERATIONAL_STATUS_MAP = {
  healthy: {
    label:       "Healthy",
    order:       0,
    tier:        "good",
    description: "Workspace is operating normally with active users.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  attention: {
    label:       "Attention",
    order:       1,
    tier:        "attention",
    description: "Workspace may need review - no active users detected.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  degraded: {
    label:       "Degraded",
    order:       2,
    tier:        "attention",
    description: "Workspace is experiencing degraded operational health.",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  restricted: {
    label:       "Restricted",
    order:       3,
    tier:        "critical",
    description: "Workspace access is partially restricted.",
    badgeClass:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  suspended: {
    label:       "Suspended",
    order:       4,
    tier:        "critical",
    description: "Workspace is currently suspended.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  archived: {
    label:       "Archived",
    order:       5,
    tier:        "muted",
    description: "Workspace has been archived.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
  unknown: {
    label:       "Unknown",
    order:       6,
    tier:        "muted",
    description: "Operational status could not be determined.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
} as const;

export type WorkspaceOperationalStatusKey = keyof typeof WORKSPACE_OPERATIONAL_STATUS_MAP;

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionStatus Map (8 statuses)
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_STATUS_MAP = {
  trialing: {
    label:       "Trialing",
    order:       0,
    tier:        "neutral",
    description: "Currently in a free trial period.",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  active: {
    label:       "Active",
    order:       1,
    tier:        "good",
    description: "Subscription is current and active.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  renewal_due: {
    label:       "Renewal Due",
    order:       2,
    tier:        "attention",
    description: "Subscription renewal is approaching.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  grace_period: {
    label:       "Grace Period",
    order:       3,
    tier:        "attention",
    description: "Subscription has lapsed but workspace is in a grace window.",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  expired: {
    label:       "Expired",
    order:       4,
    tier:        "critical",
    description: "Subscription has expired.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  suspended: {
    label:       "Suspended",
    order:       5,
    tier:        "critical",
    description: "Subscription is suspended.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  cancelled: {
    label:       "Cancelled",
    order:       6,
    tier:        "muted",
    description: "Subscription has been cancelled.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
  unknown: {
    label:       "Unknown",
    order:       7,
    tier:        "muted",
    description: "Subscription status is not yet configured.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
} as const;

export type SubscriptionStatusKey = keyof typeof SUBSCRIPTION_STATUS_MAP;

export const ALL_SUBSCRIPTION_STATUS_KEYS = [
  "trialing", "active", "renewal_due", "grace_period",
  "expired", "suspended", "cancelled", "unknown",
] as const satisfies readonly SubscriptionStatusKey[];

// ─────────────────────────────────────────────────────────────────────────────
// RiskLevel Map (6 levels)
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_LEVEL_MAP = {
  none: {
    label:       "None",
    order:       0,
    tier:        "good",
    description: "No risk signals detected.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    dotClass:    "bg-emerald-500",
  },
  low: {
    label:       "Low",
    order:       1,
    tier:        "neutral",
    description: "Minor operational signals observed.",
    badgeClass:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    dotClass:    "bg-blue-500",
  },
  medium: {
    label:       "Medium",
    order:       2,
    tier:        "attention",
    description: "Notable signals requiring monitoring.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    dotClass:    "bg-yellow-500",
  },
  high: {
    label:       "High",
    order:       3,
    tier:        "critical",
    description: "Significant signals requiring administrative review.",
    badgeClass:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    dotClass:    "bg-orange-500",
  },
  critical: {
    label:       "Critical",
    order:       4,
    tier:        "critical",
    description: "Critical signals requiring immediate administrative review.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    dotClass:    "bg-red-500",
  },
  unknown: {
    label:       "Unknown",
    order:       5,
    tier:        "muted",
    description: "Risk level could not be determined.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    dotClass:    "bg-slate-400",
  },
} as const;

export type RiskLevelKey = keyof typeof RISK_LEVEL_MAP;

export const RISK_LEVEL_ORDER = [
  "none", "low", "medium", "high", "critical", "unknown",
] as const satisfies readonly RiskLevelKey[];

// ─────────────────────────────────────────────────────────────────────────────
// Plan Tier Map
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_TIER_MAP = {
  starter:    { label: "Starter",    order: 0, tier: "muted",    badgeClass: "bg-slate-100 text-slate-600" },
  growth:     { label: "Growth",     order: 1, tier: "neutral",  badgeClass: "bg-blue-100 text-blue-700" },
  business:   { label: "Business",   order: 2, tier: "good",     badgeClass: "bg-emerald-100 text-emerald-700" },
  enterprise: { label: "Enterprise", order: 3, tier: "good",     badgeClass: "bg-purple-100 text-purple-700" },
  custom:     { label: "Custom",     order: 4, tier: "neutral",  badgeClass: "bg-indigo-100 text-indigo-700" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Query Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_REGISTRY_QUERY_CONFIG = {
  staleTime:            5 * 60 * 1000,
  gcTime:               10 * 60 * 1000,
  retry:                1,
  refetchOnWindowFocus: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// API Paths
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_REGISTRY_API_PATHS = {
  list:    "/api/platform/tenants",
  profile: (tenantId: string) => `/api/platform/tenants/${tenantId}`,
  summary: (tenantId: string) => `/api/platform/tenants/${tenantId}/summary`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hook Names (all read-only)
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_READ_HOOK_NAMES = [
  "useTenantRegistry",
  "useTenantProfile",
  "useTenantSummary",
] as const;

export type TenantReadHookName = (typeof TENANT_READ_HOOK_NAMES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_REGISTRY_SAFETY_CONTRACT = {
  readOnly:                  true,
  noMutationControls:        true,
  noTenantSuspension:        true,
  noWorkspaceDeletion:       true,
  noSubscriptionMutation:    true,
  noBillingActions:          true,
  noPaymentActions:          true,
  noLegalConclusions:        true,
  noAiSummaries:             true,
  superAdminOnly:            true,
} as const;

export type TenantRegistrySafetyContractKey = keyof typeof TENANT_REGISTRY_SAFETY_CONTRACT;

// ─────────────────────────────────────────────────────────────────────────────
// Empty / Placeholder State Messages
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_REGISTRY_EMPTY_STATE = {
  noTenants:          "No tenants registered on this platform yet.",
  noResults:          "No tenants match the current filters.",
  noOwner:            "No workspace admin assigned.",
  noPlan:             "No plan configured.",
  noSubscription:     "Subscription data not yet configured.",
  noUsage:            "Usage data not yet available.",
  noModules:          "No module entitlements configured.",
  unknownRisk:        "Risk level could not be determined.",
  unknownActivity:    "Last activity unknown.",
  unauthorized:       "Access denied. Super-admin credentials required.",
  loadingRegistry:    "Loading tenant registry...",
  loadingProfile:     "Loading tenant profile...",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Filter Options
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_STATUS_FILTER_OPTIONS = [
  { value: "",                   label: "All statuses" },
  { value: "active",             label: "Active" },
  { value: "trial",              label: "Trial" },
  { value: "grace_period",       label: "Grace Period" },
  { value: "suspended",          label: "Suspended" },
  { value: "archived",           label: "Archived" },
  { value: "locked",             label: "Locked" },
  { value: "pending_activation", label: "Pending Activation" },
  { value: "provisioning",       label: "Provisioning" },
] as const;

export const SUBSCRIPTION_STATUS_FILTER_OPTIONS = [
  { value: "",             label: "All subscriptions" },
  { value: "active",       label: "Active" },
  { value: "trialing",     label: "Trialing" },
  { value: "renewal_due",  label: "Renewal Due" },
  { value: "grace_period", label: "Grace Period" },
  { value: "expired",      label: "Expired" },
  { value: "suspended",    label: "Suspended" },
  { value: "cancelled",    label: "Cancelled" },
  { value: "unknown",      label: "Unknown" },
] as const;

export const RISK_LEVEL_FILTER_OPTIONS = [
  { value: "",         label: "All risk levels" },
  { value: "none",     label: "None" },
  { value: "low",      label: "Low" },
  { value: "medium",   label: "Medium" },
  { value: "high",     label: "High" },
  { value: "critical", label: "Critical" },
  { value: "unknown",  label: "Unknown" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Table Column Config
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_REGISTRY_TABLE_COLUMNS = [
  { key: "workspaceName",     label: "Workspace",           sortable: true  },
  { key: "primaryOwner",      label: "Owner",               sortable: false },
  { key: "tenantStatus",      label: "Status",              sortable: true  },
  { key: "subscriptionStatus",label: "Subscription",        sortable: false },
  { key: "planCode",          label: "Plan",                sortable: false },
  { key: "riskLevel",         label: "Risk",                sortable: true  },
  { key: "userCount",         label: "Users",               sortable: true  },
  { key: "lastActivityAt",    label: "Last Activity",       sortable: true  },
] as const;
