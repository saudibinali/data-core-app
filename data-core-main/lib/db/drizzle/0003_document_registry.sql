-- P19-C: Enterprise document registry

CREATE TABLE IF NOT EXISTS "documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "storage_key" text NOT NULL,
  "status" text DEFAULT 'uploading' NOT NULL,
  "classification" text DEFAULT 'internal' NOT NULL,
  "is_confidential" boolean DEFAULT false NOT NULL,
  "source_type" text,
  "source_entity_type" text,
  "source_entity_id" text,
  "folder_id" integer,
  "current_version_id" integer,
  "retention_until" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_workspace" ON "documents" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_entity" ON "documents" ("source_entity_type", "source_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_status" ON "documents" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_folder" ON "documents" ("folder_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "version_number" integer DEFAULT 1 NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "uploaded_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "sha256" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_versions_doc_ver" ON "document_versions" ("document_id", "version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_versions_document" ON "document_versions" ("document_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_folders" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "parent_id" integer,
  "name" text NOT NULL,
  "path_materialized" text NOT NULL,
  "folder_type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_folders_workspace" ON "document_folders" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_folders_entity" ON "document_folders" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_folders_path" ON "document_folders" ("workspace_id", "path_materialized");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_tags" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "tag" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_tags_doc_tag" ON "document_tags" ("document_id", "tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_tags_workspace" ON "document_tags" ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_access_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_access_logs_workspace" ON "document_access_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_access_logs_document" ON "document_access_logs" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_access_logs_created" ON "document_access_logs" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "generated_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "report_definition_key" text NOT NULL,
  "format" text NOT NULL,
  "storage_key" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "parameters_hash" text,
  "expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_generated_reports_workspace" ON "generated_reports" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_generated_reports_status" ON "generated_reports" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "import_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "dry_run" boolean DEFAULT false NOT NULL,
  "source_storage_key" text,
  "summary_json" text,
  "error_report_storage_key" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_import_jobs_workspace" ON "import_jobs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_import_jobs_status" ON "import_jobs" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "export_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "export_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "filter_params_json" text,
  "output_storage_key" text,
  "download_count" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_export_jobs_workspace" ON "export_jobs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_export_jobs_status" ON "export_jobs" ("status");
