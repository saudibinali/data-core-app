import { pgTable, text, serial, integer, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

// ── Form Definitions ──────────────────────────────────────────────────────────

export const formDefinitionsTable = pgTable(
  "form_definitions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    module: text("module").notNull().default("system"),
    category: text("category"),
    status: text("status").notNull().default("active"),
    // event name to fire on submission (e.g. "leave.requested")
    workflowEvent: text("workflow_event"),
    // { roles: string[], permissions: string[] }
    permissions: jsonb("permissions"),
    // { allowDraft, requireAuth, maxSubmissionsPerUser, successMessage }
    settings: jsonb("settings"),
    // whether this form should appear in the employee Self-Service portal
    showInSelfService: boolean("show_in_self_service").notNull().default(false),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_form_definitions_workspace").on(t.workspaceId),
    index("idx_form_definitions_module").on(t.module),
    index("idx_form_definitions_status").on(t.status),
  ],
);

// ── Form Fields ───────────────────────────────────────────────────────────────

export const formFieldsTable = pgTable(
  "form_fields",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .notNull()
      .references(() => formDefinitionsTable.id, { onDelete: "cascade" }),
    // field key used in submission data (e.g. "full_name", "start_date")
    name: text("name").notNull(),
    label: text("label").notNull(),
    labelAr: text("label_ar"),
    // text|textarea|number|email|phone|dropdown|checkbox|radio|date|time|file|user|department|multi_select|boolean
    type: text("type").notNull().default("text"),
    required: boolean("required").notNull().default(false),
    placeholder: text("placeholder"),
    placeholderAr: text("placeholder_ar"),
    defaultValue: text("default_value"),
    // for dropdown/radio/checkbox/multi_select: [{ value, label, labelAr }]
    options: jsonb("options"),
    // { min, max, minLength, maxLength, pattern, fileTypes, maxFileSizeMb }
    validation: jsonb("validation"),
    // { dependsOn: fieldName, showWhen: { operator, value } }
    conditional: jsonb("conditional"),
    // { key: string, labelField?: string, valueField?: string, filter?: object, multiple?: boolean }
    // When set, field options are loaded live from the platform (users/departments/etc.)
    dataSource: jsonb("data_source"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_form_fields_form").on(t.formId),
    index("idx_form_fields_order").on(t.formId, t.displayOrder),
  ],
);

// ── Form Submissions ──────────────────────────────────────────────────────────

export const formSubmissionsTable = pgTable(
  "form_submissions",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .notNull()
      .references(() => formDefinitionsTable.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    submittedById: integer("submitted_by_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Auto-generated request reference number e.g. "REQ-2026-00001"
    requestNumber: text("request_number"),
    // draft|submitted|pending_approval|approved|rejected|cancelled|completed
    status: text("status").notNull().default("submitted"),
    // { fieldName: value, ... }
    data: jsonb("data").notNull().default({}),
    // reviewer notes / decision reason
    reviewNote: text("review_note"),
    reviewedById: integer("reviewed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_form_submissions_form").on(t.formId),
    index("idx_form_submissions_workspace").on(t.workspaceId),
    index("idx_form_submissions_submitter").on(t.submittedById),
    index("idx_form_submissions_status").on(t.status),
  ],
);

// ── Form Submission Files ─────────────────────────────────────────────────────

export const formSubmissionFilesTable = pgTable(
  "form_submission_files",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => formSubmissionsTable.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    originalName: text("original_name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    uploadedById: integer("uploaded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_form_files_submission").on(t.submissionId),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type FormDefinition    = typeof formDefinitionsTable.$inferSelect;
export type FormField         = typeof formFieldsTable.$inferSelect;
export type FormSubmission    = typeof formSubmissionsTable.$inferSelect;
export type FormSubmissionFile = typeof formSubmissionFilesTable.$inferSelect;
