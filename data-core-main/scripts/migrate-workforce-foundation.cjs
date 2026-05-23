#!/usr/bin/env node
/**
 * Phase 1: Idempotent workforce canonical foundation migration.
 * Safe to run multiple times on local and production.
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
ALTER TABLE hr_workspace_settings
  ADD COLUMN IF NOT EXISTS workforce_canonical_mode text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS workforce_sync_direction text NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS legacy_department_org_map (
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id integer NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  org_unit_id integer NOT NULL REFERENCES hr_org_units(id) ON DELETE CASCADE,
  match_method text NOT NULL DEFAULT 'name',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_dept_org_map_org_unit
  ON legacy_department_org_map (org_unit_id);

CREATE TABLE IF NOT EXISTS workforce_migration_exceptions (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  reason text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_migration_exceptions_ws
  ON workforce_migration_exceptions (workspace_id);

ALTER TABLE hr_employee_documents
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS storage_key text;

CREATE INDEX IF NOT EXISTS idx_hr_employee_documents_storage_key
  ON hr_employee_documents (storage_key)
  WHERE storage_key IS NOT NULL;
`;

async function backfillDepartmentOrgMap(client) {
  const { rows: departments } = await client.query(`
    SELECT d.id, d.workspace_id, lower(trim(d.name)) AS name_key, d.name
    FROM departments d
  `);

  let inserted = 0;
  let skipped = 0;

  for (const dept of departments) {
    const { rows: orgUnits } = await client.query(
      `SELECT id FROM hr_org_units
       WHERE workspace_id = $1 AND lower(trim(name)) = $2 AND is_active = true
       ORDER BY id ASC LIMIT 1`,
      [dept.workspace_id, dept.name_key],
    );
    if (!orgUnits.length) {
      skipped++;
      continue;
    }

    const result = await client.query(
      `INSERT INTO legacy_department_org_map (workspace_id, department_id, org_unit_id, match_method)
       VALUES ($1, $2, $3, 'name')
       ON CONFLICT (workspace_id, department_id) DO NOTHING`,
      [dept.workspace_id, dept.id, orgUnits[0].id],
    );
    if (result.rowCount > 0) inserted++;
  }

  return { inserted, skipped, totalDepartments: departments.length };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA_SQL);
    const mapStats = await backfillDepartmentOrgMap(client);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, mapStats }, null, 2));
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
