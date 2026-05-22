/**
 * Operational commercial contracts API.
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

export type OperationalReminder = {
  code: string;
  label: string;
  urgency: "none" | "upcoming" | "due" | "overdue";
  relatedDate: string | null;
};

export type OperationalContract = {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractNumber: string | null;
  contractTitle: string | null;
  companyName: string | null;
  responsiblePersonName: string | null;
  responsiblePersonPhone: string | null;
  responsiblePersonEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalReminderDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  reminders: OperationalReminder[];
  primaryReminder: OperationalReminder | null;
  createdAt: string;
  updatedAt: string;
};

export type OperationalContractInput = {
  commercialAccountId: number;
  contractNumber?: string;
  contractTitle?: string;
  companyName?: string;
  responsiblePersonName?: string;
  responsiblePersonPhone?: string;
  responsiblePersonEmail?: string;
  startDate?: string;
  endDate?: string;
  renewalReminderDate?: string;
  notes?: string;
};

export function useTenantCommercialContracts(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["operational-contracts", tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ contracts: OperationalContract[] }>(
        `/platform/tenants/${tenantId}/commercial-contracts`,
      ).then((r) => r.contracts),
  });
}

export function useCreateTenantCommercialContract(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OperationalContractInput) =>
      apiFetch<{ contract: OperationalContract }>(
        `/platform/tenants/${tenantId}/commercial-contracts`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-contracts", tenantId] });
    },
  });
}

export function useUpdateTenantCommercialContract(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      contractId,
      input,
    }: {
      contractId: number;
      input: Partial<OperationalContractInput>;
    }) =>
      apiFetch<{ contract: OperationalContract }>(
        `/platform/tenants/${tenantId}/commercial-contracts/${contractId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-contracts", tenantId] });
    },
  });
}

export function useUploadCommercialContractDocument(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, file }: { contractId: number; file: File }) => {
      const token = getToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `${BASE}/platform/tenants/${tenantId}/commercial-contracts/${contractId}/document`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-contracts", tenantId] });
    },
  });
}

export function useDownloadCommercialContractDocument(tenantId: string) {
  return useMutation({
    mutationFn: async (contractId: number) => {
      const token = getToken();
      const res = await fetch(
        `${BASE}/platform/tenants/${tenantId}/commercial-contracts/${contractId}/document`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contract-${contractId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

/** @deprecated Use OperationalContract */
export type CommercialContractTerm = OperationalContract;
export type CommercialContractCreateInput = OperationalContractInput;
