/**
 * @phase P15-B - Contract Terms & Renewal Commitments
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

export interface CommercialContractTerm {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractNumber: string | null;
  contractTitle: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  renewalDate: string | null;
  renewalNoticeDays: number | null;
  contractTermMonths: number | null;
  renewalType: string;
  renewalCommitmentStatus: string;
  contractValue: string | null;
  currency: string | null;
  billingCycle: string | null;
  paymentTerms: string | null;
  internalOwnerUserId: number | null;
  customerDecisionMakerName: string | null;
  customerDecisionMakerEmail: string | null;
  renewalNotes: string | null;
  status: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type CommercialContractCreateInput = {
  commercialAccountId: number;
  contractNumber?: string;
  contractTitle?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  renewalDate?: string;
  renewalNoticeDays?: number;
  contractTermMonths?: number;
  renewalType?: string;
  renewalCommitmentStatus?: string;
  contractValue?: number;
  currency?: string;
  billingCycle?: string;
  paymentTerms?: string;
  internalOwnerUserId?: number | null;
  customerDecisionMakerName?: string;
  customerDecisionMakerEmail?: string;
  renewalNotes?: string;
  status?: string;
};

export type CommercialContractUpdateInput = Partial<Omit<CommercialContractCreateInput, "commercialAccountId">>;

export const commercialContractKeys = {
  list: (tenantId: string) => ["platform", "tenants", tenantId, "commercial-contracts"] as const,
  detail: (tenantId: string, contractId: number) =>
    ["platform", "tenants", tenantId, "commercial-contracts", contractId] as const,
};

export function useTenantCommercialContracts(tenantId: string | undefined) {
  return useQuery({
    queryKey: commercialContractKeys.list(tenantId ?? ""),
    enabled:  !!tenantId,
    queryFn:  () =>
      apiFetch<{ contracts: CommercialContractTerm[] }>(
        `/platform/tenants/${tenantId}/commercial-contracts`,
      ),
    select: (data) => data.contracts,
  });
}

export function useTenantCommercialContract(
  tenantId: string | undefined,
  contractId: number | undefined,
) {
  return useQuery({
    queryKey: commercialContractKeys.detail(tenantId ?? "", contractId ?? 0),
    enabled:  !!tenantId && !!contractId,
    queryFn:  () =>
      apiFetch<{ contract: CommercialContractTerm }>(
        `/platform/tenants/${tenantId}/commercial-contracts/${contractId}`,
      ),
    select: (data) => data.contract,
  });
}

export function useCreateTenantCommercialContract(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommercialContractCreateInput) =>
      apiFetch<{ contract: CommercialContractTerm }>(
        `/platform/tenants/${tenantId}/commercial-contracts`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialContractKeys.list(tenantId) });
    },
  });
}

export function useUpdateTenantCommercialContract(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, input }: { contractId: number; input: CommercialContractUpdateInput }) =>
      apiFetch<{ contract: CommercialContractTerm }>(
        `/platform/tenants/${tenantId}/commercial-contracts/${contractId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: commercialContractKeys.list(tenantId) });
      void qc.invalidateQueries({
        queryKey: commercialContractKeys.detail(tenantId, vars.contractId),
      });
    },
  });
}

export function useUpdateTenantCommercialContractStatus(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, status, reason }: { contractId: number; status: string; reason: string }) =>
      apiFetch<{ contract: CommercialContractTerm }>(
        `/platform/tenants/${tenantId}/commercial-contracts/${contractId}/status`,
        { method: "PATCH", body: JSON.stringify({ status, reason }) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: commercialContractKeys.list(tenantId) });
      void qc.invalidateQueries({
        queryKey: commercialContractKeys.detail(tenantId, vars.contractId),
      });
    },
  });
}
