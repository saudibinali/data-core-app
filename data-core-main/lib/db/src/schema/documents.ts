/**
 * P19-C — Enterprise document registry (workspace-scoped canonical storage).
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("uploading"),
    classification: text("classification").notNull().default("internal"),
    isConfidential: boolean("is_confidential").notNull().default(false),
    sourceType: text("source_type"),
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: text("source_entity_id"),
    folderId: integer("folder_id"),
    currentVersionId: integer("current_version_id"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_documents_workspace").on(t.workspaceId),
    index("idx_documents_entity").on(t.sourceEntityType, t.sourceEntityId),
    index("idx_documents_status").on(t.status),
    index("idx_documents_folder").on(t.folderId),
  ],
);

export const documentVersionsTable = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_document_versions_doc_ver").on(t.documentId, t.versionNumber),
    index("idx_document_versions_document").on(t.documentId),
  ],
);

export const documentFoldersTable = pgTable(
  "document_folders",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    parentId: integer("parent_id"),
    name: text("name").notNull(),
    pathMaterialized: text("path_materialized").notNull(),
    folderType: text("folder_type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_document_folders_workspace").on(t.workspaceId),
    index("idx_document_folders_entity").on(t.entityType, t.entityId),
    uniqueIndex("uq_document_folders_path").on(t.workspaceId, t.pathMaterialized),
  ],
);

export const documentTagsTable = pgTable(
  "document_tags",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_document_tags_doc_tag").on(t.documentId, t.tag),
    index("idx_document_tags_workspace").on(t.workspaceId),
  ],
);

export const documentAccessLogsTable = pgTable(
  "document_access_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_document_access_logs_workspace").on(t.workspaceId),
    index("idx_document_access_logs_document").on(t.documentId),
    index("idx_document_access_logs_created").on(t.createdAt),
  ],
);

export const generatedReportsTable = pgTable(
  "generated_reports",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    reportDefinitionKey: text("report_definition_key").notNull(),
    format: text("format").notNull(),
    storageKey: text("storage_key"),
    status: text("status").notNull().default("pending"),
    requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    parametersHash: text("parameters_hash"),
    parametersJson: text("parameters_json"),
    fileName: text("file_name"),
    exportJobId: integer("export_job_id"),
    downloadCount: integer("download_count").notNull().default(0),
    scheduleCron: text("schedule_cron"),
    scheduleTimezone: text("schedule_timezone"),
    recipientJson: text("recipient_json"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_generated_reports_workspace").on(t.workspaceId),
    index("idx_generated_reports_status").on(t.status),
  ],
);

export const importJobsTable = pgTable(
  "import_jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    importType: text("import_type").notNull(),
    status: text("status").notNull().default("pending"),
    dryRun: boolean("dry_run").notNull().default(false),
    sourceStorageKey: text("source_storage_key"),
    summaryJson: text("summary_json"),
    errorReportStorageKey: text("error_report_storage_key"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_import_jobs_workspace").on(t.workspaceId),
    index("idx_import_jobs_status").on(t.status),
  ],
);

export const exportJobsTable = pgTable(
  "export_jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    exportType: text("export_type").notNull(),
    reportDefinitionKey: text("report_definition_key"),
    format: text("format"),
    status: text("status").notNull().default("pending"),
    progressPercent: integer("progress_percent").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    filterParamsJson: text("filter_params_json"),
    outputStorageKey: text("output_storage_key"),
    generatedReportId: integer("generated_report_id"),
    downloadCount: integer("download_count").notNull().default(0),
    scheduleCron: text("schedule_cron"),
    scheduleTimezone: text("schedule_timezone"),
    recipientJson: text("recipient_json"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_export_jobs_workspace").on(t.workspaceId),
    index("idx_export_jobs_status").on(t.status),
  ],
);

export const reportAccessLogsTable = pgTable(
  "report_access_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    generatedReportId: integer("generated_report_id").references(() => generatedReportsTable.id, {
      onDelete: "cascade",
    }),
    exportJobId: integer("export_job_id").references(() => exportJobsTable.id, {
      onDelete: "set null",
    }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_report_access_logs_workspace").on(t.workspaceId),
    index("idx_report_access_logs_report").on(t.generatedReportId),
  ],
);

export type Document = typeof documentsTable.$inferSelect;
export type DocumentVersion = typeof documentVersionsTable.$inferSelect;
export type DocumentFolder = typeof documentFoldersTable.$inferSelect;
export type GeneratedReport = typeof generatedReportsTable.$inferSelect;
export type ImportJob = typeof importJobsTable.$inferSelect;
export type ExportJob = typeof exportJobsTable.$inferSelect;
