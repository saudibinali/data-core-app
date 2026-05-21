"use strict";
/**
 * P18-D4 — Pilot workspace legacy → canonical migration (idempotent).
 *
 * Usage:
 *   DATABASE_URL=... WORKSPACE_ID=123 DRY_RUN=1 node scripts/migrate-leave-pilot.cjs
 *   DATABASE_URL=... WORKSPACE_ID=123 node scripts/migrate-leave-pilot.cjs
 */
const { Pool } = require("pg");

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const WORKSPACE_ID = Number(process.env.WORKSPACE_ID);
const PILOT_ID = Number(process.env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID || WORKSPACE_ID);

function mapStatus(legacy) {
  if (legacy === "pending") return "pending_approval";
  if (legacy === "approved") return "approved";
  if (legacy === "rejected") return "rejected";
  if (legacy === "cancelled") return "cancelled";
  return "pending_approval";
}

function calendarDays(start, end) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  return Math.max(1, Math.floor((e - s) / 86400000) + 1);
}

function businessDaysSimple(start, end) {
  let count = 0;
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cur <= endD) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.max(1, count || calendarDays(start, end));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  if (!Number.isInteger(WORKSPACE_ID) || WORKSPACE_ID < 1) {
    console.error("WORKSPACE_ID required (positive integer)");
    process.exit(1);
  }
  if (PILOT_ID !== WORKSPACE_ID) {
    console.warn(`Warning: WORKSPACE_ID ${WORKSPACE_ID} != LEAVE_CUTOVER_PILOT_WORKSPACE_ID ${PILOT_ID}`);
  }

  const pool = new Pool({ connectionString: url });
  const report = {
    dryRun: DRY_RUN,
    workspaceId: WORKSPACE_ID,
    inserted: 0,
    skipped: 0,
    warnings: [],
    errors: [],
  };

  const client = await pool.connect();
  try {
    const { rows: legacyRows } = await client.query(
      `SELECT l.*, e.user_id AS employee_user_id
       FROM hr_employee_leaves l
       JOIN employees e ON e.id = l.employee_id AND e.workspace_id = l.workspace_id
       WHERE l.workspace_id = $1
       ORDER BY l.id ASC`,
      [WORKSPACE_ID],
    );

    for (const row of legacyRows) {
      const requestNumber = `LRQ-MIG-${row.id}`;
      const exists = await client.query(
        `SELECT id FROM leave_requests WHERE workspace_id = $1 AND request_number = $2`,
        [WORKSPACE_ID, requestNumber],
      );
      if (exists.rows.length > 0) {
        report.skipped++;
        continue;
      }

      const requestedBy = row.created_by || row.employee_user_id;
      if (!requestedBy) {
        report.warnings.push({ legacyId: row.id, msg: "no requested_by_user_id" });
        report.skipped++;
        continue;
      }

      const daysRequested = row.days_count ?? calendarDays(row.start_date, row.end_date);
      const businessDaysCount = businessDaysSimple(row.start_date, row.end_date);
      const status = mapStatus(row.status);

      if (DRY_RUN) {
        report.inserted++;
        continue;
      }

      await client.query("BEGIN");
      try {
        const ins = await client.query(
          `INSERT INTO leave_requests (
            workspace_id, employee_id, requested_by_user_id, leave_policy_id,
            leave_type, start_date, end_date, days_requested, business_days_count,
            status, employee_note, manager_note, approved_by_user_id, approved_at,
            rejected_by_user_id, rejected_at, cancelled_at, request_number, created_at, updated_at
          ) VALUES (
            $1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,
            CASE WHEN $9 = 'cancelled' THEN COALESCE($14, NOW()) ELSE NULL END,
            $15,$16,$17
          ) RETURNING id`,
          [
            WORKSPACE_ID,
            row.employee_id,
            requestedBy,
            row.leave_type,
            row.start_date,
            row.end_date,
            daysRequested,
            businessDaysCount,
            status,
            row.reason,
            row.notes,
            status === "approved" ? row.approved_by : null,
            status === "approved" ? row.approved_at : null,
            row.updated_at,
            requestNumber,
            row.created_at,
            row.updated_at,
          ],
        );
        const leaveRequestId = ins.rows[0].id;

        if (status === "approved" && row.approved_by) {
          await client.query(
            `INSERT INTO leave_approval_steps (
              leave_request_id, step_order, approver_user_id, approver_role, status, decided_at, notified_at, created_at
            ) VALUES ($1, 1, $2, 'manager', 'approved', $3, $3, NOW())`,
            [leaveRequestId, row.approved_by, row.approved_at || new Date()],
          );
        } else if (status === "rejected" && row.approved_by) {
          await client.query(
            `INSERT INTO leave_approval_steps (
              leave_request_id, step_order, approver_user_id, approver_role, status, decided_at, notified_at, created_at
            ) VALUES ($1, 1, $2, 'manager', 'rejected', $3, $3, NOW())`,
            [leaveRequestId, row.approved_by, row.approved_at || new Date()],
          );
        } else if (status === "pending_approval") {
          await client.query(
            `INSERT INTO leave_approval_steps (
              leave_request_id, step_order, approver_user_id, approver_role, status, notified_at, created_at
            ) VALUES ($1, 1, $2, 'manager', 'pending', NOW(), NOW())`,
            [leaveRequestId, row.approved_by || requestedBy],
          );
        }

        await client.query("COMMIT");
        report.inserted++;
      } catch (err) {
        await client.query("ROLLBACK");
        report.errors.push({ legacyId: row.id, error: String(err.message || err) });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
