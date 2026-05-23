/**
 * Rollback runtime foundation — Phase 4 execution when controlled_commit enabled.
 */

import { db, hrImportRollbackSnapshotsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { executeRollbackSession } from "./rollback-execution";
import { getImportRuntimeSettings, isLiveCommitAllowed } from "../runtime-settings";

export type RollbackSnapshotInput = {
  sessionId: number;
  workspaceId: number;
  entityType: string;
  entityId?: number;
  action: string;
  beforeJson?: unknown;
  afterJson?: unknown;
};

export async function recordRollbackSnapshot(input: RollbackSnapshotInput): Promise<void> {
  await db.insert(hrImportRollbackSnapshotsTable).values({
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
  });
}

export async function listRollbackSnapshots(sessionId: number, workspaceId: number) {
  return db
    .select()
    .from(hrImportRollbackSnapshotsTable)
    .where(
      and(
        eq(hrImportRollbackSnapshotsTable.sessionId, sessionId),
        eq(hrImportRollbackSnapshotsTable.workspaceId, workspaceId),
      ),
    );
}

export async function executeSessionRollback(
  workspaceId: number,
  sessionId: number,
  revertToken: string,
): Promise<{ ok: boolean; reason?: string; restored?: number; skipped?: number; errors?: string[] }> {
  const settings = await getImportRuntimeSettings(workspaceId);
  if (!isLiveCommitAllowed(settings)) {
    return { ok: false, reason: "ROLLBACK_REQUIRES_CONTROLLED_COMMIT_MODE" };
  }
  const result = await executeRollbackSession({ workspaceId, sessionId, revertToken });
  return {
    ok: result.ok,
    reason: result.reason,
    restored: result.restored,
    skipped: result.skipped,
    errors: result.errors,
  };
}
