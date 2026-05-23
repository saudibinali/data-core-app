import type pg from "pg";
import { logger } from "../../logger";
import { pushStartupDiagnostic } from "./observability-metrics";
import {
  RUNTIME_MIGRATION_TARGETS,
  updateSchemaRegistryStatus,
} from "./runtime-health-service";

export const LEGACY_COMPAT_MIGRATION_HINT =
  "Run: node scripts/migrate-legacy-compat.cjs (applies 0028_legacy_compat_stabilization.sql)";

export class LegacyCompatSchemaError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
  ) {
    super(message);
    this.name = "LegacyCompatSchemaError";
  }
}

const REQUIRED = [
  { table: "legacy_compat_usage_events" },
  { table: "legacy_cutover_snapshot" },
  { table: "runtime_schema_registry" },
  { table: "hr_workspace_settings", column: "workforce_cleanup_stage" },
];

export async function verifyLegacyCompatSchema(pool: pg.Pool): Promise<void> {
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

  if (missing.length) {
    await updateSchemaRegistryStatus("legacy_compat", "missing", { missing });
    throw new LegacyCompatSchemaError(
      `Legacy compat schema incomplete. Missing: ${missing.join(", ")}. ${LEGACY_COMPAT_MIGRATION_HINT}`,
      missing,
    );
  }

  await updateSchemaRegistryStatus("legacy_compat", "ok");
  logger.info("Legacy compat schema verification passed");
  pushStartupDiagnostic({ component: "legacy_compat", status: "ok", message: "Schema verified" });
}

export async function markRuntimeComponentsVerified(pool: pg.Pool): Promise<void> {
  const checks: Array<{ component: keyof typeof RUNTIME_MIGRATION_TARGETS; table: string }> = [
    { component: "workforce_canonical", table: "legacy_department_org_map" },
    { component: "org_runtime", table: "workforce_executive_overrides" },
    { component: "approval_runtime", table: "approval_instances" },
    { component: "workforce_operations", table: "employee_movements" },
  ];

  for (const check of checks) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [check.table],
    );
    const ok = rows.length > 0;
    await updateSchemaRegistryStatus(check.component, ok ? "ok" : "missing", { table: check.table });
    pushStartupDiagnostic({
      component: check.component,
      status: ok ? "ok" : "warn",
      message: ok ? `${check.table} present` : `Missing ${check.table}`,
    });
  }
}

export async function runLegacyCompatStartupChecks(pool: pg.Pool): Promise<void> {
  await verifyLegacyCompatSchema(pool);
  await markRuntimeComponentsVerified(pool);
}
