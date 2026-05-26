#!/usr/bin/env node
/**
 * F5.2 — Batch mirror leave_requests → hr_employee_leaves for workspaces in transition/canonical.
 * Usage:
 *   node scripts/sync-leave-canonical-mirror.cjs
 *   WORKSPACE_ID=1 node scripts/sync-leave-canonical-mirror.cjs
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

const WORKSPACE_ID = process.env.WORKSPACE_ID ? Number(process.env.WORKSPACE_ID) : null;
const pool = new Pool({ connectionString: DATABASE_URL });

function mapStatus(status) {
  if (status === "pending_approval" || status === "pending") return "pending";
  if (status === "withdrawn") return "cancelled";
  return status;
}

async function mirrorWorkspace(client, workspaceId) {
  const { rows: requests } = await client.query(
    `SELECT lr.* FROM leave_requests lr
     WHERE lr.workspace_id = $1
     ORDER BY lr.id`,
    [workspaceId],
  );

  let mirrored = 0;
  let updated = 0;

  for (const req of requests) {
    const legacyStatus = mapStatus(req.status);
    const { rows: maps } = await client.query(
      `SELECT legacy_leave_id FROM hr_leave_migration_map
       WHERE workspace_id = $1 AND canonical_request_id = $2`,
      [workspaceId, req.id],
    );

    if (maps.length) {
      const upd = await client.query(
        `UPDATE hr_employee_leaves SET
          leave_type = $1, start_date = $2, end_date = $3, days_count = $4,
          status = $5, reason = $6, notes = $7,
          approved_by = $8, approved_at = $9, updated_at = now()
         WHERE id = $10 AND workspace_id = $11`,
        [
          req.leave_type,
          req.start_date,
          req.end_date,
          req.business_days_count,
          legacyStatus,
          req.employee_note,
          req.manager_note,
          req.approved_by_user_id,
          req.approved_at,
          maps[0].legacy_leave_id,
          workspaceId,
        ],
      );
      if (upd.rowCount) updated++;
      continue;
    }

    const ins = await client.query(
      `INSERT INTO hr_employee_leaves (
        workspace_id, employee_id, leave_type, start_date, end_date, days_count,
        status, reason, notes, approved_by, approved_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        workspaceId,
        req.employee_id,
        req.leave_type,
        req.start_date,
        req.end_date,
        req.business_days_count,
        legacyStatus,
        req.employee_note,
        req.manager_note,
        req.approved_by_user_id,
        req.approved_at,
        req.requested_by_user_id,
      ],
    );
    const legacyId = ins.rows[0]?.id;
    if (!legacyId) continue;

    await client.query(
      `INSERT INTO hr_leave_migration_map (workspace_id, legacy_leave_id, canonical_request_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, legacy_leave_id) DO NOTHING`,
      [workspaceId, legacyId, req.id],
    );
    mirrored++;
  }

  return { workspaceId, total: requests.length, mirrored, updated };
}

async function main() {
  const client = await pool.connect();
  try {
    let workspaceIds = [];
    if (WORKSPACE_ID) {
      workspaceIds = [WORKSPACE_ID];
    } else {
      const { rows } = await client.query(
        `SELECT DISTINCT workspace_id AS id FROM leave_requests ORDER BY workspace_id`,
      );
      workspaceIds = rows.map((r) => r.id);
    }

    await client.query("BEGIN");
    const results = [];
    for (const wsId of workspaceIds) {
      results.push(await mirrorWorkspace(client, wsId));
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
