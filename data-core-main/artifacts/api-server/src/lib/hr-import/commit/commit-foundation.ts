/**
 * Commit runtime foundation — delegates to Phase 4 orchestrator when enabled.
 */

import { commitOrchestrator } from "./commit-orchestrator";

export type CommitResult = {
  committed: boolean;
  reason?: string;
  sessionId?: number;
  mode?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  revertToken?: string;
};

export async function commitImportSession(
  workspaceId: number,
  sessionId: number,
  userId?: number,
): Promise<CommitResult> {
  const result = await commitOrchestrator.executeCommit({ workspaceId, sessionId, userId });
  return {
    committed: result.committed,
    reason: result.reason,
    sessionId: result.sessionId,
    mode: result.mode,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    revertToken: result.revertToken,
  };
}
