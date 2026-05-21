/**
 * P19-D/E — Reporting schedules & workspace branding
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const workspaceReportBrandingTable = pgTable("workspace_report_branding", {
  workspaceId: integer("workspace_id")
    .primaryKey()
    .references(() => workspacesTable.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#1e40af"),
  footerText: text("footer_text"),
  locale: text("locale").notNull().default("en"),
  watermarkText: text("watermark_text"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const scheduledReportSchedulesTable = pgTable(
  "scheduled_report_schedules",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    reportDefinitionKey: text("report_definition_key").notNull(),
    format: text("format").notNull().default("pdf"),
    parametersJson: text("parameters_json"),
    scheduleCron: text("schedule_cron").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull().default("UTC"),
    recipientJson: text("recipient_json"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastExportJobId: integer("last_export_job_id"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_scheduled_reports_workspace").on(t.workspaceId),
    index("idx_scheduled_reports_next_run").on(t.enabled, t.nextRunAt),
  ],
);

export type WorkspaceReportBranding = typeof workspaceReportBrandingTable.$inferSelect;
export type ScheduledReportSchedule = typeof scheduledReportSchedulesTable.$inferSelect;
