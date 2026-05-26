/**
 * F5.2 — Mirror canonical leave_requests → hr_employee_leaves (read-compat layer).
 * One-way sync after canonical writes; does not dual-write balances (canonical owns balances).
 */

import { db } from "@workspace/db";
import {
  hrEmployeeLeavesTable,
  hrLeaveMigrationMapTable,
  leaveRequestsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { shouldRunLegacyAdapter } from "../workforce/stabilization/cleanup-staging";
import { shouldMirrorCanonicalToLegacy } from "./canonical-write-policy";
import { logger } from "../logger";

type LeaveRequestRow = typeof leaveRequestsTable.$inferSelect;

function mapCanonicalStatusToLegacy(status: string): string {
  if (status === "pending_approval" || status === "pending") return "pending";
  if (status === "withdrawn") return "cancelled";
  if (["approved", "rejected", "cancelled"].includes(status)) return status;
  return "pending";
}

export async function mirrorCanonicalLeaveToLegacy(
  workspaceId: number,
  leaveRequestId: number,
): Promise<{ mirrored: boolean; legacyLeaveId?: number }> {
  if (!(await shouldMirrorCanonicalToLegacy(workspaceId))) {
    return { mirrored: false };
  }
  if (!(await shouldRunLegacyAdapter(workspaceId, "leave_dual_write"))) {
    return { mirrored: false };
  }

  const [req] = await db
    .select()
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.id, leaveRequestId),
        eq(leaveRequestsTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!req) return { mirrored: false };

  try {
    return await upsertLegacyMirrorRow(workspaceId, req);
  } catch (err) {
    logger.warn({ err, leaveRequestId, workspaceId }, "[leave-mirror] canonical→legacy mirror failed");
    return { mirrored: false };
  }
}

async function upsertLegacyMirrorRow(
  workspaceId: number,
  req: LeaveRequestRow,
): Promise<{ mirrored: boolean; legacyLeaveId?: number }> {
  const legacyStatus = mapCanonicalStatusToLegacy(req.status);

  const [existingMap] = await db
    .select({ legacyLeaveId: hrLeaveMigrationMapTable.legacyLeaveId })
    .from(hrLeaveMigrationMapTable)
    .where(
      and(
        eq(hrLeaveMigrationMapTable.workspaceId, workspaceId),
        eq(hrLeaveMigrationMapTable.canonicalRequestId, req.id),
      ),
    )
    .limit(1);

  if (existingMap) {
    await db
      .update(hrEmployeeLeavesTable)
      .set({
        leaveType: req.leaveType,
        startDate: req.startDate,
        endDate: req.endDate,
        daysCount: req.businessDaysCount,
        status: legacyStatus,
        reason: req.employeeNote,
        notes: req.managerNote,
        approvedBy: req.approvedByUserId,
        approvedAt: req.approvedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(hrEmployeeLeavesTable.id, existingMap.legacyLeaveId),
          eq(hrEmployeeLeavesTable.workspaceId, workspaceId),
        ),
      );
    return { mirrored: true, legacyLeaveId: existingMap.legacyLeaveId };
  }

  const [legacyRow] = await db
    .insert(hrEmployeeLeavesTable)
    .values({
      workspaceId,
      employeeId: req.employeeId,
      leaveType: req.leaveType,
      startDate: req.startDate,
      endDate: req.endDate,
      daysCount: req.businessDaysCount,
      status: legacyStatus,
      reason: req.employeeNote,
      notes: req.managerNote,
      approvedBy: req.approvedByUserId,
      approvedAt: req.approvedAt,
      createdBy: req.requestedByUserId,
    })
    .returning({ id: hrEmployeeLeavesTable.id });

  if (!legacyRow) return { mirrored: false };

  await db
    .insert(hrLeaveMigrationMapTable)
    .values({
      workspaceId,
      legacyLeaveId: legacyRow.id,
      canonicalRequestId: req.id,
    })
    .onConflictDoNothing();

  return { mirrored: true, legacyLeaveId: legacyRow.id };
}
