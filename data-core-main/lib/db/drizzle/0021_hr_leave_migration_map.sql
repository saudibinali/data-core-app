-- P-HCM3: Idempotent legacy leave → canonical leave_requests migration map

CREATE TABLE IF NOT EXISTS "hr_leave_migration_map" (
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "legacy_leave_id" integer NOT NULL,
  "canonical_request_id" integer NOT NULL REFERENCES "leave_requests"("id") ON DELETE CASCADE,
  "migrated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pk_hr_leave_migration_map" PRIMARY KEY ("workspace_id", "legacy_leave_id")
);

CREATE INDEX IF NOT EXISTS "idx_hr_leave_migration_canonical"
  ON "hr_leave_migration_map" ("canonical_request_id");
