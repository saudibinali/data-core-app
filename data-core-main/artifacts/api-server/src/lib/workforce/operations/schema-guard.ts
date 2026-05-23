import type { Response } from "express";
import { isSchemaMismatchError, pgErrorInfo } from "../../commercial-route-utils";
import { logger } from "../../logger";

export const WORKFORCE_OPS_MIGRATION_HINT =
  "Run: node scripts/migrate-workforce-operations.cjs (applies 0027_workforce_operations_foundation.sql)";

export function workforceOpsSchemaUnavailableBody(details?: string) {
  return {
    error: "WORKFORCE_OPS_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "Workforce operations schema is not available on this database.",
    migrationHint: WORKFORCE_OPS_MIGRATION_HINT,
  };
}

export function sendWorkforceOpsSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext, migrationHint: WORKFORCE_OPS_MIGRATION_HINT }, "Workforce ops schema unavailable");
  }
  res.status(503).json(workforceOpsSchemaUnavailableBody(details));
}

export function handleWorkforceOpsRouteError(
  res: Response,
  e: unknown,
  logContext?: Record<string, unknown>,
): boolean {
  if (!isSchemaMismatchError(e)) return false;
  const info = pgErrorInfo(e);
  sendWorkforceOpsSchemaUnavailable(
    res,
    info.message ?? "Database schema mismatch for workforce operations runtime.",
    logContext,
  );
  return true;
}

export class WorkforceOpsSchemaError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
  ) {
    super(message);
    this.name = "WorkforceOpsSchemaError";
  }
}
