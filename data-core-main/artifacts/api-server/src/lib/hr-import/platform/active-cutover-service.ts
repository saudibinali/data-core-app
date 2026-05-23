/**
 * Final Phase — Enterprise active runtime cutover orchestration.
 */

import { db, hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getImportRuntimeSettings } from "../runtime-settings";
import { evaluateActiveModeSafetyGuards } from "./active-safety-guards";
import { computeWorkspaceReadiness, computeWorkspaceParityScore } from "./readiness-service";
import { upsertRolloutRecord } from "./rollout-service";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { recordPlatformRuntimeTelemetry } from "../telemetry/platform-runtime-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type ActivationResult = {
  ok: boolean;
  workspaceId: number;
  previousMode: string;
  currentMode: string;
  blockers?: string[];
  diagnostics?: unknown;
  reason?: string;
};

export async function activateWorkspaceRuntime(input: {
  workspaceId: number;
  userId?: number;
  explicitConfirmation?: boolean;
  sessionId?: number;
}): Promise<ActivationResult> {
  incrementRuntimeMetric("import.final.activate_request");

  if (!input.explicitConfirmation) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      previousMode: "unknown",
      currentMode: "unknown",
      reason: "EXPLICIT_ACTIVATION_REQUIRED",
    };
  }

  const pilotEnabled = await isPilotWorkspaceEnabled(input.workspaceId);
  if (!pilotEnabled) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      previousMode: "unknown",
      currentMode: "unknown",
      reason: "PILOT_WORKSPACE_NOT_ENABLED",
    };
  }

  const guards = await evaluateActiveModeSafetyGuards(input.workspaceId);
  if (!guards.allowed) {
    await upsertRolloutRecord({
      workspaceId: input.workspaceId,
      rolloutStatus: "blocked",
      activationBlockedReason: guards.blockers.join("; "),
      diagnostics: guards.diagnostics,
    });

    void recordPlatformRuntimeTelemetry({
      workspaceId: input.workspaceId,
      event: "activation_blocked",
      metadata: { blockers: guards.blockers },
    });

    return {
      ok: false,
      workspaceId: input.workspaceId,
      previousMode: (await getImportRuntimeSettings(input.workspaceId)).employeeImportRuntimeMode,
      currentMode: (await getImportRuntimeSettings(input.workspaceId)).employeeImportRuntimeMode,
      blockers: guards.blockers,
      diagnostics: guards.diagnostics,
      reason: "ACTIVE_SAFETY_GUARDS_FAILED",
    };
  }

  const settings = await getImportRuntimeSettings(input.workspaceId);
  const previousMode = settings.employeeImportRuntimeMode;
  const parity = await computeWorkspaceParityScore(input.workspaceId, input.sessionId);
  const readiness = await computeWorkspaceReadiness(input.workspaceId);

  await db
    .update(hrWorkspaceSettingsTable)
    .set({ employeeImportRuntimeMode: "active" })
    .where(eq(hrWorkspaceSettingsTable.workspaceId, input.workspaceId));

  await upsertRolloutRecord({
    workspaceId: input.workspaceId,
    rolloutStatus: "active",
    runtimeModePrevious: previousMode,
    runtimeModeTarget: "active",
    parityScore: parity.parityScore,
    readinessScore: readiness.readinessScore,
    activatedByUserId: input.userId,
    diagnostics: { guards, parity, readiness },
    metadata: { explicitActivation: true, globalForced: false },
  });

  void recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "workspace_import_runtime",
    entityId: input.workspaceId,
    action: "runtime.activate.active",
    actorUserId: input.userId,
    beforeState: { employeeImportRuntimeMode: previousMode },
    afterState: { employeeImportRuntimeMode: "active" },
    correlationId: `rollout:${input.workspaceId}`,
  });

  void recordPlatformRuntimeTelemetry({
    workspaceId: input.workspaceId,
    event: "activation_success",
    metadata: { previousMode, parityScore: parity.parityScore },
  });

  incrementRuntimeMetric("import.final.activate_success");

  return {
    ok: true,
    workspaceId: input.workspaceId,
    previousMode,
    currentMode: "active",
    diagnostics: { parity, readiness },
  };
}

export async function validateActiveRuntime(workspaceId: number) {
  const settings = await getImportRuntimeSettings(workspaceId);
  const guards = await evaluateActiveModeSafetyGuards(workspaceId);
  return {
    workspaceId,
    isActive: settings.employeeImportRuntimeMode === "active",
    guards,
    strictGovernanceEligible: ["pilot_active", "active"].includes(settings.employeeImportRuntimeMode),
  };
}
