-- P20-E: Workforce integration hub

CREATE TABLE IF NOT EXISTS "attendance_integrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "connector_key" text NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "config_json" text DEFAULT '{}' NOT NULL,
  "credential_encrypted" text,
  "credential_version" integer DEFAULT 1 NOT NULL,
  "webhook_secret_hash" text,
  "webhook_metadata_json" text,
  "last_sync_at" timestamp with time zone,
  "last_sync_status" text,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "poll_interval_minutes" integer DEFAULT 15 NOT NULL,
  "max_payload_bytes" integer DEFAULT 262144 NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_integrations_workspace" ON "attendance_integrations" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_integrations_connector" ON "attendance_integrations" ("connector_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_integrations_enabled" ON "attendance_integrations" ("is_enabled");

CREATE TABLE IF NOT EXISTS "attendance_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "integration_id" integer REFERENCES "attendance_integrations"("id") ON DELETE SET NULL,
  "device_uid" text NOT NULL,
  "device_type" text DEFAULT 'terminal' NOT NULL,
  "work_location_id" integer REFERENCES "hr_work_locations"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_seen_at" timestamp with time zone,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_devices_ws_uid" ON "attendance_devices" ("workspace_id", "device_uid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_devices_integration" ON "attendance_devices" ("integration_id");

CREATE TABLE IF NOT EXISTS "attendance_integration_employee_map" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "integration_id" integer NOT NULL REFERENCES "attendance_integrations"("id") ON DELETE CASCADE,
  "external_employee_id" text NOT NULL,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "confidence" integer DEFAULT 100 NOT NULL,
  "status" text DEFAULT 'mapped' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_att_int_emp_map_ext" ON "attendance_integration_employee_map" ("integration_id", "external_employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_att_int_emp_map_workspace" ON "attendance_integration_employee_map" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_att_int_emp_map_employee" ON "attendance_integration_employee_map" ("employee_id");

ALTER TABLE "attendance_sync_jobs" ADD COLUMN IF NOT EXISTS "integration_id" integer REFERENCES "attendance_integrations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "attendance_sync_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "attendance_sync_jobs" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "attendance_sync_jobs" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_sync_jobs_integration" ON "attendance_sync_jobs" ("integration_id");
