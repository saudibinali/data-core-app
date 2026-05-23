-- Phase 1: Workforce Canonical Foundation (additive, idempotent)

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "workforce_canonical_mode" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "workforce_sync_direction" text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN "hr_workspace_settings"."workforce_canonical_mode" IS 'legacy | shadow | active — workforce runtime cutover mode';
COMMENT ON COLUMN "hr_workspace_settings"."workforce_sync_direction" IS 'none | employee_to_user | bidirectional — legacy field sync direction';

CREATE TABLE IF NOT EXISTS "legacy_department_org_map" (
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "department_id" integer NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "org_unit_id" integer NOT NULL REFERENCES "hr_org_units"("id") ON DELETE CASCADE,
  "match_method" text NOT NULL DEFAULT 'name',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_legacy_department_org_map" PRIMARY KEY ("workspace_id", "department_id")
);

CREATE INDEX IF NOT EXISTS "idx_legacy_dept_org_map_org_unit"
  ON "legacy_department_org_map" ("org_unit_id");

CREATE TABLE IF NOT EXISTS "workforce_migration_exceptions" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "reason" text NOT NULL,
  "details" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_workforce_migration_exceptions_ws"
  ON "workforce_migration_exceptions" ("workspace_id");

ALTER TABLE "hr_employee_documents"
  ADD COLUMN IF NOT EXISTS "mime_type" text,
  ADD COLUMN IF NOT EXISTS "checksum" text,
  ADD COLUMN IF NOT EXISTS "storage_key" text;

CREATE INDEX IF NOT EXISTS "idx_hr_employee_documents_storage_key"
  ON "hr_employee_documents" ("storage_key")
  WHERE "storage_key" IS NOT NULL;
