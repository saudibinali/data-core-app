/**
 * Phase 3 — Rollback snapshot preparation (execution disabled).
 */

import { db, hrImportRollbackSnapshotsTable } from "@workspace/db";

export type RollbackPrepInput = {
  workspaceId: number;
  sessionId: number;
  plannedActions: Array<{
    entityType: string;
    rowNumber: number;
    entityId?: number;
    action: string;
    beforeJson?: unknown;
    afterJson?: unknown;
  }>;
};

/** Prepares rollback metadata rows — does NOT restore or mutate live entities. */
export async function prepareRollbackSnapshots(input: RollbackPrepInput): Promise<number> {
  if (!input.sessionId || input.plannedActions.length === 0) return input.plannedActions.length;

  const batch = input.plannedActions.slice(0, 500);
  for (const item of batch) {
    await db.insert(hrImportRollbackSnapshotsTable).values({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      entityType: item.entityType,
      entityId: item.entityId ?? null,
      action: `prepare_${item.action}`,
      beforeJson: item.beforeJson ?? { rollbackExecutionEnabled: false },
      afterJson: { ...((item.afterJson as object) ?? {}), simulated: true, phase: 3 },
    });
  }
  return batch.length;
}

export async function executeSessionRollbackDisabled(
  _workspaceId: number,
  _sessionId: number,
  _revertToken?: string,
): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: "USE_POST_hr_import_v2_rollback_FOR_EXECUTION" };
}
