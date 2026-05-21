import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";
import { workspacesTable } from "./workspaces";

/**
 * activity_logs - human-readable audit trail of domain actions.
 *
 * ── Observability role ────────────────────────────────────────────────────────
 *   Layer 3 (Business Activity History) in the four-layer observability model.
 *   Records WHO did WHAT, in human-readable form, for the activity feed UI.
 *
 *   This table is NOT the primary event store - that is workspace_event_logs.
 *   Use workspace_event_logs for technical event detail, payload, and listener results.
 *   Use activity_logs for the workspace timeline and user history UI.
 *
 * ── Correlation fields (added in Phase 0/1 observability stabilization) ──────
 *   workspaceId  - direct workspace isolation without JOIN through users/tickets.
 *                  Before this column, workspace-scoped queries required:
 *                    JOIN tickets ON tickets.workspace_id = ?   (ticket rows only)
 *                    JOIN users ON users.workspace_id = ?       (non-ticket rows)
 *                  With this column: WHERE workspace_id = ? on activity_logs directly.
 *
 *   busEventId   - UUID of the appEventBus event that created this row.
 *                  Populated from event.id in listeners/activity.ts.
 *                  Links this row back to workspace_event_logs WHERE
 *                    payload->>'_busEventId' = busEventId.
 *                  Enables: "show the workspace_event_log for this activity row"
 *                  and: "show all activity rows created by event <uuid>".
 *                  NULL for rows created before Phase 0/1 (legacy rows).
 *
 * ── Columns ───────────────────────────────────────────────────────────────────
 *   ticketId    - null for non-ticket actions (leave, employee, form, etc.)
 *   userId      - actor who performed the action (set null if user is deleted)
 *   action      - machine-readable action identifier (e.g. "leave_approved")
 *   metadata    - human-readable context string (dates, names, amounts)
 */
export const activityLogsTable = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),

    ticketId: integer("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),

    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),

    action: text("action").notNull(),

    metadata: text("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // ── Phase 0/1 observability columns ─────────────────────────────────────

    /**
     * Direct workspace isolation - eliminates the JOIN chain for workspace queries.
     * Nullable: legacy rows (pre Phase 0/1) do not have this value.
     * New rows: always populated from event.workspace.workspaceId in activity.ts listener.
     */
    workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),

    /**
     * UUID of the appEventBus event that caused this activity row.
     * Value = event.id (UUID v4 string, auto-assigned by appEventBus.emit()).
     * Cross-reference: workspace_event_logs WHERE payload->>'_busEventId' = bus_event_id.
     * Nullable: NULL for rows inserted before Phase 0/1 (existing data).
     */
    busEventId: text("bus_event_id"),
  },
  (t) => [
    index("idx_activity_workspace").on(t.workspaceId),
    index("idx_activity_bus_event_id").on(t.busEventId),
    index("idx_activity_created_at").on(t.createdAt),
    index("idx_activity_user_id").on(t.userId),
  ],
);

export const insertActivityLogSchema = createInsertSchema(activityLogsTable).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogsTable.$inferSelect;
