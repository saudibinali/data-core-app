/**
 * Final Phase — Platform runtime startup guards.
 */

import type pg from "pg";
import { logger } from "../../logger";
import { pushStartupDiagnostic } from "../../workforce/stabilization/observability-metrics";
import { updateSchemaRegistryStatus } from "../../workforce/stabilization/runtime-health-service";

export const PLATFORM_RUNTIME_MIGRATION_HINT =
  "Run: node scripts/migrate-platform-runtime-final-phase.cjs (applies 0031_platform_runtime_final_phase.sql)";

const REQUIRED = [
  { table: "platform_entity_runtime_registry" },
  { table: "hr_import_workspace_rollout" },
];

let platformSchemaAvailable = false;

export function isPlatformRuntimeSchemaAvailable(): boolean {
  return platformSchemaAvailable;
}

export async function verifyPlatformRuntimeSchema(pool: pg.Pool): Promise<string[]> {
  const missing: string[] = [];
  for (const req of REQUIRED) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [req.table],
    );
    if (!rows.length) missing.push(`table:${req.table}`);
  }
  return missing;
}

export async function runPlatformRuntimeStartupChecks(pool: pg.Pool): Promise<void> {
  const missing = await verifyPlatformRuntimeSchema(pool);

  if (missing.length) {
    platformSchemaAvailable = false;
    await updateSchemaRegistryStatus("platform_import_export_runtime", "missing", { missing });
    logger.warn({ missing, migrationHint: PLATFORM_RUNTIME_MIGRATION_HINT }, "Platform runtime final phase schema pending");
    pushStartupDiagnostic({
      component: "platform_import_export_runtime",
      status: "warn",
      message: `Final phase schema missing. ${PLATFORM_RUNTIME_MIGRATION_HINT}`,
    });
    return;
  }

  platformSchemaAvailable = true;
  await updateSchemaRegistryStatus("platform_import_export_runtime", "ok");
  logger.info("Platform import/export final phase schema verified");
  pushStartupDiagnostic({
    component: "platform_import_export_runtime",
    status: "ok",
    message: "Final phase platform runtime schema verified",
  });
}

export async function getPlatformRuntimeStartupHealth() {
  return {
    schemaAvailable: platformSchemaAvailable,
    globalActiveAutoEnable: false,
    migrationHint: PLATFORM_RUNTIME_MIGRATION_HINT,
  };
}
