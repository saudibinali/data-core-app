import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * @phase P17-B - Custom platform permission overrides (grant/deny per platform user)
 */
export const platformUserPermissionOverridesTable = pgTable(
  "platform_user_permission_overrides",
  {
    id: serial("id").primaryKey(),
    platformUserId: integer("platform_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    permissionCode: text("permission_code").notNull(),
    effect: text("effect").notNull(), // grant | deny
    reason: text("reason").notNull(),
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: integer("removed_by"),
    removeReason: text("remove_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("platform_user_perm_override_active_unique_idx")
      .on(table.platformUserId, table.permissionCode)
      .where(sql`${table.removedAt} IS NULL`),
  ],
);

export type PlatformUserPermissionOverride =
  typeof platformUserPermissionOverridesTable.$inferSelect;
export type InsertPlatformUserPermissionOverride =
  typeof platformUserPermissionOverridesTable.$inferInsert;
