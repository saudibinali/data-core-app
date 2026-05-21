-- P19-D: Reporting engine & export infrastructure extensions

ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "report_definition_key" text;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "format" text;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "progress_percent" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "generated_report_id" integer;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "schedule_cron" text;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "schedule_timezone" text;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "recipient_json" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_export_jobs_status_created" ON "export_jobs" ("status", "created_at");
--> statement-breakpoint

ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "export_job_id" integer;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "download_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "parameters_json" text;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "file_name" text;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "schedule_cron" text;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "schedule_timezone" text;
--> statement-breakpoint
ALTER TABLE "generated_reports" ADD COLUMN IF NOT EXISTS "recipient_json" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "report_access_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "generated_report_id" integer REFERENCES "generated_reports"("id") ON DELETE CASCADE,
  "export_job_id" integer REFERENCES "export_jobs"("id") ON DELETE SET NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_access_logs_workspace" ON "report_access_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_access_logs_report" ON "report_access_logs" ("generated_report_id");
