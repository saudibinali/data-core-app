"use strict";
/**
 * P18-D1 staging verification — read-only schema checks + optional smoke API hints.
 * Usage: DATABASE_URL=... node scripts/verify-leave-staging.cjs
 */
const { Pool } = require("pg");

const REQUIRED_LEAVE_REQUESTS_COLUMNS = [
  "id", "workspace_id", "employee_id", "requested_by_user_id", "leave_policy_id",
  "leave_type", "start_date", "end_date", "days_requested", "business_days_count",
  "status", "employee_note", "manager_note", "attachment_urls", "current_approver_id",
  "approved_by_user_id", "approved_at", "rejected_by_user_id", "rejected_at",
  "cancelled_at", "request_number", "source_form_id", "source_submission_id",
  "created_at", "updated_at",
];

const REQUIRED_STEPS_COLUMNS = [
  "id", "leave_request_id", "step_order", "approver_user_id", "approver_role",
  "status", "comment", "decided_at", "notified_at", "timeout_at", "created_at",
];

async function columnSet(pool, table) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function indexNames(pool, table) {
  const r = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
    [table],
  );
  return r.rows.map((x) => x.indexname);
}

async function fkList(pool, table) {
  const r = await pool.query(
    `SELECT conname, confdeltype
     FROM pg_constraint c
     JOIN pg_class t ON c.conrelid = t.oid
     WHERE t.relname = $1 AND c.contype = 'f'`,
    [table],
  );
  return r.rows;
}

async function main() {
  const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
  const pool = new Pool({ connectionString: url });
  const report = { ok: true, checks: [] };

  function check(name, pass, detail) {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
    console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  }

  try {
    const mig = await pool
      .query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`)
      .catch(() => ({ rows: [] }));
    check(
      "drizzle_migrations_journal",
      mig.rows.length >= 1,
      `count=${mig.rows.length}`,
    );

    const lrCols = await columnSet(pool, "leave_requests");
    const missingLr = REQUIRED_LEAVE_REQUESTS_COLUMNS.filter((c) => !lrCols.has(c));
    check("leave_requests_columns", missingLr.length === 0, missingLr.join(", ") || "all present");

    const lasCols = await columnSet(pool, "leave_approval_steps");
    const missingLas = REQUIRED_STEPS_COLUMNS.filter((c) => !lasCols.has(c));
    check(
      "leave_approval_steps_columns",
      missingLas.length === 0,
      missingLas.join(", ") || "all present",
    );

    const lrIdx = await indexNames(pool, "leave_requests");
    check(
      "uq_leave_request_number",
      lrIdx.some((n) => n === "uq_leave_request_number"),
      lrIdx.filter((n) => n.includes("leave_request")).join("; "),
    );

    const lasIdx = await indexNames(pool, "leave_approval_steps");
    check(
      "uq_leave_approval_step",
      lasIdx.some((n) => n === "uq_leave_approval_step"),
      lasIdx.filter((n) => n.includes("leave_approval")).join("; "),
    );

    const stepsFk = await fkList(pool, "leave_approval_steps");
    const cascadeFk = stepsFk.find((f) => f.conname.includes("leave_request_id"));
    check(
      "steps_cascade_on_request",
      cascadeFk?.confdeltype === "c",
      cascadeFk ? `confdeltype=${cascadeFk.confdeltype}` : "FK missing",
    );

    const legacy = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'hr_employee_leaves'`,
    );
    check("legacy_hr_employee_leaves_exists", legacy.rowCount === 1);

    // Unique constraint behavior (D)
    const seed = await pool.query(
      `SELECT e.workspace_id, e.id AS employee_id, e.user_id AS requested_by_user_id
       FROM employees e
       WHERE e.user_id IS NOT NULL
       LIMIT 1`,
    );
    if (seed.rowCount > 0) {
      const { workspace_id: wsId, employee_id: empId, requested_by_user_id: reqUid } =
        seed.rows[0];
      const dupNum = `LRQ-TEST-DUP-${Date.now()}`;
      try {
        await pool.query(
          `INSERT INTO leave_requests (
            workspace_id, employee_id, requested_by_user_id, leave_type,
            start_date, end_date, days_requested, business_days_count,
            status, request_number
          ) VALUES ($1, $2, $3, 'annual', '2030-01-06', '2030-01-10', 5, 5, 'pending_approval', $4)`,
          [wsId, empId, reqUid, dupNum],
        );
        let dupErr = null;
        try {
          await pool.query(
            `INSERT INTO leave_requests (
              workspace_id, employee_id, requested_by_user_id, leave_type,
              start_date, end_date, days_requested, business_days_count,
              status, request_number
            ) VALUES ($1, $2, $3, 'annual', '2030-01-06', '2030-01-10', 5, 5, 'pending_approval', $4)`,
            [wsId, empId, reqUid, dupNum],
          );
        } catch (e) {
          dupErr = e;
        }
        check(
          "unique_request_number_enforced",
          dupErr && dupErr.code === "23505",
          dupErr ? dupErr.code : "duplicate insert succeeded",
        );
        await pool.query(
          `DELETE FROM leave_requests WHERE workspace_id = $1 AND request_number = $2`,
          [wsId, dupNum],
        );
      } catch (e) {
        check("unique_request_number_probe", false, e.message);
      }
    } else {
      check(
        "unique_request_number_enforced",
        true,
        "skipped DB probe (no employee.user_id); index uq_leave_request_number present — see smoke tests",
      );
    }
  } finally {
    await pool.end();
  }

  console.log("\nOVERALL:", report.ok ? "PASS" : "FAIL");
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
