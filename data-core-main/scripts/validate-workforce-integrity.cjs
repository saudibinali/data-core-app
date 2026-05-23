#!/usr/bin/env node
/**
 * Read-only workforce integrity validation (Phase 1).
 * Exit 0 = pass, 1 = issues found.
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

function issue(code, message, meta = {}) {
  return { code, message, ...meta };
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function validateWorkspace(client, workspaceId) {
  const findings = [];

  const { rows: employees } = await client.query(
    `SELECT id, full_name, org_unit_id, direct_manager_id, user_id, status
     FROM employees WHERE workspace_id = $1`,
    [workspaceId],
  );

  const { rows: orgUnits } = await client.query(
    `SELECT id, parent_id, is_active FROM hr_org_units WHERE workspace_id = $1`,
    [workspaceId],
  );
  const orgIds = new Set(orgUnits.map((o) => o.id));

  for (const emp of employees) {
    if (emp.status === "active" && emp.org_unit_id == null) {
      findings.push(issue("EMPLOYEE_MISSING_ORG_UNIT", "Active employee has no orgUnitId", {
        workspaceId, employeeId: emp.id, fullName: emp.full_name,
      }));
    }
    if (emp.status === "active" && emp.direct_manager_id == null) {
      findings.push(issue("EMPLOYEE_MISSING_MANAGER", "Active employee has no directManagerId", {
        workspaceId, employeeId: emp.id, fullName: emp.full_name,
      }));
    }
    if (emp.org_unit_id != null && !orgIds.has(emp.org_unit_id)) {
      findings.push(issue("ORPHAN_ORG_UNIT_REF", "Employee references missing org unit", {
        workspaceId, employeeId: emp.id, orgUnitId: emp.org_unit_id,
      }));
    }
    if (emp.direct_manager_id != null) {
      const mgr = employees.find((e) => e.id === emp.direct_manager_id);
      if (!mgr) {
        findings.push(issue("ORPHAN_MANAGER_REF", "Employee directManagerId not found in workspace", {
          workspaceId, employeeId: emp.id, directManagerId: emp.direct_manager_id,
        }));
      } else if (mgr.id === emp.id) {
        findings.push(issue("SELF_MANAGER", "Employee is their own manager", {
          workspaceId, employeeId: emp.id,
        }));
      }
    }
  }

  // Hierarchy cycles
  const byId = new Map(orgUnits.map((o) => [o.id, o]));
  for (const unit of orgUnits) {
    const seen = new Set();
    let cur = unit;
    while (cur?.parent_id != null) {
      if (seen.has(cur.id)) {
        findings.push(issue("ORG_HIERARCHY_CYCLE", "Org unit hierarchy contains a cycle", {
          workspaceId, orgUnitId: unit.id,
        }));
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
  }

  const { rows: usersWithoutEmployee } = await client.query(
    `SELECT u.id, u.email, u.full_name
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id AND e.workspace_id = u.workspace_id
     WHERE u.workspace_id = $1 AND u.status = 'active' AND e.id IS NULL`,
    [workspaceId],
  );
  for (const u of usersWithoutEmployee) {
    findings.push(issue("USER_WITHOUT_EMPLOYEE", "Active user has no linked employee profile", {
      workspaceId, userId: u.id, email: u.email,
    }));
  }

  // Runtime conflicts: linked user manager vs employee manager
  const { rows: linked } = await client.query(
    `SELECT e.id AS employee_id, e.direct_manager_id, e.user_id,
            u.line_manager_id, mgr.user_id AS canonical_mgr_user_id
     FROM employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN employees mgr ON mgr.id = e.direct_manager_id
     WHERE e.workspace_id = $1 AND e.user_id IS NOT NULL`,
    [workspaceId],
  );
  for (const row of linked) {
    if (row.direct_manager_id && row.canonical_mgr_user_id && row.line_manager_id
        && row.canonical_mgr_user_id !== row.line_manager_id) {
      findings.push(issue("MANAGER_RUNTIME_CONFLICT", "directManagerId user differs from users.lineManagerId", {
        workspaceId,
        employeeId: row.employee_id,
        canonicalMgrUserId: row.canonical_mgr_user_id,
        legacyLineManagerId: row.line_manager_id,
      }));
    }
  }

  return findings;
}

async function main() {
  const client = await pool.connect();
  try {
    const hasEmployees = await tableExists(client, "employees");
    const hasOrg = await tableExists(client, "hr_org_units");
    if (!hasEmployees || !hasOrg) {
      console.log(JSON.stringify({
        ok: false,
        error: "WORKFORCE_SCHEMA_UNAVAILABLE",
        message: "Required tables missing — run migrate-workforce-foundation.cjs first",
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

    const allFindings = [];
    for (const wsId of workspaceIds) {
      const findings = await validateWorkspace(client, wsId);
      allFindings.push(...findings);
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
