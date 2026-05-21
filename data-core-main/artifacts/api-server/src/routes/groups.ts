import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { groupsTable, groupMembersTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/groups", requireAuth, requirePermission("groups.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }

  const groups = await db
    .select({
      id: groupsTable.id,
      workspaceId: groupsTable.workspaceId,
      name: groupsTable.name,
      emailAlias: groupsTable.emailAlias,
      description: groupsTable.description,
      sendPermissions: groupsTable.sendPermissions,
      visibility: groupsTable.visibility,
      moderation: groupsTable.moderation,
      memberCount: sql<number>`(select count(*)::int from group_members where group_id = ${groupsTable.id})`,
      createdAt: groupsTable.createdAt,
      updatedAt: groupsTable.updatedAt,
    })
    .from(groupsTable)
    .where(eq(groupsTable.workspaceId, req.workspaceId))
    .orderBy(groupsTable.name);

  res.json(groups);
});

router.post("/groups", requireAuth, requirePermission("groups.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(400).json({ error: "No workspace assigned" });
    return;
  }

  const { name, emailAlias, description, sendPermissions, visibility, moderation } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [group] = await db.insert(groupsTable).values({
    workspaceId: req.workspaceId,
    name,
    emailAlias: emailAlias ?? null,
    description: description ?? null,
    sendPermissions: sendPermissions ?? "members_only",
    visibility: visibility ?? "workspace",
    moderation: moderation ?? "none",
  }).returning();

  res.status(201).json({ ...group, memberCount: 0 });
});

// GET /groups/:id - requires "groups.view" OR "groups.<id>.view"
router.get("/groups/:id", requireAuth, requirePermission(req => [
  "groups.view",
  `groups.${req.params["id"]}.view`,
]), async (req: AuthRequest, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(groupId)) {
    res.status(400).json({ error: "Invalid group ID" });
    return;
  }

  const [group] = await db
    .select({
      id: groupsTable.id,
      workspaceId: groupsTable.workspaceId,
      name: groupsTable.name,
      emailAlias: groupsTable.emailAlias,
      description: groupsTable.description,
      sendPermissions: groupsTable.sendPermissions,
      visibility: groupsTable.visibility,
      moderation: groupsTable.moderation,
      memberCount: sql<number>`(select count(*)::int from group_members where group_id = ${groupsTable.id})`,
      createdAt: groupsTable.createdAt,
      updatedAt: groupsTable.updatedAt,
    })
    .from(groupsTable)
    .where(and(
      eq(groupsTable.id, groupId),
      req.workspaceId ? eq(groupsTable.workspaceId, req.workspaceId) : undefined!
    ));

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const members = await db
    .select({
      id: groupMembersTable.id,
      userId: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
      avatarUrl: usersTable.avatarUrl,
      position: usersTable.position,
      isOwner: groupMembersTable.isOwner,
    })
    .from(groupMembersTable)
    .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
    .where(eq(groupMembersTable.groupId, groupId))
    .orderBy(usersTable.fullName);

  res.json({ ...group, members });
});

// PATCH /groups/:id - requires "groups.manage" OR "groups.<id>.manage"
router.patch("/groups/:id", requireAuth, requirePermission(req => [
  "groups.manage",
  `groups.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(groupId)) {
    res.status(400).json({ error: "Invalid group ID" });
    return;
  }

  const { name, emailAlias, description, sendPermissions, visibility, moderation } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (emailAlias !== undefined) updates.emailAlias = emailAlias;
  if (description !== undefined) updates.description = description;
  if (sendPermissions !== undefined) updates.sendPermissions = sendPermissions;
  if (visibility !== undefined) updates.visibility = visibility;
  if (moderation !== undefined) updates.moderation = moderation;

  const [group] = await db
    .update(groupsTable)
    .set(updates)
    .where(and(
      eq(groupsTable.id, groupId),
      req.workspaceId ? eq(groupsTable.workspaceId, req.workspaceId) : undefined!
    ))
    .returning();

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, group.id));

  res.json({ ...group, memberCount: memberCount[0]?.count ?? 0 });
});

// DELETE /groups/:id - requires "groups.manage" OR "groups.<id>.manage"
router.delete("/groups/:id", requireAuth, requirePermission(req => [
  "groups.manage",
  `groups.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(groupId)) {
    res.status(400).json({ error: "Invalid group ID" });
    return;
  }

  const [group] = await db.delete(groupsTable)
    .where(and(
      eq(groupsTable.id, groupId),
      req.workspaceId ? eq(groupsTable.workspaceId, req.workspaceId) : undefined!
    ))
    .returning();

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  res.sendStatus(204);
});

// POST /groups/:id/members - requires "groups.manage" OR "groups.<id>.manage"
router.post("/groups/:id/members", requireAuth, requirePermission(req => [
  "groups.manage",
  `groups.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(groupId)) {
    res.status(400).json({ error: "Invalid group ID" });
    return;
  }

  const { userId, isOwner = false } = req.body;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(groupsTable)
    .where(and(
      eq(groupsTable.id, groupId),
      req.workspaceId ? eq(groupsTable.workspaceId, req.workspaceId) : undefined!
    ));

  if (!existing) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  await db.insert(groupMembersTable).values({ groupId, userId, isOwner }).onConflictDoNothing();

  res.status(201).json({ success: true });
});

// DELETE /groups/:id/members/:userId - requires "groups.manage" OR "groups.<id>.manage"
router.delete("/groups/:id/members/:userId", requireAuth, requirePermission(req => [
  "groups.manage",
  `groups.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id ?? ""), 10);
  const userId = parseInt(String(req.params.userId ?? ""), 10);
  if (isNaN(groupId) || isNaN(userId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  await db.delete(groupMembersTable)
    .where(and(
      eq(groupMembersTable.groupId, groupId),
      eq(groupMembersTable.userId, userId)
    ));

  res.sendStatus(204);
});

export default router;
