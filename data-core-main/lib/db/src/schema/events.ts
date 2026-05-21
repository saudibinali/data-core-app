import { pgTable, text, serial, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const platformEventRegistryTable = pgTable("platform_event_registry", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull().unique(),
  module: text("module").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  schema: jsonb("schema"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceEventLogsTable = pgTable(
  "workspace_event_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    module: text("module").notNull(),
    triggeredBy: integer("triggered_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("completed"),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_event_logs_workspace").on(t.workspaceId),
    index("idx_event_logs_event_name").on(t.eventName),
    index("idx_event_logs_created_at").on(t.createdAt),
    index("idx_event_logs_status").on(t.status),
  ],
);

export type PlatformEventRegistry = typeof platformEventRegistryTable.$inferSelect;
export type WorkspaceEventLog = typeof workspaceEventLogsTable.$inferSelect;
