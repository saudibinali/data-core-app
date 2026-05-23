-- Phase 5: Legacy compat telemetry, cleanup staging, performance indexes (additive, idempotent)

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "workforce_cleanup_stage" text NOT NULL DEFAULT 'none';

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "legacy_write_policy" jsonb;

COMMENT ON COLUMN "hr_workspace_settings"."workforce_cleanup_stage" IS 'none | stage1 | stage2 | stage3 | stage4 — gradual cleanup gate (no drops)';
COMMENT ON COLUMN "hr_workspace_settings"."legacy_write_policy" IS 'Optional per-surface write policy overrides during cleanup';

-- Runtime usage telemetry (prove zero active dependencies before any removal)
CREATE TABLE IF NOT EXISTS "legacy_compat_usage_events" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "legacy_surface" text NOT NULL,
  "runtime_mode" text,
  "source_path" text,
  "entity_type" text,
  "entity_id" integer,
  "metadata" jsonb,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_legacy_compat_usage_ws_time"
  ON "legacy_compat_usage_events" ("workspace_id", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_legacy_compat_usage_surface"
  ON "legacy_compat_usage_events" ("legacy_surface", "event_type");

CREATE INDEX IF NOT EXISTS "idx_legacy_compat_usage_recorded"
  ON "legacy_compat_usage_events" ("recorded_at" DESC);

-- Daily cutover snapshot for cleanup gates
CREATE TABLE IF NOT EXISTS "legacy_cutover_snapshot" (
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "snapshot_date" date NOT NULL,
  "modes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "legacy_hits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "integrity" jsonb,
  "cleanup_stage" text NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "snapshot_date")
);

-- Schema version registry (migration diagnostics)
CREATE TABLE IF NOT EXISTS "runtime_schema_registry" (
  "component" text PRIMARY KEY,
  "expected_migration" text NOT NULL,
  "verified_at" timestamptz,
  "status" text NOT NULL DEFAULT 'unknown',
  "details" jsonb
);

INSERT INTO "runtime_schema_registry" ("component", "expected_migration", "status")
VALUES
  ('workforce_canonical', '0024_workforce_canonical_foundation', 'pending'),
  ('org_runtime', '0025_org_runtime_foundation', 'pending'),
  ('approval_runtime', '0026_approval_runtime_foundation', 'pending'),
  ('workforce_operations', '0027_workforce_operations_foundation', 'pending'),
  ('legacy_compat', '0028_legacy_compat_stabilization', 'pending')
ON CONFLICT ("component") DO NOTHING;

-- Performance indexes (Phase 5 optimization)
CREATE INDEX IF NOT EXISTS "idx_workforce_timeline_ws_employee_time"
  ON "workforce_timeline_events" ("workspace_id", "employee_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_employee_movements_ws_employee"
  ON "employee_movements" ("workspace_id", "employee_id", "effective_date" DESC);

CREATE INDEX IF NOT EXISTS "idx_approval_instances_ws_status_created"
  ON "approval_instances" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_approval_steps_pending_approver_due"
  ON "approval_steps" ("approver_user_id", "status", "due_at")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "idx_hr_activity_ws_created"
  ON "hr_employee_activity" ("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_hr_pos_history_ws_employee"
  ON "hr_employee_position_history" ("workspace_id", "employee_id", "effective_date" DESC);
