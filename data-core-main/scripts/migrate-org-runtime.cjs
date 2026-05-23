#!/usr/bin/env node
/**
 * Phase 2: Enterprise org runtime migration (additive, idempotent).
 */
const { Pool } = require("pg");

const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });

const SCHEMA_SQL = `
ALTER TABLE hr_org_units
  ADD COLUMN IF NOT EXISTS manager_employee_id integer;

CREATE INDEX IF NOT EXISTS idx_hr_org_units_manager_employee
  ON hr_org_units (manager_employee_id)
  WHERE manager_employee_id IS NOT NULL;

ALTER TABLE hr_workspace_settings
  ADD COLUMN IF NOT EXISTS org_runtime_mode text NOT NULL DEFAULT 'legacy';

CREATE TABLE IF NOT EXISTS workforce_executive_overrides (
  workspace_id integer PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  ceo_employee_id integer,
  hr_director_employee_id integer,
  max_reporting_depth integer NOT NULL DEFAULT 10,
  executive_exempt_employee_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workforce_delegations (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delegator_employee_id integer NOT NULL,
  delegate_employee_id integer NOT NULL,
  scope text NOT NULL DEFAULT 'all_approvals',
  start_date date NOT NULL,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_delegations_workspace ON workforce_delegations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workforce_delegations_delegator ON workforce_delegations (delegator_employee_id);
`;

async function backfill(client) {
  const { rows: departments } = await client.query(`
    SELECT d.id, d.workspace_id, lower(trim(d.name)) AS name_key, d.manager_id
    FROM departments d
  `);

  let mapInserted = 0;
  let managersUpdated = 0;

  for (const dept of departments) {
    const { rows: orgUnits } = await client.query(
      `SELECT id FROM hr_org_units
       WHERE workspace_id = $1 AND lower(trim(name)) = $2 AND is_active = true
       ORDER BY id ASC LIMIT 1`,
      [dept.workspace_id, dept.name_key],
    );
    if (!orgUnits.length) continue;

    const orgUnitId = orgUnits[0].id;
    const ins = await client.query(
      `INSERT INTO legacy_department_org_map (workspace_id, department_id, org_unit_id, match_method)
       VALUES ($1, $2, $3, 'name')
       ON CONFLICT (workspace_id, department_id) DO NOTHING`,
      [dept.workspace_id, dept.id, orgUnitId],
    );
    mapInserted += ins.rowCount ?? 0;

    if (dept.manager_id) {
      const { rows: empLink } = await client.query(
        `SELECT id FROM employees WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
        [dept.manager_id, dept.workspace_id],
      );
      const managerEmployeeId = empLink[0]?.id;
      if (managerEmployeeId) {
        const upd = await client.query(
          `UPDATE hr_org_units SET manager_employee_id = $1
           WHERE id = $2 AND workspace_id = $3 AND manager_employee_id IS NULL`,
          [managerEmployeeId, orgUnitId, dept.workspace_id],
        );
        managersUpdated += upd.rowCount ?? 0;
      }
    }
  }

  return { mapInserted, managersUpdated };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA_SQL);
    const backfillStats = await backfill(client);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, backfillStats }, null, 2));
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
