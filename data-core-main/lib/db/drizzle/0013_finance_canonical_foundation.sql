-- P22-B: Canonical finance foundation (no posting, no AR/AP)

CREATE TABLE IF NOT EXISTS "finance_workspace_settings" (
  "workspace_id" integer PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "enabled_at" timestamp with time zone,
  "coa_template_key" text,
  "base_currency_code" text DEFAULT 'SAR' NOT NULL,
  "persist_prepared_batches" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "finance_fiscal_years" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "base_currency_code" text DEFAULT 'SAR' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_fiscal_years_ws_label" ON "finance_fiscal_years" ("workspace_id", "label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_fiscal_years_workspace" ON "finance_fiscal_years" ("workspace_id");

CREATE TABLE IF NOT EXISTS "finance_periods" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "fiscal_year_id" integer NOT NULL REFERENCES "finance_fiscal_years"("id") ON DELETE CASCADE,
  "period_number" integer NOT NULL,
  "period_label" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_periods_ws_label" ON "finance_periods" ("workspace_id", "period_label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_periods_workspace" ON "finance_periods" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_periods_dates" ON "finance_periods" ("start_date", "end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_periods_fiscal_year" ON "finance_periods" ("fiscal_year_id");

CREATE TABLE IF NOT EXISTS "finance_chart_of_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "account_code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "account_type" text NOT NULL,
  "normal_balance" text NOT NULL,
  "parent_account_id" integer REFERENCES "finance_chart_of_accounts"("id") ON DELETE SET NULL,
  "level" integer DEFAULT 0 NOT NULL,
  "is_postable" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "currency_code" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_coa_ws_code" ON "finance_chart_of_accounts" ("workspace_id", "account_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_coa_workspace" ON "finance_chart_of_accounts" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_coa_parent" ON "finance_chart_of_accounts" ("parent_account_id");

CREATE TABLE IF NOT EXISTS "finance_journals" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "journal_code" text NOT NULL,
  "name" text NOT NULL,
  "journal_type" text DEFAULT 'general' NOT NULL,
  "sequence_prefix" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_journals_ws_code" ON "finance_journals" ("workspace_id", "journal_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_journals_workspace" ON "finance_journals" ("workspace_id");

CREATE TABLE IF NOT EXISTS "finance_cost_centers" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "parent_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "org_unit_id" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_cost_centers_ws_code" ON "finance_cost_centers" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_cost_centers_workspace" ON "finance_cost_centers" ("workspace_id");

CREATE TABLE IF NOT EXISTS "finance_dimensions" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "dimension_code" text NOT NULL,
  "name" text NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "hierarchy_enabled" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_dimensions_ws_code" ON "finance_dimensions" ("workspace_id", "dimension_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_dimensions_workspace" ON "finance_dimensions" ("workspace_id");

CREATE TABLE IF NOT EXISTS "finance_dimension_values" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "dimension_id" integer NOT NULL REFERENCES "finance_dimensions"("id") ON DELETE CASCADE,
  "value_code" text NOT NULL,
  "name" text NOT NULL,
  "parent_value_id" integer REFERENCES "finance_dimension_values"("id") ON DELETE SET NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_dim_values_dim_code" ON "finance_dimension_values" ("dimension_id", "value_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_dim_values_workspace" ON "finance_dimension_values" ("workspace_id");

CREATE TABLE IF NOT EXISTS "finance_account_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "mapping_type" text NOT NULL,
  "source_key" text NOT NULL,
  "debit_account_id" integer REFERENCES "finance_chart_of_accounts"("id") ON DELETE SET NULL,
  "credit_account_id" integer REFERENCES "finance_chart_of_accounts"("id") ON DELETE SET NULL,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_mappings_workspace" ON "finance_account_mappings" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_mappings_source" ON "finance_account_mappings" ("workspace_id", "mapping_type", "source_key");

CREATE TABLE IF NOT EXISTS "finance_posting_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "batch_number" text NOT NULL,
  "journal_id" integer NOT NULL REFERENCES "finance_journals"("id") ON DELETE RESTRICT,
  "finance_period_id" integer NOT NULL REFERENCES "finance_periods"("id") ON DELETE RESTRICT,
  "source_type" text NOT NULL,
  "source_id" integer,
  "payroll_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "idempotency_key" text NOT NULL,
  "description" text,
  "total_debit" numeric(19, 4) DEFAULT '0' NOT NULL,
  "total_credit" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
  "prepared_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "voided_at" timestamp with time zone,
  "voided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "corrects_batch_id" integer REFERENCES "finance_posting_batches"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_batches_idempotency" ON "finance_posting_batches" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_batches_workspace" ON "finance_posting_batches" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_batches_payroll_run" ON "finance_posting_batches" ("payroll_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_batches_period" ON "finance_posting_batches" ("finance_period_id");

CREATE TABLE IF NOT EXISTS "finance_journal_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "batch_id" integer NOT NULL REFERENCES "finance_posting_batches"("id") ON DELETE CASCADE,
  "journal_id" integer NOT NULL REFERENCES "finance_journals"("id") ON DELETE RESTRICT,
  "finance_period_id" integer NOT NULL REFERENCES "finance_periods"("id") ON DELETE RESTRICT,
  "line_number" integer NOT NULL,
  "account_id" integer NOT NULL REFERENCES "finance_chart_of_accounts"("id") ON DELETE RESTRICT,
  "entry_date" date NOT NULL,
  "debit_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "credit_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency_code" text DEFAULT 'SAR' NOT NULL,
  "description" text,
  "dimension_json" text,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "source_type" text,
  "source_id" integer,
  "status" text DEFAULT 'prepared' NOT NULL,
  "reversal_of_entry_id" integer REFERENCES "finance_journal_entries"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_entries_batch" ON "finance_journal_entries" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_entries_workspace" ON "finance_journal_entries" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_entries_account" ON "finance_journal_entries" ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_entries_period" ON "finance_journal_entries" ("finance_period_id");

CREATE TABLE IF NOT EXISTS "finance_locks" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "finance_period_id" integer NOT NULL REFERENCES "finance_periods"("id") ON DELETE CASCADE,
  "lock_type" text NOT NULL,
  "reason" text,
  "locked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "break_glass_until" timestamp with time zone,
  "unlocked_at" timestamp with time zone,
  "unlocked_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_locks_workspace" ON "finance_locks" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_locks_period" ON "finance_locks" ("finance_period_id");

CREATE TABLE IF NOT EXISTS "finance_audit_logs" (
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
CREATE INDEX IF NOT EXISTS "idx_finance_audit_logs_workspace" ON "finance_audit_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_audit_logs_action" ON "finance_audit_logs" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_audit_logs_created" ON "finance_audit_logs" ("created_at");
