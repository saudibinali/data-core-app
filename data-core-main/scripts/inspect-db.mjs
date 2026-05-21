import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const root = path.resolve(import.meta.dirname, "..");
const envLine = fs
  .readFileSync(path.join(root, ".env"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="));
const databaseUrl = envLine.slice("DATABASE_URL=".length).trim();
const pool = new Pool({ connectionString: databaseUrl });

const tables = [
  "notification_jobs",
  "documents",
  "report_definitions",
  "report_export_jobs",
  "attendance_sources",
  "attendance_raw_events",
  "payroll_runs",
  "payroll_policies",
  "finance_accounts",
  "purchase_orders",
  "inventory_items",
  "leave_requests",
  "hr_leave_migration_map",
];

try {
  for (const t of tables) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [t],
    );
    console.log(t, rows.length ? "yes" : "no");
  }
  const { rows: migs } = await pool.query(
    `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
  );
  console.log("migration count", migs.length);
} finally {
  await pool.end();
}
