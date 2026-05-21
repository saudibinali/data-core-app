/**
 * @phase P16-E - Tenant workspace member access mode (banner / UI gating)
 */

import { useQuery } from "@tanstack/react-query";
import { isWorkspaceReadOnlyStatus } from "@/lib/workspace-access-enforcement-config";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

export interface TenantWorkspaceAccessSnapshot {
  enforcementStatus: string;
  allowLogin: boolean;
  allowRead: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  allowExport: boolean;
  allowAdminAccess: boolean;
  reason: string | null;
  subscriptionStatus?: string | null;
  isPlatformUser?: boolean;
}

export const tenantMemberAccessKey = ["tenant", "workspace-access"] as const;

export function useTenantMemberWorkspaceAccess(enabled: boolean) {
  return useQuery({
    queryKey: tenantMemberAccessKey,
    enabled,
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${BASE}/tenant/workspace-access`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error("Failed to load workspace access mode");
      }
      const data = (await res.json()) as { access: TenantWorkspaceAccessSnapshot };
      return data.access;
    },
    staleTime: 60_000,
  });
}

export function useWorkspaceOperationalWrite(access: TenantWorkspaceAccessSnapshot | undefined) {
  const readOnly = access ? isWorkspaceReadOnlyStatus(access.enforcementStatus) : false;
  return {
    isReadOnly: readOnly,
    canCreate: !readOnly && (access?.allowCreate ?? true),
    canUpdate: !readOnly && (access?.allowUpdate ?? true),
    canDelete: !readOnly && (access?.allowDelete ?? true),
    canExport: access?.allowExport ?? true,
  };
}
