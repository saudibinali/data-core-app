/**
 * @phase P15-F - Commercial Risk & Renewal Readiness hooks
 */

import { useQuery } from "@tanstack/react-query";
import type {
  CommercialRiskLevel,
  RenewalReadinessStatus,
} from "@/lib/commercial-config";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface CommercialRiskPlatformSummary {
  totalTenants: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  readyRenewalsCount: number;
  attentionNeededCount: number;
  atRiskRenewalsCount: number;
  blockedRenewalsCount: number;
  totalOutstandingAmount: string;
  overdueInvoiceCount: number;
  upcomingRenewalsCount: number;
}

export interface CommercialRiskListItem {
  tenantId: number;
  tenantName: string;
  riskLevel: CommercialRiskLevel;
  renewalReadinessStatus: RenewalReadinessStatus;
  outstandingAmount: string;
  overdueInvoiceCount: number;
  contractEndDate: string | null;
  renewalDate: string | null;
  reasons: string[];
}

export interface CommercialRiskSignals {
  activeContractExists: boolean;
  daysUntilContractEnd: number | null;
  daysUntilRenewalDate: number | null;
  renewalCommitmentStatus: string | null;
  renewalNoticeDays: number | null;
  unpaidInvoiceCount: number;
  overdueInvoiceCount: number;
  outstandingAmount: string;
  disputedPaymentCount: number;
  hasRejectedPayments: boolean;
  hasOverdueInvoices: boolean;
  hasExpiredContract: boolean;
  hasMissingBillingContact: boolean;
  hasMissingInvoicePdf: boolean;
  lastPaymentDate: string | null;
  lastInvoiceDate: string | null;
  contractEndDate: string | null;
  renewalDate: string | null;
}

export interface TenantCommercialRiskDetail {
  tenantId: number;
  tenantName: string;
  riskLevel: CommercialRiskLevel;
  renewalReadinessStatus: RenewalReadinessStatus;
  signals: CommercialRiskSignals;
  reasons: string[];
  recommendedActions: string[];
}

export type CommercialRiskListFilters = {
  riskLevel?: string;
  renewalReadinessStatus?: string;
  hasOverdueInvoices?: boolean;
  renewalWithinDays?: number;
};

export const commercialRiskKeys = {
  summary: () => ["platform", "commercial-risk", "summary"] as const,
  list: (filters?: CommercialRiskListFilters) =>
    ["platform", "commercial-risk", "list", filters ?? {}] as const,
  tenant: (tenantId: string) => ["platform", "tenants", tenantId, "commercial-risk"] as const,
};

function listPath(filters?: CommercialRiskListFilters): string {
  const params = new URLSearchParams();
  if (filters?.riskLevel) params.set("riskLevel", filters.riskLevel);
  if (filters?.renewalReadinessStatus) {
    params.set("renewalReadinessStatus", filters.renewalReadinessStatus);
  }
  if (filters?.hasOverdueInvoices) params.set("hasOverdueInvoices", "true");
  if (filters?.renewalWithinDays !== undefined) {
    params.set("renewalWithinDays", String(filters.renewalWithinDays));
  }
  const q = params.toString();
  return `/platform/commercial-risk/list${q ? `?${q}` : ""}`;
}

export function useCommercialRiskSummary(enabled = true) {
  return useQuery({
    enabled,
    queryKey: commercialRiskKeys.summary(),
    queryFn: async () => {
      const data = await apiFetch<{ summary: CommercialRiskPlatformSummary }>(
        "/platform/commercial-risk/summary",
      );
      return data.summary;
    },
  });
}

export function useCommercialRiskList(filters?: CommercialRiskListFilters, enabled = true) {
  return useQuery({
    enabled,
    queryKey: commercialRiskKeys.list(filters),
    queryFn: async () => {
      const data = await apiFetch<{ tenants: CommercialRiskListItem[] }>(listPath(filters));
      return data.tenants;
    },
  });
}

export function useTenantCommercialRisk(tenantId: string | undefined, canRead = true) {
  return useQuery({
    queryKey: commercialRiskKeys.tenant(tenantId ?? ""),
    enabled: canRead && !!tenantId,
    queryFn: async () => {
      const data = await apiFetch<{ risk: TenantCommercialRiskDetail }>(
        `/platform/tenants/${tenantId}/commercial-risk`,
      );
      return data.risk;
    },
  });
}
