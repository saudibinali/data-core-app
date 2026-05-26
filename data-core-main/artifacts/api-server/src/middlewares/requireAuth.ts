import jwt from "jsonwebtoken";
import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { JWT_SECRET } from "../lib/security-config";
import { evaluatePolicy } from "@workspace/core-permissions";
import { isWorkspaceRbacStrict } from "../lib/workspace-rbac-config";
import { setWorkspaceRlsSessionContext } from "./workspace-rls-context";
import { recordPlatformTenantAccessIfNeeded } from "../lib/platform-tenant-access-audit";
import { usersTable, workspaceRolePermissionsTable, activityLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  hasPlatformPermission,
  hasAnyPlatformPermission,
  type PlatformPermissionCode,
  type PlatformUserPermissionIdentity,
} from "../lib/platform-permissions";
import {
  hasEffectivePlatformPermission,
  resolveActorEffectivePermissionSet,
} from "../lib/platform-effective-permissions";

export { JWT_SECRET };

export interface AuthRequest extends Request {
  userId?: number;
  workspaceId?: number;
  userRole?: string;
  customRoleId?: number;
  userPermissions?: string[];
  platformRoleCode?: string | null;
  isRootOwner?: boolean;
  /** P17-B: cached effective platform permissions for this request */
  platformEffectivePermissions?: Set<PlatformPermissionCode>;
  /** @deprecated kept for compatibility - will be removed */
  clerkId?: string;
}

interface JwtPayload {
  userId: number;
  workspaceId: number | null;
  role: string;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      workspaceId: usersTable.workspaceId,
      role: usersTable.role,
      customRoleId: usersTable.customRoleId,
      status: usersTable.status,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
    })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (user.status === "inactive" || user.status === "disabled" || user.status === "suspended" || user.status === "locked") {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  req.userId = user.id;
  req.workspaceId = user.workspaceId ?? undefined;
  req.userRole = user.role;
  req.customRoleId = user.customRoleId ?? undefined;
  req.platformRoleCode = user.platformRoleCode;
  req.isRootOwner = user.isRootOwner;

  if (user.role === "member" && user.customRoleId) {
    const perms = await db
      .select({ permission: workspaceRolePermissionsTable.permission })
      .from(workspaceRolePermissionsTable)
      .where(eq(workspaceRolePermissionsTable.customRoleId, user.customRoleId));
    req.userPermissions = perms.map(p => p.permission);
  } else {
    req.userPermissions = [];
  }

  await setWorkspaceRlsSessionContext(req);
  recordPlatformTenantAccessIfNeeded(req);

  next();
};

export const requireWorkspaceAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.userRole || !["admin", "super_admin"].includes(req.userRole)) {
    res.status(403).json({ error: "Requires admin role" });
    return;
  }
  next();
};

export const requireSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (req.userRole !== "super_admin") {
    res.status(403).json({ error: "Requires super_admin role" });
    return;
  }
  next();
};

export const requirePermission = (
  keyOrFn: string | ((req: AuthRequest) => string | string[])
) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.userRole;

    if (!role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const resolved = typeof keyOrFn === "function" ? keyOrFn(req) : keyOrFn;
    const keys = Array.isArray(resolved) ? resolved : [resolved];

    for (const key of keys) {
      const result = evaluatePolicy(
        {
          actor: {
            userId: req.userId!,
            workspaceId: req.workspaceId ?? null,
            role: role as "super_admin" | "admin" | "manager" | "member",
          },
          permission: key as never,
        },
        {
          customPermissions: req.userPermissions,
          strictWorkspaceRbac: isWorkspaceRbacStrict(),
        },
      );
      if (result.granted) {
        next();
        return;
      }
    }

    res.status(403).json({ error: "Permission denied", required: keys[0] });
  };

// ── Platform Permission Middleware ────────────────────────────────────────────

/** Fire-and-forget audit write for permission denials. */
async function writePlatformPermissionDeniedAudit(
  actorId: number | undefined,
  permissionCode: PlatformPermissionCode,
  effectiveRoleCode: string | null,
): Promise<void> {
  try {
    await db.insert(activityLogsTable).values({
      userId: actorId ?? null,
      action: "platform_permission_denied",
      metadata: JSON.stringify({ permissionCode, effectiveRoleCode, action: "permission_check", result: "denied" }),
      workspaceId: null,
    });
  } catch {
    // Non-fatal - audit failure must not break the response
  }
}

/**
 * requirePlatformPermission(permissionCode)
 *
 * Middleware factory that gates a route on a specific platform permission.
 *
 * Must be used AFTER requireAuth (depends on req.userId, req.userRole,
 * req.platformRoleCode, req.isRootOwner being set).
 *
 * Legacy root user (role = "super_admin", platformRoleCode = null, isRootOwner = false)
 * is automatically granted ALL permissions for backward compatibility.
 *
 * Replaces requireSuperAdmin on platform administration routes.
 * requireSuperAdmin is kept for backward compatibility with other routes.
 */
async function getRequestActorEffectivePermissions(
  req: AuthRequest,
): Promise<Set<PlatformPermissionCode>> {
  if (req.platformEffectivePermissions) return req.platformEffectivePermissions;
  if (!req.userId || req.userRole !== "super_admin") return new Set();
  const set = await resolveActorEffectivePermissionSet(req.userId);
  req.platformEffectivePermissions = set;
  return set;
}

export function requirePlatformPermission(permissionCode: PlatformPermissionCode) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.userRole !== "super_admin") {
      res.status(403).json({
        error: "Platform administration access required",
        code: "NOT_PLATFORM_USER",
      });
      return;
    }

    const actor: PlatformUserPermissionIdentity = {
      id: req.userId,
      role: req.userRole,
      platformRoleCode: req.platformRoleCode,
      isRootOwner: req.isRootOwner,
    };

    const effective = await getRequestActorEffectivePermissions(req);
    const allowed =
      effective.size > 0
        ? hasEffectivePlatformPermission(effective, permissionCode)
        : hasPlatformPermission(actor, permissionCode);

    if (!allowed) {
      req.log.warn({
        event: "platform_permission_denied",
        actorId: req.userId,
        permissionCode,
        platformRoleCode: req.platformRoleCode ?? "legacy_root",
      });

      void writePlatformPermissionDeniedAudit(
        req.userId,
        permissionCode,
        req.platformRoleCode ?? null,
      );

      res.status(403).json({
        error: "Insufficient platform permissions",
        code: "PERMISSION_DENIED",
        required: permissionCode,
      });
      return;
    }

    next();
  };
}

/**
 * requireAnyPlatformPermission(permissionCodes)
 *
 * Gates a route on having at least one of the given platform permissions.
 */
export function requireAnyPlatformPermission(permissionCodes: PlatformPermissionCode[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.userRole !== "super_admin") {
      res.status(403).json({
        error: "Platform administration access required",
        code: "NOT_PLATFORM_USER",
      });
      return;
    }

    const actor: PlatformUserPermissionIdentity = {
      id: req.userId,
      role: req.userRole,
      platformRoleCode: req.platformRoleCode,
      isRootOwner: req.isRootOwner,
    };

    const effective = await getRequestActorEffectivePermissions(req);
    const allowed =
      effective.size > 0
        ? permissionCodes.some((c) => hasEffectivePlatformPermission(effective, c))
        : hasAnyPlatformPermission(actor, permissionCodes);

    if (!allowed) {
      req.log.warn({
        event: "platform_permission_denied",
        actorId: req.userId,
        permissionCodes,
        platformRoleCode: req.platformRoleCode ?? "legacy_root",
      });

      void writePlatformPermissionDeniedAudit(
        req.userId,
        permissionCodes[0]!,
        req.platformRoleCode ?? null,
      );

      res.status(403).json({
        error: "Insufficient platform permissions",
        code: "PERMISSION_DENIED",
        required: permissionCodes,
      });
      return;
    }

    next();
  };
}
