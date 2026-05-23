import type pg from "pg";
import { logger } from "../logger";
import { pushStartupDiagnostic } from "../workforce/stabilization/observability-metrics";
import { updateSchemaRegistryStatus } from "../workforce/stabilization/runtime-health-service";
import { HR_IMPORT_RUNTIME_MIGRATION_HINT } from "./schema-guard";
import { HrImportTemplateRegistry } from "./template/template-registry";

export class HrImportRuntimeSchemaError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
  ) {
    super(message);
    this.name = "HrImportRuntimeSchemaError";
  }
}

const REQUIRED = [
  { table: "hr_import_sessions" },
  { table: "hr_import_session_rows" },
  { table: "hr_import_session_entities" },
  { table: "hr_import_rollback_snapshots" },
  { table: "hr_master_data_registry" },
  { table: "hr_workspace_settings", columns: ["employee_import_runtime_mode"] },
];

let schemaAvailable = false;

export function isHrImportRuntimeSchemaAvailable(): boolean {
  return schemaAvailable;
}

export async function verifyHrImportRuntimeSchema(pool: pg.Pool): Promise<string[]> {
  const missing: string[] = [];

  for (const req of REQUIRED) {
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

/**
 * Non-fatal startup check — live platform safe.
 * Legacy import continues if migration not yet applied; new routes return 503.
 */
export async function runHrImportRuntimeStartupChecks(pool: pg.Pool): Promise<void> {
  const missing = await verifyHrImportRuntimeSchema(pool);

  if (missing.length) {
    schemaAvailable = false;
    await updateSchemaRegistryStatus("hr_import_runtime", "missing", { missing });
    logger.warn(
      { missing, migrationHint: HR_IMPORT_RUNTIME_MIGRATION_HINT },
      "HR import runtime schema not yet applied — v2 routes will return 503",
    );
    pushStartupDiagnostic({
      component: "hr_import_runtime",
      status: "warn",
      message: `Schema missing (${missing.length} items). ${HR_IMPORT_RUNTIME_MIGRATION_HINT}`,
    });
    return;
  }

  schemaAvailable = true;
  HrImportTemplateRegistry.list();
  await updateSchemaRegistryStatus("hr_import_runtime", "ok");
  logger.info("HR import runtime schema verification passed");
  pushStartupDiagnostic({
    component: "hr_import_runtime",
    status: "ok",
    message: "Schema verified; template registry warmed",
  });
}
