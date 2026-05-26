-- F4.3 — HR user provisioning audit + HTTP idempotency (additive)

CREATE TABLE IF NOT EXISTS "hr_provision_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "idempotency_key" text,
  "operation" text NOT NULL,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "outcome" text NOT NULL,
  "http_status" integer NOT NULL,
  "error_message" text,
  "request_fingerprint" text NOT NULL,
  "response_snapshot" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_provision_audit_ws_idem"
  ON "hr_provision_audit_log" ("workspace_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_hr_provision_audit_workspace"
  ON "hr_provision_audit_log" ("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_hr_provision_audit_employee"
  ON "hr_provision_audit_log" ("employee_id", "created_at" DESC);
