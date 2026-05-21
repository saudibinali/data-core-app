/**
 * @phase P16-D - Grace Period & Suspension Policy
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

export interface WorkspaceSubscriptionPolicyRecord {
  id: number | null;
  workspaceId: number;
  tenantId: number;
  subscriptionId: number | null;
  policyName: string;
  gracePeriodDays: number;
  pastDueAfterDays: number;
  suspensionAfterDays: number;
  terminationAfterDays: number | null;
  allowReadOnlyDuringSuspension: boolean;
  allowAdminAccessDuringSuspension: boolean;
  allowDataExportDuringSuspension: boolean;
  enforcementMode: string;
  isActive: boolean;
  reason: string | null;
  internalNotes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  isDefault: boolean;
}

export interface SubscriptionPolicyEvaluation {
  currentSubscriptionStatus: string;
  daysSinceEndDate: number | null;
  recommendedStatus: string;
  recommendedAction: string;
  reasons: string[];
  policy: {
    policyName: string;
    gracePeriodDays: number;
    pastDueAfterDays: number;
    suspensionAfterDays: number;
    terminationAfterDays: number | null;
    enforcementMode: string;
  };
  isAutomaticAllowed: false;
  enforcementMode: string;
}

export type SubscriptionPolicyUpsertInput = {
  policyName: string;
  gracePeriodDays: number;
  pastDueAfterDays: number;
  suspensionAfterDays: number;
  terminationAfterDays?: number | null;
  allowReadOnlyDuringSuspension?: boolean;
  allowAdminAccessDuringSuspension?: boolean;
  allowDataExportDuringSuspension?: boolean;
  enforcementMode?: string;
  isActive?: boolean;
  subscriptionId?: number | null;
  reason: string;
  internalNotes?: string;
};

export const tenantSubscriptionPolicyKeys = {
  policy: (tenantId: string) =>
    ["platform", "tenants", tenantId, "subscription-policy"] as const,
  evaluation: (tenantId: string) =>
    ["platform", "tenants", tenantId, "subscription-policy", "evaluation"] as const,
};

export function useTenantSubscriptionPolicy(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantSubscriptionPolicyKeys.policy(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ policy: WorkspaceSubscriptionPolicyRecord }>(
        `/platform/tenants/${tenantId}/subscription-policy`,
      ),
    select: (data) => data.policy,
  });
}

export function useTenantSubscriptionPolicyEvaluation(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantSubscriptionPolicyKeys.evaluation(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{
        evaluation: SubscriptionPolicyEvaluation;
        policy: WorkspaceSubscriptionPolicyRecord;
      }>(`/platform/tenants/${tenantId}/subscription-policy/evaluation`),
  });
}

export function useUpsertTenantSubscriptionPolicy(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubscriptionPolicyUpsertInput) =>
      apiFetch<{ policy: WorkspaceSubscriptionPolicyRecord }>(
        `/platform/tenants/${tenantId}/subscription-policy`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: tenantSubscriptionPolicyKeys.policy(tenantId),
      });
      void qc.invalidateQueries({
        queryKey: tenantSubscriptionPolicyKeys.evaluation(tenantId),
      });
    },
  });
}

export function useRefreshSubscriptionPolicyEvaluation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        evaluation: SubscriptionPolicyEvaluation;
        policy: WorkspaceSubscriptionPolicyRecord;
      }>(`/platform/tenants/${tenantId}/subscription-policy/evaluation`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: tenantSubscriptionPolicyKeys.evaluation(tenantId),
      });
    },
  });
}
