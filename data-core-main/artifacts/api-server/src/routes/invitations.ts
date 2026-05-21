import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workspaceInvitationsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin } from "../middlewares/requireAuth";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

router.get("/invitations", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }

  const statusFilter = req.query.status as string | undefined;

  let query = db
    .select({
      id: workspaceInvitationsTable.id,
      workspaceId: workspaceInvitationsTable.workspaceId,
      email: workspaceInvitationsTable.email,
      role: workspaceInvitationsTable.role,
      status: workspaceInvitationsTable.status,
      invitedByName: usersTable.fullName,
      clerkInvitationId: workspaceInvitationsTable.clerkInvitationId,
      expiresAt: workspaceInvitationsTable.expiresAt,
      createdAt: workspaceInvitationsTable.createdAt,
    })
    .from(workspaceInvitationsTable)
    .leftJoin(usersTable, eq(workspaceInvitationsTable.invitedByUserId, usersTable.id))
    .where(eq(workspaceInvitationsTable.workspaceId, req.workspaceId))
    .$dynamic();

  if (statusFilter) {
    query = query.where(and(
      eq(workspaceInvitationsTable.workspaceId, req.workspaceId),
      eq(workspaceInvitationsTable.status, statusFilter)
    ));
  }

  const invitations = await query.orderBy(workspaceInvitationsTable.createdAt);
  res.json(invitations);
});

router.post("/invitations", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) { res.status(400).json({ error: "No workspace assigned" }); return; }

  const { email, role = "member" } = req.body;
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const existing = await db.select().from(workspaceInvitationsTable).where(and(
    eq(workspaceInvitationsTable.workspaceId, req.workspaceId),
    eq(workspaceInvitationsTable.email, email),
    eq(workspaceInvitationsTable.status, "pending"),
  ));
  if (existing.length > 0) { res.status(409).json({ error: "A pending invitation already exists for this email" }); return; }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const [invitation] = await db.insert(workspaceInvitationsTable).values({
    workspaceId: req.workspaceId,
    email,
    role,
    status: "pending",
    invitedByUserId: req.userId,
    clerkInvitationId: null,
    expiresAt,
  }).returning();

  // Send invitation email via SMTP (no-op if SMTP not configured)
  try {
    const [inviter] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.userId));
    const appUrl = process.env.APP_URL ?? "http://localhost";
    await sendEmail({
      to: email,
      subject: "You have been invited",
      html: `<p>You have been invited to join the platform by ${inviter?.fullName ?? "an administrator"}.</p>
             <p>Your account will be created by the administrator. Contact them if you need help logging in.</p>
             <p>Platform URL: <a href="${appUrl}">${appUrl}</a></p>`,
    });
  } catch (_err) {
    // Ignore email errors - invitation record is still created
  }

  const [full] = await db
    .select({
      id: workspaceInvitationsTable.id,
      workspaceId: workspaceInvitationsTable.workspaceId,
      email: workspaceInvitationsTable.email,
      role: workspaceInvitationsTable.role,
      status: workspaceInvitationsTable.status,
      invitedByName: usersTable.fullName,
      clerkInvitationId: workspaceInvitationsTable.clerkInvitationId,
      expiresAt: workspaceInvitationsTable.expiresAt,
      createdAt: workspaceInvitationsTable.createdAt,
    })
    .from(workspaceInvitationsTable)
    .leftJoin(usersTable, eq(workspaceInvitationsTable.invitedByUserId, usersTable.id))
    .where(eq(workspaceInvitationsTable.id, invitation!.id));

  res.status(201).json(full);
});

router.delete("/invitations/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid invitation ID" }); return; }

  const [inv] = await db.select().from(workspaceInvitationsTable).where(eq(workspaceInvitationsTable.id, id));
  if (!inv || inv.workspaceId !== req.workspaceId) { res.status(404).json({ error: "Invitation not found" }); return; }

  await db.update(workspaceInvitationsTable).set({ status: "cancelled" }).where(eq(workspaceInvitationsTable.id, id));
  res.sendStatus(204);
});

export default router;
