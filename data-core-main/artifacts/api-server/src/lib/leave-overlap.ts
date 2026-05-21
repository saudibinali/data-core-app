/**
 * P18-D4 — Cross-table leave date overlap detection (canonical + legacy).
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { hrEmployeeLeavesTable, leaveRequestsTable } from "@workspace/db";

/** Active = blocks new overlapping requests. Terminal states are ignored. */
export const CANONICAL_ACTIVE_LEAVE_STATUSES = ["pending", "pending_approval", "approved"] as const;
export const LEGACY_ACTIVE_LEAVE_STATUSES = ["pending", "approved"] as const;

type DbTx = { select: (...args: unknown[]) => unknown };

export type LeaveOverlapHit = {
  source: "canonical" | "legacy";
  id: number;
  status: string;
};

export async function findLeaveDateOverlaps(
  tx: DbTx,
  params: {
    workspaceId: number;
    employeeId: number;
    startDate: string;
    endDate: string;
  },
): Promise<LeaveOverlapHit[]> {
  const { workspaceId, employeeId, startDate, endDate } = params;
  const hits: LeaveOverlapHit[] = [];

  const canonical = await tx
    .select({ id: leaveRequestsTable.id, status: leaveRequestsTable.status })
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.workspaceId, workspaceId),
        eq(leaveRequestsTable.employeeId, employeeId),
        inArray(leaveRequestsTable.status, [...CANONICAL_ACTIVE_LEAVE_STATUSES]),
        lte(leaveRequestsTable.startDate, endDate),
        gte(leaveRequestsTable.endDate, startDate),
      ),
    )
    .limit(5);

  for (const row of canonical) {
    hits.push({ source: "canonical", id: row.id, status: row.status });
  }

  const legacy = await tx
    .select({ id: hrEmployeeLeavesTable.id, status: hrEmployeeLeavesTable.status })
    .from(hrEmployeeLeavesTable)
    .where(
      and(
        eq(hrEmployeeLeavesTable.workspaceId, workspaceId),
        eq(hrEmployeeLeavesTable.employeeId, employeeId),
        inArray(hrEmployeeLeavesTable.status, [...LEGACY_ACTIVE_LEAVE_STATUSES]),
        lte(hrEmployeeLeavesTable.startDate, endDate),
        gte(hrEmployeeLeavesTable.endDate, startDate),
      ),
    )
    .limit(5);

  for (const row of legacy) {
    hits.push({ source: "legacy", id: row.id, status: row.status });
  }

  return hits;
}

export function leaveOverlapErrorMessage(hits: LeaveOverlapHit[]): string {
  const legacy = hits.find((h) => h.source === "legacy");
  const canonical = hits.find((h) => h.source === "canonical");
  if (legacy && canonical) {
    return "You already have overlapping leave in both the current and legacy systems for these dates";
  }
  if (legacy) {
    return "You already have a legacy leave record that overlaps with the selected dates";
  }
  return "You already have a leave request that overlaps with the selected dates";
}
