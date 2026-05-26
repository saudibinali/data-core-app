#!/usr/bin/env node
/**
 * H2-lite — Read-only HR master data integrity validation.
 * Purpose: detect duplicates / ambiguous identity in Foundation entities.
 *
 * Exit 0 = pass, 1 = errors (or warnings when FAIL_ON_WARN=1).
 */
const { Pool } = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");
const {
  issue,
  tableExists,
  listWorkspaceIds,
  finalizeReport,
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

function normCode(v) {
  return String(v ?? "").trim().toLowerCase();
}

function normName(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "");
}

async function findDuplicatesByCode(client, workspaceId, table, codeCol = "code") {
  const findings = [];
  const { rows } = await client.query(
    `SELECT ${codeCol} AS code, COUNT(*)::int AS cnt
     FROM ${table}
     WHERE workspace_id = $1 AND ${codeCol} IS NOT NULL AND btrim(${codeCol}) <> ''
     GROUP BY ${codeCol}
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC
     LIMIT 50`,
    [workspaceId],
  );
  for (const r of rows) {
    findings.push(
      issue(
        "HR_MASTER_DATA_DUPLICATE_CODE",
        `${table}: duplicate code "${r.code}" (${r.cnt})`,
        { workspaceId, table, code: r.code, count: r.cnt },
      ),
    );
  }
  return findings;
}

async function findSuspiciousSuffixCodes(client, workspaceId, table, codeCol = "code") {
  const findings = [];
  const { rows } = await client.query(
    `SELECT ${codeCol} AS code, COUNT(*)::int AS cnt
     FROM ${table}
     WHERE workspace_id = $1
       AND ${codeCol} IS NOT NULL
       AND (${codeCol} ~* '_[0-9]+$' OR ${codeCol} ~* '-[0-9]+$')
     GROUP BY ${codeCol}
     ORDER BY COUNT(*) DESC
     LIMIT 50`,
    [workspaceId],
  );
  for (const r of rows) {
    findings.push(
      issue(
        "HR_MASTER_DATA_SUFFIX_CODE",
        `${table}: suffix-like code "${r.code}" — indicates possible duplication strategy`,
        { workspaceId, table, code: r.code, count: r.cnt },
        "warn",
      ),
    );
  }
  return findings;
}

async function findDuplicateNamesWhenCodeMissing(client, workspaceId, table, nameCol = "name", codeCol = "code") {
  const findings = [];
  const { rows } = await client.query(
    `SELECT ${nameCol} AS name, COUNT(*)::int AS cnt
     FROM ${table}
     WHERE workspace_id = $1
       AND (${codeCol} IS NULL OR btrim(${codeCol}) = '')
     GROUP BY ${nameCol}
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC
     LIMIT 50`,
    [workspaceId],
  );
  for (const r of rows) {
    findings.push(
      issue(
        "HR_MASTER_DATA_DUPLICATE_NAME_WITHOUT_CODE",
        `${table}: duplicate name "${r.name}" while code is missing (${r.cnt})`,
        { workspaceId, table, name: r.name, count: r.cnt },
        "warn",
      ),
    );
  }
  return findings;
}

async function validateWorkspace(client, workspaceId) {
  const findings = [];

  const entities = [
    { table: "hr_job_grades", nameCol: "name", codeCol: "code" },
    { table: "hr_job_titles", nameCol: "name", codeCol: "code" },
    { table: "hr_org_units", nameCol: "name", codeCol: "code" },
    { table: "hr_work_locations", nameCol: "name", codeCol: "code" },
    { table: "hr_positions", nameCol: "title", codeCol: "code" },
    { table: "hr_employment_types", nameCol: "name", codeCol: "code" },
    { table: "hr_employee_statuses", nameCol: "name", codeCol: "code" },
    { table: "hr_contract_types", nameCol: "name", codeCol: "code" },
    { table: "hr_document_types", nameCol: "name", codeCol: "code" },
    { table: "hr_leave_policies", nameCol: "name", codeCol: "code" },
    { table: "hr_probation_policies", nameCol: "name", codeCol: "code" },
  ];

  for (const e of entities) {
    if (!(await tableExists(client, e.table))) continue;

    findings.push(...(await findDuplicatesByCode(client, workspaceId, e.table, e.codeCol)));
    findings.push(...(await findSuspiciousSuffixCodes(client, workspaceId, e.table, e.codeCol)));
    findings.push(...(await findDuplicateNamesWhenCodeMissing(client, workspaceId, e.table, e.nameCol, e.codeCol)));
  }

  // Heuristic: same normalized code but different casing/whitespace
  for (const e of entities) {
    if (!(await tableExists(client, e.table))) continue;
    const { rows } = await client.query(
      `SELECT ${e.codeCol} AS code
       FROM ${e.table}
       WHERE workspace_id = $1 AND ${e.codeCol} IS NOT NULL AND btrim(${e.codeCol}) <> ''`,
      [workspaceId],
    );
    const seen = new Map();
    for (const r of rows) {
      const raw = String(r.code);
      const key = normCode(raw);
      const prev = seen.get(key);
      if (prev && prev !== raw) {
        findings.push(
          issue(
            "HR_MASTER_DATA_CODE_CASE_CONFLICT",
            `${e.table}: code "${raw}" conflicts by normalization with "${prev}"`,
            { workspaceId, table: e.table, codeA: prev, codeB: raw, normalized: key },
            "warn",
          ),
        );
      } else if (!prev) {
        seen.set(key, raw);
      }
    }
  }

  // Heuristic: name normalization conflicts (helps catch Arabic whitespace variants)
  for (const e of entities) {
    if (!(await tableExists(client, e.table))) continue;
    const { rows } = await client.query(
      `SELECT ${e.nameCol} AS name
       FROM ${e.table}
       WHERE workspace_id = $1 AND ${e.nameCol} IS NOT NULL AND btrim(${e.nameCol}) <> ''`,
      [workspaceId],
    );
    const seen = new Map();
    for (const r of rows) {
      const raw = String(r.name);
      const key = normName(raw);
      const prev = seen.get(key);
      if (prev && prev !== raw) {
        findings.push(
          issue(
            "HR_MASTER_DATA_NAME_NORMALIZATION_CONFLICT",
            `${e.table}: name "${raw}" conflicts by normalization with "${prev}"`,
            { workspaceId, table: e.table, nameA: prev, nameB: raw, normalized: key },
            "warn",
          ),
        );
      } else if (!prev) {
        seen.set(key, raw);
      }
    }
  }

  return findings;
}

async function main() {
  const client = await pool.connect();
  try {
    const workspaceIds = await listWorkspaceIds(client, WORKSPACE_ID);
    const all = [];
    for (const ws of workspaceIds) {
      // eslint-disable-next-line no-await-in-loop
      const f = await validateWorkspace(client, ws);
      all.push(...f);
    }
    const report = finalizeReport(all, workspaceIds.length);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});

