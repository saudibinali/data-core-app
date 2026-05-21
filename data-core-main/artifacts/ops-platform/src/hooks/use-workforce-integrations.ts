import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "@/hooks/use-api-fetch";

export type WorkforceConnector = {
  connectorKey: string;
  capabilities: string[];
};

export type AttendanceIntegration = {
  id: number;
  workspaceId: number;
  name: string;
  connectorKey: string;
  isEnabled: boolean;
  configJson?: string;
  hasCredentials: boolean;
  credentialVersion?: number;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  pollIntervalMinutes: number;
  createdAt?: string;
};

export type CreateIntegrationResult = AttendanceIntegration & {
  webhookUrl?: string;
  webhookSecretOnce?: string;
};

const CONNECTORS_KEY = ["/api/hr/workforce/integrations/connectors"];
const LIST_KEY = ["/api/hr/workforce/integrations"];

export function useWorkforceConnectors(enabled = true) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: CONNECTORS_KEY,
    enabled,
    queryFn: async () => {
      const res = await apiFetch("/api/hr/workforce/integrations/connectors");
      if (!res.ok) throw new Error("Failed to load connectors");
      const data = (await res.json()) as { connectors: WorkforceConnector[] };
      return data.connectors;
    },
  });
}

export function useAttendanceIntegrations(enabled = true) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: LIST_KEY,
    enabled,
    queryFn: async () => {
      const res = await apiFetch("/api/hr/workforce/integrations");
      if (!res.ok) throw new Error("Failed to load integrations");
      return (await res.json()) as AttendanceIntegration[];
    },
  });
}

export function useCreateAttendanceIntegration() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      connectorKey: string;
      config?: Record<string, unknown>;
      credentials?: Record<string, string>;
      pollIntervalMinutes?: number;
    }) => {
      const res = await apiFetch("/api/hr/workforce/integrations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Create failed");
      }
      return (await res.json()) as CreateIntegrationResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUpdateAttendanceIntegration() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: number;
      name?: string;
      isEnabled?: boolean;
      pollIntervalMinutes?: number;
      rotateWebhookSecret?: boolean;
      credentials?: Record<string, string>;
    }) => {
      const res = await apiFetch(`/api/hr/workforce/integrations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Update failed");
      }
      const data = (await res.json()) as CreateIntegrationResult;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useTestAttendanceIntegration() {
  const apiFetch = useApiFetch();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/hr/workforce/integrations/${id}/test`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Test failed");
      return res.json() as Promise<{ ok: boolean; message?: string }>;
    },
  });
}

export function useSyncAttendanceIntegration() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/hr/workforce/integrations/${id}/sync`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function buildAttendanceWebhookUrl(integrationId: number): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/integrations/attendance/${integrationId}/webhook`;
}
