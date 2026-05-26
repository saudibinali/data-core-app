-- H7 — master data alias mapping (workspace-scoped)
-- Allows mapping legacy/variant codes (e.g., G1F) to canonical codes (G1) without creating duplicates.

CREATE TABLE IF NOT EXISTS "hr_master_data_aliases" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "entity_type" text NOT NULL,
  "alias_code" text NOT NULL,
  "canonical_code" text NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_master_data_alias_ws_type_alias"
  ON "hr_master_data_aliases" ("workspace_id", "entity_type", "alias_code");

CREATE INDEX IF NOT EXISTS "idx_hr_master_data_alias_ws_type_canonical"
  ON "hr_master_data_aliases" ("workspace_id", "entity_type", "canonical_code");

