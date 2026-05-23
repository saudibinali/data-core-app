/**
 * Phase 5 — Master data commit runtime (controlled, transaction-safe).
 */

import {
  hrJobTitlesTable,
  hrJobGradesTable,
  hrWorkLocationsTable,
  hrDocumentTypesTable,
  hrImportSessionEntitiesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { TxClient } from "../commit/transaction-manager";
import { runTransactionalBatch } from "../commit/transaction-manager";
import { recordRollbackSnapshot } from "../rollback/rollback-foundation";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import type { MasterDataRowValidation } from "../execution/master-data-import-runtime";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type MasterDataCommitRow = {
  rowNumber: number;
  entityType: string;
  entityId: number;
  validation: MasterDataRowValidation;
  patch: Record<string, unknown>;
};

const COMMIT_ALLOWED = new Set(["job_title", "job_grade", "work_location", "document_type"]);
const DRY_RUN_ONLY = new Set(["position", "org_unit"]);

async function applyPatch(
  tx: TxClient,
  workspaceId: number,
  row: MasterDataCommitRow,
): Promise<void> {
  const { entityType, entityId, patch } = row;
  const ws = eq(
    (hrJobTitlesTable as typeof hrJobTitlesTable).workspaceId,
    workspaceId,
  );

  switch (entityType) {
    case "job_title":
      await tx.update(hrJobTitlesTable).set(patch as never).where(and(eq(hrJobTitlesTable.id, entityId), eq(hrJobTitlesTable.workspaceId, workspaceId)));
      break;
    case "job_grade":
      await tx.update(hrJobGradesTable).set(patch as never).where(and(eq(hrJobGradesTable.id, entityId), eq(hrJobGradesTable.workspaceId, workspaceId)));
      break;
    case "work_location":
      await tx.update(hrWorkLocationsTable).set(patch as never).where(and(eq(hrWorkLocationsTable.id, entityId), eq(hrWorkLocationsTable.workspaceId, workspaceId)));
      break;
    case "document_type":
      await tx.update(hrDocumentTypesTable).set(patch as never).where(and(eq(hrDocumentTypesTable.id, entityId), eq(hrDocumentTypesTable.workspaceId, workspaceId)));
      break;
    default:
      throw new Error(`MASTER_DATA_COMMIT_BLOCKED:${entityType}`);
  }

  void ws;
}

export async function commitMasterDataRows(input: {
  workspaceId: number;
  sessionId: number;
  userId?: number;
  rows: MasterDataCommitRow[];
}): Promise<{ committed: number; skipped: number; errors: string[]; timingMs: number }> {
  const t0 = Date.now();
  incrementRuntimeMetric("import.v5.master_data_commit");

  const eligible = input.rows.filter((r) => {
    if (DRY_RUN_ONLY.has(r.entityType)) return false;
    if (!COMMIT_ALLOWED.has(r.entityType)) return false;
    if (r.validation.wouldAction === "create") return false;
    return r.validation.errors.length === 0;
  });

  const batch = await runTransactionalBatch({
    label: `md_${input.sessionId}`,
    rows: eligible.map((row) => ({
      rowNumber: row.rowNumber,
      execute: async (tx) => {
        const [before] = await tx
          .select()
          .from(
            row.entityType === "job_title" ? hrJobTitlesTable
              : row.entityType === "job_grade" ? hrJobGradesTable
                : row.entityType === "work_location" ? hrWorkLocationsTable
                  : hrDocumentTypesTable,
          )
          .where(
            and(
              eq(
                row.entityType === "job_title" ? hrJobTitlesTable.id
                  : row.entityType === "job_grade" ? hrJobGradesTable.id
                    : row.entityType === "work_location" ? hrWorkLocationsTable.id
                      : hrDocumentTypesTable.id,
                row.entityId,
              ),
              eq(
                row.entityType === "job_title" ? hrJobTitlesTable.workspaceId
                  : row.entityType === "job_grade" ? hrJobGradesTable.workspaceId
                    : row.entityType === "work_location" ? hrWorkLocationsTable.workspaceId
                      : hrDocumentTypesTable.workspaceId,
                input.workspaceId,
              ),
            ),
          )
          .limit(1);

        await applyPatch(tx, input.workspaceId, row);

        await tx.insert(hrImportSessionEntitiesTable).values({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          entityType: row.entityType,
          entityId: row.entityId,
          canonicalKey: row.validation.canonicalKey ?? null,
          action: "update",
          metadata: { rowNumber: row.rowNumber, phase: 5 },
        });

        await recordRollbackSnapshot({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          entityType: row.entityType,
          entityId: row.entityId,
          action: "update",
          beforeJson: before ?? null,
          afterJson: row.patch,
        });

        void recordWorkforceAudit({
          workspaceId: input.workspaceId,
          entityType: row.entityType,
          entityId: row.entityId,
          action: "import.master_data.commit",
          actorUserId: input.userId,
          beforeState: before,
          afterState: row.patch,
          correlationId: `session:${input.sessionId}`,
        });

        return { entityId: row.entityId };
      },
    })),
  });

  let committed = 0;
  let skipped = input.rows.length - eligible.length;
  const errors: string[] = [];

  for (const r of batch.results) {
    if (r.ok) committed++;
    else {
      skipped++;
      errors.push(`Row ${r.rowNumber}: ${r.error}`);
    }
  }

  return { committed, skipped, errors, timingMs: Date.now() - t0 };
}
