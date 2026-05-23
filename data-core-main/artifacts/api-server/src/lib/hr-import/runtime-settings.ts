/**
 * Workspace import/export runtime mode settings (feature flags).
 * Defaults: legacy — zero behavior change until workspace opt-in.
 */

import { db, hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ImportRuntimeMode = "legacy" | "shadow" | "controlled_commit" | "pilot_active" | "active";
export type ImportValidationMode = "warn" | "shadow" | "strict";

const IMPORT_RUNTIME_MODES: ImportRuntimeMode[] = ["legacy", "shadow", "controlled_commit", "pilot_active", "active"];
const VALIDATION_MODES: ImportValidationMode[] = ["warn", "shadow", "strict"];

export function normalizeImportRuntimeMode(value: unknown): ImportRuntimeMode {
  if (typeof value === "string" && IMPORT_RUNTIME_MODES.includes(value as ImportRuntimeMode)) {
    return value as ImportRuntimeMode;
  }
  return "legacy";
}

export function normalizeImportValidationMode(value: unknown): ImportValidationMode {
  if (typeof value === "string" && VALIDATION_MODES.includes(value as ImportValidationMode)) {
    return value as ImportValidationMode;
  }
  return "warn";
}

export type ImportRuntimeSettings = {
  employeeImportRuntimeMode: ImportRuntimeMode;
  masterDataRuntimeMode: ImportRuntimeMode;
  importValidationMode: ImportValidationMode;
};

/** Phase 4: live commit only when workspace explicitly opts into controlled_commit. */
export function isControlledCommitMode(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "controlled_commit";
}

/** Phase 4: shadow commit simulation (parity only, no writes). */
export function isShadowCommitSimulationMode(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "shadow";
}

/** Phase 5: pilot_active requires explicit pilot registry enablement (checked separately). */
export function isPilotActiveMode(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "pilot_active";
}

/** Phase 5: master data auto-create/commit when controlled_commit or pilot_active (with pilot registry). */
export function isMasterDataRuntimeAdvanced(settings: ImportRuntimeSettings): boolean {
  return settings.masterDataRuntimeMode === "controlled_commit"
    || settings.masterDataRuntimeMode === "pilot_active"
    || settings.employeeImportRuntimeMode === "pilot_active";
}

/** Final Phase: strict governance only for pilot_active and active modes. */
export function isStrictGovernanceMode(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "pilot_active"
    || settings.employeeImportRuntimeMode === "active";
}

export function isActiveRuntimeMode(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "active";
}

/** active mode never auto-enables commit — must use controlled_commit, pilot_active, or active explicitly. */
export function isLiveCommitAllowed(settings: ImportRuntimeSettings): boolean {
  return settings.employeeImportRuntimeMode === "controlled_commit"
    || settings.employeeImportRuntimeMode === "pilot_active"
    || settings.employeeImportRuntimeMode === "active";
}

export function getCommitModeLabel(settings: ImportRuntimeSettings): "disabled" | "shadow_simulation" | "controlled_commit" | "pilot_active" | "active" {
  if (settings.employeeImportRuntimeMode === "active") return "active";
  if (settings.employeeImportRuntimeMode === "pilot_active") return "pilot_active";
  if (isLiveCommitAllowed(settings) && settings.employeeImportRuntimeMode === "controlled_commit") return "controlled_commit";
  if (isShadowCommitSimulationMode(settings)) return "shadow_simulation";
  return "disabled";
}

/** Phase 2/5: strict downgraded unless pilot workspace explicitly enabled (see strict-validation-engine). */
export function getEffectiveValidationMode(
  settings: ImportRuntimeSettings,
  strictPilotEnabled = false,
): ImportValidationMode {
  if (settings.importValidationMode === "strict") {
    if (strictPilotEnabled && isStrictGovernanceMode(settings)) return "strict";
    return "shadow";
  }
  return settings.importValidationMode;
}

export function isStrictValidationRequested(settings: ImportRuntimeSettings): boolean {
  return settings.importValidationMode === "strict";
}

export async function getImportRuntimeSettings(workspaceId: number): Promise<ImportRuntimeSettings> {
  try {
    const [row] = await db
      .select({
        employeeImportRuntimeMode: hrWorkspaceSettingsTable.employeeImportRuntimeMode,
        masterDataRuntimeMode: hrWorkspaceSettingsTable.masterDataRuntimeMode,
        importValidationMode: hrWorkspaceSettingsTable.importValidationMode,
      })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

    return {
      employeeImportRuntimeMode: normalizeImportRuntimeMode(row?.employeeImportRuntimeMode),
      masterDataRuntimeMode: normalizeImportRuntimeMode(row?.masterDataRuntimeMode),
      importValidationMode: normalizeImportValidationMode(row?.importValidationMode),
    };
  } catch {
    return {
      employeeImportRuntimeMode: "legacy",
      masterDataRuntimeMode: "legacy",
      importValidationMode: "warn",
    };
  }
}
