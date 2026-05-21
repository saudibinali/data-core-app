-- P23-A: Platform governance control plane (additive, non-destructive)

CREATE TABLE IF NOT EXISTS "workspace_lifecycle_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "previous_status" text NOT NULL,
  "new_status" text NOT NULL,
  "reason" text NOT NULL,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_lifecycle_events_ws" ON "workspace_lifecycle_events" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_governance_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "scope" text NOT NULL DEFAULT 'platform',
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" integer,
  "metadata_json" text,
  "governance_signature" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_gov_audit_ws" ON "platform_governance_audit_logs" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_gov_audit_actor" ON "platform_governance_audit_logs" ("actor_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_impersonation_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "target_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scopes_json" text NOT NULL,
  "break_glass" boolean DEFAULT false NOT NULL,
  "consent_reference" text,
  "status" text DEFAULT 'active' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "metadata_json" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_impersonation_actor" ON "support_impersonation_sessions" ("actor_user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_impersonation_target_ws" ON "support_impersonation_sessions" ("target_workspace_id", "status");
