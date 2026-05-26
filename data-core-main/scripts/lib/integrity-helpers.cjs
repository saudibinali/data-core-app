/**
 * F6.4 — Shared helpers for read-only integrity validators (CI gates).
 */
function parseEnvBool(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function issue(code, message, meta = {}, severity = "error") {
  return { code, message, severity, ...meta };
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

function resolvePilotWorkspaceId(env = process.env) {
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return "all";
  const raw =
    env.WORKSPACE_ID
    ?? env.PAYROLL_CUTOVER_PILOT_WORKSPACE_ID
    ?? env.ATTENDANCE_CUTOVER_PILOT_WORKSPACE_ID
    ?? env.ORG_CUTOVER_PILOT_WORKSPACE_ID
    ?? env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID
    ?? env.PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isPilotWorkspace(workspaceId, env = process.env) {
  const pilot = resolvePilotWorkspaceId(env);
  if (pilot === "all") return true;
  if (pilot == null) return false;
  return workspaceId === pilot;
}

function cutoverFlags(env = process.env) {
  return {
    orgCutover: parseEnvBool(env.ORG_CUTOVER),
    payrollCanonical: parseEnvBool(env.PAYROLL_CANONICAL_WRITE),
    attendanceCanonical: parseEnvBool(env.ATTENDANCE_CANONICAL_WRITE),
    legacyPayrollFreeze: parseEnvBool(env.LEGACY_PAYROLL_FREEZE),
    legacyAttendanceFreeze: parseEnvBool(env.LEGACY_ATTENDANCE_FREEZE),
    legacyLeaveFreeze: parseEnvBool(env.LEGACY_LEAVE_FREEZE),
  };
}

async function listWorkspaceIds(client, workspaceIdFilter) {
  if (workspaceIdFilter) return [workspaceIdFilter];
  const { rows } = await client.query(`SELECT id FROM workspaces ORDER BY id`);
  return rows.map((r) => r.id);
}

function finalizeReport(allFindings, workspaceCount, options = {}) {
  const failOnWarn = parseEnvBool(process.env.FAIL_ON_WARN) || options.failOnWarn;
  const errors = allFindings.filter((f) => f.severity !== "warn");
  const warnings = allFindings.filter((f) => f.severity === "warn");
  const ok = errors.length === 0 && (!failOnWarn || warnings.length === 0);

  return {
    ok,
    workspaceCount,
    issueCount: allFindings.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    findings: allFindings,
    cutover: cutoverFlags(),
    pilotWorkspaceId: resolvePilotWorkspaceId(),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  parseEnvBool,
  issue,
  tableExists,
  columnExists,
  resolvePilotWorkspaceId,
  isPilotWorkspace,
  cutoverFlags,
  listWorkspaceIds,
  finalizeReport,
};
