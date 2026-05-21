-- P21-D: Payroll operations, GL mapping, audit & exceptions

ALTER TABLE "payroll_components" ADD COLUMN IF NOT EXISTS "debit_account_code" text;
--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN IF NOT EXISTS "credit_account_code" text;
--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN IF NOT EXISTS "cost_center_code" text;
--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN IF NOT EXISTS "export_code" text;

CREATE TABLE IF NOT EXISTS "payroll_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" integer,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_audit_logs_workspace" ON "payroll_audit_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_audit_logs_action" ON "payroll_audit_logs" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_audit_logs_created" ON "payroll_audit_logs" ("created_at");

CREATE TABLE IF NOT EXISTS "payroll_exceptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_id" integer REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "exception_code" text NOT NULL,
  "severity" text DEFAULT 'warning' NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "metadata_json" text,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_exceptions_workspace" ON "payroll_exceptions" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_exceptions_run" ON "payroll_exceptions" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_exceptions_status" ON "payroll_exceptions" ("status");
