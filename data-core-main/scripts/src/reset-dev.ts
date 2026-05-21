/**
 * Development reset script — wipes all data and seeds a default super_admin.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run reset-dev
 *
 * Default credentials after reset:
 *   Employee Number : admin
 *   Password        : admin
 *   Role            : super_admin
 *   Must reset pwd  : true  (forced on first sign-in)
 *
 * ⚠️  NEVER run this in production — it truncates ALL data.
 */
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

// ── Tables to truncate in safe order (child → parent) ────────────────────────
const TRUNCATE_ORDER = [
  "workflow_execution_steps",
  "workflow_executions",
  "workflow_tasks",
  "workflow_definitions",
  "workspace_role_permissions",
  "workspace_custom_roles",
  "workspace_module_settings",
  "workspace_event_logs",
  "workspace_invitations",
  "ticket_cc",
  "ticket_comments",
  "tickets",
  "form_submission_files",
  "form_submissions",
  "form_fields",
  "form_definitions",
  "hr_employee_activity",
  "hr_employee_compensation_items",
  "hr_employee_compensations",
  "hr_employee_contracts",
  "hr_employee_documents",
  "hr_employee_leaves",
  "hr_employee_notes",
  "hr_employee_position_history",
  "hr_employee_statuses",
  "hr_leave_balances",
  "hr_payslip_lines",
  "hr_payslips",
  "hr_payroll_runs",
  "hr_overtime_records",
  "hr_attendance",
  "hr_custom_field_values",
  "employees",
  "hr_leave_policies",
  "hr_salary_structure_components",
  "hr_salary_structures",
  "hr_salary_components",
  "hr_salary_bands",
  "hr_job_grades",
  "hr_positions",
  "hr_job_titles",
  "hr_org_units",
  "hr_shifts",
  "hr_work_calendars",
  "hr_work_locations",
  "hr_service_categories",
  "hr_services",
  "hr_overtime_policies",
  "hr_probation_policies",
  "hr_contract_types",
  "hr_employment_types",
  "hr_document_types",
  "hr_custom_field_defs",
  "hr_calendar_holidays",
  "hr_workspace_counters",
  "hr_workspace_settings",
  "calendar_event_participants",
  "calendar_events",
  "message_recipients",
  "messages",
  "approvals",
  "activity_logs",
  "notifications",
  "group_members",
  "groups",
  "user_departments",
  "platform_event_registry",
  "platform_modules",
  "platform_settings",
  "departments",
  "users",
  "workspaces",
] as const;

// ── Default super_admin credentials ──────────────────────────────────────────
const DEFAULT_EMPLOYEE_NUMBER = process.env.DEFAULT_ADMIN_EMP   ?? "admin";
const DEFAULT_PASSWORD         = process.env.DEFAULT_ADMIN_PASS  ?? "admin";
const DEFAULT_FULL_NAME        = process.env.DEFAULT_ADMIN_NAME  ?? "Platform Owner";
const DEFAULT_EMAIL            = process.env.DEFAULT_ADMIN_EMAIL ?? "admin@platform.local";

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL is not set.");
    process.exit(1);
  }

  // Safety guard — refuse to run if NODE_ENV is production
  if (process.env.NODE_ENV === "production") {
    console.error("❌  reset-dev must NOT be run in production (NODE_ENV=production).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db   = drizzle(pool);

  console.log("\n🗑️   Resetting database...\n");

  // Truncate all tables (continue on missing table errors)
  for (const table of TRUNCATE_ORDER) {
    try {
      await db.execute(sql.raw(`DELETE FROM "${table}"`));
      console.log(`   ✓  ${table}`);
    } catch {
      console.log(`   ⚠  ${table} (skipped — may not exist yet)`);
    }
  }

  console.log("\n👤  Creating default super_admin...\n");

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const parts        = DEFAULT_FULL_NAME.trim().split(/\s+/);
  const firstName    = parts[0] ?? "Platform";
  const lastName     = parts.slice(1).join(" ") || null;

  await db.execute(sql`
    INSERT INTO users (
      full_name, first_name, last_name,
      email, employee_number, password_hash,
      role, status, must_reset_password,
      workspace_id, department_id,
      created_at, updated_at
    ) VALUES (
      ${DEFAULT_FULL_NAME},
      ${firstName},
      ${lastName},
      ${DEFAULT_EMAIL},
      ${DEFAULT_EMPLOYEE_NUMBER},
      ${passwordHash},
      'super_admin',
      'active',
      true,
      NULL,
      NULL,
      NOW(),
      NOW()
    )
  `);

  await pool.end();

  console.log("✅  Done!\n");
  console.log("   Platform is now in a clean state.");
  console.log("   Sign in with:\n");
  console.log(`      Employee Number : ${DEFAULT_EMPLOYEE_NUMBER}`);
  console.log(`      Password        : ${DEFAULT_PASSWORD}`);
  console.log(`      Role            : super_admin`);
  console.log("\n   ⚠️  You will be forced to change the password on first sign-in.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
