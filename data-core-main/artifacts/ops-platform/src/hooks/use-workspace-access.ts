/**
 * @phase P16-E - Platform workspace access hooks
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

export interface WorkspaceAccessMode {
  workspaceId: number;
  tenantId: number;
  enforcementId: number | null;
  enforcementStatus: string;
  allowLogin: boolean;
  allowRead: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  allowExport: boolean;
  allowAdminAccess: boolean;
  reason: string | null;
  source: string | null;
  subscriptionId: number | null;
  subscriptionStatus: string | null;
  appliedBy: number | null;
  appliedAt: string | null;
  expiresAt: string | null;
  isDefault: boolean;
}

export interface WorkspaceAccessEvaluation {
  recommendation: string;
  reasons: string[];
  subscriptionStatus: string | null;
  subscriptionId: number | null;
  manualApplyOnly: true;
  isAutomaticAllowed: false;
}

export const tenantWorkspaceAccessKeys = {
  access: (tenantId: string) =>
    ["platform", "tenants", tenantId, "workspace-access"] as const,
  evaluation: (tenantId: string) =>
    ["platform", "tenants", tenantId, "workspace-access", "evaluation"] as const,
};

export function useTenantWorkspaceAccess(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantWorkspaceAccessKeys.access(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ access: WorkspaceAccessMode }>(
        `/platform/tenants/${tenantId}/workspace-access`,
      ),
    select: (d) => d.access,
  });
}

export function useTenantWorkspaceAccessEvaluation(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantWorkspaceAccessKeys.evaluation(tenantId ?? ""),
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{
        evaluation: WorkspaceAccessEvaluation;
        currentAccess: WorkspaceAccessMode;
      }>(`/platform/tenants/${tenantId}/workspace-access/evaluation`),
  });
}

export function useUpdateTenantWorkspaceAccess(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      enforcementStatus: string;
      reason: string;
      source?: string;
      subscriptionId?: number | null;
      internalNotes?: string;
    }) =>
      apiFetch<{ access: WorkspaceAccessMode }>(
        `/platform/tenants/${tenantId}/workspace-access`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tenantWorkspaceAccessKeys.access(tenantId) });
      void qc.invalidateQueries({
        queryKey: tenantWorkspaceAccessKeys.evaluation(tenantId),
      });
    },
  });
}

export function useRefreshWorkspaceAccessEvaluation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        evaluation: WorkspaceAccessEvaluation;
        currentAccess: WorkspaceAccessMode;
      }>(`/platform/tenants/${tenantId}/workspace-access/evaluation`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: tenantWorkspaceAccessKeys.evaluation(tenantId),
      });
    },
  });
}
