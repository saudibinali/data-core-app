import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  emailAlias: text("email_alias"),
  description: text("description"),
  sendPermissions: text("send_permissions").notNull().default("members_only"),
  visibility: text("visibility").notNull().default("workspace"),
  moderation: text("moderation").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Group = typeof groupsTable.$inferSelect;
