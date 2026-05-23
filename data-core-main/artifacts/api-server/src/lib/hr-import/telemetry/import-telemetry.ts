/**
 * Phase 0 — Import runtime telemetry (additive, workspace-safe).
 * Reuses legacy_compat_usage_events + in-process metrics. One event per request.
 */

import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import type { ImportRuntimeSettings } from "../runtime-settings";

export type ImportTelemetryPhase = "template" | "preview" | "confirm";

export type ImportTelemetryMetrics = {
  rowCount?: number;
  newCount?: number;
  updateCount?: number;
  errorCount?: number;
  warningCount?: number;
  validationErrors?: number;
  unresolvedLookups?: Record<string, number>;
  managerUnresolved?: number;
  managerResolved?: number;
  positionUnresolved?: number;
  workLocationUnresolved?: number;
  positionMapped?: number;
  workLocationMapped?: number;
  mappingFailures?: number;
  imported?: number;
  updated?: number;
  confirmErrors?: number;
  dynamicEnumSource?: "dynamic" | "fallback" | "merged";
  employmentTypeCount?: number;
  statusCount?: number;
  shadowMismatchedRows?: number;
  shadowValidationRan?: boolean;
  shadowParityRatio?: number;
};

export type RecordImportTelemetryInput = {
  workspaceId: number;
  phase: ImportTelemetryPhase;
  sourcePath: string;
  runtimeSettings?: ImportRuntimeSettings;
  metrics?: ImportTelemetryMetrics;
};

const SURFACE = "hr.employee.import.legacy";

export async function recordImportTelemetry(input: RecordImportTelemetryInput): Promise<void> {
  const { workspaceId, phase, sourcePath, runtimeSettings, metrics } = input;

  incrementRuntimeMetric(`import.${phase}`);
  incrementRuntimeMetric(`import.${SURFACE}.${phase}`);

  if (metrics?.errorCount) incrementRuntimeMetric("import.validation_errors", metrics.errorCount);
  if (metrics?.warningCount) incrementRuntimeMetric("import.warnings", metrics.warningCount);
  if (metrics?.managerUnresolved) {
    incrementRuntimeMetric("import.manager_unresolved", metrics.managerUnresolved);
  }
  if (metrics?.positionUnresolved) {
    incrementRuntimeMetric("import.position_unresolved", metrics.positionUnresolved);
  }
  if (metrics?.workLocationUnresolved) {
    incrementRuntimeMetric("import.work_location_unresolved", metrics.workLocationUnresolved);
  }
  if (metrics?.mappingFailures) {
    incrementRuntimeMetric("import.mapping_failures", metrics.mappingFailures);
  }
  if (metrics?.shadowMismatchedRows) {
    incrementRuntimeMetric("import.validation_mismatch", metrics.shadowMismatchedRows);
  }

  await recordLegacyUsage({
    workspaceId,
    eventType: "route_hit",
    legacySurface: SURFACE,
    runtimeMode: runtimeSettings?.employeeImportRuntimeMode ?? "legacy",
    sourcePath,
    entityType: "import_session",
    metadata: {
      phase,
      importValidationMode: runtimeSettings?.importValidationMode ?? "warn",
      masterDataRuntimeMode: runtimeSettings?.masterDataRuntimeMode ?? "legacy",
      metrics: metrics ?? {},
      runtime: "legacy_pipeline",
    },
  });
}

/** Aggregate unresolved lookup counts from preview warnings. */
export function countUnresolvedFromWarnings(warnings: string[]): ImportTelemetryMetrics {
  const metrics: ImportTelemetryMetrics = {
    unresolvedLookups: {},
    managerUnresolved: 0,
    positionUnresolved: 0,
    workLocationUnresolved: 0,
    positionMapped: 0,
    workLocationMapped: 0,
    mappingFailures: 0,
  };

  for (const w of warnings) {
    const lower = w.toLowerCase();
    if (lower.includes("org_unit") || lower.includes("org unit")) {
      metrics.unresolvedLookups!.org_unit = (metrics.unresolvedLookups!.org_unit ?? 0) + 1;
      metrics.mappingFailures = (metrics.mappingFailures ?? 0) + 1;
    } else if (lower.includes("job_title")) {
      metrics.unresolvedLookups!.job_title = (metrics.unresolvedLookups!.job_title ?? 0) + 1;
      metrics.mappingFailures = (metrics.mappingFailures ?? 0) + 1;
    } else if (lower.includes("job_grade")) {
      metrics.unresolvedLookups!.job_grade = (metrics.unresolvedLookups!.job_grade ?? 0) + 1;
      metrics.mappingFailures = (metrics.mappingFailures ?? 0) + 1;
    } else if (lower.includes("position_title") || lower.includes("position")) {
      metrics.positionUnresolved = (metrics.positionUnresolved ?? 0) + 1;
      metrics.mappingFailures = (metrics.mappingFailures ?? 0) + 1;
    } else if (lower.includes("work_location") || lower.includes("location")) {
      metrics.workLocationUnresolved = (metrics.workLocationUnresolved ?? 0) + 1;
      metrics.mappingFailures = (metrics.mappingFailures ?? 0) + 1;
    } else if (lower.includes("manager")) {
      metrics.managerUnresolved = (metrics.managerUnresolved ?? 0) + 1;
    }
  }

  return metrics;
}
