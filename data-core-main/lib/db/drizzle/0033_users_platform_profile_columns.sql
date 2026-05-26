-- P14/P17 — User platform profile columns (additive; aligns schema with auth/me queries)

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "platform_role_code" text,
  ADD COLUMN IF NOT EXISTS "is_root_owner" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_protected" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "platform_job_title" text,
  ADD COLUMN IF NOT EXISTS "platform_department" text,
  ADD COLUMN IF NOT EXISTS "platform_phone" text,
  ADD COLUMN IF NOT EXISTS "platform_user_type" text,
  ADD COLUMN IF NOT EXISTS "platform_created_by" integer,
  ADD COLUMN IF NOT EXISTS "platform_updated_by" integer,
  ADD COLUMN IF NOT EXISTS "platform_disabled_by" integer,
  ADD COLUMN IF NOT EXISTS "platform_disabled_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "platform_disable_reason" text,
  ADD COLUMN IF NOT EXISTS "platform_reactivated_by" integer,
  ADD COLUMN IF NOT EXISTS "platform_reactivated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "platform_reactivation_reason" text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_emp_num_ws"
  ON "users" ("workspace_id", "employee_number");
