import {
  pgTable,
  bigserial,
  integer,
  text,
  timestamp,
  date,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const legacyCompatUsageEventsTable = pgTable(
  "legacy_compat_usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    legacySurface: text("legacy_surface").notNull(),
    runtimeMode: text("runtime_mode"),
    sourcePath: text("source_path"),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    metadata: jsonb("metadata"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_legacy_compat_usage_ws_time").on(t.workspaceId, t.recordedAt),
    index("idx_legacy_compat_usage_surface").on(t.legacySurface, t.eventType),
  ],
);

export const legacyCutoverSnapshotTable = pgTable(
  "legacy_cutover_snapshot",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    modes: jsonb("modes").notNull().default({}),
    legacyHits: jsonb("legacy_hits").notNull().default({}),
    integrity: jsonb("integrity"),
    cleanupStage: text("cleanup_stage").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.snapshotDate] })],
);

export const runtimeSchemaRegistryTable = pgTable("runtime_schema_registry", {
  component: text("component").primaryKey(),
  expectedMigration: text("expected_migration").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  status: text("status").notNull().default("unknown"),
  details: jsonb("details"),
});

export type LegacyCompatUsageEvent = typeof legacyCompatUsageEventsTable.$inferSelect;
export type LegacyCutoverSnapshot = typeof legacyCutoverSnapshotTable.$inferSelect;
export type RuntimeSchemaRegistryEntry = typeof runtimeSchemaRegistryTable.$inferSelect;
