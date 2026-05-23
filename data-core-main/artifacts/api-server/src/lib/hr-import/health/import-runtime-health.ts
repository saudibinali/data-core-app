/**
 * Phase 3 — Import runtime health snapshot.
 */

import { isHrImportRuntimeSchemaAvailable } from "../hr-import-startup";
import { getCatalogCacheStats } from "../catalog/master-data-catalog";
import { getRuntimeMetrics } from "../../workforce/stabilization/observability-metrics";
import { getSchemaRegistrySnapshot } from "../../workforce/stabilization/runtime-health-service";

export async function getImportRuntimeHealth() {
  const schema = await getSchemaRegistrySnapshot();
  const hrImportOk = schema.components.hr_import_runtime?.status === "ok";

  return {
    status: isHrImportRuntimeSchemaAvailable() && hrImportOk ? "healthy" : "degraded",
    phase: "final",
    schemaAvailable: isHrImportRuntimeSchemaAvailable(),
    hrImportRegistry: schema.components.hr_import_runtime ?? null,
    catalogCache: getCatalogCacheStats(),
    metrics: Object.fromEntries(
      Object.entries(getRuntimeMetrics()).filter(([k]) => k.startsWith("import.")),
    ),
    commitEnabled: false,
    controlledCommitRequiresOptIn: true,
    rollbackExecutionEnabled: false,
    strictEnforcementEnabled: false,
    autoCreateEnabled: false,
  };
}
