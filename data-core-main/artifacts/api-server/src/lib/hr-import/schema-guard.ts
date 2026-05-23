import type { Response } from "express";
import { isSchemaMismatchError, pgErrorInfo } from "../commercial-route-utils";
import { logger } from "../logger";

export const HR_IMPORT_RUNTIME_MIGRATION_HINT =
  "Run: node scripts/migrate-hr-import-runtime.cjs (applies 0029_hr_import_runtime_foundation.sql)";

export function hrImportRuntimeSchemaUnavailableBody(details?: string) {
  return {
    error: "HR_IMPORT_RUNTIME_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "HR import/export runtime schema is not available.",
    migrationHint: HR_IMPORT_RUNTIME_MIGRATION_HINT,
  };
}

export function sendHrImportRuntimeSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext, migrationHint: HR_IMPORT_RUNTIME_MIGRATION_HINT }, "HR import runtime schema unavailable");
  }
  res.status(503).json(hrImportRuntimeSchemaUnavailableBody(details));
}

export function sendPlatformRuntimeSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext }, "Platform runtime final phase schema unavailable");
  }
  res.status(503).json({
    error: "PLATFORM_RUNTIME_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "Platform import/export final phase schema is not available.",
    migrationHint: "Run: node scripts/migrate-platform-runtime-final-phase.cjs",
  });
}

export function sendHrImportAutoCreateSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext }, "HR import auto-create Phase 5 schema unavailable");
  }
  res.status(503).json({
    error: "HR_IMPORT_AUTO_CREATE_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "HR import auto-create Phase 5 schema is not available.",
    migrationHint: "Run: node scripts/migrate-hr-import-auto-create-phase5.cjs",
  });
}

export function handleHrImportRuntimeRouteError(
  res: Response,
  e: unknown,
  logContext?: Record<string, unknown>,
): boolean {
  if (!isSchemaMismatchError(e)) return false;
  const info = pgErrorInfo(e);
  sendHrImportRuntimeSchemaUnavailable(
    res,
    info.message ?? "Database schema mismatch for HR import runtime.",
    logContext,
  );
  return true;
}
