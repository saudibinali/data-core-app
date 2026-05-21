-- P20-C: Attendance Import Center

CREATE TABLE IF NOT EXISTS "attendance_import_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "import_job_id" integer NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "file_document_id" integer REFERENCES "documents"("id") ON DELETE SET NULL,
  "template_key" text DEFAULT 'attendance.period.default.v1' NOT NULL,
  "mapping_json" text,
  "dry_run" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "summary_json" text,
  "reconciliation_report_id" integer REFERENCES "generated_reports"("id") ON DELETE SET NULL,
  "revert_token" text,
  "reverted_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_import_batches_workspace" ON "attendance_import_batches" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_import_batches_job" ON "attendance_import_batches" ("import_job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_import_batches_status" ON "attendance_import_batches" ("status");

CREATE TABLE IF NOT EXISTS "attendance_import_rows" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "batch_id" integer NOT NULL REFERENCES "attendance_import_batches"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "local_date" date,
  "raw_json" text NOT NULL,
  "validation_status" text DEFAULT 'pending' NOT NULL,
  "outcome" text,
  "errors_json" text,
  "warnings_json" text,
  "raw_event_id" integer,
  "legacy_attendance_id" integer,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_import_rows_batch_row" ON "attendance_import_rows" ("batch_id", "row_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_import_rows_batch" ON "attendance_import_rows" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_import_rows_workspace" ON "attendance_import_rows" ("workspace_id");

CREATE TABLE IF NOT EXISTS "attendance_adjustments" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "batch_id" integer REFERENCES "attendance_import_batches"("id") ON DELETE SET NULL,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "local_date" date NOT NULL,
  "adjustment_type" text NOT NULL,
  "metadata_json" text NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reverted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_adjustments_batch" ON "attendance_adjustments" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_adjustments_employee_date" ON "attendance_adjustments" ("employee_id", "local_date");
