/**
 * Final Phase — Workspace readiness & parity scoring.
 */

import { isHrImportRuntimeSchemaAvailable } from "../hr-import-startup";
import { isHrImportAutoCreateSchemaAvailable } from "../health/auto-create-startup";
import { isPlatformRuntimeSchemaAvailable } from "../health/platform-runtime-startup";
import { getImportRuntimeSettings } from "../runtime-settings";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import { getWorkspaceRollout } from "./rollout-service";
import { importSessionService } from "../session/import-session-service";
import { buildImportParityReport } from "../validation/parity-validation";
import { getSchemaRegistrySnapshot } from "../../workforce/stabilization/runtime-health-service";

export const PARITY_THRESHOLD = 0.95;
export const READINESS_THRESHOLD = 0.85;

export type WorkspaceReadinessReport = {
  workspaceId: number;
  readinessScore: number;
  parityScore: number;
  pilotValidated: boolean;
  parityValidated: boolean;
  schemaHealthy: boolean;
  rollbackAvailable: boolean;
  activationEligible: boolean;
  blockers: string[];
  diagnostics: Record<string, unknown>;
};

export async function computeWorkspaceReadiness(workspaceId: number): Promise<WorkspaceReadinessReport> {
  const blockers: string[] = [];
  const settings = await getImportRuntimeSettings(workspaceId);
  const pilotEnabled = await isPilotWorkspaceEnabled(workspaceId);
  const rollout = await getWorkspaceRollout(workspaceId);

  const schemaHealthy =
    isHrImportRuntimeSchemaAvailable()
    && isHrImportAutoCreateSchemaAvailable()
    && isPlatformRuntimeSchemaAvailable();

  if (!schemaHealthy) blockers.push("SCHEMA_NOT_READY");

  if (!pilotEnabled) blockers.push("PILOT_NOT_ENABLED");

  let parityScore = rollout?.parityScore ? parseFloat(String(rollout.parityScore)) : 0;
  let parityValidated = false;

  const sessions = await importSessionService.listSessions(workspaceId, 5);
  const shadowSession = sessions.find((s) =>
    ["shadow_complete", "validated", "committed"].includes(s.status),
  );

  if (shadowSession) {
    const parity = await buildImportParityReport(workspaceId, shadowSession.id);
    if (parity?.validationParity) {
      parityScore = parity.validationParity.parityRatio;
      parityValidated = parityScore >= PARITY_THRESHOLD;
    }
  } else {
    blockers.push("NO_SHADOW_SESSION_FOR_PARITY");
  }

  if (parityScore < PARITY_THRESHOLD) blockers.push("PARITY_BELOW_THRESHOLD");

  const pilotValidated = pilotEnabled && ["pilot_active", "controlled_commit", "active"].includes(settings.employeeImportRuntimeMode);
  if (!pilotValidated) blockers.push("PILOT_VALIDATION_INCOMPLETE");

  const rollbackAvailable = schemaHealthy && isHrImportRuntimeSchemaAvailable();

  let readinessScore = 0;
  if (schemaHealthy) readinessScore += 0.25;
  if (pilotEnabled) readinessScore += 0.2;
  if (pilotValidated) readinessScore += 0.15;
  if (parityValidated) readinessScore += 0.25;
  if (rollbackAvailable) readinessScore += 0.15;

  const activationEligible =
    blockers.length === 0
    && readinessScore >= READINESS_THRESHOLD
    && parityScore >= PARITY_THRESHOLD
    && pilotEnabled;

  const schema = await getSchemaRegistrySnapshot();

  return {
    workspaceId,
    readinessScore,
    parityScore,
    pilotValidated,
    parityValidated,
    schemaHealthy,
    rollbackAvailable,
    activationEligible,
    blockers,
    diagnostics: {
      settings,
      rolloutStatus: rollout?.rolloutStatus ?? "not_registered",
      parityThreshold: PARITY_THRESHOLD,
      readinessThreshold: READINESS_THRESHOLD,
      schemaComponents: {
        hr_import_runtime: schema.components.hr_import_runtime?.status,
        hr_import_auto_create_runtime: schema.components.hr_import_auto_create_runtime?.status,
        platform_import_export_runtime: schema.components.platform_import_export_runtime?.status,
      },
    },
  };
}

export async function computeWorkspaceParityScore(workspaceId: number, sessionId?: number): Promise<{
  parityScore: number;
  fieldLevelScore: number;
  commitParityScore: number;
  report: Awaited<ReturnType<typeof buildImportParityReport>>;
}> {
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    const sessions = await importSessionService.listSessions(workspaceId, 10);
    const s = sessions.find((x) => ["shadow_complete", "validated"].includes(x.status));
    targetSessionId = s?.id;
  }

  if (!targetSessionId) {
    return { parityScore: 0, fieldLevelScore: 0, commitParityScore: 0, report: null };
  }

  const report = await buildImportParityReport(workspaceId, targetSessionId);
  if (!report) {
    return { parityScore: 0, fieldLevelScore: 0, commitParityScore: 0, report: null };
  }

  const parityScore = report.validationParity.parityRatio;
  const fieldLevelScore = report.fieldMismatches.length
    ? Math.max(0, 1 - report.fieldMismatches.length / Math.max(report.validationParity.totalRows, 1))
    : 1;
  const commitParityScore = report.commitParity?.parityRatio ?? parityScore;

  return { parityScore, fieldLevelScore, commitParityScore, report };
}
