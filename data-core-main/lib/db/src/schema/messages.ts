import { pgTable, text, serial, integer, boolean, timestamp, unique, json } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => usersTable.id, { onDelete: "set null" }),
  subject: text("subject").notNull().default("(No subject)"),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("sent"),
  isPinned: boolean("is_pinned").notNull().default(false),
  isImportant: boolean("is_important").notNull().default(false),
  attachments: json("attachments").$type<{ id: string; name: string; size: number; type: string; data: string }[]>().default([]),
  parentId: integer("parent_id"),
  relatedTicketId: integer("related_ticket_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const messageRecipientsTable = pgTable("message_recipients", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  recipientType: text("recipient_type").notNull().default("to"),
  isRead: boolean("is_read").notNull().default(false),
  isArchivedByRecipient: boolean("is_archived_by_recipient").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.messageId, t.userId)]);
