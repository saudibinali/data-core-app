#!/usr/bin/env node
/**
 * Phase 4: Validate workforce operations schema + runtime tables.
 */
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const REQUIRED = [
  { table: "employee_movements" },
  { table: "workforce_lifecycle_events" },
  { table: "workforce_timeline_events" },
  { table: "workforce_audit_log" },
  { table: "hr_workspace_settings", column: "workforce_governance_mode" },
  { table: "hr_employee_documents", column: "category_code" },
];

async function main() {
  const missing = [];
  for (const req of REQUIRED) {
    const { rows: t } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [req.table],
    );
    if (!t.length) {
      missing.push(`table:${req.table}`);
      continue;
    }
    if (req.column) {
      const { rows: c } = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [req.table, req.column],
      );
      if (!c.length) missing.push(`column:${req.table}.${req.column}`);
    }
  }

  if (missing.length) {
    console.error(JSON.stringify({ ok: false, missing, hint: "node scripts/migrate-workforce-operations.cjs" }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, checked: REQUIRED.length }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
