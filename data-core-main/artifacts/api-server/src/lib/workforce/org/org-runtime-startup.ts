import type pg from "pg";
import { logger } from "../../logger";

export const ORG_RUNTIME_MIGRATION_HINT =
  "Run: node scripts/migrate-org-runtime.cjs (applies 0025_org_runtime_foundation.sql)";

type SchemaRequirement = { table: string; columns?: string[] };

const REQUIRED: SchemaRequirement[] = [
  { table: "hr_org_units", columns: ["manager_employee_id"] },
  { table: "hr_workspace_settings", columns: ["org_runtime_mode"] },
  { table: "workforce_executive_overrides" },
  { table: "workforce_delegations" },
];

export class OrgRuntimeSchemaError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
  ) {
    super(message);
    this.name = "OrgRuntimeSchemaError";
  }
}

export async function verifyOrgRuntimeSchema(pool: pg.Pool): Promise<void> {
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
    throw new OrgRuntimeSchemaError(
      `Org runtime schema incomplete. Missing: ${missing.join(", ")}. ${ORG_RUNTIME_MIGRATION_HINT}`,
      missing,
    );
  }

  logger.info("Org runtime schema verification passed");
}

/** Idempotent backfill: department→org map + org unit heads from legacy departments. */
export async function runOrgRuntimeBackfill(pool: pg.Pool): Promise<{
  mapInserted: number;
  managersUpdated: number;
}> {
  let mapInserted = 0;
  let managersUpdated = 0;

  const { rows: departments } = await pool.query(`
    SELECT d.id, d.workspace_id, lower(trim(d.name)) AS name_key, d.manager_id
    FROM departments d
  `);

  for (const dept of departments) {
    const { rows: orgUnits } = await pool.query(
      `SELECT id FROM hr_org_units
       WHERE workspace_id = $1 AND lower(trim(name)) = $2 AND is_active = true
       ORDER BY id ASC LIMIT 1`,
      [dept.workspace_id, dept.name_key],
    );
    if (!orgUnits.length) continue;

    const orgUnitId = orgUnits[0].id;
    const ins = await pool.query(
      `INSERT INTO legacy_department_org_map (workspace_id, department_id, org_unit_id, match_method)
       VALUES ($1, $2, $3, 'name')
       ON CONFLICT (workspace_id, department_id) DO NOTHING`,
      [dept.workspace_id, dept.id, orgUnitId],
    );
    mapInserted += ins.rowCount ?? 0;

    if (dept.manager_id) {
      const { rows: empLink } = await pool.query(
        `SELECT id FROM employees WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
        [dept.manager_id, dept.workspace_id],
      );
      const managerEmployeeId = empLink[0]?.id;
      if (managerEmployeeId) {
        const upd = await pool.query(
          `UPDATE hr_org_units SET manager_employee_id = $1
           WHERE id = $2 AND workspace_id = $3 AND manager_employee_id IS NULL`,
          [managerEmployeeId, orgUnitId, dept.workspace_id],
        );
        managersUpdated += upd.rowCount ?? 0;
      }
    }
  }

  logger.info({ mapInserted, managersUpdated }, "Org runtime backfill complete");
  return { mapInserted, managersUpdated };
}

export async function runOrgRuntimeStartupChecks(pool: pg.Pool): Promise<void> {
  await verifyOrgRuntimeSchema(pool);
  await runOrgRuntimeBackfill(pool);
}
