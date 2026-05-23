#!/usr/bin/env node
/**
 * Read-only org runtime validation (Phase 2).
 */
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const WORKSPACE_ID = process.env.WORKSPACE_ID ? Number(process.env.WORKSPACE_ID) : null;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function issue(code, message, meta = {}) {
  return { code, message, ...meta };
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function validateSchema(client) {
  const findings = [];
  const required = [
    ["hr_org_units", "manager_employee_id"],
    ["hr_workspace_settings", "org_runtime_mode"],
  ];
  for (const [table, col] of required) {
    if (!(await columnExists(client, table, col))) {
      findings.push(issue("SCHEMA_MISSING", `Missing ${table}.${col}`, { table, column: col }));
    }
  }
  const { rows: t } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workforce_executive_overrides'`,
  );
  if (!t.length) findings.push(issue("SCHEMA_MISSING", "Missing table workforce_executive_overrides"));
  return findings;
}

async function validateWorkspace(client, workspaceId) {
  const findings = [];

  const { rows: orgUnits } = await client.query(
    `SELECT id, parent_id, manager_employee_id, is_active FROM hr_org_units WHERE workspace_id = $1`,
    [workspaceId],
  );
  const orgIds = new Set(orgUnits.map((o) => o.id));

  for (const unit of orgUnits) {
    if (unit.parent_id != null && !orgIds.has(unit.parent_id)) {
      findings.push(issue("ORPHAN_ORG_UNIT", "Org unit parent does not exist", {
        workspaceId, orgUnitId: unit.id, parentId: unit.parent_id,
      }));
    }
    if (unit.manager_employee_id != null) {
      const { rows: mgr } = await client.query(
        `SELECT id FROM employees WHERE id = $1 AND workspace_id = $2`,
        [unit.manager_employee_id, workspaceId],
      );
      if (!mgr.length) {
        findings.push(issue("ORPHAN_ORG_HEAD", "Org unit head employee not found", {
          workspaceId, orgUnitId: unit.id, managerEmployeeId: unit.manager_employee_id,
        }));
      }
    }
  }

  for (const unit of orgUnits) {
    const seen = new Set();
    let cur = unit;
    while (cur?.parent_id != null) {
      if (seen.has(cur.id)) {
        findings.push(issue("ORG_HIERARCHY_CYCLE", "Circular org hierarchy detected", {
          workspaceId, orgUnitId: unit.id,
        }));
        break;
      }
      seen.add(cur.id);
      cur = orgUnits.find((o) => o.id === cur.parent_id);
    }
  }

  const { rows: employees } = await client.query(
    `SELECT id, full_name, org_unit_id, direct_manager_id, status
     FROM employees WHERE workspace_id = $1`,
    [workspaceId],
  );

  const { rows: settings } = await client.query(
    `SELECT org_runtime_mode FROM hr_workspace_settings WHERE workspace_id = $1`,
    [workspaceId],
  );
  const orgMode = settings[0]?.org_runtime_mode ?? "legacy";

  let exemptIds = [];
  try {
    const { rows: exec } = await client.query(
      `SELECT executive_exempt_employee_ids, ceo_employee_id, hr_director_employee_id
       FROM workforce_executive_overrides WHERE workspace_id = $1`,
      [workspaceId],
    );
    if (exec[0]) {
      exemptIds = Array.isArray(exec[0].executive_exempt_employee_ids)
        ? exec[0].executive_exempt_employee_ids
        : [];
      if (exec[0].ceo_employee_id) exemptIds.push(exec[0].ceo_employee_id);
      if (exec[0].hr_director_employee_id) exemptIds.push(exec[0].hr_director_employee_id);
    }
  } catch {
    /* table may be missing — caught by schema check */
  }

  for (const emp of employees) {
    if (emp.status !== "active") continue;
    const exempt = exemptIds.includes(emp.id);

    if (!emp.org_unit_id && !exempt) {
      findings.push(issue("EMPLOYEE_MISSING_ORG", "Active employee without orgUnitId", {
        workspaceId, employeeId: emp.id, fullName: emp.full_name, orgRuntimeMode: orgMode,
      }));
    }
    if (!emp.direct_manager_id && !exempt) {
      findings.push(issue("EMPLOYEE_MISSING_MANAGER", "Active employee without directManagerId", {
        workspaceId, employeeId: emp.id, fullName: emp.full_name, orgRuntimeMode: orgMode,
      }));
    }
    if (emp.org_unit_id && !orgIds.has(emp.org_unit_id)) {
      findings.push(issue("ORPHAN_EMPLOYEE_ORG", "Employee references missing org unit", {
        workspaceId, employeeId: emp.id, orgUnitId: emp.org_unit_id,
      }));
    }
    if (emp.direct_manager_id === emp.id) {
      findings.push(issue("SELF_MANAGER", "Employee is their own manager", {
        workspaceId, employeeId: emp.id,
      }));
    }
  }

  for (const emp of employees) {
    if (!emp.direct_manager_id) continue;
    const chain = new Set([emp.id]);
    let curId = emp.direct_manager_id;
    let depth = 0;
    while (curId != null && depth < 25) {
      if (chain.has(curId)) {
        findings.push(issue("INVALID_REPORTING_CHAIN", "Manager cycle in reporting chain", {
          workspaceId, employeeId: emp.id,
        }));
        break;
      }
      chain.add(curId);
      const mgr = employees.find((e) => e.id === curId);
      curId = mgr?.direct_manager_id ?? null;
      depth++;
    }
  }

  return findings;
}

async function main() {
  const client = await pool.connect();
  try {
    const schemaFindings = await validateSchema(client);
    if (schemaFindings.length) {
      console.log(JSON.stringify({
        ok: false,
        error: "ORG_RUNTIME_SCHEMA_UNAVAILABLE",
        findings: schemaFindings,
        migrationHint: "node scripts/migrate-org-runtime.cjs",
      }, null, 2));
      process.exit(1);
    }

    let workspaceIds;
    if (WORKSPACE_ID) {
      workspaceIds = [WORKSPACE_ID];
    } else {
      const { rows } = await client.query(`SELECT id FROM workspaces ORDER BY id`);
      workspaceIds = rows.map((r) => r.id);
    }

    const allFindings = [...schemaFindings];
    for (const wsId of workspaceIds) {
      allFindings.push(...(await validateWorkspace(client, wsId)));
    }

    const report = {
      ok: allFindings.length === 0,
      workspaceCount: workspaceIds.length,
      issueCount: allFindings.length,
      findings: allFindings,
      checkedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
