-- Phase 0+1: HR Universal Import/Export Runtime Foundation (additive, idempotent)

-- Feature flags on workspace settings (default legacy — no behavior change)
ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "employee_import_runtime_mode" text NOT NULL DEFAULT 'legacy';

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "master_data_runtime_mode" text NOT NULL DEFAULT 'legacy';

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "import_validation_mode" text NOT NULL DEFAULT 'warn';

COMMENT ON COLUMN "hr_workspace_settings"."employee_import_runtime_mode" IS 'legacy | shadow | active — employee import pipeline cutover';
COMMENT ON COLUMN "hr_workspace_settings"."master_data_runtime_mode" IS 'legacy | shadow | active — master data catalog/import cutover';
COMMENT ON COLUMN "hr_workspace_settings"."import_validation_mode" IS 'warn | shadow | strict — import validation enforcement depth';

-- Import sessions (universal import/export runtime)
CREATE TABLE IF NOT EXISTS "hr_import_sessions" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "import_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "template_key" text,
  "template_version" text,
  "runtime_mode" text NOT NULL DEFAULT 'legacy',
  "dry_run" boolean NOT NULL DEFAULT true,
  "mapping_json" jsonb,
  "revert_token" text,
  "source_path" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "summary" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hr_import_sessions_ws_status"
  ON "hr_import_sessions" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_hr_import_sessions_type"
  ON "hr_import_sessions" ("import_type", "created_at" DESC);

-- Per-row import session storage
CREATE TABLE IF NOT EXISTS "hr_import_session_rows" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL REFERENCES "hr_import_sessions"("id") ON DELETE CASCADE,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "raw_row" jsonb,
  "normalized_row" jsonb,
  "validation_result" jsonb,
  "action" text,
  "status" text NOT NULL DEFAULT 'pending',
  "errors" jsonb,
  "warnings" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_import_session_rows_session_row"
  ON "hr_import_session_rows" ("session_id", "row_number");

CREATE INDEX IF NOT EXISTS "idx_hr_import_session_rows_session"
  ON "hr_import_session_rows" ("session_id");

-- Entity resolution / auto-create audit trail (staging only in Phase 1)
CREATE TABLE IF NOT EXISTS "hr_import_session_entities" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL REFERENCES "hr_import_sessions"("id") ON DELETE CASCADE,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" integer,
  "canonical_key" text,
  "action" text NOT NULL DEFAULT 'resolved',
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hr_import_session_entities_session"
  ON "hr_import_session_entities" ("session_id");

-- Rollback snapshots (foundation — populated in later phases)
CREATE TABLE IF NOT EXISTS "hr_import_rollback_snapshots" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL REFERENCES "hr_import_sessions"("id") ON DELETE CASCADE,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" integer,
  "action" text NOT NULL,
  "before_json" jsonb,
  "after_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hr_import_rollback_session"
  ON "hr_import_rollback_snapshots" ("session_id");

-- Per-workspace master data registry (policies for future auto-create)
CREATE TABLE IF NOT EXISTS "hr_master_data_registry" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "auto_create_policy" text NOT NULL DEFAULT 'off',
  "canonical_key_field" text NOT NULL DEFAULT 'code',
  "is_runtime_sensitive" boolean NOT NULL DEFAULT false,
  "metadata" jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_master_data_registry_ws_entity"
  ON "hr_master_data_registry" ("workspace_id", "entity_type");

-- Seed default registry rows for known entity types (idempotent)
INSERT INTO "hr_master_data_registry" ("workspace_id", "entity_type", "auto_create_policy", "is_runtime_sensitive")
SELECT w."id", v.entity_type, v.auto_create_policy, v.is_runtime_sensitive
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('org_unit', 'off', true),
    ('job_title', 'off', false),
    ('job_grade', 'off', false),
    ('position', 'off', true),
    ('work_location', 'off', false),
    ('employment_type', 'never', true),
    ('employee_status', 'never', true),
    ('contract_type', 'never', true),
    ('document_type', 'off', true),
    ('leave_policy', 'never', true),
    ('probation_policy', 'never', true)
) AS v(entity_type, auto_create_policy, is_runtime_sensitive)
ON CONFLICT ("workspace_id", "entity_type") DO NOTHING;

-- Runtime schema registry entry
INSERT INTO "runtime_schema_registry" ("component", "expected_migration", "status")
VALUES ('hr_import_runtime', '0029_hr_import_runtime_foundation', 'pending')
ON CONFLICT ("component") DO NOTHING;
