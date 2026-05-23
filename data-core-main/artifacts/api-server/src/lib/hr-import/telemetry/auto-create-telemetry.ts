/**
 * Phase 5 — Auto-create telemetry & observability.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric, getRuntimeMetrics } from "../../workforce/stabilization/observability-metrics";

export async function recordAutoCreateTelemetry(input: {
  workspaceId: number;
  event:
    | "preview"
    | "approval_queued"
    | "approval_processed"
    | "entities_created"
    | "rejected"
    | "duplicate_prevented"
    | "strict_failure"
    | "reconciliation_mismatch";
  count?: number;
  sessionId?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  incrementRuntimeMetric(`import.v5.${input.event}`, input.count ?? 1);

  await recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: "route_hit",
    legacySurface: "hr.import.runtime.v5",
    sourcePath: input.sessionId ? `session:${input.sessionId}:${input.event}` : input.event,
    entityType: "import_auto_create",
    entityId: input.sessionId,
    metadata: { phase: 5, event: input.event, count: input.count, ...input.metadata },
  });
}

export function getAutoCreateMetrics(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(getRuntimeMetrics()).filter(([k]) => k.startsWith("import.v5.")),
  );
}
