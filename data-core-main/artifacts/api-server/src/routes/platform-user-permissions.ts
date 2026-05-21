/**
 * @phase P17-B - Custom platform permission assignment APIs
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  activityLogsTable,
  platformUserPermissionOverridesTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  PLATFORM_PERMISSION_CONFIG,
  PLATFORM_PERMISSION_CODES,
  type PlatformPermissionCode,
} from "../lib/platform-permissions";
import {
  resolvePlatformUserEffectivePermissions,
  resolveActorEffectivePermissionSet,
  isPlatformPermissionCatalogCode,
} from "../lib/platform-effective-permissions";
import {
  validateOverrideChange,
  validateOverrideReason,
  buildPermissionOverrideAuditMetadata,
  canActorModifyTargetOverrides,
} from "../lib/platform-permission-override-policy";
import { isRootPlatformOwner, type PlatformUserIdentity } from "../lib/root-platform-owner-policy";
import { evaluateAndAuditPlatformProtection } from "../lib/platform-protection-integration";
import { countActivePlatformOwners } from "../lib/platform-owner-counts";

const router: IRouter = Router();

async function writeAudit(actorId: number | undefined, action: string, metadata: Record<string, unknown>) {
  await db.insert(activityLogsTable).values({
    userId: actorId ?? null,
    action,
    metadata: JSON.stringify(metadata),
    workspaceId: null,
  });
}

async function getActorIdentity(actorId: number): Promise<PlatformUserIdentity | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
    })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  return row ?? null;
}

async function getPlatformUserIdentity(userId: number) {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));
  return row ?? null;
}

async function runOverrideProtection(
  actorId: number,
  actor: PlatformUserIdentity,
  target: PlatformUserIdentity & { platformUserType?: string | null },
  action: "update_permission_override" | "bulk_update_permission_overrides" | "clear_permission_override",
  payload: { permissionCode?: string; effect?: "grant" | "deny"; reason?: string },
): Promise<{ ok: true } | { ok: false; code: string; severity: string }> {
  const evaluation = await evaluateAndAuditPlatformProtection({
    action,
    actor,
    target,
    actorId,
    payload: { ...payload, confirmation: true },
  });
  if (!evaluation.allowed) {
    return { ok: false, code: evaluation.blockedReason, severity: evaluation.severity };
  }
  return { ok: true };
}

// GET /platform/permissions/catalog
router.get(
  "/platform/permissions/catalog",
  requireAuth,
  requirePlatformPermission("platform.permissions.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const permissions = PLATFORM_PERMISSION_CODES.map((code) => ({
      code,
      ...PLATFORM_PERMISSION_CONFIG[code],
    }));
    const groups = [...new Set(permissions.map((p) => p.group))].map((group) => ({
      group,
      permissions: permissions.filter((p) => p.group === group),
    }));
    res.json({ permissions, groups, total: permissions.length });
  },
);

// GET /platform/users/:userId/permissions
router.get(
  "/platform/users/:userId/permissions",
  requireAuth,
  requirePlatformPermission("platform.permissions.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const resolved = await resolvePlatformUserEffectivePermissions(userId);
    if (!resolved) {
      res.status(404).json({ error: "Platform user not found", code: "NOT_PLATFORM_USER" });
      return;
    }

    const activeOverrides = await db
      .select()
      .from(platformUserPermissionOverridesTable)
      .where(
        and(
          eq(platformUserPermissionOverridesTable.platformUserId, userId),
          isNull(platformUserPermissionOverridesTable.removedAt),
        ),
      );

    res.json({
      ...resolved,
      overrides: activeOverrides.map((o) => ({
        id: o.id,
        permissionCode: o.permissionCode,
        effect: o.effect,
        reason: o.reason,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
    });
  },
);

// PUT bulk overrides
router.put(
  "/platform/users/:userId/permissions/overrides",
  requireAuth,
  requirePlatformPermission("platform.permissions.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const { reason, overrides } = req.body as {
      reason?: string;
      overrides?: Array<{ permissionCode: string; effect: "grant" | "deny" }>;
    };

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const reasonErr = validateOverrideReason(reason);
    if (reasonErr) {
      res.status(400).json({ error: "Validation failed", codes: [reasonErr] });
      return;
    }

    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: "overrides array required" });
      return;
    }

    const actor = await getActorIdentity(actorId);
    const target = await getPlatformUserIdentity(userId);
    if (!actor || !target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const actorEffective = await resolveActorEffectivePermissionSet(actorId);
    const { activePlatformOwnerCount } = await countActivePlatformOwners();

    for (const change of overrides) {
      const protection = await runOverrideProtection(
        actorId,
        actor,
        target,
        "bulk_update_permission_overrides",
        { permissionCode: change.permissionCode, effect: change.effect, reason },
      );
      if (!protection.ok) {
        res.status(403).json({ error: "Override blocked by protection policy", code: protection.code });
        return;
      }
      const validation = validateOverrideChange(actor, target, actorEffective, change, {
        activeOwnerCount: activePlatformOwnerCount,
        reason,
      });
      if (!validation.valid) {
        await writeAudit(actorId, "platform_permission_change_blocked", {
          ...buildPermissionOverrideAuditMetadata({
            actorId,
            targetPlatformUserId: userId,
            permissionCode: change.permissionCode,
            effect: change.effect,
            reason,
          }),
          blockedReason: validation.errors[0],
        });
        res.status(403).json({ error: "Override blocked", codes: validation.errors });
        return;
      }
    }

    await db
      .update(platformUserPermissionOverridesTable)
      .set({
        removedAt: new Date(),
        removedBy: actorId,
        removeReason: `Bulk replace: ${reason!.trim()}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformUserPermissionOverridesTable.platformUserId, userId),
          isNull(platformUserPermissionOverridesTable.removedAt),
        ),
      );

    for (const change of overrides) {
      await db.insert(platformUserPermissionOverridesTable).values({
        platformUserId: userId,
        permissionCode: change.permissionCode,
        effect: change.effect,
        reason: reason!.trim(),
        createdBy: actorId,
        updatedBy: actorId,
      });
    }

    await writeAudit(actorId, "platform_permission_overrides_bulk_updated", {
      ...buildPermissionOverrideAuditMetadata({
        actorId,
        targetPlatformUserId: userId,
        reason,
      }),
      overrideCount: overrides.length,
    });

    const resolved = await resolvePlatformUserEffectivePermissions(userId);
    res.json({ success: true, ...resolved });
  },
);

// PATCH single override
router.patch(
  "/platform/users/:userId/permissions/overrides/:permissionCode",
  requireAuth,
  requirePlatformPermission("platform.permissions.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const permissionCode = decodeURIComponent(String(req.params.permissionCode ?? ""));

    const { effect, reason } = req.body as { effect?: "grant" | "deny"; reason?: string };

    if (!userId || !effect) {
      res.status(400).json({ error: "userId and effect required" });
      return;
    }

    const actor = await getActorIdentity(actorId);
    const target = await getPlatformUserIdentity(userId);
    if (!actor || !target) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const protection = await runOverrideProtection(actorId, actor, target, "update_permission_override", {
      permissionCode,
      effect,
      reason,
    });
    if (!protection.ok) {
      res.status(403).json({ error: "Override blocked by protection policy", code: protection.code });
      return;
    }

    const { activePlatformOwnerCount } = await countActivePlatformOwners();
    const actorEffective = await resolveActorEffectivePermissionSet(actorId);
    const validation = validateOverrideChange(
      actor,
      target,
      actorEffective,
      { permissionCode, effect },
      { activeOwnerCount: activePlatformOwnerCount, reason },
    );

    if (!validation.valid) {
      await writeAudit(actorId, "platform_permission_change_blocked", {
        ...buildPermissionOverrideAuditMetadata({
          actorId,
          targetPlatformUserId: userId,
          permissionCode,
          effect,
          reason,
        }),
        blockedReason: validation.errors[0],
      });
      res.status(403).json({ error: "Override blocked", codes: validation.errors });
      return;
    }

    const [existing] = await db
      .select()
      .from(platformUserPermissionOverridesTable)
      .where(
        and(
          eq(platformUserPermissionOverridesTable.platformUserId, userId),
          eq(platformUserPermissionOverridesTable.permissionCode, permissionCode),
          isNull(platformUserPermissionOverridesTable.removedAt),
        ),
      );

    const previousEffect = existing?.effect ?? null;

    if (existing) {
      await db
        .update(platformUserPermissionOverridesTable)
        .set({
          effect,
          reason: reason!.trim(),
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(eq(platformUserPermissionOverridesTable.id, existing.id));
    } else {
      await db.insert(platformUserPermissionOverridesTable).values({
        platformUserId: userId,
        permissionCode,
        effect,
        reason: reason!.trim(),
        createdBy: actorId,
        updatedBy: actorId,
      });
    }

    const auditAction =
      effect === "grant" ? "platform_permission_override_granted" : "platform_permission_override_denied";

    await writeAudit(actorId, auditAction, buildPermissionOverrideAuditMetadata({
      actorId,
      targetPlatformUserId: userId,
      permissionCode,
      effect,
      previousEffect,
      nextEffect: effect,
      reason,
    }));

    const resolved = await resolvePlatformUserEffectivePermissions(userId);
    res.json({ success: true, ...resolved });
  },
);

// DELETE (soft) single override
router.delete(
  "/platform/users/:userId/permissions/overrides/:permissionCode",
  requireAuth,
  requirePlatformPermission("platform.permissions.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const permissionCode = decodeURIComponent(String(req.params.permissionCode ?? ""));
    const { reason } = req.body as { reason?: string };

    const reasonErr = validateOverrideReason(reason);
    if (reasonErr) {
      res.status(400).json({ error: "Validation failed", codes: [reasonErr] });
      return;
    }

    const actor = await getActorIdentity(actorId);
    const target = await getPlatformUserIdentity(userId);
    if (!actor || !target) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const protection = await runOverrideProtection(actorId, actor, target, "clear_permission_override", {
      permissionCode,
      reason,
    });
    if (!protection.ok) {
      res.status(403).json({ error: "Override blocked by protection policy", code: protection.code });
      return;
    }

    const modifyCheck = canActorModifyTargetOverrides(actor, target);
    if (!modifyCheck.allowed) {
      await writeAudit(actorId, "platform_permission_change_blocked", {
        ...buildPermissionOverrideAuditMetadata({
          actorId,
          targetPlatformUserId: userId,
          permissionCode,
          reason,
        }),
        blockedReason: modifyCheck.blockedReason,
      });
      res.status(403).json({ error: "Blocked", code: modifyCheck.blockedReason });
      return;
    }

    if (!isPlatformPermissionCatalogCode(permissionCode)) {
      res.status(400).json({ error: "Unknown permission", code: "UNKNOWN_PERMISSION_CODE" });
      return;
    }

    const [existing] = await db
      .select()
      .from(platformUserPermissionOverridesTable)
      .where(
        and(
          eq(platformUserPermissionOverridesTable.platformUserId, userId),
          eq(platformUserPermissionOverridesTable.permissionCode, permissionCode),
          isNull(platformUserPermissionOverridesTable.removedAt),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Override not found" });
      return;
    }

    await db
      .update(platformUserPermissionOverridesTable)
      .set({
        removedAt: new Date(),
        removedBy: actorId,
        removeReason: reason!.trim(),
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(platformUserPermissionOverridesTable.id, existing.id));

    await writeAudit(actorId, "platform_permission_override_removed", buildPermissionOverrideAuditMetadata({
      actorId,
      targetPlatformUserId: userId,
      permissionCode,
      previousEffect: existing.effect,
      nextEffect: null,
      reason,
    }));

    const resolved = await resolvePlatformUserEffectivePermissions(userId);
    res.json({ success: true, ...resolved });
  },
);

export default router;
