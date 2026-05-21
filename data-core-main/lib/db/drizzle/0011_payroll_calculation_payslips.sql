-- P21-C: Payroll calculation engine, payslips, run workflow extensions

ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "corrects_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "review_warnings_json" text;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "submitted_for_review_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "submitted_for_review_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_corrects" ON "payroll_runs" ("corrects_run_id");

ALTER TABLE "payroll_run_employees" ADD COLUMN IF NOT EXISTS "warnings_json" text;
--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'ok' NOT NULL;

ALTER TABLE "payroll_component_values" ADD COLUMN IF NOT EXISTS "metadata_json" text;

CREATE TABLE IF NOT EXISTS "payroll_payslips" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "run_employee_id" integer NOT NULL REFERENCES "payroll_run_employees"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "payslip_number" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "corrects_payslip_id" integer REFERENCES "payroll_payslips"("id") ON DELETE SET NULL,
  "gross_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "net_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "total_deductions" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "snapshot_json" text,
  "ytd_json" text,
  "pdf_storage_key" text,
  "document_id" integer,
  "issued_at" timestamp with time zone,
  "issued_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_payslips_run_employee" ON "payroll_payslips" ("run_id", "employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_payslips_ws_number" ON "payroll_payslips" ("workspace_id", "payslip_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_payslips_workspace" ON "payroll_payslips" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_payslips_employee" ON "payroll_payslips" ("employee_id");
