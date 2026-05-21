/**
 * P20-E — Vendor-agnostic workforce integration hub
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
import { employeesTable, hrWorkLocationsTable } from "./hr";

export const attendanceIntegrationsTable = pgTable(
  "attendance_integrations",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    connectorKey: text("connector_key").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    configJson: text("config_json").notNull().default("{}"),
    credentialEncrypted: text("credential_encrypted"),
    credentialVersion: integer("credential_version").notNull().default(1),
    webhookSecretHash: text("webhook_secret_hash"),
    webhookMetadataJson: text("webhook_metadata_json"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStatus: text("last_sync_status"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(15),
    maxPayloadBytes: integer("max_payload_bytes").notNull().default(262144),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_attendance_integrations_workspace").on(t.workspaceId),
    index("idx_attendance_integrations_connector").on(t.connectorKey),
    index("idx_attendance_integrations_enabled").on(t.isEnabled),
  ],
);

export const attendanceDevicesTable = pgTable(
  "attendance_devices",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    integrationId: integer("integration_id").references(() => attendanceIntegrationsTable.id, {
      onDelete: "set null",
    }),
    deviceUid: text("device_uid").notNull(),
    deviceType: text("device_type").notNull().default("terminal"),
    workLocationId: integer("work_location_id").references(() => hrWorkLocationsTable.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_attendance_devices_ws_uid").on(t.workspaceId, t.deviceUid),
    index("idx_attendance_devices_integration").on(t.integrationId),
  ],
);

export const attendanceIntegrationEmployeeMapTable = pgTable(
  "attendance_integration_employee_map",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    integrationId: integer("integration_id")
      .notNull()
      .references(() => attendanceIntegrationsTable.id, { onDelete: "cascade" }),
    externalEmployeeId: text("external_employee_id").notNull(),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
    confidence: integer("confidence").notNull().default(100),
    status: text("status").notNull().default("mapped"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_att_int_emp_map_ext").on(t.integrationId, t.externalEmployeeId),
    index("idx_att_int_emp_map_workspace").on(t.workspaceId),
    index("idx_att_int_emp_map_employee").on(t.employeeId),
  ],
);

export type AttendanceIntegration = typeof attendanceIntegrationsTable.$inferSelect;
export type AttendanceDevice = typeof attendanceDevicesTable.$inferSelect;
export type AttendanceIntegrationEmployeeMap =
  typeof attendanceIntegrationEmployeeMapTable.$inferSelect;
