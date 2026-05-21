-- P19-B: Workspace SMTP & notification infrastructure

CREATE TABLE IF NOT EXISTS "workspace_smtp_configs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "host" text NOT NULL,
  "port" integer DEFAULT 587 NOT NULL,
  "secure" boolean DEFAULT false NOT NULL,
  "username" text NOT NULL,
  "encrypted_password" text NOT NULL,
  "from_email" text NOT NULL,
  "from_name" text,
  "reply_to_email" text,
  "is_verified" boolean DEFAULT false NOT NULL,
  "last_test_at" timestamp with time zone,
  "last_test_status" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspace_smtp_configs_workspace" ON "workspace_smtp_configs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_smtp_configs_workspace" ON "workspace_smtp_configs" ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "template_key" text NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "body_text" text,
  "version" integer DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_templates_scope" ON "notification_templates" ("workspace_id", "template_key", "channel", "locale");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_templates_workspace" ON "notification_templates" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_templates_key" ON "notification_templates" ("template_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "idempotency_key" text NOT NULL,
  "event_type" text NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "recipient_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "recipient_email" text,
  "template_key" text,
  "payload_json" text,
  "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "last_error" text,
  "bus_event_id" text,
  "notification_id" integer,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_jobs_idempotency" ON "notification_jobs" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_jobs_status_scheduled" ON "notification_jobs" ("status", "scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_jobs_workspace" ON "notification_jobs" ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "notification_job_id" integer,
  "notification_id" integer,
  "channel" text NOT NULL,
  "recipient_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "recipient_email" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "provider_message_id" text,
  "sent_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_workspace" ON "notification_deliveries" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_notification" ON "notification_deliveries" ("notification_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_job" ON "notification_deliveries" ("notification_job_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "communication_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "target_type" text,
  "target_id" text,
  "metadata_json" text,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_communication_audit_workspace" ON "communication_audit_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_communication_audit_created" ON "communication_audit_logs" ("created_at");
--> statement-breakpoint

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workspace_id" integer REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "notification_job_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_workspace_id" ON "notifications" ("workspace_id");
--> statement-breakpoint

UPDATE "notifications" n
SET "workspace_id" = u."workspace_id"
FROM "users" u
WHERE n."user_id" = u."id" AND n."workspace_id" IS NULL AND u."workspace_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_notification_id_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_job_id_notification_jobs_id_fk"
  FOREIGN KEY ("notification_job_id") REFERENCES "notification_jobs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE;
