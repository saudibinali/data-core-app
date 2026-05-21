/**
 * @phase P16-A - Workspace Subscription State Model
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

export interface WorkspaceSubscription {
  id: number;
  workspaceId: number;
  tenantId: number;
  commercialAccountId: number | null;
  activeContractTermId: number | null;
  subscriptionCode: string;
  subscriptionName: string;
  status: string;
  statusReason: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  gracePeriodEndsAt: string | null;
  suspensionStartedAt: string | null;
  terminationDate: string | null;
  planName: string | null;
  internalNotes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceSubscriptionCreateInput = {
  subscriptionCode: string;
  subscriptionName: string;
  status?: string;
  commercialAccountId?: number | null;
  activeContractTermId?: number | null;
  startDate?: string;
  endDate?: string;
  renewalDate?: string;
  gracePeriodEndsAt?: string;
  planName?: string;
  internalNotes?: string;
  statusReason?: string;
};

export type WorkspaceSubscriptionUpdateInput = Partial<WorkspaceSubscriptionCreateInput>;

export const tenantSubscriptionKeys = {
  detail: (tenantId: string) =>
    ["platform", "tenants", tenantId, "subscription"] as const,
};

export function useTenantSubscription(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantSubscriptionKeys.detail(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ subscription: WorkspaceSubscription | null }>(
        `/platform/tenants/${tenantId}/subscription`,
      ),
    select: (data) => data.subscription,
  });
}

export function useCreateTenantSubscription(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceSubscriptionCreateInput) =>
      apiFetch<{ subscription: WorkspaceSubscription }>(
        `/platform/tenants/${tenantId}/subscription`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tenantSubscriptionKeys.detail(tenantId) });
    },
  });
}

export function useUpdateTenantSubscription(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceSubscriptionUpdateInput) =>
      apiFetch<{ subscription: WorkspaceSubscription }>(
        `/platform/tenants/${tenantId}/subscription`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tenantSubscriptionKeys.detail(tenantId) });
    },
  });
}

export function useUpdateTenantSubscriptionStatus(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: string; reason: string; gracePeriodEndsAt?: string }) =>
      apiFetch<{ subscription: WorkspaceSubscription }>(
        `/platform/tenants/${tenantId}/subscription/status`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tenantSubscriptionKeys.detail(tenantId) });
    },
  });
}
