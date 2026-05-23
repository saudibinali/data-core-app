/**
 * Final Phase — Production runtime health dashboard foundations.
 */

import { getImportRuntimeHealth } from "../health/import-runtime-health";
import { getCommitRuntimeHealth } from "../health/commit-health";
import { getAutoCreateStartupHealth } from "../health/auto-create-startup";
import { getPlatformRuntimeStartupHealth } from "../health/platform-runtime-startup";
import { getRolloutHealthSummary } from "./rollout-service";
import { listRolloutProgress } from "./rollout-service";
import { getRuntimeMetrics } from "../../workforce/stabilization/observability-metrics";
import { getSchemaRegistrySnapshot } from "../../workforce/stabilization/runtime-health-service";
import { enforceParityThreshold } from "./parity-enforcement";
import { getRollbackDiagnostics } from "./rollback-orchestration";

export async function getPlatformRuntimeHealthDashboard(workspaceId?: number) {
  const [base, commit, autoCreate, platform, schema, rollout] = await Promise.all([
    getImportRuntimeHealth(),
    workspaceId ? getCommitRuntimeHealth(workspaceId) : getCommitRuntimeHealth(),
    getAutoCreateStartupHealth(),
    getPlatformRuntimeStartupHealth(),
    getSchemaRegistrySnapshot(),
    getRolloutHealthSummary(),
  ]);

  const vFinalMetrics = Object.fromEntries(
    Object.entries(getRuntimeMetrics()).filter(([k]) =>
      k.startsWith("import.final.") || k.startsWith("import.v"),
    ),
  );

  return {
    phase: "final",
    status: platform.schemaAvailable && base.schemaAvailable ? "healthy" : "degraded",
    importExportRuntime: base,
    commitRuntime: commit,
    autoCreateRuntime: autoCreate,
    platformRuntime: platform,
    rolloutHealth: rollout,
    schemaRegistry: schema.components,
    metrics: vFinalMetrics,
    globalActiveForced: false,
    legacyPreserved: true,
  };
}

export async function getPlatformParityDashboard(workspaceId: number, sessionId?: number) {
  const parity = await enforceParityThreshold(workspaceId, sessionId);
  return {
    workspaceId,
    parity,
    rollback: await getRollbackDiagnostics(workspaceId),
  };
}

export async function getPlatformRolloutStatusDashboard() {
  const rollout = await getRolloutHealthSummary();
  const workspaces = await listRolloutProgress(100);
  return {
    summary: rollout,
    workspaces: workspaces.map((w) => ({
      workspaceId: w.workspaceId,
      status: w.rolloutStatus,
      parityScore: w.parityScore,
      readinessScore: w.readinessScore,
      activatedAt: w.activatedAt,
      blockedReason: w.activationBlockedReason,
    })),
    globalForcedActivation: false,
  };
}
