import { pgTable, text, serial, integer, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  invitationMessage: text("invitation_message"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  isAllDay: boolean("is_all_day").notNull().default(false),
  // in_person | online
  eventType: text("event_type").notNull().default("in_person"),
  location: text("location"),
  meetingLink: text("meeting_link"),
  priority: text("priority").notNull().default("medium"),
  // draft | scheduled | active | completed | cancelled
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  attachments: json("attachments").$type<{ id: string; name: string; size: number; type: string; data: string }[]>().default([]),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const calendarEventParticipantsTable = pgTable("calendar_event_participants", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => calendarEventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // main | cc
  participantType: text("participant_type").notNull().default("main"),
  // invited | accepted | declined
  status: text("status").notNull().default("invited"),
  rsvpNote: text("rsvp_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
export type CalendarEventParticipant = typeof calendarEventParticipantsTable.$inferSelect;
