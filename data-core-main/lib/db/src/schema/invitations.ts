import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const workspaceInvitationsTable = pgTable("workspace_invitations", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"),
  invitedByUserId: integer("invited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  clerkInvitationId: text("clerk_invitation_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkspaceInvitationSchema = createInsertSchema(workspaceInvitationsTable).omit({ id: true, createdAt: true });
export type InsertWorkspaceInvitation = z.infer<typeof insertWorkspaceInvitationSchema>;
export type WorkspaceInvitation = typeof workspaceInvitationsTable.$inferSelect;
