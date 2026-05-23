/**
 * Phase 5 — Strict validation foundation (disabled by default; pilot-gated).
 */

import type { ImportRuntimeSettings } from "../runtime-settings";
import { getEffectiveValidationMode, isStrictValidationRequested, isStrictGovernanceMode } from "../runtime-settings";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import { HrImportValidator, type HrImportRowValidation } from "./hr-import-validator";
import {
  detectCrossFileDuplicates,
  detectRuntimeUniquenessViolations,
  type DuplicateHit,
} from "../auto-create/duplicate-prevention";
import type { MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type StrictValidationResult = {
  mode: "warn" | "shadow" | "strict";
  strictEnforced: boolean;
  rows: HrImportRowValidation[];
  duplicateHits: DuplicateHit[];
  crossFileDuplicates: DuplicateHit[];
  blockingErrors: string[];
};

export async function runStrictValidationEngine(input: {
  workspaceId: number;
  settings: ImportRuntimeSettings;
  catalog: MasterDataCatalogSnapshot;
  numberingMode: string;
  rawRows: Record<string, string>[];
  masterDataRows?: Array<{ rowNumber: number; entityType: string; code: string; name: string }>;
}): Promise<StrictValidationResult> {
  const pilotEnabled = await isPilotWorkspaceEnabled(input.workspaceId);
  const effectiveMode = getEffectiveValidationMode(input.settings, pilotEnabled);
  const strictEnforced =
    effectiveMode === "strict"
    && isStrictValidationRequested(input.settings)
    && isStrictGovernanceMode(input.settings)
    && pilotEnabled;

  const ctx = await HrImportValidator.createContext(input.workspaceId, input.catalog, input.numberingMode);
  const rows = HrImportValidator.validateRows(ctx, input.rawRows);

  const crossFileDuplicates = input.masterDataRows?.length
    ? detectCrossFileDuplicates(input.masterDataRows)
    : [];

  const duplicateHits = input.masterDataRows?.length
    ? detectRuntimeUniquenessViolations(input.catalog, input.masterDataRows as never)
    : [];

  const blockingErrors: string[] = [];

  if (strictEnforced) {
    incrementRuntimeMetric("import.v5.strict_validation");
    for (const row of rows) {
      if (row.errors.length) blockingErrors.push(`Row ${row.rowIndex}: ${row.errors.join("; ")}`);
    }
    for (const dup of duplicateHits) {
      blockingErrors.push(`Duplicate ${dup.entityType} row ${dup.rowNumbers.join(",")}: ${dup.duplicateKey}`);
    }
    for (const dup of crossFileDuplicates) {
      blockingErrors.push(`Cross-file duplicate ${dup.duplicateKey} rows ${dup.rowNumbers.join(",")}`);
    }
  }

  return {
    mode: effectiveMode,
    strictEnforced,
    rows,
    duplicateHits,
    crossFileDuplicates,
    blockingErrors,
  };
}

export async function isStrictEnforcementActive(
  workspaceId: number,
  settings: ImportRuntimeSettings,
): Promise<boolean> {
  const pilotEnabled = await isPilotWorkspaceEnabled(workspaceId);
  return (
    getEffectiveValidationMode(settings, pilotEnabled) === "strict"
    && isStrictGovernanceMode(settings)
    && pilotEnabled
  );
}
