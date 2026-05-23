import type { Response } from "express";
import { isSchemaMismatchError, pgErrorInfo } from "../../commercial-route-utils";
import { logger } from "../../logger";

export const LEGACY_COMPAT_MIGRATION_HINT =
  "Run: node scripts/migrate-legacy-compat.cjs (applies 0028_legacy_compat_stabilization.sql)";

export function legacyCompatSchemaUnavailableBody(details?: string) {
  return {
    error: "LEGACY_COMPAT_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "Legacy compat / stabilization schema is not available.",
    migrationHint: LEGACY_COMPAT_MIGRATION_HINT,
  };
}

export function sendLegacyCompatSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext, migrationHint: LEGACY_COMPAT_MIGRATION_HINT }, "Legacy compat schema unavailable");
  }
  res.status(503).json(legacyCompatSchemaUnavailableBody(details));
}

export function handleLegacyCompatRouteError(
  res: Response,
  e: unknown,
  logContext?: Record<string, unknown>,
): boolean {
  if (!isSchemaMismatchError(e)) return false;
  const info = pgErrorInfo(e);
  sendLegacyCompatSchemaUnavailable(
    res,
    info.message ?? "Database schema mismatch for legacy compat runtime.",
    logContext,
  );
  return true;
}
