/**
 * Phase 5 — Auto-create approval queue runtime.
 */

import { db, hrImportAutoCreatePendingTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AutoCreateProposal } from "./auto-create-policy-engine";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { recordAutoCreateTelemetry } from "../telemetry/auto-create-telemetry";

export async function queueAutoCreateProposals(input: {
  workspaceId: number;
  sessionId?: number;
  userId?: number;
  proposals: AutoCreateProposal[];
}): Promise<number[]> {
  const ids: number[] = [];
  const toQueue = input.proposals.filter((p) => p.action === "queue_approval");

  for (const p of toQueue) {
    const [row] = await db
      .insert(hrImportAutoCreatePendingTable)
      .values({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId ?? null,
        entityType: p.entityType,
        proposedCode: p.proposedCode,
        proposedName: p.proposedName,
        proposedNameAr: p.proposedNameAr ?? null,
        status: "pending",
        duplicateKey: p.duplicateKey,
        policySnapshot: p.policy,
        metadata: { rowNumber: p.rowNumber, phase: 5 },
        requestedByUserId: input.userId ?? null,
      })
      .returning({ id: hrImportAutoCreatePendingTable.id });

    ids.push(row!.id);

    void recordWorkforceAudit({
      workspaceId: input.workspaceId,
      entityType: "hr_import_auto_create_pending",
      entityId: row!.id,
      action: "auto_create.queued",
      actorUserId: input.userId,
      afterState: { proposal: p },
      correlationId: input.sessionId ? `session:${input.sessionId}` : null,
    });
  }

  if (ids.length) {
    void recordAutoCreateTelemetry({
      workspaceId: input.workspaceId,
      event: "approval_queued",
      count: ids.length,
      sessionId: input.sessionId,
    });
  }

  return ids;
}

export async function listPendingAutoCreates(workspaceId: number, limit = 100) {
  return db
    .select()
    .from(hrImportAutoCreatePendingTable)
    .where(
      and(
        eq(hrImportAutoCreatePendingTable.workspaceId, workspaceId),
        eq(hrImportAutoCreatePendingTable.status, "pending"),
      ),
    )
    .orderBy(desc(hrImportAutoCreatePendingTable.createdAt))
    .limit(Math.min(limit, 500));
}

export async function approveAutoCreateItems(input: {
  workspaceId: number;
  pendingIds: number[];
  approvedByUserId?: number;
}): Promise<{ approved: number; rejected: number; errors: string[] }> {
  const rows = await db
    .select()
    .from(hrImportAutoCreatePendingTable)
    .where(
      and(
        eq(hrImportAutoCreatePendingTable.workspaceId, input.workspaceId),
        inArray(hrImportAutoCreatePendingTable.id, input.pendingIds),
        eq(hrImportAutoCreatePendingTable.status, "pending"),
      ),
    );

  let approved = 0;
  let rejected = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      await db
        .update(hrImportAutoCreatePendingTable)
        .set({
          status: "approved",
          approvedByUserId: input.approvedByUserId ?? null,
        })
        .where(eq(hrImportAutoCreatePendingTable.id, row.id));

      void recordWorkforceAudit({
        workspaceId: input.workspaceId,
        entityType: "hr_import_auto_create_pending",
        entityId: row.id,
        action: "auto_create.approved",
        actorUserId: input.approvedByUserId,
        beforeState: { status: "pending" },
        afterState: { status: "approved" },
      });

      approved++;
    } catch (e) {
      rejected++;
      errors.push(`Pending ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  void recordAutoCreateTelemetry({
    workspaceId: input.workspaceId,
    event: "approval_processed",
    count: approved,
    metadata: { rejected, errorCount: errors.length },
  });

  return { approved, rejected, errors };
}

export function buildApprovalDiagnostics(pending: Awaited<ReturnType<typeof listPendingAutoCreates>>) {
  return {
    pendingCount: pending.length,
    byEntityType: pending.reduce<Record<string, number>>((acc, p) => {
      acc[p.entityType] = (acc[p.entityType] ?? 0) + 1;
      return acc;
    }, {}),
    approvalRequired: true,
    rollbackSafe: true,
  };
}
