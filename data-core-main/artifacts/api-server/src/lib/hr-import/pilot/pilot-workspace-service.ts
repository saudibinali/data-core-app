/**
 * Phase 5 — Pilot workspace activation registry.
 */

import { db, hrImportPilotWorkspacesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type PilotWorkspaceRecord = {
  workspaceId: number;
  pilotStatus: "inactive" | "enabled" | "suspended";
  rolloutPhase: string;
  enabledAt: Date | null;
  metadata: unknown;
};

export async function getPilotWorkspace(workspaceId: number): Promise<PilotWorkspaceRecord | null> {
  const [row] = await db
    .select()
    .from(hrImportPilotWorkspacesTable)
    .where(eq(hrImportPilotWorkspacesTable.workspaceId, workspaceId))
    .limit(1);

  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    pilotStatus: row.pilotStatus as PilotWorkspaceRecord["pilotStatus"],
    rolloutPhase: row.rolloutPhase,
    enabledAt: row.enabledAt,
    metadata: row.metadata,
  };
}

export async function isPilotWorkspaceEnabled(workspaceId: number): Promise<boolean> {
  const pilot = await getPilotWorkspace(workspaceId);
  return pilot?.pilotStatus === "enabled";
}

export async function listPilotWorkspaces(): Promise<PilotWorkspaceRecord[]> {
  const rows = await db.select().from(hrImportPilotWorkspacesTable);
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    pilotStatus: row.pilotStatus as PilotWorkspaceRecord["pilotStatus"],
    rolloutPhase: row.rolloutPhase,
    enabledAt: row.enabledAt,
    metadata: row.metadata,
  }));
}

export async function enablePilotWorkspace(input: {
  workspaceId: number;
  enabledByUserId?: number;
  metadata?: unknown;
}): Promise<PilotWorkspaceRecord> {
  const [row] = await db
    .insert(hrImportPilotWorkspacesTable)
    .values({
      workspaceId: input.workspaceId,
      pilotStatus: "enabled",
      rolloutPhase: "phase_5",
      enabledAt: new Date(),
      enabledByUserId: input.enabledByUserId ?? null,
      metadata: input.metadata ?? { note: "explicit_enablement_required" },
    })
    .onConflictDoUpdate({
      target: hrImportPilotWorkspacesTable.workspaceId,
      set: {
        pilotStatus: "enabled",
        enabledAt: new Date(),
        enabledByUserId: input.enabledByUserId ?? null,
        metadata: input.metadata ?? { note: "explicit_enablement_required" },
      },
    })
    .returning();

  return {
    workspaceId: row!.workspaceId,
    pilotStatus: "enabled",
    rolloutPhase: row!.rolloutPhase,
    enabledAt: row!.enabledAt,
    metadata: row!.metadata,
  };
}

export async function getPilotRolloutDiagnostics(workspaceId: number) {
  const pilot = await getPilotWorkspace(workspaceId);
  return {
    workspaceId,
    pilotEnabled: pilot?.pilotStatus === "enabled",
    pilotStatus: pilot?.pilotStatus ?? "not_registered",
    rolloutPhase: pilot?.rolloutPhase ?? null,
    requiresExplicitEnablement: true,
    globalActiveCutover: false,
  };
}
