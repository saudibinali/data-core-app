import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";
import { workspacesTable } from "./workspaces";

/**
 * notifications - in-app notification delivery records.
 *
 * ── Observability role ────────────────────────────────────────────────────────
 *   Layer 2 (Notification Delivery) - records what was sent to whom.
 *   Combined with busEventId, enables: "show all notifications sent by event X".
 *
 * ── Correlation field (added in Phase 0/1 observability stabilization) ────────
 *   busEventId - UUID of the appEventBus event that created this notification row.
 *   Source: event.id in notifications-bus.ts listeners.
 *   Cross-reference: workspace_event_logs WHERE payload->>'_busEventId' = busEventId.
 *   NULL for notifications created before Phase 0/1 or by inline route handlers
 *   (comments.ts, messages.ts, calendar.ts - these are not yet on the bus).
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),

    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),

    workspaceId: integer("workspace_id").references(() => workspacesTable.id, {
      onDelete: "cascade",
    }),

    notificationJobId: integer("notification_job_id"),

    type: text("type").notNull(),

    title: text("title").notNull(),

    message: text("message").notNull(),

    ticketId: integer("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),

    isRead: boolean("is_read").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // ── Phase 0/1 observability column ──────────────────────────────────────

    /**
     * UUID of the appEventBus event that triggered this notification.
     * Value = event.id (UUID v4 string) from notifications-bus.ts listeners.
     * NULL for: legacy rows, inline inserts (comments.ts, messages.ts, calendar.ts),
     * and system-generated notifications without a bus event.
     *
     * Use case: given a workspace_event_log row, find all notifications it generated:
     *   SELECT * FROM notifications WHERE bus_event_id = '<uuid>'
     */
    busEventId: text("bus_event_id"),
  },
  (t) => [
    index("idx_notifications_bus_event_id").on(t.busEventId),
    index("idx_notifications_user_id").on(t.userId),
    index("idx_notifications_workspace_id").on(t.workspaceId),
    index("idx_notifications_created_at").on(t.createdAt),
  ],
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
