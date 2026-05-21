import { pgTable, serial, integer, boolean, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { departmentsTable } from "./departments";

export const userDepartmentsTable = pgTable("user_departments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").notNull().references(() => departmentsTable.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  departmentRole: text("department_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.departmentId)]);

export type UserDepartment = typeof userDepartmentsTable.$inferSelect;
