/**
 * F6.2 — Frontend attendance cutover flags (pilot-scoped via API status).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";

export type AttendanceCutoverFlagKey = "attendanceCanonicalWrite" | "legacyAttendanceFreeze";

export type AttendanceCutoverFlags = Record<AttendanceCutoverFlagKey, boolean>;

export type AttendanceCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  globalFlags: AttendanceCutoverFlags;
  attendanceCanonicalWrite: boolean;
  legacyAttendanceFrozen: boolean;
  legacyAttendanceReadOnly: boolean;
  canonicalWriteEnabled: boolean;
  workforceImportPath?: string;
  workforceClockPath?: string;
};

export async function fetchAttendanceCutoverStatus(): Promise<AttendanceCutoverStatus> {
  const res = await apiClient.get<AttendanceCutoverStatus>("/api/hr/attendance-cutover/status");
  return res.data;
}

export function useAttendanceCutover() {
  const q = useQuery({
    queryKey: ["/hr/attendance-cutover/status"],
    queryFn: fetchAttendanceCutoverStatus,
    staleTime: 60_000,
  });
  const status = q.data;
  return {
    ...q,
    status,
    isPilotWorkspace: status?.isPilotWorkspace ?? false,
    useCanonicalAttendance: status?.attendanceCanonicalWrite ?? false,
    legacyAttendanceReadOnly: status?.legacyAttendanceReadOnly ?? false,
    legacyAttendanceFrozen: status?.legacyAttendanceFrozen ?? false,
    pilotWorkspaceId: status?.pilotWorkspaceId ?? null,
  };
}
