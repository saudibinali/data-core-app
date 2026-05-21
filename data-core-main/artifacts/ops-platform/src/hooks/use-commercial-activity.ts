/**
 * @phase P15-H - Tenant commercial activity feed
 */

import { useQuery } from "@tanstack/react-query";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface CommercialActivityItem {
  id: number;
  action: string;
  actionLabel: string;
  actionLabelAr: string;
  severity: string;
  result: string;
  actorId: number | null;
  actorDisplayName: string | null;
  metadataSummary: string | null;
  createdAt: string;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const commercialActivityKeys = {
  tenant: (tenantId: string) => ["platform", "tenants", tenantId, "commercial-activity"] as const,
};

export function useTenantCommercialActivity(tenantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: commercialActivityKeys.tenant(tenantId ?? ""),
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const data = await apiFetch<{ items: CommercialActivityItem[] }>(
        `/platform/tenants/${tenantId}/commercial-activity`,
      );
      return data.items;
    },
  });
}
