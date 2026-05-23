/**
 * Phase 4 — Commit runtime health & diagnostics.
 */

import { getImportRuntimeHealth } from "../health/import-runtime-health";
import { getRuntimeMetrics } from "../../workforce/stabilization/observability-metrics";
import { getCommitModeLabel, getImportRuntimeSettings } from "../runtime-settings";

export async function getCommitRuntimeHealth(workspaceId?: number) {
  const base = await getImportRuntimeHealth();
  const settings = workspaceId ? await getImportRuntimeSettings(workspaceId) : null;

  const v4Metrics = Object.fromEntries(
    Object.entries(getRuntimeMetrics()).filter(([k]) => k.startsWith("import.v4.")),
  );

  return {
    ...base,
    phase: 4,
    commitMode: settings ? getCommitModeLabel(settings) : "disabled",
    controlledCommitEnabled: settings?.employeeImportRuntimeMode === "controlled_commit",
    activeModeAutoCommit: false,
    rollbackExecutionEnabled: settings?.employeeImportRuntimeMode === "controlled_commit",
    commitMetrics: v4Metrics,
    strictEnforcementEnabled: false,
    autoCreateEnabled: false,
  };
}

export function buildCommitDiagnostics(sessionSummary: Record<string, unknown> | null | undefined) {
  const commitResult = sessionSummary?.commitResult as Record<string, unknown> | undefined;
  const rollbackResult = sessionSummary?.rollbackResult as Record<string, unknown> | undefined;
  const shadowCommit = sessionSummary?.shadowCommitSimulation as Record<string, unknown> | undefined;

  return {
    commitResult: commitResult ?? null,
    rollbackResult: rollbackResult ?? null,
    shadowCommitSimulation: shadowCommit ?? null,
    rollbackExecutionEnabled: true,
    destructiveDeleteRollbacks: false,
  };
}
