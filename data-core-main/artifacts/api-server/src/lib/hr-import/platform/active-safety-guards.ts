/**
 * Final Phase — Active mode safety guards (safe rejection, no HTTP 500).
 */

import { isHrImportRuntimeSchemaAvailable } from "../hr-import-startup";
import { isHrImportAutoCreateSchemaAvailable } from "../health/auto-create-startup";
import { isPlatformRuntimeSchemaAvailable } from "../health/platform-runtime-startup";
import { computeWorkspaceReadiness, PARITY_THRESHOLD } from "./readiness-service";
import { getSchemaRegistrySnapshot } from "../../workforce/stabilization/runtime-health-service";
import { importSessionService } from "../session/import-session-service";
import { buildManagerCommitPlan } from "../commit/hierarchy-commit";

export type ActiveSafetyGuardResult = {
  allowed: boolean;
  blockers: string[];
  diagnostics: Record<string, unknown>;
};

export async function evaluateActiveModeSafetyGuards(workspaceId: number): Promise<ActiveSafetyGuardResult> {
  const blockers: string[] = [];
  const readiness = await computeWorkspaceReadiness(workspaceId);

  if (!isHrImportRuntimeSchemaAvailable()) blockers.push("HR_IMPORT_SCHEMA_UNAVAILABLE");
  if (!isHrImportAutoCreateSchemaAvailable()) blockers.push("AUTO_CREATE_SCHEMA_UNAVAILABLE");
  if (!isPlatformRuntimeSchemaAvailable()) blockers.push("PLATFORM_RUNTIME_SCHEMA_UNAVAILABLE");

  if (readiness.parityScore < PARITY_THRESHOLD) blockers.push("PARITY_BELOW_THRESHOLD");
  if (!readiness.pilotValidated) blockers.push("PILOT_VALIDATION_REQUIRED");
  if (!readiness.parityValidated) blockers.push("PARITY_VALIDATION_REQUIRED");
  if (!readiness.rollbackAvailable) blockers.push("ROLLBACK_RUNTIME_UNAVAILABLE");

  const schema = await getSchemaRegistrySnapshot();
  if (schema.components.hr_import_runtime?.status !== "ok") {
    blockers.push("SCHEMA_DRIFT_HR_IMPORT");
  }

  const sessions = await importSessionService.listSessions(workspaceId, 3);
  const latest = sessions[0];
  if (latest) {
    const rows = await importSessionService.getSessionRows(latest.id, workspaceId);
    const hierarchy = buildManagerCommitPlan(
      rows.map((r) => ({ rowNumber: r.rowNumber, raw: (r.rawRow ?? {}) as Record<string, string> })),
    );
    if (hierarchy.cycles.length || hierarchy.unresolvedManagers.length) {
      blockers.push("UNRESOLVED_DEPENDENCY_CHAINS");
    }
  }

  const unstable = readiness.blockers.filter((b) =>
    ["NO_SHADOW_SESSION_FOR_PARITY", "SCHEMA_NOT_READY"].includes(b),
  );
  if (unstable.length) blockers.push("VALIDATION_INSTABILITY");

  return {
    allowed: blockers.length === 0 && readiness.activationEligible,
    blockers: [...new Set([...blockers, ...readiness.blockers])],
    diagnostics: {
      readiness,
      schemaRegistry: schema.components,
      globalAutoEnable: false,
    },
  };
}
