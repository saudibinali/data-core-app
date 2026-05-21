import { pgTable, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { groupsTable } from "./groups";
import { usersTable } from "./users";

export const groupMembersTable = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.groupId, t.userId)]);

export type GroupMember = typeof groupMembersTable.$inferSelect;
