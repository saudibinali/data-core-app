/**
 * P19-B — Workspace communication & notification infrastructure (canonical schema).
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { notificationsTable } from "./notifications";

export const workspaceSmtpConfigsTable = pgTable(
  "workspace_smtp_configs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    port: integer("port").notNull().default(587),
    secure: boolean("secure").notNull().default(false),
    username: text("username").notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    replyToEmail: text("reply_to_email"),
    isVerified: boolean("is_verified").notNull().default(false),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_workspace_smtp_configs_workspace").on(t.workspaceId),
    index("idx_workspace_smtp_configs_workspace").on(t.workspaceId),
  ],
);

export const notificationTemplatesTable = pgTable(
  "notification_templates",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => workspacesTable.id, {
      onDelete: "cascade",
    }),
    templateKey: text("template_key").notNull(),
    channel: text("channel").notNull().default("email"),
    locale: text("locale").notNull().default("en"),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text"),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_notification_templates_scope").on(t.workspaceId, t.templateKey, t.channel, t.locale),
    index("idx_notification_templates_workspace").on(t.workspaceId),
    index("idx_notification_templates_key").on(t.templateKey),
  ],
);

export const notificationJobsTable = pgTable(
  "notification_jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    channel: text("channel").notNull().default("email"),
    status: text("status").notNull().default("pending"),
    recipientUserId: integer("recipient_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email"),
    templateKey: text("template_key"),
    payloadJson: text("payload_json"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    busEventId: text("bus_event_id"),
    notificationId: integer("notification_id").references(() => notificationsTable.id, {
      onDelete: "set null",
    }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_notification_jobs_idempotency").on(t.workspaceId, t.idempotencyKey),
    index("idx_notification_jobs_status_scheduled").on(t.status, t.scheduledAt),
    index("idx_notification_jobs_workspace").on(t.workspaceId),
  ],
);

export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    notificationJobId: integer("notification_job_id").references(() => notificationJobsTable.id, {
      onDelete: "set null",
    }),
    notificationId: integer("notification_id").references(() => notificationsTable.id, {
      onDelete: "cascade",
    }),
    channel: text("channel").notNull(),
    recipientUserId: integer("recipient_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email"),
    status: text("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_notification_deliveries_workspace").on(t.workspaceId),
    index("idx_notification_deliveries_notification").on(t.notificationId),
    index("idx_notification_deliveries_job").on(t.notificationJobId),
  ],
);

export const communicationAuditLogsTable = pgTable(
  "communication_audit_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadataJson: text("metadata_json"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_communication_audit_workspace").on(t.workspaceId),
    index("idx_communication_audit_created").on(t.createdAt),
  ],
);

export type WorkspaceSmtpConfig = typeof workspaceSmtpConfigsTable.$inferSelect;
export type NotificationTemplate = typeof notificationTemplatesTable.$inferSelect;
export type NotificationJob = typeof notificationJobsTable.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;
export type CommunicationAuditLog = typeof communicationAuditLogsTable.$inferSelect;
