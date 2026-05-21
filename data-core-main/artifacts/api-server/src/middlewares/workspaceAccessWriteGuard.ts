/**
 * @file   workspaceAccessWriteGuard.ts
 * @phase  P16-E - Block tenant operational writes when workspace is read-only
 *
 * Coverage: mounted globally after requireDatabase on workspace operational routes.
 * Exempt: platform admin, auth, setup, health, tenant billing read/download.
 * Does NOT block GET/HEAD/OPTIONS.
 */

import jwt from "jsonwebtoken";
import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { activityLogsTable } from "@workspace/db";
import { JWT_SECRET, type AuthRequest } from "./requireAuth";
import {
  assertWorkspaceCanWrite,
  WorkspaceWriteBlockedError,
} from "../lib/workspace-access-resolver";
import type { WorkspaceWriteAction } from "../lib/workspace-access-enforcement-config";

const EXEMPT_PREFIXES = [
  "/platform/",
  "/auth/",
  "/setup",
  "/health",
  "/tenant/billing/",
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

function actionForMethod(method: string): WorkspaceWriteAction {
  if (method === "POST") return "create";
  if (method === "DELETE") return "delete";
  return "update";
}

interface JwtPayload {
  userId: number;
  workspaceId: number | null;
  role: string;
}

async function auditBlockedWrite(
  actorId: number | undefined,
  workspaceId: number,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId: actorId ?? null,
    workspaceId,
    action: "workspace_write_blocked_read_only",
    metadata: JSON.stringify({
      ...meta,
      actorId,
      workspaceId,
      tenantId: workspaceId,
      timestamp: new Date().toISOString(),
    }),
  });
}

export async function workspaceAccessWriteGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const method = req.method.toUpperCase();
  if (!WRITE_METHODS.has(method)) {
    next();
    return;
  }

  const path = req.path;
  if (isExemptPath(path)) {
    next();
    return;
  }

  const authReq = req as AuthRequest;
  let workspaceId = authReq.workspaceId;
  let userId = authReq.userId;
  let role = authReq.userRole;

  if (!workspaceId || !userId) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      next();
      return;
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      workspaceId = payload.workspaceId ?? undefined;
      userId = payload.userId;
      role = payload.role;
    } catch {
      next();
      return;
    }
  }

  if (!workspaceId) {
    next();
    return;
  }

  if (role === "super_admin") {
    next();
    return;
  }

  const action = actionForMethod(method);

  try {
    await assertWorkspaceCanWrite(workspaceId, action);
    next();
  } catch (err) {
    if (err instanceof WorkspaceWriteBlockedError) {
      await auditBlockedWrite(userId, workspaceId, {
        actionBlocked: action,
        route: `${method} ${path}`,
        enforcementStatus: err.enforcementStatus,
        code: err.code,
      });
      res.status(403).json({
        error: err.message,
        code: err.code,
        enforcementStatus: err.enforcementStatus,
      });
      return;
    }
    next(err);
  }
}

/**
 * APIs not covered by global guard (mounted before guard or public):
 * - /setup, /auth/*, /health
 * - /platform/* (platform administration)
 * - /tenant/billing/* (read-only invoice portal)
 *
 * Operational APIs covered (write methods only):
 * - /tickets, /users, /departments, /groups, /messages, /comments,
 *   /notifications, /approvals, /activity, /calendar, /workflows,
 *   /governance, /forms, /hr, /leave, /storage, /events, /modules,
 *   /dashboard (if mutating), /workspaces, /invitations, /admin,
 *   /datasources, /stream (if mutating)
 */
