/**
 * Phase 2 — Run shadow validation pipeline against legacy preview (telemetry only).
 */

import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "./hr-import-validator";
import { compareLegacyVsShadowRow, summarizeShadowComparison, type LegacyPreviewRow } from "./shadow-validation";
import { getEffectiveValidationMode, type ImportRuntimeSettings } from "../runtime-settings";
import { recordTemplateCatalogTelemetry } from "../telemetry/template-catalog-telemetry";
import { isSchemaMismatchError } from "../../commercial-route-utils";

export async function runShadowValidationPipeline(input: {
  workspaceId: number;
  numberingMode: string;
  runtimeSettings: ImportRuntimeSettings;
  rawRows: Record<string, string>[];
  legacyPreviewRows: LegacyPreviewRow[];
  sourcePath: string;
}): Promise<{ ran: boolean; summary?: ReturnType<typeof summarizeShadowComparison> }> {
  const mode = getEffectiveValidationMode(input.runtimeSettings);
  if (mode !== "shadow") return { ran: false };

  try {
    const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId);
    if (!catalog.cacheHit) {
      void recordTemplateCatalogTelemetry({
        workspaceId: input.workspaceId,
        event: "catalog_cache_miss",
        sourcePath: input.sourcePath,
      });
    }

    const ctx = await HrImportValidator.createContext(input.workspaceId, catalog, input.numberingMode);
    const shadowRows = HrImportValidator.validateRows(ctx, input.rawRows);

    const comparisons = input.legacyPreviewRows.map((legacy, i) =>
      compareLegacyVsShadowRow(legacy, shadowRows[i] ?? { rowIndex: legacy.rowIndex, errors: [], warnings: [], resolved: {} }),
    );
    const summary = summarizeShadowComparison(comparisons);

    if (summary.mismatchedRows > 0) {
      void recordTemplateCatalogTelemetry({
        workspaceId: input.workspaceId,
        event: "validation_mismatch",
        sourcePath: input.sourcePath,
        metadata: {
          mismatchedRows: summary.mismatchedRows,
          parityRatio: summary.parityRatio,
          totalRows: summary.totalRows,
          strictRequested: input.runtimeSettings.importValidationMode === "strict",
          strictEnforced: false,
        },
      });
    }

    return { ran: true, summary };
  } catch (e) {
    if (isSchemaMismatchError(e)) return { ran: false };
    throw e;
  }
}
