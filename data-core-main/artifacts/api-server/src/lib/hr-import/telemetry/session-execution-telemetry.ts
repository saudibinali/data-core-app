/**
 * Phase 3 — Session execution telemetry.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export async function recordSessionExecutionTelemetry(input: {
  workspaceId: number;
  sessionId: number;
  event: "upload" | "validate" | "shadow_run";
  timingMs?: Record<string, number>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  incrementRuntimeMetric(`import.v3.session.${input.event}`);
  if (input.timingMs?.totalMs) incrementRuntimeMetric("import.v3.timing.total", input.timingMs.totalMs);
  if (input.timingMs?.validateMs) incrementRuntimeMetric("import.v3.timing.validate", input.timingMs.validateMs);
  if (input.timingMs?.shadowMs) incrementRuntimeMetric("import.v3.timing.shadow", input.timingMs.shadowMs);

  await recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: "route_hit",
    legacySurface: "hr.import.runtime.v3",
    sourcePath: `session:${input.sessionId}:${input.event}`,
    entityType: "import_session",
    entityId: input.sessionId,
    metadata: { phase: 3, event: input.event, timingMs: input.timingMs, ...input.metadata, commitEnabled: false },
  });
}
