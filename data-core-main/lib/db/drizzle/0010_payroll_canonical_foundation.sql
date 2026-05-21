-- P21-B: Canonical payroll foundation (numeric money)

CREATE TABLE IF NOT EXISTS "payroll_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "frequency" text DEFAULT 'monthly' NOT NULL,
  "anchor_day" integer DEFAULT 1 NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_cycles_ws_code" ON "payroll_cycles" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_cycles_workspace" ON "payroll_cycles" ("workspace_id");

CREATE TABLE IF NOT EXISTS "payroll_periods" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "cycle_id" integer NOT NULL REFERENCES "payroll_cycles"("id") ON DELETE RESTRICT,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "period_label" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "cutoff_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_periods_ws_label" ON "payroll_periods" ("workspace_id", "period_label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_periods_workspace" ON "payroll_periods" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_periods_dates" ON "payroll_periods" ("period_start", "period_end");

CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_id" integer NOT NULL REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  "run_number" integer DEFAULT 1 NOT NULL,
  "run_type" text DEFAULT 'preview' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "idempotency_key" text NOT NULL,
  "calculation_version" integer DEFAULT 1 NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "total_gross" numeric(19, 4) DEFAULT '0' NOT NULL,
  "total_net" numeric(19, 4) DEFAULT '0' NOT NULL,
  "total_deductions" numeric(19, 4) DEFAULT '0' NOT NULL,
  "employee_count" integer DEFAULT 0 NOT NULL,
  "legacy_payroll_run_id" integer REFERENCES "hr_payroll_runs"("id") ON DELETE SET NULL,
  "notes" text,
  "processed_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_runs_idempotency" ON "payroll_runs" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_workspace" ON "payroll_runs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_period" ON "payroll_runs" ("period_id");

CREATE TABLE IF NOT EXISTS "payroll_components" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "component_class" text DEFAULT 'earning' NOT NULL,
  "sub_type" text DEFAULT 'allowance' NOT NULL,
  "calculation_method" text DEFAULT 'fixed' NOT NULL,
  "gl_account_code" text,
  "is_taxable" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "legacy_salary_component_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_components_ws_code" ON "payroll_components" ("workspace_id", "code");

CREATE TABLE IF NOT EXISTS "compensation_packages" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "structure_code" text,
  "base_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "status" text DEFAULT 'active' NOT NULL,
  "package_json" text DEFAULT '{}' NOT NULL,
  "legacy_compensation_id" integer,
  "superseded_by_id" integer,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compensation_packages_employee" ON "compensation_packages" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compensation_packages_workspace" ON "compensation_packages" ("workspace_id");

CREATE TABLE IF NOT EXISTS "compensation_adjustments" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "period_id" integer REFERENCES "payroll_periods"("id") ON DELETE SET NULL,
  "adjustment_type" text NOT NULL,
  "amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "effective_date" date NOT NULL,
  "reason" text,
  "status" text DEFAULT 'approved' NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_run_employees" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "compensation_package_id" integer REFERENCES "compensation_packages"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'included' NOT NULL,
  "scheduled_days" integer DEFAULT 0 NOT NULL,
  "paid_days" integer DEFAULT 0 NOT NULL,
  "unpaid_absence_days" integer DEFAULT 0 NOT NULL,
  "gross_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "net_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "input_snapshot_json" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_run_employees" ON "payroll_run_employees" ("run_id", "employee_id");

CREATE TABLE IF NOT EXISTS "payroll_component_values" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_employee_id" integer NOT NULL REFERENCES "payroll_run_employees"("id") ON DELETE CASCADE,
  "component_id" integer REFERENCES "payroll_components"("id") ON DELETE SET NULL,
  "source" text DEFAULT 'compensation' NOT NULL,
  "quantity" numeric(19, 4) DEFAULT '1' NOT NULL,
  "rate" numeric(19, 4) DEFAULT '0' NOT NULL,
  "amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "reference_type" text,
  "reference_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "policy_key" text NOT NULL,
  "policy_json" text DEFAULT '{}' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "effective_from" date NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_policies_ws_key_ver" ON "payroll_policies" ("workspace_id", "policy_key", "version");

CREATE TABLE IF NOT EXISTS "payroll_locks" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_id" integer NOT NULL REFERENCES "payroll_periods"("id") ON DELETE CASCADE,
  "lock_type" text NOT NULL,
  "locked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "break_glass_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_locks_period_type" ON "payroll_locks" ("period_id", "lock_type");
