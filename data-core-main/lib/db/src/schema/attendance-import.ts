/**
 * P20-C — Attendance Import Center tables
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { employeesTable } from "./hr";
import { importJobsTable, documentsTable, generatedReportsTable } from "./documents";

export const attendanceImportBatchesTable = pgTable(
  "attendance_import_batches",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    importJobId: integer("import_job_id")
      .notNull()
      .references(() => importJobsTable.id, { onDelete: "cascade" }),
    fileDocumentId: integer("file_document_id").references(() => documentsTable.id, {
      onDelete: "set null",
    }),
    templateKey: text("template_key").notNull().default("attendance.period.default.v1"),
    mappingJson: text("mapping_json"),
    dryRun: boolean("dry_run").notNull().default(false),
    status: text("status").notNull().default("pending"),
    summaryJson: text("summary_json"),
    reconciliationReportId: integer("reconciliation_report_id").references(
      () => generatedReportsTable.id,
      { onDelete: "set null" },
    ),
    revertToken: text("revert_token"),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_attendance_import_batches_workspace").on(t.workspaceId),
    index("idx_attendance_import_batches_job").on(t.importJobId),
    index("idx_attendance_import_batches_status").on(t.status),
  ],
);

export const attendanceImportRowsTable = pgTable(
  "attendance_import_rows",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => attendanceImportBatchesTable.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
    localDate: date("local_date"),
    rawJson: text("raw_json").notNull(),
    validationStatus: text("validation_status").notNull().default("pending"),
    outcome: text("outcome"),
    errorsJson: text("errors_json"),
    warningsJson: text("warnings_json"),
    rawEventId: integer("raw_event_id"),
    legacyAttendanceId: integer("legacy_attendance_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_attendance_import_rows_batch_row").on(t.batchId, t.rowNumber),
    index("idx_attendance_import_rows_batch").on(t.batchId),
    index("idx_attendance_import_rows_workspace").on(t.workspaceId),
  ],
);

/** Soft revert metadata — no destructive deletes */
export const attendanceAdjustmentsTable = pgTable(
  "attendance_adjustments",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").references(() => attendanceImportBatchesTable.id, {
      onDelete: "set null",
    }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    adjustmentType: text("adjustment_type").notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_attendance_adjustments_batch").on(t.batchId),
    index("idx_attendance_adjustments_employee_date").on(t.employeeId, t.localDate),
  ],
);

export type AttendanceImportBatch = typeof attendanceImportBatchesTable.$inferSelect;
export type AttendanceImportRow = typeof attendanceImportRowsTable.$inferSelect;
export type AttendanceAdjustment = typeof attendanceAdjustmentsTable.$inferSelect;
