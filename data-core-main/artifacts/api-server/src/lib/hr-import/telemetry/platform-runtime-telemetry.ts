/**
 * Final Phase — Platform runtime telemetry.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export async function recordPlatformRuntimeTelemetry(input: {
  workspaceId: number;
  event:
    | "activation_success"
    | "activation_blocked"
    | "rollback_success"
    | "parity_degraded"
    | "strict_failure"
    | "rollout_progress";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  incrementRuntimeMetric(`import.final.${input.event}`);

  await recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: "route_hit",
    legacySurface: "platform.import_export.runtime.final",
    sourcePath: `workspace:${input.workspaceId}:${input.event}`,
    entityType: "platform_runtime",
    entityId: input.workspaceId,
    metadata: { phase: "final", event: input.event, ...input.metadata },
  });
}
