#!/usr/bin/env node
/**
 * F6.4 — Read-only payroll / canonical cutover integrity validation.
 * Exit 0 = pass, 1 = errors (or warnings when FAIL_ON_WARN=1).
 */
const { Pool } = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");
const {
  issue,
  tableExists,
  columnExists,
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

async function validatePayrollWorkspace(client, workspaceId) {
  const findings = [];
  const flags = cutoverFlags();
  const pilot = isPilotWorkspace(workspaceId);
  const strictCanonical = pilot && flags.payrollCanonical;

  if (!(await tableExists(client, "payroll_runs"))) {
    findings.push(
      issue("PAYROLL_SCHEMA_UNAVAILABLE", "payroll_runs table missing — apply payroll migrations", {
        workspaceId,
      }),
    );
    return findings;
  }

  const hasLegacyCol = await columnExists(client, "payroll_runs", "legacy_payroll_run_id");

  if (hasLegacyCol) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM hr_payroll_runs l
       LEFT JOIN payroll_runs c
         ON c.workspace_id = l.workspace_id AND c.legacy_payroll_run_id = l.id
       WHERE l.workspace_id = $1 AND c.id IS NULL`,
      [workspaceId],
    );
    const pending = rows[0]?.cnt ?? 0;
    if (pending > 0) {
      findings.push(
        issue(
          "PAYROLL_LEGACY_RUNS_UNMIGRATED",
          `${pending} legacy hr_payroll_runs without canonical payroll_runs mapping`,
          { workspaceId, pendingMigration: pending },
          strictCanonical ? "error" : "warn",
        ),
      );
    }
  }

  const { rows: orphanRunEmp } = await client.query(
    `SELECT pre.id, pre.run_id, pre.employee_id
     FROM payroll_run_employees pre
     LEFT JOIN employees e ON e.id = pre.employee_id AND e.workspace_id = pre.workspace_id
     WHERE pre.workspace_id = $1 AND e.id IS NULL
     LIMIT 20`,
    [workspaceId],
  );
  for (const row of orphanRunEmp) {
    findings.push(
      issue("PAYROLL_ORPHAN_RUN_EMPLOYEE", "payroll_run_employees references missing employee", {
        workspaceId,
        runEmployeeId: row.id,
        runId: row.run_id,
        employeeId: row.employee_id,
      }),
    );
  }

  if (await tableExists(client, "payroll_payslips")) {
    const { rows: orphanPayslips } = await client.query(
      `SELECT pp.id, pp.run_id
       FROM payroll_payslips pp
       LEFT JOIN payroll_runs pr ON pr.id = pp.run_id AND pr.workspace_id = pp.workspace_id
       WHERE pp.workspace_id = $1 AND pr.id IS NULL
       LIMIT 20`,
      [workspaceId],
    );
    for (const row of orphanPayslips) {
      findings.push(
        issue("PAYROLL_ORPHAN_PAYSLIP_RUN", "payroll_payslips references missing payroll_run", {
          workspaceId,
          payslipId: row.id,
          runId: row.run_id,
        }),
      );
    }

    const { rows: badAmounts } = await client.query(
      `SELECT id, run_id, gross_amount::numeric AS gross, net_amount::numeric AS net
       FROM payroll_payslips
       WHERE workspace_id = $1
         AND (gross_amount::numeric < 0 OR net_amount::numeric < 0 OR net_amount::numeric > gross_amount::numeric + 0.01)
       LIMIT 20`,
      [workspaceId],
    );
    for (const row of badAmounts) {
      findings.push(
        issue("PAYROLL_PAYSLIP_AMOUNT_INVALID", "Payslip gross/net amounts invalid", {
          workspaceId,
          payslipId: row.id,
          runId: row.run_id,
          gross: String(row.gross),
          net: String(row.net),
        }),
      );
    }

    if (strictCanonical) {
      const { rows: missingPdf } = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM payroll_payslips
         WHERE workspace_id = $1 AND status = 'issued' AND (pdf_storage_key IS NULL OR pdf_storage_key = '')`,
        [workspaceId],
      );
      const cnt = missingPdf[0]?.cnt ?? 0;
      if (cnt > 0) {
        findings.push(
          issue(
            "PAYROLL_ISSUED_PAYSLIP_MISSING_PDF",
            `${cnt} issued canonical payslips missing pdf_storage_key`,
            { workspaceId, count: cnt },
            "warn",
          ),
        );
      }
    }

    const { rows: lockedGaps } = await client.query(
      `SELECT pr.id AS run_id,
              (SELECT COUNT(*)::int FROM payroll_run_employees pre
               WHERE pre.run_id = pr.id AND pre.workspace_id = pr.workspace_id AND pre.status = 'included') AS included_cnt,
              (SELECT COUNT(*)::int FROM payroll_payslips pp
               WHERE pp.run_id = pr.id AND pp.workspace_id = pr.workspace_id AND pp.status = 'issued') AS issued_cnt
       FROM payroll_runs pr
       WHERE pr.workspace_id = $1
         AND pr.status IN ('locked', 'approved')
         AND (SELECT COUNT(*)::int FROM payroll_run_employees pre
              WHERE pre.run_id = pr.id AND pre.workspace_id = pr.workspace_id AND pre.status = 'included')
           > (SELECT COUNT(*)::int FROM payroll_payslips pp
              WHERE pp.run_id = pr.id AND pp.workspace_id = pr.workspace_id AND pp.status = 'issued')
       LIMIT 10`,
      [workspaceId],
    );
    for (const row of lockedGaps) {
      findings.push(
        issue(
          "PAYROLL_LOCKED_RUN_PAYSLIP_GAP",
          "Locked/approved run has fewer issued payslips than included employees",
          {
            workspaceId,
            runId: row.run_id,
            includedCount: row.included_cnt,
            issuedCount: row.issued_cnt,
          },
          strictCanonical ? "error" : "warn",
        ),
      );
    }
  }

  const { rows: dupNumbers } = await client.query(
    `SELECT payslip_number, COUNT(*)::int AS cnt
     FROM payroll_payslips
     WHERE workspace_id = $1 AND payslip_number IS NOT NULL
     GROUP BY payslip_number
     HAVING COUNT(*) > 1
     LIMIT 10`,
    [workspaceId],
  );
  for (const row of dupNumbers) {
    findings.push(
      issue("PAYROLL_DUPLICATE_PAYSLIP_NUMBER", "Duplicate payslip_number in workspace", {
        workspaceId,
        payslipNumber: row.payslip_number,
        count: row.cnt,
      }),
    );
  }

  if (flags.legacyPayrollFreeze && pilot) {
    const { rows: recentLegacy } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM hr_payroll_runs
       WHERE workspace_id = $1
         AND updated_at > NOW() - INTERVAL '7 days'
         AND status IN ('draft', 'processing')`,
      [workspaceId],
    );
    const cnt = recentLegacy[0]?.cnt ?? 0;
    if (cnt > 0) {
      findings.push(
        issue(
          "PAYROLL_LEGACY_RUNS_STILL_MUTATING",
          `${cnt} legacy hr_payroll_runs updated in last 7d while LEGACY_PAYROLL_FREEZE expected`,
          { workspaceId, count: cnt },
          "warn",
        ),
      );
    }
  }

  return findings;
}

async function main() {
  const client = await pool.connect();
  try {
    const workspaceIds = await listWorkspaceIds(client, WORKSPACE_ID);
    const allFindings = [];
    for (const wsId of workspaceIds) {
      allFindings.push(...(await validatePayrollWorkspace(client, wsId)));
    }

    const report = finalizeReport(allFindings, workspaceIds.length, {
      failOnWarn: parseEnvBool(process.env.FAIL_ON_WARN),
    });
    report.script = "validate-payroll-integrity";
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
