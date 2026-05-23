/**
 * Final Phase — Enterprise rollback orchestration (workspace mode rollback).
 */

import { db, hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getImportRuntimeSettings } from "../runtime-settings";
import { upsertRolloutRecord, getWorkspaceRollout } from "./rollout-service";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { recordPlatformRuntimeTelemetry } from "../telemetry/platform-runtime-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type RuntimeRollbackTarget = "pilot_active" | "controlled_commit" | "shadow" | "legacy";

export type RuntimeRollbackResult = {
  ok: boolean;
  workspaceId: number;
  previousMode: string;
  currentMode: string;
  reason?: string;
  diagnostics?: unknown;
};

export async function rollbackWorkspaceRuntime(input: {
  workspaceId: number;
  userId?: number;
  targetMode?: RuntimeRollbackTarget;
  explicitConfirmation?: boolean;
}): Promise<RuntimeRollbackResult> {
  incrementRuntimeMetric("import.final.rollback_request");

  if (!input.explicitConfirmation) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      previousMode: "unknown",
      currentMode: "unknown",
      reason: "EXPLICIT_ROLLBACK_REQUIRED",
    };
  }

  const settings = await getImportRuntimeSettings(input.workspaceId);
  const previousMode = settings.employeeImportRuntimeMode;
  const rollout = await getWorkspaceRollout(input.workspaceId);

  const targetMode: RuntimeRollbackTarget =
    input.targetMode
    ?? (rollout?.runtimeModePrevious as RuntimeRollbackTarget)
    ?? "pilot_active";

  if (!["legacy", "shadow", "controlled_commit", "pilot_active"].includes(targetMode)) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      previousMode,
      currentMode: previousMode,
      reason: "INVALID_ROLLBACK_TARGET",
    };
  }

  await db
    .update(hrWorkspaceSettingsTable)
    .set({ employeeImportRuntimeMode: targetMode })
    .where(eq(hrWorkspaceSettingsTable.workspaceId, input.workspaceId));

  await upsertRolloutRecord({
    workspaceId: input.workspaceId,
    rolloutStatus: "rolled_back",
    runtimeModePrevious: previousMode,
    runtimeModeTarget: targetMode,
    rollbackByUserId: input.userId,
    diagnostics: { stagedRollback: true, destructiveDeletes: false },
    metadata: { rollbackTarget: targetMode },
  });

  void recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "workspace_import_runtime",
    entityId: input.workspaceId,
    action: "runtime.rollback",
    actorUserId: input.userId,
    beforeState: { employeeImportRuntimeMode: previousMode },
    afterState: { employeeImportRuntimeMode: targetMode },
    correlationId: `rollout:${input.workspaceId}`,
  });

  void recordPlatformRuntimeTelemetry({
    workspaceId: input.workspaceId,
    event: "rollback_success",
    metadata: { previousMode, targetMode },
  });

  incrementRuntimeMetric("import.final.rollback_success");

  return {
    ok: true,
    workspaceId: input.workspaceId,
    previousMode,
    currentMode: targetMode,
    diagnostics: { targetMode, entityRollbackSeparate: true },
  };
}

export async function getRollbackDiagnostics(workspaceId: number) {
  const rollout = await getWorkspaceRollout(workspaceId);
  const settings = await getImportRuntimeSettings(workspaceId);
  return {
    workspaceId,
    currentMode: settings.employeeImportRuntimeMode,
    rolloutStatus: rollout?.rolloutStatus ?? "not_registered",
    rolledBackAt: rollout?.rolledBackAt ?? null,
    destructiveDeleteRollbacks: false,
    transactionSafe: true,
  };
}
