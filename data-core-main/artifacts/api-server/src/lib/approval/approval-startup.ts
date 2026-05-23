import type pg from "pg";
import { logger } from "../logger";
import { escalateOverdueSteps } from "./runtime-service";

export const APPROVAL_RUNTIME_MIGRATION_HINT =
  "Run: node scripts/migrate-approval-runtime.cjs (applies 0026_approval_runtime_foundation.sql)";

export class ApprovalRuntimeSchemaError extends Error {
  constructor(message: string, public readonly missing: string[]) {
    super(message);
    this.name = "ApprovalRuntimeSchemaError";
  }
}

export async function verifyApprovalRuntimeSchema(pool: pg.Pool): Promise<void> {
  const missing: string[] = [];
  const required = [
    { table: "approval_instances" },
    { table: "approval_steps" },
    { table: "approval_process_policies" },
    { table: "hr_workspace_settings", column: "approval_runtime_mode" },
  ];

  for (const req of required) {
    const { rows: t } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [req.table],
    );
    if (!t.length) {
      missing.push(`table:${req.table}`);
      continue;
    }
    if (req.column) {
      const { rows: c } = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [req.table, req.column],
      );
      if (!c.length) missing.push(`column:${req.table}.${req.column}`);
    }
  }

  if (missing.length) {
    throw new ApprovalRuntimeSchemaError(
      `Approval runtime schema incomplete: ${missing.join(", ")}. ${APPROVAL_RUNTIME_MIGRATION_HINT}`,
      missing,
    );
  }

  logger.info("Approval runtime schema verification passed");
}

export async function runApprovalRuntimeStartupChecks(pool: pg.Pool): Promise<void> {
  await verifyApprovalRuntimeSchema(pool);
  const escalated = await escalateOverdueSteps();
  if (escalated > 0) {
    logger.info({ escalated }, "Approval SLA escalation processed on startup");
  }
}
