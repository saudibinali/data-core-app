-- Phase 5: Controlled auto-create, approval queue, pilot workspaces (additive, idempotent)

ALTER TABLE "hr_master_data_registry"
  ADD COLUMN IF NOT EXISTS "auto_create_mode" text NOT NULL DEFAULT 'disabled';

ALTER TABLE "hr_master_data_registry"
  ADD COLUMN IF NOT EXISTS "approval_required" boolean NOT NULL DEFAULT true;

ALTER TABLE "hr_master_data_registry"
  ADD COLUMN IF NOT EXISTS "canonical_strategy" text NOT NULL DEFAULT 'slug_from_name';

ALTER TABLE "hr_master_data_registry"
  ADD COLUMN IF NOT EXISTS "duplicate_strategy" text NOT NULL DEFAULT 'reject';

ALTER TABLE "hr_master_data_registry"
  ADD COLUMN IF NOT EXISTS "reconciliation_mode" text NOT NULL DEFAULT 'report_only';

COMMENT ON COLUMN "hr_master_data_registry"."auto_create_mode" IS 'disabled | controlled | pilot_only';
COMMENT ON COLUMN "hr_master_data_registry"."approval_required" IS 'When true, auto-create enters approval queue before commit';
COMMENT ON COLUMN "hr_master_data_registry"."canonical_strategy" IS 'slug_from_name | explicit_code | registry_default';
COMMENT ON COLUMN "hr_master_data_registry"."duplicate_strategy" IS 'reject | skip | queue_review';
COMMENT ON COLUMN "hr_master_data_registry"."reconciliation_mode" IS 'report_only | suggest | disabled';

-- Default safe policies for auto-create-eligible types (idempotent update)
UPDATE "hr_master_data_registry"
SET
  "auto_create_mode" = CASE
    WHEN "entity_type" IN ('job_title', 'job_grade', 'work_location') THEN 'disabled'
    WHEN "entity_type" = 'document_type' THEN 'disabled'
    ELSE 'disabled'
  END,
  "approval_required" = true,
  "duplicate_strategy" = 'reject',
  "reconciliation_mode" = 'report_only'
WHERE "auto_create_mode" IS NULL OR "auto_create_mode" = 'disabled';

-- Auto-create approval queue
CREATE TABLE IF NOT EXISTS "hr_import_auto_create_pending" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "session_id" integer REFERENCES "hr_import_sessions"("id") ON DELETE SET NULL,
  "entity_type" text NOT NULL,
  "proposed_code" text,
  "proposed_name" text NOT NULL,
  "proposed_name_ar" text,
  "status" text NOT NULL DEFAULT 'pending',
  "duplicate_key" text,
  "policy_snapshot" jsonb,
  "metadata" jsonb,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_entity_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hr_import_auto_create_pending_ws_status"
  ON "hr_import_auto_create_pending" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_hr_import_auto_create_pending_session"
  ON "hr_import_auto_create_pending" ("session_id");

-- Pilot workspace activation registry
CREATE TABLE IF NOT EXISTS "hr_import_pilot_workspaces" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "pilot_status" text NOT NULL DEFAULT 'inactive',
  "rollout_phase" text NOT NULL DEFAULT 'phase_5',
  "enabled_at" timestamptz,
  "enabled_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_import_pilot_workspaces_ws"
  ON "hr_import_pilot_workspaces" ("workspace_id");

INSERT INTO "runtime_schema_registry" ("component", "expected_migration", "status")
VALUES ('hr_import_auto_create_runtime', '0030_hr_import_auto_create_phase5', 'pending')
ON CONFLICT ("component") DO UPDATE SET "expected_migration" = EXCLUDED."expected_migration";
