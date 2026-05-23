-- Final Phase: Enterprise active runtime, rollout registry, universal entity registry (additive)

CREATE TABLE IF NOT EXISTS "platform_entity_runtime_registry" (
  "id" serial PRIMARY KEY,
  "entity_type" text NOT NULL,
  "display_name" text NOT NULL,
  "template_key" text,
  "validation_key" text,
  "import_enabled" boolean NOT NULL DEFAULT false,
  "export_enabled" boolean NOT NULL DEFAULT false,
  "rollout_readiness" text NOT NULL DEFAULT 'future',
  "runtime_compatibility" jsonb,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_entity_runtime_registry_type"
  ON "platform_entity_runtime_registry" ("entity_type");

INSERT INTO "platform_entity_runtime_registry"
  ("entity_type", "display_name", "template_key", "validation_key", "import_enabled", "export_enabled", "rollout_readiness", "metadata")
VALUES
  ('hr.employee', 'HR Employee', 'hr.employee.enterprise.v2', 'hr.employee.v2', true, true, 'active', '{"phase":"final","legacyPreserved":true}'),
  ('hr.master_data', 'HR Master Data', 'hr.master_data.bundle.v2', 'hr.master_data.v2', true, true, 'active', '{"phase":"final"}'),
  ('platform.dynamic_form', 'Dynamic Forms', null, null, false, false, 'future', '{"note":"not_activated"}'),
  ('platform.workflow', 'Workflow Definitions', null, null, false, false, 'future', '{"note":"not_activated"}'),
  ('platform.service_catalog', 'Service Catalog', null, null, false, false, 'future', '{"note":"not_activated"}'),
  ('platform.asset', 'Assets', null, null, false, false, 'future', '{"note":"not_activated"}')
ON CONFLICT ("entity_type") DO NOTHING;

CREATE TABLE IF NOT EXISTS "hr_import_workspace_rollout" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "rollout_status" text NOT NULL DEFAULT 'pending',
  "runtime_mode_target" text NOT NULL DEFAULT 'active',
  "runtime_mode_previous" text,
  "rollout_sequence" integer NOT NULL DEFAULT 0,
  "parity_score" numeric(5,4),
  "readiness_score" numeric(5,4),
  "activation_blocked_reason" text,
  "activated_at" timestamptz,
  "rolled_back_at" timestamptz,
  "activated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "rollback_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "diagnostics" jsonb,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_import_workspace_rollout_ws"
  ON "hr_import_workspace_rollout" ("workspace_id");

CREATE INDEX IF NOT EXISTS "idx_hr_import_workspace_rollout_status"
  ON "hr_import_workspace_rollout" ("rollout_status", "rollout_sequence");

INSERT INTO "runtime_schema_registry" ("component", "expected_migration", "status")
VALUES ('platform_import_export_runtime', '0031_platform_runtime_final_phase', 'pending')
ON CONFLICT ("component") DO UPDATE SET "expected_migration" = EXCLUDED."expected_migration";
