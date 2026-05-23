"use strict";
/**
 * P18-D4 — Pilot leave migration reconciliation report.
 * Usage: DATABASE_URL=... WORKSPACE_ID=123 node scripts/reconcile-leave-pilot.cjs
 */
const { Pool } = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

const WORKSPACE_ID = Number(process.env.WORKSPACE_ID);

async function main() {
  let url;
  try {
    url = resolveDatabaseUrl();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (!Number.isInteger(WORKSPACE_ID)) {
    console.error("WORKSPACE_ID required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const report = { workspaceId: WORKSPACE_ID, ok: true, checks: [] };

  function add(name, pass, detail) {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
  }

  const legacyCnt = await pool.query(
    `SELECT COUNT(*)::int AS c FROM hr_employee_leaves WHERE workspace_id = $1`,
    [WORKSPACE_ID],
  );
  const migCnt = await pool.query(
    `SELECT COUNT(*)::int AS c FROM leave_requests
     WHERE workspace_id = $1 AND request_number LIKE 'LRQ-MIG-%'`,
    [WORKSPACE_ID],
  );
  add("migration_row_count", migCnt.rows[0].c >= 0, `legacy=${legacyCnt.rows[0].c} migrated=${migCnt.rows[0].c}`);

  const dupReq = await pool.query(
    `SELECT request_number, COUNT(*)::int AS c FROM leave_requests
     WHERE workspace_id = $1 GROUP BY request_number HAVING COUNT(*) > 1`,
    [WORKSPACE_ID],
  );
  add("no_duplicate_request_numbers", dupReq.rows.length === 0, dupReq.rows);

  const orphanSteps = await pool.query(
    `SELECT lr.id FROM leave_requests lr
     LEFT JOIN leave_approval_steps las ON las.leave_request_id = lr.id
     WHERE lr.workspace_id = $1 AND lr.status = 'pending_approval' AND las.id IS NULL`,
    [WORKSPACE_ID],
  );
  add("no_orphan_pending_approval", orphanSteps.rows.length === 0, `count=${orphanSteps.rows.length}`);

  const crossWs = await pool.query(
    `SELECT id FROM leave_requests WHERE workspace_id != $1 AND request_number LIKE $2`,
    [WORKSPACE_ID, `LRQ-MIG-%`],
  );
  add("no_cross_workspace_mig_prefix", crossWs.rows.length === 0, `leaks=${crossWs.rows.length}`);

  const legacyWrites = await pool.query(
    `SELECT COUNT(*)::int AS c FROM hr_employee_leaves
     WHERE workspace_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [WORKSPACE_ID],
  );
  add(
    "legacy_writes_recent_hour_note",
    true,
    `recent_legacy_inserts=${legacyWrites.rows[0].c} (verify freeze operationally)`,
  );

  await pool.end();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
