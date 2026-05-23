/**
 * Phase 5 — Auto-create startup guards (non-fatal, 503-safe).
 */

import type pg from "pg";
import { logger } from "../../logger";
import { pushStartupDiagnostic } from "../../workforce/stabilization/observability-metrics";
import { updateSchemaRegistryStatus } from "../../workforce/stabilization/runtime-health-service";

export const HR_IMPORT_AUTO_CREATE_MIGRATION_HINT =
  "Run: node scripts/migrate-hr-import-auto-create-phase5.cjs (applies 0030_hr_import_auto_create_phase5.sql)";

const PHASE5_REQUIRED = [
  { table: "hr_import_auto_create_pending" },
  { table: "hr_import_pilot_workspaces" },
  { table: "hr_master_data_registry", columns: ["auto_create_mode"] },
];

let autoCreateSchemaAvailable = false;

export function isHrImportAutoCreateSchemaAvailable(): boolean {
  return autoCreateSchemaAvailable;
}

export async function verifyHrImportAutoCreateSchema(pool: pg.Pool): Promise<string[]> {
  const missing: string[] = [];

  for (const req of PHASE5_REQUIRED) {
    const { rows: tableRows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [req.table],
    );
    if (!tableRows.length) {
      missing.push(`table:${req.table}`);
      continue;
    }
    for (const col of req.columns ?? []) {
      const { rows: colRows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [req.table, col],
      );
      if (!colRows.length) missing.push(`column:${req.table}.${col}`);
    }
  }

  return missing;
}

export async function runHrImportAutoCreateStartupChecks(pool: pg.Pool): Promise<void> {
  const missing = await verifyHrImportAutoCreateSchema(pool);

  if (missing.length) {
    autoCreateSchemaAvailable = false;
    await updateSchemaRegistryStatus("hr_import_auto_create_runtime", "missing", { missing });
    logger.warn(
      { missing, migrationHint: HR_IMPORT_AUTO_CREATE_MIGRATION_HINT },
      "HR import auto-create Phase 5 schema not yet applied — v2 auto-create routes will return 503",
    );
    pushStartupDiagnostic({
      component: "hr_import_auto_create_runtime",
      status: "warn",
      message: `Phase 5 schema missing (${missing.length} items). ${HR_IMPORT_AUTO_CREATE_MIGRATION_HINT}`,
    });
    return;
  }

  autoCreateSchemaAvailable = true;
  await updateSchemaRegistryStatus("hr_import_auto_create_runtime", "ok");
  logger.info("HR import auto-create Phase 5 schema verification passed");
  pushStartupDiagnostic({
    component: "hr_import_auto_create_runtime",
    status: "ok",
    message: "Phase 5 auto-create schema verified",
  });
}

export async function getAutoCreateStartupHealth() {
  return {
    schemaAvailable: autoCreateSchemaAvailable,
    rollbackReady: autoCreateSchemaAvailable,
    approvalQueueReady: autoCreateSchemaAvailable,
    strictDefaultDisabled: true,
    globalAutoCreateDisabled: true,
    migrationHint: HR_IMPORT_AUTO_CREATE_MIGRATION_HINT,
  };
}
