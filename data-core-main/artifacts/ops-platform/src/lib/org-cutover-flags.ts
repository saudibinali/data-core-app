/**
 * F5.1 — Frontend org cutover status (pilot-scoped via API).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";

export type OrgRuntimeMode = "legacy" | "shadow" | "active";

export type OrgCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  orgCutoverEnabled: boolean;
  orgRuntimeMode: OrgRuntimeMode;
  departmentsWritePolicy: "allow" | "read_only" | "blocked";
  legacyDepartmentsFrozen: boolean;
};

export async function fetchOrgCutoverStatus(): Promise<OrgCutoverStatus> {
  const res = await apiClient.get<OrgCutoverStatus>("/api/hr/org-cutover/status");
  return res.data;
}

export function useOrgCutover() {
  const q = useQuery({
    queryKey: ["/hr/org-cutover/status"],
    queryFn: fetchOrgCutoverStatus,
    staleTime: 60_000,
  });
  const status = q.data;
  return {
    ...q,
    status,
    legacyDepartmentsFrozen: status?.legacyDepartmentsFrozen ?? false,
    orgRuntimeMode: status?.orgRuntimeMode ?? "legacy",
  };
}
