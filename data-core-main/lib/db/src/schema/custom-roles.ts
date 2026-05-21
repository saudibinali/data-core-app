import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const workspaceCustomRolesTable = pgTable("workspace_custom_roles", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const workspaceRolePermissionsTable = pgTable("workspace_role_permissions", {
  id: serial("id").primaryKey(),
  customRoleId: integer("custom_role_id").notNull().references(() => workspaceCustomRolesTable.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
});

export type WorkspaceCustomRole = typeof workspaceCustomRolesTable.$inferSelect;
export type WorkspaceRolePermission = typeof workspaceRolePermissionsTable.$inferSelect;
