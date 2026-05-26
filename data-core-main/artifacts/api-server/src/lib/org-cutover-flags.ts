/**
 * F5.1 — Org canonical cutover flags (pilot-scoped, env-driven).
 * When enabled for a workspace, legacy department writes are blocked.
 */

import { getOrgRuntimeMode, type OrgRuntimeMode } from "./workforce/org/org-runtime-settings";
import { resolveLegacyWritePolicy } from "./workforce/stabilization/cleanup-staging";

const ORG_CUTOVER_ENV = "ORG_CUTOVER";
const PILOT_ENV = "ORG_CUTOVER_PILOT_WORKSPACE_ID";

function parseEnvBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isOrgCutoverFlagEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseEnvBool(env[ORG_CUTOVER_ENV]);
}

export function getOrgPilotWorkspaceId(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env[PILOT_ENV];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isOrgPilotWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!workspaceId) return false;
  if (parseEnvBool(env.PLATFORM_STABILIZATION_ALL_WORKSPACES)) return true;
  const pilotId = getOrgPilotWorkspaceId(env);
  return pilotId !== null && workspaceId === pilotId;
}

/** ORG_CUTOVER=true in env AND workspace is in pilot scope. */
export function isOrgCutoverEnabledForWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isOrgCutoverFlagEnabled(env)) return false;
  return isOrgPilotWorkspace(workspaceId, env);
}

export type OrgCutoverStatus = {
  pilotWorkspaceId: number | null;
  isPilotWorkspace: boolean;
  orgCutoverEnabled: boolean;
  orgRuntimeMode: OrgRuntimeMode;
  departmentsWritePolicy: "allow" | "read_only" | "blocked";
  legacyDepartmentsFrozen: boolean;
};

export async function resolveOrgCutoverStatus(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<OrgCutoverStatus> {
  const pilotWorkspaceId = getOrgPilotWorkspaceId(env);
  const isPilotWorkspace = workspaceId ? isOrgPilotWorkspace(workspaceId, env) : false;
  const orgCutoverEnabled = workspaceId ? isOrgCutoverEnabledForWorkspace(workspaceId, env) : false;
  const orgRuntimeMode = workspaceId ? await getOrgRuntimeMode(workspaceId) : "legacy";
  const departmentsWritePolicy = workspaceId
    ? await resolveLegacyWritePolicy(workspaceId, "departments")
    : "allow";

  const legacyDepartmentsFrozen =
    orgCutoverEnabled
    || orgRuntimeMode === "active"
    || departmentsWritePolicy !== "allow";

  return {
    pilotWorkspaceId,
    isPilotWorkspace,
    orgCutoverEnabled,
    orgRuntimeMode,
    departmentsWritePolicy,
    legacyDepartmentsFrozen,
  };
}

export function orgCutoverStatusForWorkspace(
  workspaceId: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): OrgCutoverStatus {
  const pilotWorkspaceId = getOrgPilotWorkspaceId(env);
  const isPilot = workspaceId ? isOrgPilotWorkspace(workspaceId, env) : false;
  const orgCutoverEnabled = workspaceId ? isOrgCutoverEnabledForWorkspace(workspaceId, env) : false;
  return {
    pilotWorkspaceId,
    isPilotWorkspace: isPilot,
    orgCutoverEnabled,
    orgRuntimeMode: "legacy",
    departmentsWritePolicy: "allow",
    legacyDepartmentsFrozen: orgCutoverEnabled,
  };
}
