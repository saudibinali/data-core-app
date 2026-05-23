/**
 * Phase 4 — Master data persistence (update-only; auto-create disabled).
 */

import { hrImportSessionEntitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { TxClient } from "./transaction-manager";
import type { MasterDataRowValidation } from "../execution/master-data-import-runtime";

export type MasterDataPersistResult = {
  action: "update" | "skip";
  entityType: string;
  entityId?: number;
  reason?: string;
};

/** Master data live commit deferred — records session entity audit only when update path validated. */
export async function persistMasterDataRow(input: {
  tx: TxClient;
  workspaceId: number;
  sessionId: number;
  row: MasterDataRowValidation;
  catalogEntityId?: number;
}): Promise<MasterDataPersistResult> {
  const { tx, workspaceId, sessionId, row, catalogEntityId } = input;

  if (row.wouldAction === "create") {
    return {
      action: "skip",
      entityType: row.entityType,
      reason: "AUTO_CREATE_DISABLED_PHASE_4",
    };
  }

  if (!catalogEntityId || row.errors.length) {
    return {
      action: "skip",
      entityType: row.entityType,
      reason: row.errors[0] ?? "validation_failed",
    };
  }

  await tx.insert(hrImportSessionEntitiesTable).values({
    sessionId,
    workspaceId,
    entityType: row.entityType,
    entityId: catalogEntityId,
    canonicalKey: row.canonicalKey ?? "",
    action: "update",
    metadata: { rowNumber: row.rowNumber, phase: 4, note: "audit_only_no_field_mutation" },
  });

  return { action: "update", entityType: row.entityType, entityId: catalogEntityId };
}

export async function findCatalogEntityId(
  _workspaceId: number,
  _entityType: string,
  _canonicalKey: string,
): Promise<number | undefined> {
  return undefined;
}
