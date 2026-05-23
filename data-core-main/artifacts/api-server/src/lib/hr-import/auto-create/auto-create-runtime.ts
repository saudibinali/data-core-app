/**
 * Phase 5 — Auto-create execution runtime (controlled, approval-aware).
 */

import {
  db,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrWorkLocationsTable,
  hrDocumentTypesTable,
  hrImportSessionEntitiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { autoCreatePolicyEngine, type AutoCreatePreviewResult } from "./auto-create-policy-engine";
import { queueAutoCreateProposals } from "../approval/auto-create-approval-service";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { getImportRuntimeSettings } from "../runtime-settings";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import { recordRollbackSnapshot } from "../rollback/rollback-foundation";
import { recordAutoCreateTelemetry } from "../telemetry/auto-create-telemetry";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { runInTransaction, type TxClient } from "../commit/transaction-manager";
import type { AutoCreateProposal } from "./auto-create-policy-engine";

export type AutoCreateExecuteResult = {
  preview: AutoCreatePreviewResult;
  created: number;
  queued: number;
  rejected: number;
  entityIds: number[];
};

async function insertEntity(
  tx: TxClient,
  workspaceId: number,
  proposal: AutoCreateProposal,
): Promise<number> {
  switch (proposal.entityType) {
    case "job_title": {
      const [row] = await tx
        .insert(hrJobTitlesTable)
        .values({
          workspaceId,
          name: proposal.proposedName,
          nameAr: proposal.proposedNameAr ?? null,
          code: proposal.proposedCode,
        })
        .returning({ id: hrJobTitlesTable.id });
      return row!.id;
    }
    case "job_grade": {
      const [row] = await tx
        .insert(hrJobGradesTable)
        .values({
          workspaceId,
          name: proposal.proposedName,
          nameAr: proposal.proposedNameAr ?? null,
          code: proposal.proposedCode,
        })
        .returning({ id: hrJobGradesTable.id });
      return row!.id;
    }
    case "work_location": {
      const [row] = await tx
        .insert(hrWorkLocationsTable)
        .values({
          workspaceId,
          name: proposal.proposedName,
          nameAr: proposal.proposedNameAr ?? null,
          code: proposal.proposedCode,
        })
        .returning({ id: hrWorkLocationsTable.id });
      return row!.id;
    }
    case "document_type": {
      const [row] = await tx
        .insert(hrDocumentTypesTable)
        .values({
          workspaceId,
          name: proposal.proposedName,
          nameAr: proposal.proposedNameAr ?? null,
          code: proposal.proposedCode,
        })
        .returning({ id: hrDocumentTypesTable.id });
      return row!.id;
    }
    default:
      throw new Error(`AUTO_CREATE_UNSUPPORTED_ENTITY:${proposal.entityType}`);
  }
}

export async function runAutoCreatePreview(input: {
  workspaceId: number;
  sessionId?: number;
  rows: Array<{
    rowNumber: number;
    entityType: string;
    name: string;
    nameAr?: string;
    code?: string;
  }>;
}): Promise<AutoCreatePreviewResult> {
  const settings = await getImportRuntimeSettings(input.workspaceId);
  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);
  return autoCreatePolicyEngine.evaluatePreview({
    workspaceId: input.workspaceId,
    settings,
    catalog,
    rows: input.rows,
  });
}

export async function executeApprovedAutoCreates(input: {
  workspaceId: number;
  sessionId?: number;
  userId?: number;
  proposals: AutoCreateProposal[];
}): Promise<AutoCreateExecuteResult> {
  const settings = await getImportRuntimeSettings(input.workspaceId);
  const pilotEnabled = await isPilotWorkspaceEnabled(input.workspaceId);
  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);

  const preview = await autoCreatePolicyEngine.evaluatePreview({
    workspaceId: input.workspaceId,
    settings,
    catalog,
    rows: input.proposals.map((p) => ({
      rowNumber: p.rowNumber,
      entityType: p.entityType,
      name: p.proposedName,
      nameAr: p.proposedNameAr,
      code: p.proposedCode,
    })),
  });

  if (!preview.runtimeEnabled) {
    return { preview, created: 0, queued: 0, rejected: preview.rejected, entityIds: [] };
  }

  const toCreate = preview.proposals.filter((p) => p.action === "create");
  const toQueue = preview.proposals.filter((p) => p.action === "queue_approval");

  await queueAutoCreateProposals({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    userId: input.userId,
    proposals: toQueue,
  });

  const entityIds: number[] = [];

  await runInTransaction(async (tx) => {
    for (const proposal of toCreate) {
      const entityId = await insertEntity(tx, input.workspaceId, proposal);

      if (input.sessionId) {
        await tx.insert(hrImportSessionEntitiesTable).values({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          entityType: proposal.entityType,
          entityId,
          canonicalKey: proposal.proposedCode,
          action: "auto_create",
          metadata: { rowNumber: proposal.rowNumber, phase: 5 },
        });

        await recordRollbackSnapshot({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          entityType: proposal.entityType,
          entityId,
          action: "insert",
          beforeJson: null,
          afterJson: { autoCreated: true, proposal },
        });
      }

      void recordWorkforceAudit({
        workspaceId: input.workspaceId,
        entityType: proposal.entityType,
        entityId,
        action: "import.auto_create",
        actorUserId: input.userId,
        afterState: proposal,
        correlationId: input.sessionId ? `session:${input.sessionId}` : null,
      });

      entityIds.push(entityId);
    }
  });

  masterDataCatalogService.invalidateCache(input.workspaceId);

  void recordAutoCreateTelemetry({
    workspaceId: input.workspaceId,
    event: "entities_created",
    count: entityIds.length,
    sessionId: input.sessionId,
    metadata: { queued: toQueue.length, rejected: preview.rejected },
  });

  return {
    preview,
    created: entityIds.length,
    queued: toQueue.length,
    rejected: preview.rejected,
    entityIds,
  };
}

export async function commitApprovedPendingItems(input: {
  workspaceId: number;
  pendingIds: number[];
  userId?: number;
}): Promise<{ created: number; entityIds: number[]; errors: string[] }> {
  const { db, hrImportAutoCreatePendingTable } = await import("@workspace/db");
  const { eq, and, inArray } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(hrImportAutoCreatePendingTable)
    .where(
      and(
        eq(hrImportAutoCreatePendingTable.workspaceId, input.workspaceId),
        inArray(hrImportAutoCreatePendingTable.id, input.pendingIds),
        eq(hrImportAutoCreatePendingTable.status, "approved"),
      ),
    );

  const entityIds: number[] = [];
  const errors: string[] = [];

  await runInTransaction(async (tx) => {
    for (const row of rows) {
      try {
        const proposal: AutoCreateProposal = {
          rowNumber: (row.metadata as { rowNumber?: number })?.rowNumber ?? 0,
          entityType: row.entityType,
          proposedName: row.proposedName,
          proposedNameAr: row.proposedNameAr ?? undefined,
          proposedCode: row.proposedCode ?? "",
          duplicateKey: row.duplicateKey ?? "",
          action: "create",
          policy: (row.policySnapshot as AutoCreateProposal["policy"]) ?? {
            entityType: row.entityType,
            autoCreatePolicy: "off",
            autoCreateMode: "disabled",
            approvalRequired: true,
            canonicalStrategy: "slug_from_name",
            duplicateStrategy: "reject",
            reconciliationMode: "report_only",
            isRuntimeSensitive: false,
            autoCreateAllowed: false,
          },
        };

        const entityId = await insertEntity(tx, input.workspaceId, proposal);
        entityIds.push(entityId);

        await tx
          .update(hrImportAutoCreatePendingTable)
          .set({ status: "created", createdEntityId: entityId })
          .where(eq(hrImportAutoCreatePendingTable.id, row.id));

        void recordWorkforceAudit({
          workspaceId: input.workspaceId,
          entityType: row.entityType,
          entityId,
          action: "import.auto_create.approved_commit",
          actorUserId: input.userId,
          afterState: proposal,
          correlationId: row.sessionId ? `session:${row.sessionId}` : null,
        });
      } catch (e) {
        errors.push(`Pending ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

  masterDataCatalogService.invalidateCache(input.workspaceId);

  void recordAutoCreateTelemetry({
    workspaceId: input.workspaceId,
    event: "entities_created",
    count: entityIds.length,
    metadata: { fromApproval: true, errors: errors.length },
  });

  return { created: entityIds.length, entityIds, errors };
}
