-- H1/H5/H6 — HR Foundation governance: match-only import + employee staging + readiness gate flags

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "employee_import_match_only" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "employee_import_staging_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "foundation_readiness_gate_enabled" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "hr_employee_import_staging" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "batch_id" text NOT NULL,
  "row_index" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_review',
  "raw_row" jsonb,
  "normalized_row" jsonb NOT NULL,
  "mismatch_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "existing_employee_id" integer,
  "promoted_employee_id" integer,
  "reviewed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "promoted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hr_employee_import_staging_ws_status"
  ON "hr_employee_import_staging" ("workspace_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "idx_hr_employee_import_staging_batch"
  ON "hr_employee_import_staging" ("workspace_id", "batch_id");
