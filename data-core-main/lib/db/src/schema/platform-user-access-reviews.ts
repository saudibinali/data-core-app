import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * @phase P17-D - Manual access review records (visibility only; no permission changes)
 */
export const platformUserAccessReviewsTable = pgTable(
  "platform_user_access_reviews",
  {
    id: serial("id").primaryKey(),
    platformUserId: integer("platform_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reviewedBy: integer("reviewed_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStatus: text("review_status").notNull(), // reviewed | needs_follow_up | exception_accepted
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("platform_user_access_review_user_idx").on(table.platformUserId)],
);

export type PlatformUserAccessReview = typeof platformUserAccessReviewsTable.$inferSelect;
