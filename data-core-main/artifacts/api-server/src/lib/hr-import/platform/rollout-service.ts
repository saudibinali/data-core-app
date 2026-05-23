/**
 * Final Phase — Global rollout runtime (staged, workspace-isolated).
 */

import { db, hrImportWorkspaceRolloutTable } from "@workspace/db";
import { asc, desc, eq, sql } from "drizzle-orm";

export type RolloutStatus = "pending" | "in_progress" | "active" | "rolled_back" | "blocked";

export async function getWorkspaceRollout(workspaceId: number) {
  const [row] = await db
    .select()
    .from(hrImportWorkspaceRolloutTable)
    .where(eq(hrImportWorkspaceRolloutTable.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function listRolloutProgress(limit = 100) {
  return db
    .select()
    .from(hrImportWorkspaceRolloutTable)
    .orderBy(asc(hrImportWorkspaceRolloutTable.rolloutSequence), desc(hrImportWorkspaceRolloutTable.updatedAt))
    .limit(Math.min(limit, 500));
}

export async function upsertRolloutRecord(input: {
  workspaceId: number;
  rolloutStatus: RolloutStatus;
  runtimeModePrevious?: string;
  runtimeModeTarget?: string;
  parityScore?: number;
  readinessScore?: number;
  activationBlockedReason?: string | null;
  activatedByUserId?: number;
  rollbackByUserId?: number;
  diagnostics?: unknown;
  metadata?: unknown;
}) {
  const existing = await getWorkspaceRollout(input.workspaceId);
  const nextSequence = existing?.rolloutSequence ?? (await getNextRolloutSequence());

  const [row] = await db
    .insert(hrImportWorkspaceRolloutTable)
    .values({
      workspaceId: input.workspaceId,
      rolloutStatus: input.rolloutStatus,
      runtimeModePrevious: input.runtimeModePrevious ?? null,
      runtimeModeTarget: input.runtimeModeTarget ?? "active",
      rolloutSequence: nextSequence,
      parityScore: input.parityScore != null ? String(input.parityScore) : null,
      readinessScore: input.readinessScore != null ? String(input.readinessScore) : null,
      activationBlockedReason: input.activationBlockedReason ?? null,
      activatedAt: input.rolloutStatus === "active" ? new Date() : null,
      rolledBackAt: input.rolloutStatus === "rolled_back" ? new Date() : null,
      activatedByUserId: input.activatedByUserId ?? null,
      rollbackByUserId: input.rollbackByUserId ?? null,
      diagnostics: input.diagnostics ?? null,
      metadata: input.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: hrImportWorkspaceRolloutTable.workspaceId,
      set: {
        rolloutStatus: input.rolloutStatus,
        runtimeModePrevious: input.runtimeModePrevious ?? undefined,
        runtimeModeTarget: input.runtimeModeTarget ?? "active",
        parityScore: input.parityScore != null ? String(input.parityScore) : undefined,
        readinessScore: input.readinessScore != null ? String(input.readinessScore) : undefined,
        activationBlockedReason: input.activationBlockedReason ?? null,
        activatedAt: input.rolloutStatus === "active" ? new Date() : undefined,
        rolledBackAt: input.rolloutStatus === "rolled_back" ? new Date() : undefined,
        activatedByUserId: input.activatedByUserId ?? undefined,
        rollbackByUserId: input.rollbackByUserId ?? undefined,
        diagnostics: input.diagnostics ?? undefined,
        metadata: input.metadata ?? undefined,
      },
    })
    .returning();

  return row!;
}

async function getNextRolloutSequence(): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(${hrImportWorkspaceRolloutTable.rolloutSequence}), 0) + 1` })
    .from(hrImportWorkspaceRolloutTable);
  return Number(row?.max ?? 1);
}

export async function getRolloutHealthSummary() {
  const rows = await listRolloutProgress(500);
  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.rolloutStatus] = (acc[r.rolloutStatus] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: rows.length,
    byStatus,
    globalForcedActivation: false,
    stagedRollout: true,
    recent: rows.slice(0, 10).map((r) => ({
      workspaceId: r.workspaceId,
      status: r.rolloutStatus,
      parityScore: r.parityScore,
      readinessScore: r.readinessScore,
    })),
  };
}
