/**
 * @phase P16-C - Workspace Limits & Quotas
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QuotaUsageStatus } from "@/lib/quota-model-config";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface QuotaCatalogEntry {
  key: string;
  label: string;
  labelAr: string;
  unit: string;
  defaultLimit: number;
  warningThresholdPercent: number;
  hardLimitSupported: boolean;
  description: string;
  relatedModule?: string;
}

export interface WorkspaceQuotaLimitRecord {
  id: number;
  workspaceId: number;
  tenantId: number;
  subscriptionId: number | null;
  quotaKey: string;
  limitValue: number | null;
  warningThresholdPercent: number;
  isHardLimit: boolean;
  source: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  reason: string | null;
  internalNotes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaUsageItem {
  quotaKey: string;
  label: string;
  labelAr: string;
  unit: string;
  limitValue: number | null;
  currentUsage: number | null;
  usagePercent: number | null;
  status: QuotaUsageStatus;
  warningThresholdPercent: number;
  isHardLimit: boolean;
  source: string | null;
  quotaLimitId: number | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}

export type WorkspaceQuotaUpsertItem = {
  quotaKey: string;
  limitValue?: number | null;
  warningThresholdPercent?: number;
  isHardLimit?: boolean;
  source?: string;
  subscriptionId?: number | null;
  effectiveFrom?: string;
  effectiveUntil?: string;
  reason?: string;
  internalNotes?: string;
};

export const workspaceQuotaKeys = {
  catalog: (tenantId: string) =>
    ["platform", "tenants", tenantId, "quotas", "catalog"] as const,
  list: (tenantId: string) =>
    ["platform", "tenants", tenantId, "quotas"] as const,
  usage: (tenantId: string) =>
    ["platform", "tenants", tenantId, "quotas", "usage"] as const,
};

export function useTenantQuotaCatalog(tenantId: string | undefined) {
  return useQuery({
    queryKey: workspaceQuotaKeys.catalog(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ catalog: { quotas: QuotaCatalogEntry[] } }>(
        `/platform/tenants/${tenantId}/quotas/catalog`,
      ),
    select: (data) => data.catalog,
  });
}

export function useTenantQuotas(tenantId: string | undefined) {
  return useQuery({
    queryKey: workspaceQuotaKeys.list(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{
        quotas: WorkspaceQuotaLimitRecord[];
        catalog: { quotas: QuotaCatalogEntry[] };
      }>(`/platform/tenants/${tenantId}/quotas`),
  });
}

export function useTenantQuotaUsage(tenantId: string | undefined) {
  return useQuery({
    queryKey: workspaceQuotaKeys.usage(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ usage: QuotaUsageItem[] }>(
        `/platform/tenants/${tenantId}/quotas/usage`,
      ),
    select: (data) => data.usage,
  });
}

export function useUpdateTenantQuotas(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotas: WorkspaceQuotaUpsertItem[]) =>
      apiFetch<{ quotas: WorkspaceQuotaLimitRecord[] }>(
        `/platform/tenants/${tenantId}/quotas`,
        { method: "PUT", body: JSON.stringify({ quotas }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceQuotaKeys.list(tenantId) });
      void qc.invalidateQueries({ queryKey: workspaceQuotaKeys.usage(tenantId) });
    },
  });
}

export function useUpdateTenantQuota(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quotaLimitId,
      ...body
    }: WorkspaceQuotaUpsertItem & { quotaLimitId: number }) =>
      apiFetch<{ quota: WorkspaceQuotaLimitRecord }>(
        `/platform/tenants/${tenantId}/quotas/${quotaLimitId}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceQuotaKeys.list(tenantId) });
      void qc.invalidateQueries({ queryKey: workspaceQuotaKeys.usage(tenantId) });
    },
  });
}
