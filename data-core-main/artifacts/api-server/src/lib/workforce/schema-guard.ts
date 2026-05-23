import type { Response } from "express";
import { isSchemaMismatchError, pgErrorInfo } from "../commercial-route-utils";
import { logger } from "../logger";

export const WORKFORCE_MIGRATION_HINT =
  "Run: node scripts/migrate-workforce-foundation.cjs (or apply lib/db/drizzle/0024_workforce_canonical_foundation.sql)";

export const ORG_RUNTIME_MIGRATION_HINT =
  "Run: node scripts/migrate-org-runtime.cjs (or apply lib/db/drizzle/0025_org_runtime_foundation.sql)";

export function workforceSchemaUnavailableBody(details?: string) {
  return {
    error: "WORKFORCE_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "Workforce canonical schema is not available on this database.",
    migrationHint: WORKFORCE_MIGRATION_HINT,
  };
}

export function sendWorkforceSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext, migrationHint: WORKFORCE_MIGRATION_HINT }, "Workforce schema unavailable");
  }
  res.status(503).json(workforceSchemaUnavailableBody(details));
}

export function handleWorkforceRouteError(
  res: Response,
  e: unknown,
  logContext?: Record<string, unknown>,
): boolean {
  if (!isSchemaMismatchError(e)) return false;
  const info = pgErrorInfo(e);
  sendWorkforceSchemaUnavailable(
    res,
    info.message ?? "Database schema mismatch for workforce runtime.",
    logContext,
  );
  return true;
}
