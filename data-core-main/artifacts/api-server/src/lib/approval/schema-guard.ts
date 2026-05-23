import type { Response } from "express";
import { isSchemaMismatchError, pgErrorInfo } from "../commercial-route-utils";
import { logger } from "../logger";

export const APPROVAL_MIGRATION_HINT =
  "Run: node scripts/migrate-approval-runtime.cjs (applies 0026_approval_runtime_foundation.sql)";

export function approvalSchemaUnavailableBody(details?: string) {
  return {
    error: "APPROVAL_RUNTIME_SCHEMA_UNAVAILABLE" as const,
    message: details ?? "Approval runtime schema is not available on this database.",
    migrationHint: APPROVAL_MIGRATION_HINT,
  };
}

export function sendApprovalSchemaUnavailable(
  res: Response,
  details?: string,
  logContext?: Record<string, unknown>,
): void {
  if (logContext) {
    logger.warn({ ...logContext, migrationHint: APPROVAL_MIGRATION_HINT }, "Approval schema unavailable");
  }
  res.status(503).json(approvalSchemaUnavailableBody(details));
}

export function handleApprovalRouteError(
  res: Response,
  e: unknown,
  logContext?: Record<string, unknown>,
): boolean {
  if (!isSchemaMismatchError(e)) return false;
  const info = pgErrorInfo(e);
  sendApprovalSchemaUnavailable(
    res,
    info.message ?? "Database schema mismatch for approval runtime.",
    logContext,
  );
  return true;
}
