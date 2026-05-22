import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export type TenantProductModule = {
  key: string;
  name: string;
  description: string | null;
  core: boolean;
  defaultEnabled: boolean;
  enabled: boolean;
  displayOrder: number;
};

export function useTenantProductModules(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["tenant-product-modules", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await apiFetch<{ modules: TenantProductModule[] }>(
        `/platform/tenants/${tenantId}/product-modules`,
      );
      return res.modules;
    },
  });
}

export function useUpdateTenantProductModule(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { moduleKey: string; enabled: boolean }) => {
      return apiFetch<{ module: { moduleKey: string; enabled: boolean }; modules: TenantProductModule[] }>(
        `/platform/tenants/${tenantId}/product-modules/${input.moduleKey}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: input.enabled }),
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tenant-product-modules", tenantId] });
    },
  });
}
