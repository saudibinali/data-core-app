/**
 * P20-B — Workforce Event Platform (attendance foundation)
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
import { employeesTable, hrShiftsTable, hrAttendanceTable } from "./hr";
import { attendanceIntegrationsTable } from "./workforce-integration";

export const attendanceSourcesTable = pgTable(
  "attendance_sources",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sourceKind: text("source_kind").notNull(),
    defaultPriority: integer("default_priority").notNull().default(50),
    trustLevel: integer("trust_level").notNull().default(50),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_attendance_sources_ws_code").on(t.workspaceId, t.code),
    index("idx_attendance_sources_workspace").on(t.workspaceId),
  ],
);

export const attendanceRawEventsTable = pgTable(
  "attendance_raw_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => attendanceSourcesTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    eventTypeHint: text("event_type_hint").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processingStatus: text("processing_status").notNull().default("received"),
    errorMessage: text("error_message"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("uq_attendance_raw_idempotency").on(t.workspaceId, t.sourceId, t.idempotencyKey),
    index("idx_attendance_raw_workspace").on(t.workspaceId),
    index("idx_attendance_raw_employee").on(t.employeeId),
    index("idx_attendance_raw_status").on(t.processingStatus),
  ],
);

export const attendanceEventsTable = pgTable(
  "attendance_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => attendanceSourcesTable.id, { onDelete: "restrict" }),
    rawEventId: integer("raw_event_id")
      .notNull()
      .references(() => attendanceRawEventsTable.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    locationJson: text("location_json"),
    idempotencyKey: text("idempotency_key").notNull(),
    isSuperseded: boolean("is_superseded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_attendance_events_raw").on(t.rawEventId),
    uniqueIndex("uq_attendance_events_idempotency").on(t.workspaceId, t.employeeId, t.idempotencyKey),
    index("idx_attendance_events_employee_date").on(t.employeeId, t.localDate),
    index("idx_attendance_events_workspace").on(t.workspaceId),
  ],
);

export const attendanceDailySummariesTable = pgTable(
  "attendance_daily_summaries",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    shiftId: integer("shift_id").references(() => hrShiftsTable.id, { onDelete: "set null" }),
    firstIn: text("first_in"),
    lastOut: text("last_out"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    status: text("status").notNull().default("present"),
    dominantSourceCode: text("dominant_source_code"),
    legacyAttendanceId: integer("legacy_attendance_id").references(() => hrAttendanceTable.id, {
      onDelete: "set null",
    }),
    calculationVersion: integer("calculation_version").notNull().default(1),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_attendance_daily_emp_date").on(t.employeeId, t.date),
    index("idx_attendance_daily_workspace").on(t.workspaceId),
    index("idx_attendance_daily_date").on(t.date),
  ],
);

export const attendanceSyncJobsTable = pgTable(
  "attendance_sync_jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    integrationId: integer("integration_id").references(() => attendanceIntegrationsTable.id, {
      onDelete: "set null",
    }),
    jobType: text("job_type").notNull().default("poll"),
    status: text("status").notNull().default("pending"),
    cursorJson: text("cursor_json"),
    recordsFetched: integer("records_fetched").notNull().default(0),
    recordsNormalized: integer("records_normalized").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_attendance_sync_jobs_workspace").on(t.workspaceId),
    index("idx_attendance_sync_jobs_status").on(t.status),
    index("idx_attendance_sync_jobs_integration").on(t.integrationId),
  ],
);

export type AttendanceSource = typeof attendanceSourcesTable.$inferSelect;
export type AttendanceRawEvent = typeof attendanceRawEventsTable.$inferSelect;
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
export type AttendanceDailySummary = typeof attendanceDailySummariesTable.$inferSelect;
