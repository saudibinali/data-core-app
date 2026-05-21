import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * @phase P17-E - Platform user invitation / activation tokens (hashed only)
 */
export const platformUserInvitationsTable = pgTable(
  "platform_user_invitations",
  {
    id: serial("id").primaryKey(),
    platformUserId: integer("platform_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
    revokeReason: text("revoke_reason"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("platform_user_invitation_one_pending_per_user_idx")
      .on(table.platformUserId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type PlatformUserInvitation = typeof platformUserInvitationsTable.$inferSelect;
