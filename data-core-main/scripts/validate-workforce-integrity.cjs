#!/usr/bin/env node
/**
 * Read-only workforce + canonical cutover integrity validation (Phase 1 / F6.4).
 * Exit 0 = pass, 1 = errors (or warnings when FAIL_ON_WARN=1).
 */
const { Pool } = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");
const {
  issue,
  tableExists,
  isPilotWorkspace,
  cutoverFlags,
  listWorkspaceIds,
  finalizeReport,
  parseEnvBool,
} = require("./lib/integrity-helpers.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const WORKSPACE_ID = process.env.WORKSPACE_ID ? Number(process.env.WORKSPACE_ID) : null;

const pool = new Pool({ connectionString: DATABASE_URL });

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

async function validateCutoverData(client, workspaceId) {
  const findings = [];
  const flags = cutoverFlags();
  const pilot = isPilotWorkspace(workspaceId);
  const strictOrg = pilot && flags.orgCutover;
  const strictAttendance = pilot && flags.attendanceCanonical;

  if (await tableExists(client, "legacy_department_org_map")) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM departments d
       LEFT JOIN legacy_department_org_map m
         ON m.workspace_id = d.workspace_id AND m.department_id = d.id
       WHERE d.workspace_id = $1 AND m.org_unit_id IS NULL`,
      [workspaceId],
    );
    const unmapped = rows[0]?.cnt ?? 0;
    if (unmapped > 0) {
      findings.push(
        issue(
          "DEPARTMENTS_UNMAPPED_TO_ORG",
          `${unmapped} legacy departments without org unit mapping`,
          { workspaceId, unmappedDepartments: unmapped },
          strictOrg ? "error" : "warn",
        ),
      );
    }
  }

  if (await tableExists(client, "hr_leave_migration_map")) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM hr_employee_leaves l
       LEFT JOIN hr_leave_migration_map m
         ON m.workspace_id = l.workspace_id AND m.legacy_leave_id = l.id
       WHERE l.workspace_id = $1
         AND l.status IN ('pending', 'approved')
         AND m.canonical_request_id IS NULL`,
      [workspaceId],
    );
    const unmigrated = rows[0]?.cnt ?? 0;
    if (unmigrated > 0) {
      findings.push(
        issue(
          "LEAVE_LEGACY_ACTIVE_UNMIGRATED",
          `${unmigrated} active legacy leaves without canonical migration map`,
          { workspaceId, unmigratedActiveLeaves: unmigrated },
          pilot ? "error" : "warn",
        ),
      );
    }
  }

  if (await tableExists(client, "attendance_daily_summaries")) {
    const { rows: orphanSummary } = await client.query(
      `SELECT ads.id, ads.employee_id, ads.date
       FROM attendance_daily_summaries ads
       LEFT JOIN employees e ON e.id = ads.employee_id AND e.workspace_id = ads.workspace_id
       WHERE ads.workspace_id = $1 AND e.id IS NULL
       LIMIT 20`,
      [workspaceId],
    );
    for (const row of orphanSummary) {
      findings.push(
        issue("ATTENDANCE_SUMMARY_ORPHAN_EMPLOYEE", "attendance_daily_summaries references missing employee", {
          workspaceId,
          summaryId: row.id,
          employeeId: row.employee_id,
          date: row.date,
        }),
      );
    }

    if (strictAttendance) {
      const { rows: legacyMismatch } = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM attendance_daily_summaries ads
         LEFT JOIN hr_attendance ha ON ha.id = ads.legacy_attendance_id
         WHERE ads.workspace_id = $1
           AND ads.legacy_attendance_id IS NOT NULL
           AND ha.id IS NULL`,
        [workspaceId],
      );
      const cnt = legacyMismatch[0]?.cnt ?? 0;
      if (cnt > 0) {
        findings.push(
          issue(
            "ATTENDANCE_LEGACY_LINK_BROKEN",
            `${cnt} canonical summaries with missing legacy_attendance_id target`,
            { workspaceId, count: cnt },
            "warn",
          ),
        );
      }
    }
  }

  if (flags.legacyAttendanceFreeze && pilot) {
    const { rows: recentLegacyAtt } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM hr_attendance
       WHERE workspace_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [workspaceId],
    );
    const cnt = recentLegacyAtt[0]?.cnt ?? 0;
    if (cnt > 0) {
      findings.push(
        issue(
          "ATTENDANCE_LEGACY_ROWS_RECENT",
          `${cnt} hr_attendance rows created in last 7d while LEGACY_ATTENDANCE_FREEZE expected`,
          { workspaceId, count: cnt },
          strictAttendance ? "warn" : "warn",
        ),
      );
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

    const workspaceIds = await listWorkspaceIds(client, WORKSPACE_ID);

    const allFindings = [];
    for (const wsId of workspaceIds) {
      allFindings.push(...(await validateWorkspace(client, wsId)));
      allFindings.push(...(await validateCutoverData(client, wsId)));
    }

    const report = finalizeReport(allFindings, workspaceIds.length, {
      failOnWarn: parseEnvBool(process.env.FAIL_ON_WARN),
    });
    report.script = "validate-workforce-integrity";

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
