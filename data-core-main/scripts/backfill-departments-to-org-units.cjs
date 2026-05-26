#!/usr/bin/env node
/**
 * F5.1 — Backfill legacy departments → hr_org_units + legacy_department_org_map.
 * Idempotent: creates org units when missing (name match), links map, syncs managers.
 *
 * Usage:
 *   node scripts/backfill-departments-to-org-units.cjs
 *   WORKSPACE_ID=1 node scripts/backfill-departments-to-org-units.cjs
 *   DRY_RUN=1 node scripts/backfill-departments-to-org-units.cjs
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
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

const pool = new Pool({ connectionString: DATABASE_URL });

function slugCode(name) {
  const base = String(name || "dept")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "dept";
}

async function backfillWorkspace(client, workspaceId) {
  const { rows: departments } = await client.query(
    `SELECT d.id, d.workspace_id, d.name, lower(trim(d.name)) AS name_key, d.manager_id, d.description
     FROM departments d
     WHERE d.workspace_id = $1
     ORDER BY d.id`,
    [workspaceId],
  );

  let orgUnitsCreated = 0;
  let mapInserted = 0;
  let managersUpdated = 0;
  let skipped = 0;

  for (const dept of departments) {
    let orgUnitId = null;

    const { rows: existingOrg } = await client.query(
      `SELECT id FROM hr_org_units
       WHERE workspace_id = $1 AND lower(trim(name)) = $2 AND is_active = true
       ORDER BY id ASC LIMIT 1`,
      [workspaceId, dept.name_key],
    );

    if (existingOrg.length) {
      orgUnitId = existingOrg[0].id;
    } else if (!DRY_RUN) {
      const code = `${slugCode(dept.name)}-${dept.id}`;
      const ins = await client.query(
        `INSERT INTO hr_org_units (workspace_id, type, name, code, is_active, display_order)
         VALUES ($1, 'department', $2, $3, true, 0)
         RETURNING id`,
        [workspaceId, dept.name.trim(), code],
      );
      orgUnitId = ins.rows[0]?.id ?? null;
      if (orgUnitId) orgUnitsCreated++;
    } else {
      orgUnitsCreated++;
      skipped++;
      continue;
    }

    if (!orgUnitId) {
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      const mapRes = await client.query(
        `INSERT INTO legacy_department_org_map (workspace_id, department_id, org_unit_id, match_method)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, department_id) DO NOTHING`,
        [workspaceId, dept.id, orgUnitId, existingOrg.length ? "name" : "backfill_create"],
      );
      if ((mapRes.rowCount ?? 0) > 0) mapInserted++;

      if (dept.manager_id) {
        const { rows: empLink } = await client.query(
          `SELECT id FROM employees WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
          [dept.manager_id, workspaceId],
        );
        const managerEmployeeId = empLink[0]?.id;
        if (managerEmployeeId) {
          const upd = await client.query(
            `UPDATE hr_org_units SET manager_employee_id = $1
             WHERE id = $2 AND workspace_id = $3 AND manager_employee_id IS NULL`,
            [managerEmployeeId, orgUnitId, workspaceId],
          );
          managersUpdated += upd.rowCount ?? 0;
        }
      }
    } else {
      mapInserted++;
    }
  }

  return {
    workspaceId,
    totalDepartments: departments.length,
    orgUnitsCreated,
    mapInserted,
    managersUpdated,
    skipped,
    dryRun: DRY_RUN,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    let workspaceIds = [];
    if (WORKSPACE_ID) {
      workspaceIds = [WORKSPACE_ID];
    } else {
      const { rows } = await client.query(
        `SELECT DISTINCT workspace_id AS id FROM departments ORDER BY workspace_id`,
      );
      workspaceIds = rows.map((r) => r.id);
    }

    if (!DRY_RUN) await client.query("BEGIN");

    const results = [];
    for (const wsId of workspaceIds) {
      results.push(await backfillWorkspace(client, wsId));
    }

    if (!DRY_RUN) await client.query("COMMIT");

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } catch (e) {
    if (!DRY_RUN) await client.query("ROLLBACK").catch(() => undefined);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
