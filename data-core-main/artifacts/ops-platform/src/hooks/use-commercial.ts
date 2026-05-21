/**
 * use-commercial.ts
 *
 * @phase P15-A - Commercial Accounts & Billing Contacts
 *
 * React Query hooks for commercial account and billing contact management.
 * All requests go through the platform API endpoints.
 *
 * SAFETY CONTRACT:
 *   - No payment, no Stripe, no invoice, no tax logic.
 *   - No delete - contacts are updated only.
 *   - No tenant-side visibility.
 *   - All writes require commercial.accounts.update / commercial.contacts.update permissions.
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommercialAccount {
  id:                          number;
  workspaceId:                 number;
  commercialAccountName:       string | null;
  legalEntityName:             string | null;
  accountManagerUserId:        number | null;
  financeOwnerUserId:          number | null;
  contractOwnerName:           string | null;
  contractOwnerEmail:          string | null;
  billingEmail:                string | null;
  billingPhone:                string | null;
  companyTaxNumberPlaceholder: string | null;
  commercialNotes:             string | null;
  status:                      string;
  createdBy:                   number | null;
  updatedBy:                   number | null;
  createdAt:                   string;
  updatedAt:                   string;
}

export interface BillingContact {
  id:                  number;
  commercialAccountId: number;
  contactName:         string;
  contactEmail:        string;
  contactPhone:        string | null;
  contactRole:         string;
  isPrimary:           boolean;
  notes:               string | null;
  createdBy:           number | null;
  updatedBy:           number | null;
  createdAt:           string;
  updatedAt:           string;
}

export type CommercialAccountUpsertInput = Partial<{
  commercialAccountName:       string;
  legalEntityName:             string;
  billingEmail:                string;
  billingPhone:                string;
  contractOwnerName:           string;
  contractOwnerEmail:          string;
  companyTaxNumberPlaceholder: string;
  commercialNotes:             string;
  status:                      string;
}>;

export interface BillingContactCreateInput {
  contactName:   string;
  contactEmail:  string;
  contactPhone?: string;
  contactRole?:  string;
  notes?:        string;
}

export type BillingContactUpdateInput = Partial<BillingContactCreateInput>;

// ── Query Keys ────────────────────────────────────────────────────────────────

export const commercialKeys = {
  account:  (tenantId: string) => ["commercial", "account",  tenantId] as const,
  contacts: (tenantId: string) => ["commercial", "contacts", tenantId] as const,
};

// ── useCommercialAccount ──────────────────────────────────────────────────────

export function useCommercialAccount(tenantId: string | undefined) {
  return useQuery({
    queryKey: commercialKeys.account(tenantId ?? ""),
    enabled:  !!tenantId,
    queryFn:  () =>
      apiFetch<{ commercialAccount: CommercialAccount | null }>(
        `/platform/tenants/${tenantId}/commercial-account`,
      ),
    select: (data) => data.commercialAccount,
  });
}

// ── useUpsertCommercialAccount ────────────────────────────────────────────────

export function useUpsertCommercialAccount(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommercialAccountUpsertInput) =>
      apiFetch<{ commercialAccount: CommercialAccount }>(
        `/platform/tenants/${tenantId}/commercial-account`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.account(tenantId) });
    },
  });
}

// ── useBillingContacts ────────────────────────────────────────────────────────

export function useBillingContacts(tenantId: string | undefined) {
  return useQuery({
    queryKey: commercialKeys.contacts(tenantId ?? ""),
    enabled:  !!tenantId,
    queryFn:  () =>
      apiFetch<{ contacts: BillingContact[] }>(
        `/platform/tenants/${tenantId}/commercial-contacts`,
      ),
    select: (data) => data.contacts,
  });
}

// ── useCreateBillingContact ───────────────────────────────────────────────────

export function useCreateBillingContact(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillingContactCreateInput) =>
      apiFetch<{ contact: BillingContact }>(
        `/platform/tenants/${tenantId}/commercial-contacts`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.contacts(tenantId) });
    },
  });
}

// ── useUpdateBillingContact ───────────────────────────────────────────────────

export function useUpdateBillingContact(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, input }: { contactId: number; input: BillingContactUpdateInput }) =>
      apiFetch<{ contact: BillingContact }>(
        `/platform/tenants/${tenantId}/commercial-contacts/${contactId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.contacts(tenantId) });
    },
  });
}

// ── useSetPrimaryBillingContact ───────────────────────────────────────────────

export function useSetPrimaryBillingContact(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: number) =>
      apiFetch<{ contact: BillingContact }>(
        `/platform/tenants/${tenantId}/commercial-contacts/${contactId}/primary`,
        { method: "PATCH", body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.contacts(tenantId) });
    },
  });
}
