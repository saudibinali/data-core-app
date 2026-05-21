-- P19-E: PDF scheduled reports & workspace branding

CREATE TABLE IF NOT EXISTS "workspace_report_branding" (
  "workspace_id" integer PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "display_name" text,
  "logo_url" text,
  "primary_color" text DEFAULT '#1e40af' NOT NULL,
  "footer_text" text,
  "locale" text DEFAULT 'en' NOT NULL,
  "watermark_text" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "scheduled_report_schedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "report_definition_key" text NOT NULL,
  "format" text DEFAULT 'pdf' NOT NULL,
  "parameters_json" text,
  "schedule_cron" text NOT NULL,
  "schedule_timezone" text DEFAULT 'UTC' NOT NULL,
  "recipient_json" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_export_job_id" integer,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_workspace" ON "scheduled_report_schedules" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_next_run" ON "scheduled_report_schedules" ("enabled", "next_run_at");
