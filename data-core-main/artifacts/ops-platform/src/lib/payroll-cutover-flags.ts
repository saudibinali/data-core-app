/**
 * F6.1 — Frontend payroll cutover flags (pilot-scoped via API status).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";

export type PayrollCutoverFlagKey = "payrollCanonicalWrite" | "legacyPayrollFreeze";

export type PayrollCutoverFlags = Record<PayrollCutoverFlagKey, boolean>;

export type PayrollCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  globalFlags: PayrollCutoverFlags;
  payrollCanonicalWrite: boolean;
  legacyPayrollFrozen: boolean;
  legacyRunsReadOnly: boolean;
  canonicalWriteEnabled: boolean;
};

export async function fetchPayrollCutoverStatus(): Promise<PayrollCutoverStatus> {
  const res = await apiClient.get<PayrollCutoverStatus>("/api/hr/payroll-cutover/status");
  return res.data;
}

export function usePayrollCutover() {
  const q = useQuery({
    queryKey: ["/hr/payroll-cutover/status"],
    queryFn: fetchPayrollCutoverStatus,
    staleTime: 60_000,
  });
  const status = q.data;
  return {
    ...q,
    status,
    isPilotWorkspace: status?.isPilotWorkspace ?? false,
    useCanonicalPayroll: status?.payrollCanonicalWrite ?? false,
    legacyPayrollFrozen: status?.legacyPayrollFrozen ?? false,
    legacyRunsReadOnly: status?.legacyRunsReadOnly ?? false,
    pilotWorkspaceId: status?.pilotWorkspaceId ?? null,
  };
}
