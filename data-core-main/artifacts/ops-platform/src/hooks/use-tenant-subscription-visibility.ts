/**
 * @phase P16-G - Tenant subscription visibility hooks (read-only)
 */

import { useQuery } from "@tanstack/react-query";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function tenantFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface TenantSubscriptionSummary {
  subscriptionStatus: string;
  planName: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  gracePeriodEndsAt: string | null;
  accessMode: string;
  readOnlyMode: boolean;
  readOnlyReason: string | null;
  daysUntilEnd: number | null;
  daysPastEnd: number | null;
  recommendedStatus: string | null;
  supportContact: {
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    contactRole: string;
  } | null;
}

export interface TenantSubscriptionEntitlementModule {
  moduleKey: string;
  label: string;
  labelAr: string;
  description: string;
  isCore: boolean;
  isEnabled: boolean;
  features: {
    key: string;
    label: string;
    labelAr: string;
    isEnabled: boolean;
  }[];
}

export interface TenantSubscriptionQuotaItem {
  quotaKey: string;
  label: string;
  labelAr: string;
  unit: string;
  limitValue: number | null;
  currentUsage: number | null;
  usagePercent: number | null;
  status: "ok" | "warning" | "exceeded" | "unlimited" | "unknown";
  warningThresholdPercent: number;
}

export const tenantSubscriptionKeys = {
  summary: ["tenant", "subscription", "summary"] as const,
  entitlements: ["tenant", "subscription", "entitlements"] as const,
  quotas: ["tenant", "subscription", "quotas"] as const,
};

export function useTenantSubscriptionSummary(enabled: boolean) {
  return useQuery({
    queryKey: tenantSubscriptionKeys.summary,
    enabled,
    queryFn: () =>
      tenantFetch<{ summary: TenantSubscriptionSummary }>("/tenant/subscription/summary"),
    select: (d) => d.summary,
    staleTime: 60_000,
  });
}

export function useTenantSubscriptionEntitlements(enabled: boolean) {
  return useQuery({
    queryKey: tenantSubscriptionKeys.entitlements,
    enabled,
    queryFn: () =>
      tenantFetch<{ modules: TenantSubscriptionEntitlementModule[] }>(
        "/tenant/subscription/entitlements",
      ),
    select: (d) => d.modules,
    staleTime: 60_000,
  });
}

export function useTenantSubscriptionQuotas(enabled: boolean) {
  return useQuery({
    queryKey: tenantSubscriptionKeys.quotas,
    enabled,
    queryFn: () =>
      tenantFetch<{ quotas: TenantSubscriptionQuotaItem[] }>("/tenant/subscription/quotas"),
    select: (d) => d.quotas,
    staleTime: 60_000,
  });
}
