/**
 * F6.1 — Payroll canonical cutover flags (pilot-scoped, env-driven).
 * PAYROLL_CANONICAL_WRITE=false → rollback to legacy hr_payroll_runs UI/writes.
 * LEGACY_PAYROLL_FREEZE=true → block legacy payroll run mutations (410).
 */

export type PayrollCutoverFlagKey = "payrollCanonicalWrite" | "legacyPayrollFreeze";

export type PayrollCutoverFlags = Record<PayrollCutoverFlagKey, boolean>;

const ENV_MAP: Record<PayrollCutoverFlagKey, string> = {
  payrollCanonicalWrite: "PAYROLL_CANONICAL_WRITE",
  legacyPayrollFreeze: "LEGACY_PAYROLL_FREEZE",
};

const PILOT_ENV = "PAYROLL_CUTOVER_PILOT_WORKSPACE_ID";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getPayrollCutoverFlags(
  env: Record<string, string | undefined> = process.env,
): PayrollCutoverFlags {
  return {
    payrollCanonicalWrite: parseEnvBool(env[ENV_MAP.payrollCanonicalWrite]),
    legacyPayrollFreeze: parseEnvBool(env[ENV_MAP.legacyPayrollFreeze]),
  };
}

export function getPayrollPilotWorkspaceId(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw =
    env[PILOT_ENV]
    ?? env.PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID
    ?? env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isPayrollPilotWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!workspaceId) return false;
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return true;
  const pilotId = getPayrollPilotWorkspaceId(env);
  return pilotId !== null && workspaceId === pilotId;
}

export function isPayrollCutoverFlagEnabled(
  key: PayrollCutoverFlagKey,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getPayrollCutoverFlags(env)[key];
}

/** Flag is ON in env AND workspace is in pilot scope. */
export function isPayrollCutoverEnabledForWorkspace(
  key: PayrollCutoverFlagKey,
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isPayrollPilotWorkspace(workspaceId, env)) return false;
  return getPayrollCutoverFlags(env)[key];
}

export type PayrollCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  globalFlags: PayrollCutoverFlags;
  payrollCanonicalWrite: boolean;
  legacyPayrollFrozen: boolean;
  legacyRunsReadOnly: boolean;
  canonicalWriteEnabled: boolean;
};

export function payrollCutoverStatusForWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): PayrollCutoverStatus {
  const flags = getPayrollCutoverFlags(env);
  const pilotWorkspaceId = getPayrollPilotWorkspaceId(env);
  const isPilot = isPayrollPilotWorkspace(workspaceId, env);
  const payrollCanonicalWrite = isPilot && flags.payrollCanonicalWrite;
  const legacyPayrollFrozen = isPilot && flags.legacyPayrollFreeze;
  const legacyRunsReadOnly = legacyPayrollFrozen || payrollCanonicalWrite;
  return {
    pilotWorkspaceId,
    isPilotWorkspace: isPilot,
    globalFlags: flags,
    payrollCanonicalWrite,
    legacyPayrollFrozen,
    legacyRunsReadOnly,
    canonicalWriteEnabled: payrollCanonicalWrite,
  };
}

export function payrollCutoverFlagsSnapshot(
  env: Record<string, string | undefined> = process.env,
): { flags: PayrollCutoverFlags; envKeys: typeof ENV_MAP; pilotEnvKey: string } {
  return { flags: getPayrollCutoverFlags(env), envKeys: ENV_MAP, pilotEnvKey: PILOT_ENV };
}
