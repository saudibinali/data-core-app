/**
 * Phase 2 — Template/catalog telemetry.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type TemplateCatalogTelemetryInput = {
  workspaceId: number;
  event: "template_download_v2" | "stale_template" | "catalog_cache_miss" | "validation_mismatch" | "dropdown_ref_unresolved";
  sourcePath: string;
  metadata?: Record<string, unknown>;
};

export async function recordTemplateCatalogTelemetry(input: TemplateCatalogTelemetryInput): Promise<void> {
  incrementRuntimeMetric(`import.v2.${input.event}`);
  if (input.event === "catalog_cache_miss") incrementRuntimeMetric("import.catalog_cache_miss");
  if (input.event === "validation_mismatch") incrementRuntimeMetric("import.validation_mismatch");
  if (input.event === "stale_template") incrementRuntimeMetric("import.stale_template");

  await recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: input.event === "validation_mismatch" ? "shadow_mismatch" : "route_hit",
    legacySurface: "hr.import.runtime.v2",
    sourcePath: input.sourcePath,
    entityType: "import_template",
    metadata: { ...input.metadata, event: input.event, phase: 2 },
  });
}
