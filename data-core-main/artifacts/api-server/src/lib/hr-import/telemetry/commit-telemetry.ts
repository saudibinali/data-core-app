/**
 * Phase 4 — Commit & rollback telemetry.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export async function recordCommitTelemetry(input: {
  workspaceId: number;
  sessionId: number;
  event: "commit_success" | "commit_failed" | "shadow_commit_simulation" | "rollback_success" | "rollback_failed";
  timingMs?: Record<string, number>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  incrementRuntimeMetric(`import.v4.${input.event}`);
  if (input.timingMs?.commitMs) incrementRuntimeMetric("import.v4.timing.commit", input.timingMs.commitMs);
  if (input.timingMs?.rollbackMs) incrementRuntimeMetric("import.v4.timing.rollback", input.timingMs.rollbackMs);
  if (input.timingMs?.totalMs) incrementRuntimeMetric("import.v4.timing.total", input.timingMs.totalMs);

  await recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: "route_hit",
    legacySurface: "hr.import.runtime.v4",
    sourcePath: `session:${input.sessionId}:${input.event}`,
    entityType: "import_session",
    entityId: input.sessionId,
    metadata: { phase: 4, event: input.event, timingMs: input.timingMs, ...input.metadata },
  });
}
