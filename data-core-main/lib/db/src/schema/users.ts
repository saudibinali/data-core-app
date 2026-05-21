import { pgTable, text, serial, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { departmentsTable } from "./departments";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").unique(),
  passwordHash: text("password_hash"),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name").notNull(),
  employeeNumber: text("employee_number"),
  employeeId: text("employee_id"),
  position: text("position"),
  avatarUrl: text("avatar_url"),
  phoneNumber: text("phone_number"),
  extensionNumber: text("extension_number"),
  languagePreference: text("language_preference"),
  timeZone: text("time_zone"),
  employmentStatus: text("employment_status").notNull().default("active"),
  signature: text("signature"),
  lineManagerId: integer("line_manager_id"),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  role: text("role").notNull().default("member"),
  customRoleId: integer("custom_role_id"),
  status: text("status").notNull().default("active"),
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  // ── P14-A: Platform User fields ─────────────────────────────────────────────
  /** For platform-internal users (workspaceId IS NULL): sub-role within the platform. */
  platformRoleCode: text("platform_role_code"),
  /** True if this user is the immutable Root Platform Owner. */
  isRootOwner: boolean("is_root_owner").notNull().default(false),
  /** True if this account is protected from status changes / deletion / email changes. */
  isProtected: boolean("is_protected").notNull().default(false),
  /** Last successful authentication timestamp. Nullable - null means never signed in. */
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // ── P17-A: Platform user directory profile & lifecycle ─────────────────────
  platformJobTitle: text("platform_job_title"),
  platformDepartment: text("platform_department"),
  platformPhone: text("platform_phone"),
  /** platform_owner | platform_admin | platform_operator (directory classification) */
  platformUserType: text("platform_user_type"),
  platformCreatedBy: integer("platform_created_by"),
  platformUpdatedBy: integer("platform_updated_by"),
  platformDisabledBy: integer("platform_disabled_by"),
  platformDisabledAt: timestamp("platform_disabled_at", { withTimezone: true }),
  platformDisableReason: text("platform_disable_reason"),
  platformReactivatedBy: integer("platform_reactivated_by"),
  platformReactivatedAt: timestamp("platform_reactivated_at", { withTimezone: true }),
  platformReactivationReason: text("platform_reactivation_reason"),
  // ────────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("uq_users_emp_num_ws").on(t.workspaceId, t.employeeNumber),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
