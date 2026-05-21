import { useQuery } from "@tanstack/react-query";

/** Super-admin overview auto-refresh interval (global ops standard). */
export const PLATFORM_DASHBOARD_REFRESH_MS = 60_000;

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("ops_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface PlatformDashboardPayload {
  generatedAt: string;
  workspaces: {
    total: number;
    active: number;
    suspended: number;
    disabled: number;
    withoutSubscription: number;
  };
  users: { total: number };
  subscriptions: {
    byStatus: Record<string, number>;
    trialEndingWithin14Days: number;
    gracePeriodActive: number;
  };
  plans: { byCode: Record<string, number> };
  integrations: {
    attendanceConnections: number;
    attendanceEnabled: number;
    smtpConfigured: number;
  };
  safetyNotice: string;
}

export function usePlatformDashboard(enabled = true) {
  return useQuery({
    queryKey: ["platform", "overview", "dashboard"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/platform/overview/dashboard", {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as PlatformDashboardPayload;
    },
    refetchInterval: PLATFORM_DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  });
}
