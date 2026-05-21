/**
 * P20-D — Geofence & attendance policies foundation
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { hrWorkLocationsTable } from "./hr";

export const attendanceGeofencesTable = pgTable(
  "attendance_geofences",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    workLocationId: integer("work_location_id").references(() => hrWorkLocationsTable.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    radiusMeters: integer("radius_meters").notNull().default(200),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_attendance_geofences_workspace").on(t.workspaceId),
    index("idx_attendance_geofences_location").on(t.workLocationId),
    index("idx_attendance_geofences_active").on(t.isActive),
  ],
);

export const attendancePoliciesTable = pgTable(
  "attendance_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Default"),
    isDefault: boolean("is_default").notNull().default(false),
    policyJson: text("policy_json").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("idx_attendance_policies_workspace").on(t.workspaceId)],
);

export type AttendanceGeofence = typeof attendanceGeofencesTable.$inferSelect;
export type AttendancePolicy = typeof attendancePoliciesTable.$inferSelect;
