import type pg from "pg";
import { logger } from "../../logger";
import { WORKFORCE_OPS_MIGRATION_HINT, WorkforceOpsSchemaError } from "./schema-guard";

type SchemaRequirement = { table: string; columns?: string[] };

const REQUIRED: SchemaRequirement[] = [
  { table: "employee_movements" },
  { table: "workforce_lifecycle_events" },
  { table: "workforce_timeline_events" },
  { table: "workforce_audit_log" },
  { table: "hr_workspace_settings", columns: ["workforce_governance_mode"] },
  { table: "hr_employee_documents", columns: ["category_code", "is_signed"] },
];

export async function verifyWorkforceOpsSchema(pool: pg.Pool): Promise<void> {
  const missing: string[] = [];

  for (const req of REQUIRED) {
    const { rows: tableRows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [req.table],
    );
    if (!tableRows.length) {
      missing.push(`table:${req.table}`);
      continue;
    }

    for (const col of req.columns ?? []) {
      const { rows: colRows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [req.table, col],
      );
      if (!colRows.length) missing.push(`column:${req.table}.${col}`);
    }
  }

  if (missing.length) {
    throw new WorkforceOpsSchemaError(
      `Workforce operations schema incomplete. Missing: ${missing.join(", ")}. ${WORKFORCE_OPS_MIGRATION_HINT}`,
      missing,
    );
  }

  logger.info("Workforce operations schema verification passed");
}

export async function runWorkforceOpsStartupChecks(pool: pg.Pool): Promise<void> {
  await verifyWorkforceOpsSchema(pool);
}
