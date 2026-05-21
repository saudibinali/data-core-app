/**
 * @phase P15-E - Manual Payment & Collection Tracking
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CollectionState } from "@/lib/commercial-config";

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

export interface CommercialPaymentRecord {
  id: number;
  workspaceId: number;
  commercialAccountId: number;
  invoiceId: number;
  paymentReference: string;
  paymentDate: string;
  receivedAmount: string;
  currency: string;
  paymentMethod: string;
  collectionStatus: string;
  recordedByUserId: number;
  verifiedByUserId: number | null;
  verificationDate: string | null;
  internalNotes: string | null;
  rejectionReason: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceCollectionSummary {
  invoiceId: number;
  invoiceAmount: string | null;
  currency: string | null;
  totalRecordedPayments: string;
  totalVerifiedPayments: string;
  outstandingAmount: string;
  collectionState: CollectionState;
  paymentCount: number;
  verifiedPaymentCount: number;
  hasRejectedPayments: boolean;
}

export type CommercialPaymentFilters = {
  invoiceId?: number;
  collectionStatus?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
};

export type RecordPaymentInput = {
  paymentReference: string;
  paymentDate: string;
  receivedAmount: number;
  currency?: string;
  paymentMethod: string;
  internalNotes?: string;
  commercialAccountId?: number;
};

export type UpdatePaymentInput = Partial<
  Omit<RecordPaymentInput, "commercialAccountId">
>;

export const commercialPaymentKeys = {
  list: (tenantId: string, filters?: CommercialPaymentFilters) =>
    ["platform", "tenants", tenantId, "commercial-payments", filters ?? {}] as const,
  summary: (tenantId: string, invoiceId: number) =>
    ["platform", "tenants", tenantId, "commercial-invoices", invoiceId, "collection-summary"] as const,
};

function paymentsListPath(tenantId: string, filters?: CommercialPaymentFilters): string {
  const params = new URLSearchParams();
  if (filters?.invoiceId) params.set("invoiceId", String(filters.invoiceId));
  if (filters?.collectionStatus) params.set("collectionStatus", filters.collectionStatus);
  if (filters?.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const q = params.toString();
  return `/platform/tenants/${tenantId}/commercial-payments${q ? `?${q}` : ""}`;
}

export function useTenantCommercialPayments(
  tenantId: string | undefined,
  filters?: CommercialPaymentFilters,
) {
  return useQuery({
    queryKey: commercialPaymentKeys.list(tenantId ?? "", filters),
    enabled: !!tenantId,
    queryFn: async () => {
      const data = await apiFetch<{ payments: CommercialPaymentRecord[] }>(
        paymentsListPath(tenantId!, filters),
      );
      return data.payments;
    },
  });
}

export function useInvoiceCollectionSummary(
  tenantId: string | undefined,
  invoiceId: number | undefined,
) {
  return useQuery({
    queryKey: commercialPaymentKeys.summary(tenantId ?? "", invoiceId ?? 0),
    enabled: !!tenantId && !!invoiceId && invoiceId > 0,
    queryFn: async () => {
      const data = await apiFetch<{ summary: InvoiceCollectionSummary }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/collection-summary`,
      );
      return data.summary;
    },
  });
}

function invalidatePaymentQueries(qc: ReturnType<typeof useQueryClient>, tenantId: string, invoiceId: number) {
  void qc.invalidateQueries({ queryKey: ["platform", "tenants", tenantId, "commercial-payments"] });
  void qc.invalidateQueries({
    queryKey: commercialPaymentKeys.summary(tenantId, invoiceId),
  });
}

export function useRecordCommercialPayment(tenantId: string, invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordPaymentInput) =>
      apiFetch<{ payment: CommercialPaymentRecord }>(
        `/platform/tenants/${tenantId}/commercial-invoices/${invoiceId}/payments`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => invalidatePaymentQueries(qc, tenantId, invoiceId),
  });
}

export function useUpdateCommercialPayment(tenantId: string, invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, input }: { paymentId: number; input: UpdatePaymentInput }) =>
      apiFetch<{ payment: CommercialPaymentRecord }>(
        `/platform/tenants/${tenantId}/commercial-payments/${paymentId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => invalidatePaymentQueries(qc, tenantId, invoiceId),
  });
}

export function useVerifyCommercialPayment(tenantId: string, invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) =>
      apiFetch<{ payment: CommercialPaymentRecord }>(
        `/platform/tenants/${tenantId}/commercial-payments/${paymentId}/verify`,
        { method: "PATCH", body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => invalidatePaymentQueries(qc, tenantId, invoiceId),
  });
}

export function useRejectCommercialPayment(tenantId: string, invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) =>
      apiFetch<{ payment: CommercialPaymentRecord }>(
        `/platform/tenants/${tenantId}/commercial-payments/${paymentId}/reject`,
        { method: "PATCH", body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => invalidatePaymentQueries(qc, tenantId, invoiceId),
  });
}

export function useReverseCommercialPayment(tenantId: string, invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) =>
      apiFetch<{ payment: CommercialPaymentRecord }>(
        `/platform/tenants/${tenantId}/commercial-payments/${paymentId}/reverse`,
        { method: "PATCH", body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => invalidatePaymentQueries(qc, tenantId, invoiceId),
  });
}
