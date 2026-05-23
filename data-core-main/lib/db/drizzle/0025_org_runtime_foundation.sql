-- Phase 2: Enterprise Organizational Runtime (additive, idempotent)

ALTER TABLE "hr_org_units"
  ADD COLUMN IF NOT EXISTS "manager_employee_id" integer;

CREATE INDEX IF NOT EXISTS "idx_hr_org_units_manager_employee"
  ON "hr_org_units" ("manager_employee_id")
  WHERE "manager_employee_id" IS NOT NULL;

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "org_runtime_mode" text NOT NULL DEFAULT 'legacy';

COMMENT ON COLUMN "hr_workspace_settings"."org_runtime_mode" IS 'legacy | shadow | active — org linking enforcement cutover';

CREATE TABLE IF NOT EXISTS "workforce_executive_overrides" (
  "workspace_id" integer PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "ceo_employee_id" integer,
  "hr_director_employee_id" integer,
  "max_reporting_depth" integer NOT NULL DEFAULT 10,
  "executive_exempt_employee_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workforce_delegations" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "delegator_employee_id" integer NOT NULL,
  "delegate_employee_id" integer NOT NULL,
  "scope" text NOT NULL DEFAULT 'all_approvals',
  "start_date" date NOT NULL,
  "end_date" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_workforce_delegations_workspace"
  ON "workforce_delegations" ("workspace_id");

CREATE INDEX IF NOT EXISTS "idx_workforce_delegations_delegator"
  ON "workforce_delegations" ("delegator_employee_id");
