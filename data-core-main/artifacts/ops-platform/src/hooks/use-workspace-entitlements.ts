/**
 * @phase P16-B - Workspace Entitlements
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

export interface EntitlementCatalogModule {
  key: string;
  label: string;
  labelAr: string;
  description: string;
  isCore: boolean;
  order: number;
  features: { key: string; moduleKey: string; label: string; labelAr: string }[];
}

export interface WorkspaceEntitlementRecord {
  id: number;
  workspaceId: number;
  tenantId: number;
  subscriptionId: number | null;
  moduleKey: string;
  featureKey: string | null;
  isEnabled: boolean;
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

export type WorkspaceEntitlementUpsertItem = {
  moduleKey: string;
  featureKey?: string | null;
  isEnabled: boolean;
  source?: string;
  subscriptionId?: number | null;
  effectiveFrom?: string;
  effectiveUntil?: string;
  reason?: string;
  internalNotes?: string;
};

export const workspaceEntitlementKeys = {
  catalog: (tenantId: string) =>
    ["platform", "tenants", tenantId, "entitlements", "catalog"] as const,
  list: (tenantId: string) =>
    ["platform", "tenants", tenantId, "entitlements"] as const,
};

export function useTenantEntitlementCatalog(tenantId: string | undefined) {
  return useQuery({
    queryKey: workspaceEntitlementKeys.catalog(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ catalog: { modules: EntitlementCatalogModule[]; features: unknown[] } }>(
        `/platform/tenants/${tenantId}/entitlements/catalog`,
      ),
    select: (data) => data.catalog,
  });
}

export function useTenantEntitlements(tenantId: string | undefined) {
  return useQuery({
    queryKey: workspaceEntitlementKeys.list(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{
        entitlements: WorkspaceEntitlementRecord[];
        catalog: { modules: EntitlementCatalogModule[] };
      }>(`/platform/tenants/${tenantId}/entitlements`),
  });
}

export function useUpdateTenantEntitlements(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entitlements: WorkspaceEntitlementUpsertItem[]) =>
      apiFetch<{ entitlements: WorkspaceEntitlementRecord[] }>(
        `/platform/tenants/${tenantId}/entitlements`,
        { method: "PUT", body: JSON.stringify({ entitlements }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceEntitlementKeys.list(tenantId) });
    },
  });
}

export function useUpdateTenantEntitlement(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entitlementId,
      input,
    }: {
      entitlementId: number;
      input: Partial<WorkspaceEntitlementUpsertItem>;
    }) =>
      apiFetch<{ entitlement: WorkspaceEntitlementRecord }>(
        `/platform/tenants/${tenantId}/entitlements/${entitlementId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceEntitlementKeys.list(tenantId) });
    },
  });
}
