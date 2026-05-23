-- Phase 4: Enterprise Workforce Operations & Employee File Runtime (additive, idempotent)

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "workforce_governance_mode" text NOT NULL DEFAULT 'legacy';

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "workforce_activation_requires" jsonb;

COMMENT ON COLUMN "hr_workspace_settings"."workforce_governance_mode" IS 'legacy | shadow | active — workforce governance enforcement cutover';
COMMENT ON COLUMN "hr_workspace_settings"."workforce_activation_requires" IS 'Optional activation gate: orgUnit, directManager, employmentType, jobTitle';

-- Document metadata extensions (Phase 4)
ALTER TABLE "hr_employee_documents"
  ADD COLUMN IF NOT EXISTS "category_code" text;

ALTER TABLE "hr_employee_documents"
  ADD COLUMN IF NOT EXISTS "is_signed" boolean NOT NULL DEFAULT false;

ALTER TABLE "hr_employee_documents"
  ADD COLUMN IF NOT EXISTS "signed_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_hr_docs_category"
  ON "hr_employee_documents" ("category_code")
  WHERE "category_code" IS NOT NULL;

-- Canonical employee movements (org / manager / title transitions)
CREATE TABLE IF NOT EXISTS "employee_movements" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "movement_type" text NOT NULL,
  "effective_date" date NOT NULL,
  "from_org_unit_id" integer,
  "to_org_unit_id" integer,
  "from_manager_id" integer,
  "to_manager_id" integer,
  "from_job_title_id" integer,
  "to_job_title_id" integer,
  "from_status" text,
  "to_status" text,
  "reason" text,
  "notes" text,
  "lifecycle_event_id" integer,
  "approval_instance_id" integer,
  "applied_at" timestamptz,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_employee_movements_employee"
  ON "employee_movements" ("employee_id", "effective_date" DESC);

CREATE INDEX IF NOT EXISTS "idx_employee_movements_workspace"
  ON "employee_movements" ("workspace_id", "created_at" DESC);

-- Workforce lifecycle events (onboarding, transfer, promotion, offboarding, etc.)
CREATE TABLE IF NOT EXISTS "workforce_lifecycle_events" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "effective_date" date,
  "payload" jsonb,
  "approval_instance_id" integer,
  "movement_id" integer,
  "completed_at" timestamptz,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_workforce_lifecycle_employee"
  ON "workforce_lifecycle_events" ("employee_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_workforce_lifecycle_status"
  ON "workforce_lifecycle_events" ("workspace_id", "status");

-- Unified workforce timeline (operational history feed)
CREATE TABLE IF NOT EXISTS "workforce_timeline_events" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "event_category" text NOT NULL,
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_name" text,
  "correlation_id" text,
  "source_table" text,
  "source_id" integer,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_workforce_timeline_employee"
  ON "workforce_timeline_events" ("employee_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_workforce_timeline_correlation"
  ON "workforce_timeline_events" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;

-- Workforce audit log (before/after with correlation)
CREATE TABLE IF NOT EXISTS "workforce_audit_log" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "before_state" jsonb,
  "after_state" jsonb,
  "correlation_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_workforce_audit_entity"
  ON "workforce_audit_log" ("entity_type", "entity_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_workforce_audit_correlation"
  ON "workforce_audit_log" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;

-- Seed default document categories reference (uses existing hr_document_types if present)
INSERT INTO "hr_document_types" ("workspace_id", "code", "name", "name_ar", "is_required", "display_order")
SELECT w.id, v.code, v.name, v.name_ar, v.is_required, v.display_order
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('national_id', 'National ID', 'الهوية الوطنية', true, 1),
    ('passport', 'Passport', 'جواز السفر', false, 2),
    ('iqama', 'Iqama / Residence', 'الإقامة', false, 3),
    ('contract', 'Employment Contract', 'عقد العمل', true, 4),
    ('certificate', 'Certificate', 'شهادة', false, 5),
    ('signed_document', 'Signed Document', 'مستند موقع', false, 6),
    ('other', 'Other', 'أخرى', false, 99)
) AS v(code, name, name_ar, is_required, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_document_types" dt
  WHERE dt.workspace_id = w.id AND dt.code = v.code
);

-- Seed lifecycle approval policies if missing
INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT w.id, 'hr.transfer', 'Employee Transfer', 'نقل موظف', 'direct_manager', 1, 72, 'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p WHERE p.workspace_id = w.id AND p.code = 'hr.transfer'
);

INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT w.id, 'hr.onboarding', 'Employee Onboarding', 'تهيئة موظف', 'direct_manager', 1, 72, 'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p WHERE p.workspace_id = w.id AND p.code = 'hr.onboarding'
);

INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT w.id, 'hr.promotion', 'Employee Promotion', 'ترقية موظف', 'direct_manager', 2, 72, 'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p WHERE p.workspace_id = w.id AND p.code = 'hr.promotion'
);

INSERT INTO "approval_process_policies" (
  "workspace_id", "code", "name", "name_ar", "routing_type", "chain_depth", "timeout_hours", "on_timeout"
)
SELECT w.id, 'hr.offboarding', 'Employee Offboarding', 'إنهاء خدمة موظف', 'direct_manager', 1, 72, 'escalate'
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_process_policies" p WHERE p.workspace_id = w.id AND p.code = 'hr.offboarding'
);
