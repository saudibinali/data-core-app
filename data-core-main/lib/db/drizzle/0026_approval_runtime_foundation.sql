-- Phase 3: Enterprise Approval Runtime (additive, idempotent)

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "approval_runtime_mode" text NOT NULL DEFAULT 'legacy';

COMMENT ON COLUMN "hr_workspace_settings"."approval_runtime_mode" IS 'legacy | dual | unified — approval runtime cutover';

CREATE TABLE IF NOT EXISTS "approval_process_policies" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "routing_type" text NOT NULL DEFAULT 'direct_manager',
  "chain_depth" integer NOT NULL DEFAULT 1,
  "timeout_hours" integer NOT NULL DEFAULT 48,
  "on_timeout" text NOT NULL DEFAULT 'escalate',
  "parallel_mode" text,
  "conditions" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_approval_process_policies_ws_code"
  ON "approval_process_policies" ("workspace_id", "code");

CREATE TABLE IF NOT EXISTS "approval_instances" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "process_code" text NOT NULL,
  "requester_employee_id" integer,
  "requester_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "current_step_order" integer NOT NULL DEFAULT 1,
  "context" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_instances_ws_status"
  ON "approval_instances" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "idx_approval_instances_entity"
  ON "approval_instances" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "approval_steps" (
  "id" serial PRIMARY KEY,
  "instance_id" integer NOT NULL REFERENCES "approval_instances"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL DEFAULT 1,
  "routing_source" text NOT NULL DEFAULT 'direct_manager',
  "approver_employee_id" integer,
  "approver_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "due_at" timestamptz,
  "decided_at" timestamptz,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "delegated_from_employee_id" integer,
  "legacy_leave_step_id" integer,
  "notified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_steps_instance"
  ON "approval_steps" ("instance_id", "step_order");

CREATE INDEX IF NOT EXISTS "idx_approval_steps_approver_pending"
  ON "approval_steps" ("approver_user_id", "status")
  WHERE "status" = 'pending';

INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT
  w.id,
  'leave.standard',
  'Standard Leave Approval',
  'موافقة إجازة — المدير المباشر',
  'direct_manager',
  1,
  48,
  'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p
  WHERE p.workspace_id = w.id AND p.code = 'leave.standard'
);

INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT
  w.id,
  'leave.manager_chain',
  'Multi-Level Leave Approval',
  'موافقة إجازة — سلسلة المدراء',
  'manager_chain',
  2,
  48,
  'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p
  WHERE p.workspace_id = w.id AND p.code = 'leave.manager_chain'
);
