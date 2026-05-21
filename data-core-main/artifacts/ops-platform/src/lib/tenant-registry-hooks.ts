/**
 * @file   lib/tenant-registry-hooks.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *         P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *         P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *
 * TanStack Query hooks for Platform Tenant Registry and Subscription API endpoints.
 *
 * SAFETY CONTRACT:
 *   - Read hooks use useQuery (read-only GET requests).
 *   - Mutation hooks are limited - P13-B: exactly one lifecycle mutation,
 *     P13-C: exactly one subscription mutation (SUBSCRIPTION_MUTATION_HOOK_NAMES).
 *   - No delete, HR, billing, payment, or email operations.
 *   - All queryFn calls use GET/PATCH only via fetch() with Authorization header.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TENANT_REGISTRY_QUERY_CONFIG,
  TENANT_REGISTRY_API_PATHS,
  TENANT_READ_HOOK_NAMES,
} from "./tenant-registry-config";
import {
  SUBSCRIPTION_API_PATHS,
  SUBSCRIPTION_MUTATION_HOOK_NAMES,
} from "./subscription-lifecycle-config";
import {
  ENTITLEMENT_API_PATHS,
  ENTITLEMENT_MUTATION_HOOK_NAMES,
} from "./platform-entitlements-config";
import {
  USAGE_API_PATHS,
  USAGE_READ_HOOK_NAMES,
} from "./platform-usage-config";
import {
  RENEWAL_INTELLIGENCE_API_PATHS,
  RENEWAL_READ_HOOK_NAMES,
  type RenewalSignalCode,
  type RenewalUrgency,
  type RecommendedPlatformAction,
} from "./renewal-intelligence-config";
import {
  TENANT_HEALTH_API_PATHS,
  TENANT_HEALTH_READ_HOOK_NAMES,
  type TenantHealthStatus,
  type TenantHealthRiskLevel,
  type TenantHealthSignalCode,
  type RecommendedTenantHealthAction,
} from "./tenant-health-config";
import {
  LIFECYCLE_EVALUATION_API_PATHS,
  type EvaluationSignalCode,
  type EvaluationSeverity,
  type EvaluationRecommendedAction,
} from "./lifecycle-evaluation-config";

export const LIFECYCLE_EVALUATION_READ_HOOK_NAMES = ["useTenantLifecycleEvaluation"] as const;

// ── Re-exports ─────────────────────────────────────────────────────────────
export { TENANT_READ_HOOK_NAMES, SUBSCRIPTION_MUTATION_HOOK_NAMES, ENTITLEMENT_MUTATION_HOOK_NAMES, USAGE_READ_HOOK_NAMES, RENEWAL_READ_HOOK_NAMES, TENANT_HEALTH_READ_HOOK_NAMES };

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("ops_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: getAuthHeader() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method:  "PATCH",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrored from backend - kept minimal for UI consumption)
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantRiskSignalSummary {
  renewalApproaching:       boolean;
  subscriptionExpired:      boolean;
  gracePeriodActive:        boolean;
  usageLimitApproaching:    boolean;
  usageLimitExceeded:       boolean;
  governanceWarnings:       boolean;
  operationalWarnings:      boolean;
  riskLevel:                string;
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

export type UsageLimitStatus =
  | "unknown" | "normal" | "approaching" | "exceeded" | "unlimited" | "not_applicable";

export type MetricSourceType =
  | "live_db" | "derived" | "configured" | "unavailable";

export interface UsageMetricRow {
  metricCode:       string;
  usageValue:       number | null;
  limitValue:       number | null;
  percentage:       number | null;
  status:           UsageLimitStatus;
  sourceType:       MetricSourceType;
  lastCalculatedAt: string;
  notes?:           string;
}

export interface TenantUsageProfile {
  tenantId:          string;
  workspaceId:       number;
  metrics:           UsageMetricRow[];
  warningCount:      number;
  exceededCount:     number;
  unknownCount:      number;
  capacityRiskLevel: string;
  derivedAt:         string;
}

export interface TenantUsageData {
  usageProfile:             TenantUsageProfile;
  entitlementProfileSummary: {
    planCode:        string | null;
    planTier:        string | null;
    enabledCount:    number;
    customOverrides: number;
    limits:          Record<string, number | null>;
  };
  rawUsageSources:  Record<string, { sourceType: MetricSourceType; notes?: string }>;
  warnings:         string[];
}

// P13-F - Renewal Intelligence Types
export interface SubscriptionRenewalProfile {
  subscriptionId:        string | null;
  workspaceId:           number;
  planCode:              string | null;
  subscriptionStatus:    string;
  signals:               string[];
  urgency:               string;
  recommendedAction:     string;
  daysUntilBillingEnd:   number | null;
  daysUntilTrialEnd:     number | null;
  daysUntilGraceEnd:     number | null;
  daysPastDue:           number | null;
  warnings:              string[];
  derivedAt:             string;
}

export interface SubscriptionSummaryForRenewal {
  planCode:             string | null;
  subscriptionStatus:   string;
  billingPeriodStart:   string | null;
  billingPeriodEnd:     string | null;
  renewalDueAt:         string | null;
  trialStartedAt:       string | null;
  trialEndsAt:          string | null;
  gracePeriodStartedAt: string | null;
  gracePeriodEndsAt:    string | null;
  cancelledAt:          string | null;
  suspendedAt:          string | null;
}

export interface TenantRenewalIntelligenceData {
  renewalProfile:      SubscriptionRenewalProfile;
  subscriptionSummary: SubscriptionSummaryForRenewal | null;
  warnings:            string[];
  safetyNotice:        string;
}

export interface PlatformTenantProfile {
  tenantId:              string;
  workspaceId:           number;
  workspaceName:         string;
  tenantDisplayName:     string;
  primaryOwnerUserId:    number | null;
  primaryOwnerEmail:     string | null;
  primaryOwnerFullName:  string | null;
  tenantStatus:          string;
  workspaceStatus:       string;
  planCode:              string | null;
  planName:              string | null;
  planTier:              string | null;
  subscriptionStatus:    string;
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

export interface TenantRegistryFilters {
  status?:             string;
  subscriptionStatus?: string;
  riskLevel?:          string;
  search?:             string;
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantRegistry - list all tenant profiles with optional filters
// ─────────────────────────────────────────────────────────────────────────────

export function useTenantRegistry(
  filters?: TenantRegistryFilters,
  options?: { refetchInterval?: number },
) {
  const params = new URLSearchParams();
  if (filters?.status)             params.set("status",             filters.status);
  if (filters?.subscriptionStatus) params.set("subscriptionStatus", filters.subscriptionStatus);
  if (filters?.riskLevel)          params.set("riskLevel",          filters.riskLevel);
  if (filters?.search)             params.set("search",             filters.search);

  const query = params.toString();
  const url   = query
    ? `${TENANT_REGISTRY_API_PATHS.list}?${query}`
    : TENANT_REGISTRY_API_PATHS.list;

  return useQuery<{ tenants: PlatformTenantProfile[]; total: number }>({
    queryKey:   ["platform", "tenants", filters ?? {}],
    queryFn:    () => getJson(url),
    staleTime:  TENANT_REGISTRY_QUERY_CONFIG.staleTime,
    gcTime:     TENANT_REGISTRY_QUERY_CONFIG.gcTime,
    retry:      TENANT_REGISTRY_QUERY_CONFIG.retry,
    refetchOnWindowFocus: TENANT_REGISTRY_QUERY_CONFIG.refetchOnWindowFocus,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchInterval != null ? true : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantProfile - single tenant profile by tenantId
// ─────────────────────────────────────────────────────────────────────────────

export function useTenantProfile(tenantId: string | null) {
  return useQuery<{ tenant: PlatformTenantProfile }>({
    queryKey:   ["platform", "tenants", tenantId, "profile"],
    queryFn:    () => getJson(TENANT_REGISTRY_API_PATHS.profile(tenantId!)),
    enabled:    !!tenantId,
    staleTime:  TENANT_REGISTRY_QUERY_CONFIG.staleTime,
    gcTime:     TENANT_REGISTRY_QUERY_CONFIG.gcTime,
    retry:      TENANT_REGISTRY_QUERY_CONFIG.retry,
    refetchOnWindowFocus: TENANT_REGISTRY_QUERY_CONFIG.refetchOnWindowFocus,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantSummary - lightweight summary for a single tenant
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantSummaryResponse {
  tenantId:           string;
  workspaceName:      string;
  tenantStatus:       string;
  workspaceStatus:    string;
  userCount:          number;
  ticketCount:        number;
  departmentCount:    number;
  riskSignalSummary:  TenantRiskSignalSummary;
  usageSummary:       TenantUsageSummary;
  planCode:           string | null;
  subscriptionStatus: string;
  createdAt:          string;
  updatedAt:          string;
  lastActivityAt:     string | null;
}

export function useTenantSummary(tenantId: string | null) {
  return useQuery<TenantSummaryResponse>({
    queryKey:   ["platform", "tenants", tenantId, "summary"],
    queryFn:    () => getJson(TENANT_REGISTRY_API_PATHS.summary(tenantId!)),
    enabled:    !!tenantId,
    staleTime:  TENANT_REGISTRY_QUERY_CONFIG.staleTime,
    gcTime:     TENANT_REGISTRY_QUERY_CONFIG.gcTime,
    retry:      TENANT_REGISTRY_QUERY_CONFIG.retry,
    refetchOnWindowFocus: TENANT_REGISTRY_QUERY_CONFIG.refetchOnWindowFocus,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-B - Lifecycle Transition Mutation Hook
//
// SAFETY CONTRACT:
//   - Exactly ONE lifecycle mutation hook (LIFECYCLE_MUTATION_HOOK_NAMES).
//   - Only lifecycle transitions - no delete, billing, HR, or email actions.
//   - On success: invalidates all ["platform", "tenants"] queries automatically.
// ─────────────────────────────────────────────────────────────────────────────

export interface LifecycleTransitionInput {
  tenantId:      string;
  action:        string;
  reason:        string;
  internalNote?: string;
  confirmation:  true;
}

export interface LifecycleTransitionResult {
  tenant:         PlatformTenantProfile;
  lifecycleEvent: {
    eventType:     string;
    tenantId:      string;
    workspaceId:   number;
    actorId:       number;
    action:        string;
    previousState: string;
    targetState:   string;
    reason:        string;
    internalNote:  string | null;
    occurredAt:    string;
  };
}

export function useWorkspaceLifecycleTransition() {
  const queryClient = useQueryClient();

  return useMutation<LifecycleTransitionResult, Error, LifecycleTransitionInput>({
    mutationFn: ({ tenantId, action, reason, internalNote, confirmation }) =>
      patchJson<LifecycleTransitionResult>(
        `/api/platform/tenants/${tenantId}/lifecycle`,
        { action, reason, internalNote, confirmation },
      ),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-C - Subscription Read Hook
//
// GET /api/platform/tenants/:tenantId/subscription
// Returns subscription metadata. isConfigured=false when no record exists.
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantSubscriptionData {
  tenantId:             string;
  workspaceId:          number;
  isConfigured:         boolean;
  planCode:             string | null;
  subscriptionStatus:   string;
  derivedStatus:        string;
  billingPeriodStart:   string | null;
  billingPeriodEnd:     string | null;
  renewalDueAt:         string | null;
  trialStartedAt:       string | null;
  trialEndsAt:          string | null;
  gracePeriodStartedAt: string | null;
  gracePeriodEndsAt:    string | null;
  cancelledAt:          string | null;
  suspendedAt:          string | null;
  metadataJson:         unknown;
  reason:               string | null;
  createdAt:            string | null;
  updatedAt:            string | null;
}

export function useTenantSubscription(tenantId: string | null) {
  return useQuery<TenantSubscriptionData>({
    queryKey:   ["platform", "tenants", tenantId, "subscription"],
    queryFn:    () => getJson(SUBSCRIPTION_API_PATHS.get(tenantId!)),
    enabled:    !!tenantId,
    staleTime:  TENANT_REGISTRY_QUERY_CONFIG.staleTime,
    gcTime:     TENANT_REGISTRY_QUERY_CONFIG.gcTime,
    retry:      TENANT_REGISTRY_QUERY_CONFIG.retry,
    refetchOnWindowFocus: TENANT_REGISTRY_QUERY_CONFIG.refetchOnWindowFocus,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-C - Subscription Update Mutation Hook
//
// SAFETY CONTRACT:
//   - Exactly ONE subscription mutation hook (SUBSCRIPTION_MUTATION_HOOK_NAMES).
//   - Metadata only - no payment, invoice, charge, tax, or card data.
//   - No automatic workspace suspension.
//   - On success: invalidates tenant registry + subscription queries.
//   - Requires reason + confirmation - enforced at API route level.
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionUpdateInput {
  tenantId:              string;
  planCode?:             string;
  subscriptionStatus?:   string;
  billingPeriodStart?:   string | null;
  billingPeriodEnd?:     string | null;
  renewalDueAt?:         string | null;
  trialStartedAt?:       string | null;
  trialEndsAt?:          string | null;
  gracePeriodStartedAt?: string | null;
  gracePeriodEndsAt?:    string | null;
  cancelledAt?:          string | null;
  suspendedAt?:          string | null;
  metadataJson?:         Record<string, unknown>;
  reason:                string;
  confirmation:          true;
}

export interface SubscriptionUpdateResult {
  subscription: TenantSubscriptionData;
  tenant:       PlatformTenantProfile;
  auditEvent:   {
    eventType:                  string;
    tenantId:                   string;
    workspaceId:                number;
    actorId:                    number;
    previousSubscriptionStatus: string;
    newSubscriptionStatus:      string;
    previousPlanCode:           string | null;
    newPlanCode:                string | null;
    changedFields:              string[];
    reason:                     string;
    occurredAt:                 string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-D - Entitlement Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantEntitlementOverrideItem {
  id?:          number;
  moduleCode:   string;
  overrideType: "enable" | "disable" | "limit_override";
  limitCode:    string | null;
  limitValue:   number | null;
  reason:       string;
  createdBy?:   number;
  createdAt?:   string;
}

export interface TenantEntitlementProfile {
  planCode:                string | null;
  planTier:                string | null;
  enabledModules:          string[];
  disabledModules:         string[];
  limits:                  Record<string, number | null>;
  overridesApplied:        TenantEntitlementOverrideItem[];
  customEntitlementsCount: number;
  derivedAt:               string;
}

export interface TenantEntitlementsData {
  entitlementProfile: TenantEntitlementProfile;
  overrides:          TenantEntitlementOverrideItem[];
}

export interface EntitlementOverrideInput {
  moduleCode:   string;
  overrideType: string;
  limitCode?:   string | null;
  limitValue?:  number | null;
  reason:       string;
}

export interface EntitlementUpdateInput {
  tenantId:     string;
  overrides:    EntitlementOverrideInput[];
  confirmation: boolean;
}

export interface EntitlementUpdateResult {
  entitlementProfile: TenantEntitlementProfile;
  overrides:          TenantEntitlementOverrideItem[];
  tenant:             PlatformTenantProfile;
  auditEvent: {
    eventType:    string;
    tenantId:     string;
    workspaceId:  number;
    actorId:      number;
    planCode:     string | null;
    addedCount:   number;
    addedModules: string[];
    reason:       string;
    ts:           string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-D - Entitlement Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useTenantEntitlements - P13-D read hook.
 *
 * Fetches the derived entitlement profile + override list for a tenant.
 * Disabled when tenantId is null.
 */
export function useTenantEntitlements(tenantId: string | null) {
  return useQuery<TenantEntitlementsData>({
    queryKey: ["platform", "tenants", tenantId, "entitlements"],
    queryFn:  () => getJson<TenantEntitlementsData>(
      ENTITLEMENT_API_PATHS.get(tenantId!),
    ),
    enabled:   tenantId !== null,
    staleTime: 60_000,
  });
}

/**
 * useUpdateTenantEntitlementOverrides - P13-D mutation hook.
 *
 * Sends PATCH /api/platform/tenants/:tenantId/entitlements/overrides and
 * invalidates all tenant + entitlement queries on success.
 * This is the ONLY mutation hook for entitlements (ENTITLEMENT_MUTATION_HOOK_NAMES).
 */
export function useUpdateTenantEntitlementOverrides() {
  const queryClient = useQueryClient();

  return useMutation<EntitlementUpdateResult, Error, EntitlementUpdateInput>({
    mutationFn: ({ tenantId, ...body }) =>
      patchJson<EntitlementUpdateResult>(
        ENTITLEMENT_API_PATHS.overrides(tenantId),
        body,
      ),

    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
      void queryClient.invalidateQueries({
        queryKey: ["platform", "tenants", variables.tenantId, "entitlements"],
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-E - Usage & Capacity Intelligence Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useTenantUsage - P13-E read hook (USAGE_READ_HOOK_NAMES[0]).
 *
 * Fetches the derived usage profile, capacity risk level, and metric rows
 * for a tenant. Disabled when tenantId is null.
 * Read-only - no mutation, no billing, no enforcement.
 */
export function useTenantUsage(tenantId: string | null) {
  return useQuery<TenantUsageData>({
    queryKey: ["platform", "tenants", tenantId, "usage"],
    queryFn:  () => getJson<TenantUsageData>(
      USAGE_API_PATHS.usage(tenantId!),
    ),
    enabled:   tenantId !== null,
    staleTime: 30_000,
  });
}

/**
 * useUpdateTenantSubscription - P13-C subscription metadata mutation hook.
 *
 * Sends PATCH /api/platform/tenants/:tenantId/subscription with the metadata
 * payload and invalidates all platform tenant + subscription queries on success.
 */
export function useUpdateTenantSubscription() {
  const queryClient = useQueryClient();

  return useMutation<SubscriptionUpdateResult, Error, SubscriptionUpdateInput>({
    mutationFn: ({ tenantId, ...body }) =>
      patchJson<SubscriptionUpdateResult>(
        SUBSCRIPTION_API_PATHS.update(tenantId),
        body,
      ),

    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
      void queryClient.invalidateQueries({
        queryKey: ["platform", "tenants", variables.tenantId, "subscription"],
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantRenewalIntelligence - P13-F
// GET /api/platform/tenants/:tenantId/renewal-intelligence
// Read-only. No mutations.
// ─────────────────────────────────────────────────────────────────────────────

export function useTenantRenewalIntelligence(tenantId: string | null) {
  return useQuery<TenantRenewalIntelligenceData>({
    queryKey: ["platform", "tenants", tenantId, "renewal-intelligence"],
    queryFn:  () =>
      getJson<TenantRenewalIntelligenceData>(
        RENEWAL_INTELLIGENCE_API_PATHS.get(tenantId!),
      ),
    enabled:   tenantId !== null,
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-G - Tenant Health, Risk Signals & Operational Monitoring Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantHealthComponentSummary {
  name:   string;
  status: "ok" | "attention" | "warning" | "critical" | "unknown";
  note:   string;
}

export interface TenantHealthProfileData {
  tenantId:          string;
  workspaceId:       number;
  healthStatus:      TenantHealthStatus;
  riskLevel:         TenantHealthRiskLevel;
  signals:           TenantHealthSignalCode[];
  recommendedAction: RecommendedTenantHealthAction;
  warnings:          string[];
  summary:           string;
  components: {
    lifecycle:    TenantHealthComponentSummary;
    subscription: TenantHealthComponentSummary;
    renewal:      TenantHealthComponentSummary;
    usage:        TenantHealthComponentSummary;
    entitlements: TenantHealthComponentSummary;
    governance:   TenantHealthComponentSummary;
  };
  derivedAt: string;
}

export interface TenantHealthData {
  healthProfile:      TenantHealthProfileData;
  componentSummaries: TenantHealthProfileData["components"];
  warnings:           string[];
  safetyNotice:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantHealth - P13-G
// GET /api/platform/tenants/:tenantId/health
// Read-only. No mutations.
// ─────────────────────────────────────────────────────────────────────────────

export function useTenantHealth(tenantId: string | null) {
  return useQuery<TenantHealthData>({
    queryKey: ["platform", "tenants", tenantId, "health"],
    queryFn:  () =>
      getJson<TenantHealthData>(
        TENANT_HEALTH_API_PATHS.get(tenantId!),
      ),
    enabled:   tenantId !== null,
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P13-I - Tenant Lifecycle Evaluation Types
// GET /api/platform/tenants/:tenantId/lifecycle-evaluation
// Read-only. No mutations.
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluationReviewEligibility {
  renewalReviewEligible:     boolean;
  graceReviewEligible:       boolean;
  suspensionReviewEligible:  boolean;
  usageReviewEligible:       boolean;
  entitlementReviewEligible: boolean;
  lifecycleReviewEligible:   boolean;
  governanceReviewEligible:  boolean;
  manualReviewRequired:      boolean;
}

export interface TenantLifecycleEvaluationProfileData {
  tenantId:          string;
  workspaceId:       number;
  signals:           EvaluationSignalCode[];
  severity:          EvaluationSeverity;
  recommendedAction: EvaluationRecommendedAction;
  reviewEligibility: EvaluationReviewEligibility;
  warnings:          string[];
  summary:           string;
  evaluatedAt:       string;
  safetyNotice:      string;
}

export interface TenantLifecycleEvaluationData {
  evaluationProfile: TenantLifecycleEvaluationProfileData;
  componentSummaries: Record<string, unknown>;
  warnings:          string[];
  safetyNotice:      string;
}

// ─────────────────────────────────────────────────────────────────────────────
// useTenantLifecycleEvaluation - P13-I
// GET /api/platform/tenants/:tenantId/lifecycle-evaluation
// Read-only. No mutations.
// ─────────────────────────────────────────────────────────────────────────────

export function useTenantLifecycleEvaluation(tenantId: string | null) {
  return useQuery<TenantLifecycleEvaluationData>({
    queryKey: ["platform", "tenants", tenantId, "lifecycle-evaluation"],
    queryFn:  () =>
      getJson<TenantLifecycleEvaluationData>(
        LIFECYCLE_EVALUATION_API_PATHS.get(tenantId!),
      ),
    enabled:   tenantId !== null,
    staleTime: 30_000,
  });
}
