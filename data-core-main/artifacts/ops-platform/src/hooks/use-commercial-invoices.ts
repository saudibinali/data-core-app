/**
 * @phase P15-C - Invoice Records & Uploaded Invoice PDFs
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(json = true): HeadersInit {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
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

export interface CommercialInvoice {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractTermId: number | null;
  invoiceNumber: string;
  invoiceTitle: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceAmount: string | null;
  currency: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  status: string;
  externalAccountingSystemName: string | null;
  externalAccountingReference: string | null;
  notes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  documentStatus?: "uploaded" | "missing";
}

export interface CommercialInvoiceDocumentMeta {
  id: number;
  invoiceId: number;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: number | null;
  uploadedAt: string;
  createdAt: string;
  hasDocument: boolean;
}

export type CommercialInvoiceCreateInput = {
  commercialAccountId: number;
  contractTermId?: number | null;
  invoiceNumber: string;
  invoiceTitle?: string;
  invoiceDate?: string;
  dueDate?: string;
  invoiceAmount?: number;
  currency?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  status?: string;
  externalAccountingSystemName?: string;
  externalAccountingReference?: string;
  notes?: string;
};

export type CommercialInvoiceUpdateInput = Partial<
  Omit<CommercialInvoiceCreateInput, "commercialAccountId">
>;

export type CommercialInvoiceFilters = {
  status?: string;
  contractTermId?: number;
};

export const commercialInvoiceKeys = {
  list: (tenantId: string, filters?: CommercialInvoiceFilters) =>
    ["platform", "tenants", tenantId, "commercial-invoices", filters ?? {}] as const,
  detail: (tenantId: string, invoiceId: number) =>
    ["platform", "tenants", tenantId, "commercial-invoices", invoiceId] as const,
};

function listQuery(tenantId: string, filters?: CommercialInvoiceFilters): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.contractTermId !== undefined) {
    params.set("contractTermId", String(filters.contractTermId));
  }
  const q = params.toString();
  return `/platform/tenants/${tenantId}/commercial-invoices${q ? `?${q}` : ""}`;
}

export function useTenantCommercialInvoices(
  tenantId: string | undefined,
  filters?: CommercialInvoiceFilters,
) {
  return useQuery({
    queryKey: commercialInvoiceKeys.list(tenantId ?? "", filters),
    enabled:  !!tenantId,
    queryFn:  () =>
      apiFetch<{ invoices: CommercialInvoice[] }>(listQuery(tenantId!, filters)),
    select: (data) => data.invoices,
  });
}

export function useTenantCommercialInvoice(
  tenantId: string | undefined,
  invoiceId: number | undefined,
) {
  return useQuery({
    queryKey: commercialInvoiceKeys.detail(tenantId ?? "", invoiceId ?? 0),
    enabled:  !!tenantId && !!invoiceId,
    queryFn:  () =>
      apiFetch<{ invoice: CommercialInvoice; document?: CommercialInvoiceDocumentMeta | null }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}`,
      ),
  });
}

export function useCreateTenantCommercialInvoice(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommercialInvoiceCreateInput) =>
      apiFetch<{ invoice: CommercialInvoice }>(
        `/platform/tenants/${tenantId}/commercial-invoices`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["platform", "tenants", tenantId, "commercial-invoices"],
      });
    },
  });
}

export function useUpdateTenantCommercialInvoice(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, input }: { invoiceId: number; input: CommercialInvoiceUpdateInput }) =>
      apiFetch<{ invoice: CommercialInvoice }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["platform", "tenants", tenantId, "commercial-invoices"],
      });
      void qc.invalidateQueries({
        queryKey: commercialInvoiceKeys.detail(tenantId, vars.invoiceId),
      });
    },
  });
}

export function useUpdateTenantCommercialInvoiceStatus(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, status, reason }: { invoiceId: number; status: string; reason: string }) =>
      apiFetch<{ invoice: CommercialInvoice }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/status`,
        { method: "PATCH", body: JSON.stringify({ status, reason }) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["platform", "tenants", tenantId, "commercial-invoices"],
      });
      void qc.invalidateQueries({
        queryKey: commercialInvoiceKeys.detail(tenantId, vars.invoiceId),
      });
    },
  });
}

export function useUploadCommercialInvoiceDocument(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, file }: { invoiceId: number; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const token = getToken();
      const res = await fetch(
        `${BASE}/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/document`,
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
      return res.json() as Promise<{ document: CommercialInvoiceDocumentMeta }>;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["platform", "tenants", tenantId, "commercial-invoices"],
      });
      void qc.invalidateQueries({
        queryKey: commercialInvoiceKeys.detail(tenantId, vars.invoiceId),
      });
    },
  });
}

export function useDownloadCommercialInvoiceDocument(tenantId: string) {
  return useMutation({
    mutationFn: async ({
      invoiceId,
      fileName,
    }: {
      invoiceId: number;
      fileName: string;
    }) => {
      const token = getToken();
      const res = await fetch(
        `${BASE}/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/document`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "invoice.pdf";
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
