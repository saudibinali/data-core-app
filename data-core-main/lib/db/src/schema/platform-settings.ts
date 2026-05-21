import { pgTable, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const platformSettingsTable = pgTable("platform_settings", {
  category: text("category").primaryKey(),
  value:    jsonb("value").notNull().default("{}"),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformSettingsRow = typeof platformSettingsTable.$inferSelect;
