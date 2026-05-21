/**
 * platform-users.ts
 *
 * @phase P14-A/P14-B - Platform user foundation & roles
 * @phase P17-A - Platform User Directory & Lifecycle
 *
 * Routes:
 *   GET    /platform/users                      - list (search/filter/pagination)
 *   GET    /platform/users/:userId              - get single
 *   POST   /platform/users                      - create
 *   PATCH  /platform/users/:userId              - basic profile only
 *   PATCH  /platform/users/:userId/status       - disable/suspend/reactivate
 *   PATCH  /platform/users/:userId/role         - role change (P14-B, unchanged)
 *
 * No DELETE, password reset, MFA, SSO, tenant/workspace users.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, activityLogsTable } from "@workspace/db";
import {
  eq,
  isNull,
  and,
  or,
  ilike,
  desc,
} from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  isRootPlatformOwner,
  isProtectedPlatformAccount,
  buildBlockedPlatformUserActionAuditEvent,
  canManagePlatformUser,
  canAssignPlatformRole,
  validatePlatformUserStatusChange,
  type PlatformUserIdentity,
} from "../lib/root-platform-owner-policy";
import { isAssignablePlatformRoleCode } from "../lib/platform-permissions";
import {
  hasPlatformPermission,
  type PlatformUserPermissionIdentity,
} from "../lib/platform-permissions";
import {
  PLATFORM_USER_TYPES,
  type PlatformUserType,
} from "../lib/platform-user-directory-config";
import {
  validatePlatformUserDirectoryCreate,
  validatePlatformUserProfileUpdate,
  resolveStatusPermission,
  resolveStatusAuditAction,
  buildPlatformUserLifecycleAuditMetadata,
} from "../lib/platform-user-lifecycle";
import { resolveStatusProtectionAction } from "../lib/platform-admin-protection-evaluator";
import { evaluateAndAuditPlatformProtection } from "../lib/platform-protection-integration";
import { isProtectedPlatformAdminUser } from "../lib/platform-protected-user";

const router: IRouter = Router();

interface PlatformUserRow {
  id: number;
  email: string | null;
  fullName: string;
  role: string;
  status: string;
  workspaceId: number | null;
  platformRoleCode: string | null;
  isRootOwner: boolean;
  isProtected: boolean;
  lastLoginAt: Date | null;
  platformJobTitle: string | null;
  platformDepartment: string | null;
  platformPhone: string | null;
  platformUserType: string | null;
  platformCreatedBy: number | null;
  platformUpdatedBy: number | null;
  platformDisabledBy: number | null;
  platformDisabledAt: Date | null;
  platformDisableReason: string | null;
  platformReactivatedBy: number | null;
  platformReactivatedAt: Date | null;
  platformReactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PLATFORM_USER_SELECT = {
  id: usersTable.id,
  email: usersTable.email,
  fullName: usersTable.fullName,
  role: usersTable.role,
  status: usersTable.status,
  workspaceId: usersTable.workspaceId,
  platformRoleCode: usersTable.platformRoleCode,
  isRootOwner: usersTable.isRootOwner,
  isProtected: usersTable.isProtected,
  lastLoginAt: usersTable.lastLoginAt,
  platformJobTitle: usersTable.platformJobTitle,
  platformDepartment: usersTable.platformDepartment,
  platformPhone: usersTable.platformPhone,
  platformUserType: usersTable.platformUserType,
  platformCreatedBy: usersTable.platformCreatedBy,
  platformUpdatedBy: usersTable.platformUpdatedBy,
  platformDisabledBy: usersTable.platformDisabledBy,
  platformDisabledAt: usersTable.platformDisabledAt,
  platformDisableReason: usersTable.platformDisableReason,
  platformReactivatedBy: usersTable.platformReactivatedBy,
  platformReactivatedAt: usersTable.platformReactivatedAt,
  platformReactivationReason: usersTable.platformReactivationReason,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
};

function inferUserType(user: PlatformUserRow): PlatformUserType {
  if (user.platformUserType && PLATFORM_USER_TYPES.includes(user.platformUserType as PlatformUserType)) {
    return user.platformUserType as PlatformUserType;
  }
  if (isRootPlatformOwner(user)) return "platform_owner";
  if (user.platformRoleCode === "platform_admin") return "platform_admin";
  return "platform_operator";
}

function buildPlatformUserProfile(user: PlatformUserRow) {
  const isRoot = isRootPlatformOwner(user);
  const isProtected =
    isProtectedPlatformAccount(user) ||
    isProtectedPlatformAdminUser({
      ...user,
      platformUserType: user.platformUserType,
      status: user.status,
    });
  const userType = inferUserType(user);

  return {
    id: String(user.id),
    email: user.email,
    displayName: user.fullName,
    userType,
    roleCode: isRoot ? "root_platform_owner" : (user.platformRoleCode ?? "platform_admin"),
    status: user.status,
    jobTitle: user.platformJobTitle,
    department: user.platformDepartment,
    phone: user.platformPhone,
    isRootOwner: isRoot,
    isProtected,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    disabledAt: user.platformDisabledAt?.toISOString() ?? null,
    disableReason: user.platformDisableReason,
    reactivatedAt: user.platformReactivatedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function getActorIdentity(actorId: number): Promise<PlatformUserIdentity & { platformUserType?: string | null; status?: string } | null> {
  const [actor] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  return actor ?? null;
}

async function writeAuditLog(
  actorId: number | undefined,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(activityLogsTable).values({
    userId: actorId ?? null,
    action,
    metadata: JSON.stringify(metadata),
    workspaceId: null,
  });
}


function actorHasStatusPermission(
  actor: PlatformUserPermissionIdentity,
  nextStatus: string,
): boolean {
  const required = resolveStatusPermission(nextStatus);
  if (hasPlatformPermission(actor, required)) return true;
  if (hasPlatformPermission(actor, "platform.users.status.update")) return true;
  return false;
}

function parseListQuery(req: AuthRequest) {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const userType = typeof req.query.userType === "string" ? req.query.userType.trim() : "";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  return { search, status, userType, page, pageSize, offset: (page - 1) * pageSize };
}

// ── GET /platform/users ───────────────────────────────────────────────────────

router.get(
  "/platform/users",
  requireAuth,
  requirePlatformPermission("platform.users.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const { search, status, userType, page, pageSize, offset } = parseListQuery(req);

    const conditions = [isNull(usersTable.workspaceId)];
    if (status) conditions.push(eq(usersTable.status, status as "active"));
    if (search) {
      conditions.push(
        or(
          ilike(usersTable.email, `%${search}%`),
          ilike(usersTable.fullName, `%${search}%`),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const allRows = await db.select(PLATFORM_USER_SELECT).from(usersTable).where(whereClause).orderBy(desc(usersTable.createdAt));

    let filtered = allRows;
    if (userType) {
      filtered = allRows.filter((row) => inferUserType(row) === userType);
    }

    const total = filtered.length;
    const pageRows = filtered.slice(offset, offset + pageSize);
    const users = pageRows.map(buildPlatformUserProfile);

    res.json({ users, total, page, pageSize });
  },
);

// ── GET /platform/users/:userId ───────────────────────────────────────────────

router.get(
  "/platform/users/:userId",
  requireAuth,
  requirePlatformPermission("platform.users.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const [row] = await db
      .select(PLATFORM_USER_SELECT)
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));

    if (!row) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    res.json({ user: buildPlatformUserProfile(row) });
  },
);

// ── POST /platform/users ──────────────────────────────────────────────────────

router.post(
  "/platform/users",
  requireAuth,
  requirePlatformPermission("platform.users.create"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const actor = await getActorIdentity(actorId);
    if (!actor) {
      res.status(401).json({ error: "Actor not found" });
      return;
    }

    const body = req.body as {
      email?: string;
      displayName?: string;
      userType?: string;
      roleCode?: string;
      jobTitle?: string;
      department?: string;
      phone?: string;
    };

    const validation = validatePlatformUserDirectoryCreate(actor, body);
    if (!validation.valid) {
      if (validation.errors.includes("ROOT_ROLE_ASSIGNMENT_BLOCKED") || validation.errors.includes("PLATFORM_OWNER_CREATE_BLOCKED")) {
        await writeAuditLog(actorId, "platform_user_create_blocked", buildPlatformUserLifecycleAuditMetadata({
          actorId,
          email: body.email,
          reason: validation.errors[0],
        }));
        res.status(403).json({ error: "Cannot create platform owner via API", code: validation.errors[0] });
        return;
      }
      res.status(400).json({ error: "Validation failed", codes: validation.errors });
      return;
    }

    const normalizedEmail = validation.normalizedEmail!;
    const roleCode = validation.roleCode!;
    const userType = validation.userType ?? (roleCode === "platform_admin" ? "platform_admin" : "platform_operator");

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));

    if (existing) {
      res.status(409).json({ error: "A user with this email already exists", code: "DUPLICATE_EMAIL" });
      return;
    }

    const [created] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        fullName: body.displayName!.trim(),
        role: "super_admin",
        status: "invited",
        platformRoleCode: roleCode,
        platformUserType: userType,
        platformJobTitle: body.jobTitle?.trim() || null,
        platformDepartment: body.department?.trim() || null,
        platformPhone: body.phone?.trim() || null,
        platformCreatedBy: actorId,
        isRootOwner: false,
        isProtected: false,
        workspaceId: null,
      })
      .returning(PLATFORM_USER_SELECT);

    if (!created) {
      res.status(500).json({ error: "Failed to create platform user" });
      return;
    }

    await writeAuditLog(actorId, "platform_user_created", buildPlatformUserLifecycleAuditMetadata({
      actorId,
      targetPlatformUserId: created.id,
      email: normalizedEmail,
      userType,
    }));

    res.status(201).json({ user: buildPlatformUserProfile(created) });
  },
);

// ── PATCH /platform/users/:userId ─────────────────────────────────────────────

router.patch(
  "/platform/users/:userId",
  requireAuth,
  requirePlatformPermission("platform.users.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const actor = await getActorIdentity(actorId);
    if (!actor) {
      res.status(401).json({ error: "Actor not found" });
      return;
    }

    const [row] = await db
      .select(PLATFORM_USER_SELECT)
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));

    if (!row) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const targetUser: PlatformUserIdentity = {
      id: row.id,
      email: row.email,
      role: row.role,
      workspaceId: row.workspaceId,
      platformRoleCode: row.platformRoleCode,
      isRootOwner: row.isRootOwner,
      isProtected: row.isProtected,
    };

    const manageCheck = canManagePlatformUser(actor, targetUser);
    if (!manageCheck.allowed) {
      res.status(403).json({
        error: manageCheck.blockedReason ?? "Cannot manage this user",
        code: manageCheck.blockedReason,
      });
      return;
    }

    const payload = req.body as {
      displayName?: string;
      jobTitle?: string | null;
      department?: string | null;
      phone?: string | null;
      email?: string;
      isRootOwner?: boolean;
    };

    if (payload.isRootOwner !== undefined) {
      const rootFlagBlock = await evaluateAndAuditPlatformProtection({
        action: "update_root_owner_flag",
        actor,
        target: {
          id: row.id,
          email: row.email,
          role: row.role,
          workspaceId: row.workspaceId,
          platformRoleCode: row.platformRoleCode,
          isRootOwner: row.isRootOwner,
          isProtected: row.isProtected,
          platformUserType: row.platformUserType,
        },
        actorId,
        payload: { isRootOwner: payload.isRootOwner },
      });
      if (!rootFlagBlock.allowed) {
        res.status(403).json({
          error: "Root owner flag cannot be changed",
          code: rootFlagBlock.blockedReason,
        });
        return;
      }
    }

    const validation = validatePlatformUserProfileUpdate(payload);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", codes: validation.errors });
      return;
    }

    const updates: Partial<typeof usersTable.$inferInsert> = {
      platformUpdatedBy: actorId,
      updatedAt: new Date(),
    };
    if (payload.displayName !== undefined) updates.fullName = payload.displayName.trim();
    if (payload.jobTitle !== undefined) updates.platformJobTitle = payload.jobTitle?.trim() || null;
    if (payload.department !== undefined) updates.platformDepartment = payload.department?.trim() || null;
    if (payload.phone !== undefined) updates.platformPhone = payload.phone?.trim() || null;

    await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

    await writeAuditLog(actorId, "platform_user_profile_updated", buildPlatformUserLifecycleAuditMetadata({
      actorId,
      targetPlatformUserId: userId,
      email: row.email,
      userType: inferUserType(row),
    }));

    const [updated] = await db.select(PLATFORM_USER_SELECT).from(usersTable).where(eq(usersTable.id, userId));
    res.json({ user: buildPlatformUserProfile(updated!) });
  },
);

// ── PATCH /platform/users/:userId/status ─────────────────────────────────────

router.patch(
  "/platform/users/:userId/status",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const { nextStatus, reason, confirmation } = req.body as {
      nextStatus?: string;
      reason?: string;
      confirmation?: boolean;
    };

    const actorPermIdentity: PlatformUserPermissionIdentity = {
      role: req.userRole ?? "",
      platformRoleCode: req.platformRoleCode,
      isRootOwner: req.isRootOwner,
    };

    if (!nextStatus || !actorHasStatusPermission(actorPermIdentity, nextStatus)) {
      res.status(403).json({ error: "Insufficient permission for status change", code: "PERMISSION_DENIED" });
      return;
    }

    const actor = await getActorIdentity(actorId);
    if (!actor) {
      res.status(401).json({ error: "Actor not found" });
      return;
    }

    const [row] = await db
      .select(PLATFORM_USER_SELECT)
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));

    if (!row) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const targetUser: PlatformUserIdentity & { platformUserType?: string | null; status?: string } = {
      id: row.id,
      email: row.email,
      role: row.role,
      workspaceId: row.workspaceId,
      platformRoleCode: row.platformRoleCode,
      isRootOwner: row.isRootOwner,
      isProtected: row.isProtected,
      platformUserType: row.platformUserType,
      status: row.status,
    };

    const protectionAction = resolveStatusProtectionAction(nextStatus!);
    const protection = await evaluateAndAuditPlatformProtection({
      action: protectionAction,
      actor,
      target: targetUser,
      actorId,
      payload: { nextStatus, reason, confirmation },
    });
    if (!protection.allowed) {
      res.status(403).json({
        error: "Status change blocked by protection policy",
        code: protection.blockedReason,
        severity: protection.severity,
        requiredReason: protection.requiredReason,
      });
      return;
    }

    const legacyValidation = validatePlatformUserStatusChange(actor, targetUser, {
      nextStatus,
      reason,
      confirmation,
    });

    if (!legacyValidation.valid && !legacyValidation.errors.includes("UNKNOWN_STATUS")) {
      const blockedReason = legacyValidation.errors[0] ?? "VALIDATION_FAILED";
      res.status(400).json({ error: "Validation failed", codes: legacyValidation.errors });
      return;
    }

    if (nextStatus && !["invited", "active", "disabled", "suspended", "locked"].includes(nextStatus)) {
      res.status(400).json({ error: "Validation failed", codes: ["UNKNOWN_STATUS"] });
      return;
    }

    const previousStatus = row.status;
    const now = new Date();
    const statusUpdate: Partial<typeof usersTable.$inferInsert> = {
      status: nextStatus as "active" | "disabled" | "suspended" | "locked",
      updatedAt: now,
    };

    if (nextStatus === "active") {
      statusUpdate.platformReactivatedBy = actorId;
      statusUpdate.platformReactivatedAt = now;
      statusUpdate.platformReactivationReason = reason!.trim();
    } else if (nextStatus === "disabled" || nextStatus === "suspended" || nextStatus === "locked") {
      statusUpdate.platformDisabledBy = actorId;
      statusUpdate.platformDisabledAt = now;
      statusUpdate.platformDisableReason = reason!.trim();
    }

    await db.update(usersTable).set(statusUpdate).where(eq(usersTable.id, userId));

    const auditAction = resolveStatusAuditAction(nextStatus!);
    await writeAuditLog(actorId, auditAction, buildPlatformUserLifecycleAuditMetadata({
      actorId,
      targetPlatformUserId: userId,
      email: row.email,
      previousStatus,
      nextStatus,
      userType: inferUserType(row),
      reason,
    }));

    const [updated] = await db.select(PLATFORM_USER_SELECT).from(usersTable).where(eq(usersTable.id, userId));
    res.json({
      user: buildPlatformUserProfile(updated!),
      previousStatus,
      nextStatus,
    });
  },
);

// ── PATCH /platform/users/:userId/role (P14-B) ────────────────────────────────

router.patch(
  "/platform/users/:userId/role",
  requireAuth,
  requirePlatformPermission("platform.users.role.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const actor = await getActorIdentity(actorId);
    if (!actor) {
      res.status(401).json({ error: "Actor not found" });
      return;
    }

    const [row] = await db
      .select(PLATFORM_USER_SELECT)
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));

    if (!row) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const targetUser: PlatformUserIdentity = {
      id: row.id,
      email: row.email,
      role: row.role,
      workspaceId: row.workspaceId,
      platformRoleCode: row.platformRoleCode,
      isRootOwner: row.isRootOwner,
      isProtected: row.isProtected,
    };

    const { roleCode, reason, confirmation } = req.body as {
      roleCode?: string;
      reason?: string;
      confirmation?: boolean;
    };

    if (!roleCode || typeof roleCode !== "string") {
      res.status(400).json({ error: "roleCode is required", code: "MISSING_ROLE_CODE" });
      return;
    }

    if (!isAssignablePlatformRoleCode(roleCode)) {
      const blockedReason = roleCode === "root_platform_owner"
        ? "ROOT_ROLE_ASSIGNMENT_BLOCKED"
        : "INVALID_ROLE_CODE";
      if (blockedReason === "ROOT_ROLE_ASSIGNMENT_BLOCKED") {
        await writeAuditLog(actorId, "platform_user_role_change_blocked", { actorId, targetUserId: userId, blockedReason });
        res.status(403).json({ error: "Cannot assign root_platform_owner role via API", code: blockedReason });
        return;
      }
      res.status(400).json({ error: `Invalid roleCode: "${roleCode}"`, code: "INVALID_ROLE_CODE" });
      return;
    }

    if (!reason || reason.trim().length < 10) {
      res.status(400).json({ error: "reason is required and must be at least 10 characters", code: "REASON_TOO_SHORT" });
      return;
    }

    if (confirmation !== true) {
      res.status(400).json({ error: "confirmation must be true", code: "CONFIRMATION_REQUIRED" });
      return;
    }

    const roleProtection = await evaluateAndAuditPlatformProtection({
      action: "change_role",
      actor,
      target: { ...targetUser, platformUserType: row.platformUserType, status: row.status },
      actorId,
      payload: { nextRoleCode: roleCode, reason, confirmation },
    });
    if (!roleProtection.allowed) {
      res.status(403).json({
        error: "Role change blocked by protection policy",
        code: roleProtection.blockedReason,
        severity: roleProtection.severity,
      });
      return;
    }

    const manageCheck = canManagePlatformUser(actor, targetUser);
    if (!manageCheck.allowed) {
      res.status(403).json({ error: manageCheck.blockedReason ?? "Cannot manage this user", code: manageCheck.blockedReason });
      return;
    }

    const assignCheck = canAssignPlatformRole(actor, roleCode);
    if (!assignCheck.allowed) {
      res.status(403).json({ error: assignCheck.blockedReason ?? "Cannot assign this role", code: assignCheck.blockedReason });
      return;
    }

    const previousRoleCode = row.platformRoleCode;
    const userType: PlatformUserType =
      roleCode === "platform_admin" ? "platform_admin" : "platform_operator";

    await db
      .update(usersTable)
      .set({
        platformRoleCode: roleCode,
        platformUserType: userType,
        platformUpdatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    await writeAuditLog(actorId, "platform_user_role_changed", {
      actorId,
      targetUserId: userId,
      targetEmail: row.email,
      previousRoleCode,
      nextRoleCode: roleCode,
      reason,
      result: "success",
    });

    const [updated] = await db.select(PLATFORM_USER_SELECT).from(usersTable).where(eq(usersTable.id, userId));
    res.json({
      user: buildPlatformUserProfile(updated!),
      previousRoleCode,
      nextRoleCode: roleCode,
    });
  },
);

export default router;
