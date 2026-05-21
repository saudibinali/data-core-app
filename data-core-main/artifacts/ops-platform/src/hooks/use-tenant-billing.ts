/**
 * @phase P15-D - Tenant Billing Portal hooks
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import type { TenantBillingInvoice } from "@/lib/tenant-billing-config";

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

export type TenantBillingInvoiceFilters = {
  status?: string;
  from?: string;
  to?: string;
};

export const tenantBillingKeys = {
  list: (filters?: TenantBillingInvoiceFilters) =>
    ["tenant", "billing", "invoices", filters ?? {}] as const,
  detail: (invoiceId: number) =>
    ["tenant", "billing", "invoices", invoiceId] as const,
};

function listPath(filters?: TenantBillingInvoiceFilters): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const q = params.toString();
  return `/tenant/billing/invoices${q ? `?${q}` : ""}`;
}

export function useTenantBillingInvoices(filters?: TenantBillingInvoiceFilters) {
  return useQuery({
    queryKey: tenantBillingKeys.list(filters),
    queryFn: async () => {
      const data = await apiFetch<{ invoices: TenantBillingInvoice[] }>(listPath(filters));
      return data.invoices;
    },
  });
}

export function useTenantBillingInvoice(invoiceId: number | undefined) {
  return useQuery({
    queryKey: tenantBillingKeys.detail(invoiceId ?? 0),
    enabled: !!invoiceId && invoiceId > 0,
    queryFn: async () => {
      const data = await apiFetch<{ invoice: TenantBillingInvoice }>(
        `/tenant/billing/invoices/${invoiceId}`,
      );
      return data.invoice;
    },
  });
}

export function useDownloadTenantInvoiceDocument() {
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
        `${BASE}/tenant/billing/invoices/${invoiceId}/document`,
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
