#!/usr/bin/env node
/** Phase 5: Verify runtime schema registry vs expected migrations. */
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

const EXPECTED = [
  { component: "workforce_canonical", table: "legacy_department_org_map", migration: "0024" },
  { component: "org_runtime", table: "workforce_executive_overrides", migration: "0025" },
  { component: "approval_runtime", table: "approval_instances", migration: "0026" },
  { component: "workforce_operations", table: "employee_movements", migration: "0027" },
  { component: "legacy_compat", table: "legacy_compat_usage_events", migration: "0028" },
  { component: "hr_import_runtime", table: "hr_import_sessions", migration: "0029" },
];

async function main() {
  const drift = [];
  for (const req of EXPECTED) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [req.table],
    );
    if (!rows.length) drift.push({ component: req.component, missing: req.table, migration: req.migration });
  }

  if (drift.length) {
    console.error(JSON.stringify({ ok: false, drift, hint: "Apply missing migrations before deploy" }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: EXPECTED.length }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
