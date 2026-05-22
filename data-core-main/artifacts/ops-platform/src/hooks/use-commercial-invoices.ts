/**
 * Operational invoice document records API.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OperationalReminder } from "@/hooks/use-commercial-contracts";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";
export const INVOICE_PDF_MAX_BYTES = 10 * 1024 * 1024;

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

export type OperationalInvoice = {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  contractTermId: number | null;
  invoiceNumber: string;
  responsiblePersonName: string | null;
  responsiblePersonPhone: string | null;
  responsiblePersonEmail: string | null;
  reminderDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  uploadedAt: string | null;
  uploadedBy: number | null;
  reminders: OperationalReminder[];
  primaryReminder: OperationalReminder | null;
  createdAt: string;
  updatedAt: string;
};

export type OperationalInvoiceInput = {
  commercialAccountId: number;
  contractTermId?: number | null;
  invoiceNumber: string;
  responsiblePersonName?: string;
  responsiblePersonPhone?: string;
  responsiblePersonEmail?: string;
  reminderDate?: string;
  notes?: string;
};

export function useTenantCommercialInvoices(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["operational-invoices", tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      apiFetch<{ invoices: OperationalInvoice[] }>(
        `/platform/tenants/${tenantId}/commercial-invoices`,
      ).then((r) => r.invoices),
  });
}

export function useCreateTenantCommercialInvoice(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OperationalInvoiceInput) =>
      apiFetch<{ invoice: OperationalInvoice }>(
        `/platform/tenants/${tenantId}/commercial-invoices`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-invoices", tenantId] });
    },
  });
}

export function useUpdateTenantCommercialInvoice(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      input,
    }: {
      invoiceId: number;
      input: Partial<OperationalInvoiceInput>;
    }) =>
      apiFetch<{ invoice: OperationalInvoice }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-invoices", tenantId] });
    },
  });
}

export function useUploadCommercialInvoiceDocument(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, file }: { invoiceId: number; file: File }) => {
      const token = getToken();
      const form = new FormData();
      form.append("file", file);
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
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operational-invoices", tenantId] });
    },
  });
}

export function useDownloadCommercialInvoiceDocument(tenantId: string) {
  return useMutation({
    mutationFn: async (invoiceId: number) => {
      const token = getToken();
      const res = await fetch(
        `${BASE}/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/document`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${invoiceId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

export type CommercialInvoice = OperationalInvoice;
export type CommercialInvoiceCreateInput = OperationalInvoiceInput;
export type CommercialInvoiceUpdateInput = Partial<OperationalInvoiceInput>;
