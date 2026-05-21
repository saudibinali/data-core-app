import { pgTable, text, serial, integer, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const platformModulesTable = pgTable("platform_modules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  icon: text("icon").notNull().default("Box"),
  version: text("version").notNull().default("1.0.0"),
  category: text("category").notNull().default("core"),
  core: boolean("core").notNull().default(false),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  navigationPath: text("navigation_path"),
  permissionKey: text("permission_key"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceModuleSettingsTable = pgTable("workspace_module_settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  moduleKey: text("module_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("uq_workspace_module").on(t.workspaceId, t.moduleKey),
]);

export type PlatformModule = typeof platformModulesTable.$inferSelect;
export type WorkspaceModuleSetting = typeof workspaceModuleSettingsTable.$inferSelect;
