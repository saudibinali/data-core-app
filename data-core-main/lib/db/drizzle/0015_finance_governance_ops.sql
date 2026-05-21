-- P22-D: Finance operations governance (no posting)

ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "governance_status" text DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "submitted_for_review_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_batches_governance" ON "finance_posting_batches" ("workspace_id", "governance_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_exceptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "batch_id" integer REFERENCES "finance_posting_batches"("id") ON DELETE CASCADE,
  "payroll_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "exception_code" text NOT NULL,
  "severity" text DEFAULT 'warning' NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "metadata_json" text,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_exceptions_workspace" ON "finance_exceptions" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_exceptions_status" ON "finance_exceptions" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_exceptions_batch" ON "finance_exceptions" ("batch_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_reversal_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_batch_id" integer NOT NULL REFERENCES "finance_posting_batches"("id") ON DELETE CASCADE,
  "plan_status" text DEFAULT 'draft' NOT NULL,
  "simulation_json" text,
  "validation_json" text,
  "planned_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_reversal_plans_workspace" ON "finance_reversal_plans" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_reversal_plans_batch" ON "finance_reversal_plans" ("source_batch_id");
