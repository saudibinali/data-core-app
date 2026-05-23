/**
 * Phase 6 — Enterprise runtime activation (wire existing paths, no new engine).
 */

import { db, hrMasterDataRegistryTable, hrWorkspaceSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { isSchemaMismatchError } from "../../commercial-route-utils";
import { logger } from "../../logger";
import {
  getImportRuntimeSettings,
  type ImportRuntimeMode,
  isControlledCommitMode,
  isPilotActiveMode,
  isActiveRuntimeMode,
} from "../runtime-settings";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import { getWorkspaceRollout, upsertRolloutRecord } from "../platform/rollout-service";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { masterDataCatalogService } from "../catalog/master-data-catalog";

export type EnterpriseActivationTarget = "controlled_commit" | "pilot_active";

export type EnterprisePolicyProfile = {
  autoCreateMode: "controlled" | "pilot_only" | "disabled";
  approvalRequired: boolean;
  reconciliationMode: "suggest" | "report_only" | "disabled";
};

export const ENTERPRISE_POLICY_PROFILE: Record<string, EnterprisePolicyProfile> = {
  job_title: { autoCreateMode: "controlled", approvalRequired: false, reconciliationMode: "suggest" },
  job_grade: { autoCreateMode: "controlled", approvalRequired: false, reconciliationMode: "suggest" },
  work_location: { autoCreateMode: "controlled", approvalRequired: false, reconciliationMode: "suggest" },
  position: { autoCreateMode: "controlled", approvalRequired: true, reconciliationMode: "suggest" },
  org_unit: { autoCreateMode: "controlled", approvalRequired: true, reconciliationMode: "suggest" },
  employment_type: { autoCreateMode: "controlled", approvalRequired: true, reconciliationMode: "suggest" },
  employee_status: { autoCreateMode: "controlled", approvalRequired: true, reconciliationMode: "suggest" },
  document_type: { autoCreateMode: "controlled", approvalRequired: true, reconciliationMode: "report_only" },
};

export async function isEnterpriseImportRuntimeActive(workspaceId: number): Promise<boolean> {
  const settings = await getImportRuntimeSettings(workspaceId);
  const modeOk =
    isControlledCommitMode(settings)
    || isPilotActiveMode(settings)
    || isActiveRuntimeMode(settings);
  if (!modeOk) return false;

  try {
    const rollout = await getWorkspaceRollout(workspaceId);
    return Boolean(
      (rollout?.metadata as Record<string, unknown> | null)?.enterprisePoliciesActivated,
    );
  } catch (e) {
    if (isSchemaMismatchError(e)) {
      logger.warn({ workspaceId }, "Enterprise rollout table unavailable — treating enterprise as inactive");
      return false;
    }
    throw e;
  }
}

export async function getEnterpriseRuntimeStatus(workspaceId: number) {
  const settings = await getImportRuntimeSettings(workspaceId);

  let pilotEnabled = false;
  try {
    pilotEnabled = await isPilotWorkspaceEnabled(workspaceId);
  } catch (e) {
    if (!isSchemaMismatchError(e)) throw e;
    logger.warn({ workspaceId }, "Pilot workspace table unavailable for status");
  }

  let rollout: Awaited<ReturnType<typeof getWorkspaceRollout>> = null;
  let rolloutSchemaAvailable = true;
  try {
    rollout = await getWorkspaceRollout(workspaceId);
  } catch (e) {
    if (isSchemaMismatchError(e)) {
      rolloutSchemaAvailable = false;
      logger.warn({ workspaceId }, "Enterprise rollout table unavailable for status");
    } else {
      throw e;
    }
  }

  return {
    workspaceId,
    enterpriseActive: await isEnterpriseImportRuntimeActive(workspaceId),
    employeeImportRuntimeMode: settings.employeeImportRuntimeMode,
    masterDataRuntimeMode: settings.masterDataRuntimeMode,
    importValidationMode: settings.importValidationMode,
    pilotEnabled,
    policiesActivated: Boolean((rollout?.metadata as Record<string, unknown>)?.enterprisePoliciesActivated),
    rolloutStatus: rollout?.rolloutStatus ?? "not_registered",
    rolloutSchemaAvailable,
    globalCutover: false,
    legacyPreserved: true,
  };
}

async function applyEnterprisePolicies(workspaceId: number): Promise<void> {
  for (const [entityType, profile] of Object.entries(ENTERPRISE_POLICY_PROFILE)) {
    await db
      .update(hrMasterDataRegistryTable)
      .set({
        autoCreateMode: profile.autoCreateMode,
        approvalRequired: profile.approvalRequired,
        reconciliationMode: profile.reconciliationMode,
        autoCreatePolicy: profile.autoCreateMode === "disabled" ? "off" : "controlled",
      })
      .where(
        and(
          eq(hrMasterDataRegistryTable.workspaceId, workspaceId),
          eq(hrMasterDataRegistryTable.entityType, entityType),
        ),
      );
  }
}

async function resetEnterprisePolicies(workspaceId: number): Promise<void> {
  await db
    .update(hrMasterDataRegistryTable)
    .set({
      autoCreateMode: "disabled",
      approvalRequired: true,
      reconciliationMode: "report_only",
      autoCreatePolicy: "off",
    })
    .where(eq(hrMasterDataRegistryTable.workspaceId, workspaceId));
}

export async function activateEnterpriseImportRuntime(input: {
  workspaceId: number;
  userId?: number;
  targetMode?: EnterpriseActivationTarget;
  explicitConfirmation?: boolean;
}): Promise<{ ok: boolean; reason?: string; status?: Awaited<ReturnType<typeof getEnterpriseRuntimeStatus>> }> {
  if (!input.explicitConfirmation) {
    return { ok: false, reason: "EXPLICIT_CONFIRMATION_REQUIRED" };
  }

  if (!(await isPilotWorkspaceEnabled(input.workspaceId))) {
    return { ok: false, reason: "PILOT_WORKSPACE_REQUIRED" };
  }

  const previousSettings = await getImportRuntimeSettings(input.workspaceId);
  const targetMode: ImportRuntimeMode = input.targetMode ?? "controlled_commit";

  await db
    .update(hrWorkspaceSettingsTable)
    .set({ employeeImportRuntimeMode: targetMode, masterDataRuntimeMode: targetMode })
    .where(eq(hrWorkspaceSettingsTable.workspaceId, input.workspaceId));

  await applyEnterprisePolicies(input.workspaceId);
  masterDataCatalogService.invalidateCache(input.workspaceId);

  await upsertRolloutRecord({
    workspaceId: input.workspaceId,
    rolloutStatus: "in_progress",
    runtimeModeTarget: targetMode,
    runtimeModePrevious: previousSettings.employeeImportRuntimeMode,
    activatedByUserId: input.userId,
    metadata: { enterprisePoliciesActivated: true, phase: 6 },
    diagnostics: { targetMode, policies: ENTERPRISE_POLICY_PROFILE },
  });

  void recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "enterprise_import_runtime",
    entityId: input.workspaceId,
    action: "enterprise.activate",
    actorUserId: input.userId,
    beforeState: previousSettings,
    afterState: { targetMode, policiesActivated: true },
  });

  incrementRuntimeMetric("import.phase6.activate");
  return { ok: true, status: await getEnterpriseRuntimeStatus(input.workspaceId) };
}

export async function deactivateEnterpriseImportRuntime(input: {
  workspaceId: number;
  userId?: number;
  explicitConfirmation?: boolean;
  targetMode?: "shadow" | "legacy";
}): Promise<{ ok: boolean; reason?: string }> {
  if (!input.explicitConfirmation) {
    return { ok: false, reason: "EXPLICIT_CONFIRMATION_REQUIRED" };
  }

  const previous = await getImportRuntimeSettings(input.workspaceId);
  const targetMode = input.targetMode ?? "shadow";

  await db
    .update(hrWorkspaceSettingsTable)
    .set({ employeeImportRuntimeMode: targetMode })
    .where(eq(hrWorkspaceSettingsTable.workspaceId, input.workspaceId));

  await resetEnterprisePolicies(input.workspaceId);
  masterDataCatalogService.invalidateCache(input.workspaceId);

  await upsertRolloutRecord({
    workspaceId: input.workspaceId,
    rolloutStatus: "rolled_back",
    runtimeModePrevious: previous.employeeImportRuntimeMode,
    runtimeModeTarget: targetMode,
    rollbackByUserId: input.userId,
    metadata: { enterprisePoliciesActivated: false, phase: 6 },
  });

  void recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "enterprise_import_runtime",
    entityId: input.workspaceId,
    action: "enterprise.deactivate",
    actorUserId: input.userId,
    beforeState: previous,
    afterState: { targetMode, policiesActivated: false },
  });

  incrementRuntimeMetric("import.phase6.deactivate");
  return { ok: true };
}

export async function getEffectiveEntityPolicy(
  workspaceId: number,
  entityType: string,
): Promise<EnterprisePolicyProfile | null> {
  const active = await isEnterpriseImportRuntimeActive(workspaceId);
  if (!active) return null;
  return ENTERPRISE_POLICY_PROFILE[entityType] ?? null;
}
