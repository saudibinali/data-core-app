/**
 * @file   routes/commercial-activity.ts
 * @phase  P15-H - Tenant-scoped commercial activity (read-only)
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogsTable, usersTable, workspacesTable } from "@workspace/db";
import { and, desc, eq, like } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requireAnyPlatformPermission,
} from "../middlewares/requireAuth";
import { parseLimit } from "../lib/platform-activity-helpers";
import {
  COMMERCIAL_ACTIVITY_DEFAULT_LIMIT,
  COMMERCIAL_ACTIVITY_MAX_LIMIT,
  isCommercialActivityAction,
  toCommercialActivityItem,
} from "../lib/commercial-activity-helpers";

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/commercial-activity",
  requireAuth,
  requireSuperAdmin,
  requireAnyPlatformPermission(["platform.activity.read", "audit.read"]),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ws = await db.query.workspacesTable.findFirst({
      where: eq(workspacesTable.id, tenantId),
      columns: { id: true },
    });
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const limit = parseLimit(
      req.query.limit,
      COMMERCIAL_ACTIVITY_DEFAULT_LIMIT,
      COMMERCIAL_ACTIVITY_MAX_LIMIT,
    );

    const rows = await db
      .select({
        id: activityLogsTable.id,
        actorId: activityLogsTable.userId,
        actorEmail: usersTable.email,
        actorName: usersTable.fullName,
        action: activityLogsTable.action,
        metadata: activityLogsTable.metadata,
        createdAt: activityLogsTable.createdAt,
      })
      .from(activityLogsTable)
      .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
      .where(
        and(
          eq(activityLogsTable.workspaceId, tenantId),
          like(activityLogsTable.action, "commercial_%"),
        ),
      )
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit + 10);

    const items = rows
      .filter(r => isCommercialActivityAction(r.action))
      .slice(0, limit)
      .map(r => toCommercialActivityItem({
        id: r.id,
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        actorName: r.actorName,
        action: r.action,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }));

    res.json({ items, tenantId });
  },
);

export default router;
