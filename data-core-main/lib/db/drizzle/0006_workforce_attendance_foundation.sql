-- P20-B: Workforce attendance event platform foundation

CREATE TABLE IF NOT EXISTS "attendance_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "source_kind" text NOT NULL,
  "default_priority" integer DEFAULT 50 NOT NULL,
  "trust_level" integer DEFAULT 50 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_sources_ws_code" ON "attendance_sources" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_sources_workspace" ON "attendance_sources" ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attendance_raw_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_id" integer NOT NULL REFERENCES "attendance_sources"("id") ON DELETE RESTRICT,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "external_id" text,
  "idempotency_key" text NOT NULL,
  "event_type_hint" text NOT NULL,
  "payload_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processing_status" text DEFAULT 'received' NOT NULL,
  "error_message" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_raw_idempotency" ON "attendance_raw_events" ("workspace_id", "source_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_raw_workspace" ON "attendance_raw_events" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_raw_employee" ON "attendance_raw_events" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_raw_status" ON "attendance_raw_events" ("processing_status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attendance_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "source_id" integer NOT NULL REFERENCES "attendance_sources"("id") ON DELETE RESTRICT,
  "raw_event_id" integer NOT NULL REFERENCES "attendance_raw_events"("id") ON DELETE RESTRICT,
  "event_type" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "local_date" date NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "location_json" text,
  "idempotency_key" text NOT NULL,
  "is_superseded" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_events_raw" ON "attendance_events" ("raw_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_events_idempotency" ON "attendance_events" ("workspace_id", "employee_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_events_employee_date" ON "attendance_events" ("employee_id", "local_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_events_workspace" ON "attendance_events" ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attendance_daily_summaries" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "shift_id" integer REFERENCES "hr_shifts"("id") ON DELETE SET NULL,
  "first_in" text,
  "last_out" text,
  "worked_minutes" integer DEFAULT 0 NOT NULL,
  "late_minutes" integer DEFAULT 0 NOT NULL,
  "early_leave_minutes" integer DEFAULT 0 NOT NULL,
  "overtime_minutes" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'present' NOT NULL,
  "dominant_source_code" text,
  "legacy_attendance_id" integer REFERENCES "hr_attendance"("id") ON DELETE SET NULL,
  "calculation_version" integer DEFAULT 1 NOT NULL,
  "calculated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_daily_emp_date" ON "attendance_daily_summaries" ("employee_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_daily_workspace" ON "attendance_daily_summaries" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_daily_date" ON "attendance_daily_summaries" ("date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attendance_sync_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "job_type" text DEFAULT 'placeholder' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "cursor_json" text,
  "records_fetched" integer DEFAULT 0 NOT NULL,
  "records_normalized" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_sync_jobs_workspace" ON "attendance_sync_jobs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_sync_jobs_status" ON "attendance_sync_jobs" ("status");
