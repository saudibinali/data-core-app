/**
 * platform-activity.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 * @phase P14-E - Platform Administration Users Console Finalization
 *                (helpers extracted to platform-activity-helpers.ts for testability)
 *
 * Routes:
 *   GET /platform/activity               - paginated platform audit log
 *   GET /platform/users/:userId/activity - activity for a specific platform user
 *
 * Safety:
 *   - read-only - no mutations, no deletions, no exports
 *   - requireAnyPlatformPermission(["platform.activity.read", "audit.read"])
 *   - metadata is always parsed and redacted before returning
 *   - no secrets in response
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogsTable, usersTable } from "@workspace/db";
import { and, isNull, eq, lt, gte, lte, or, desc, sql } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireAnyPlatformPermission,
} from "../middlewares/requireAuth";
import {
  parseLimit,
  parseCursor,
  parseDate,
  enrichRow,
  PLATFORM_ACTIVITY_DEFAULT_LIMIT,
  PLATFORM_ACTIVITY_MAX_LIMIT,
  PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT,
  PLATFORM_USER_ACTIVITY_MAX_LIMIT,
  type EnrichedActivityRow,
} from "../lib/platform-activity-helpers";

const router: IRouter = Router();

// ── GET /platform/activity ────────────────────────────────────────────────────

router.get(
  "/platform/activity",
  requireAuth,
  requireAnyPlatformPermission(["platform.activity.read", "audit.read"]),
  async (req: AuthRequest, res) => {
    const {
      actorId,
      targetUserId,
      action,
      group,
      result,
      severity,
      from,
      to,
      limit: limitRaw,
      cursor,
    } = req.query;

    const limit    = parseLimit(limitRaw, PLATFORM_ACTIVITY_DEFAULT_LIMIT, PLATFORM_ACTIVITY_MAX_LIMIT);
    const cursorId = parseCursor(cursor);
    const fromDate = parseDate(from);
    const toDate   = parseDate(to);

    const conditions = [
      isNull(activityLogsTable.workspaceId),
      ...(actorId ? [eq(activityLogsTable.userId, Number(actorId))] : []),
      ...(action  ? [eq(activityLogsTable.action, String(action))]  : []),
      ...(fromDate ? [gte(activityLogsTable.createdAt, fromDate)]   : []),
      ...(toDate   ? [lte(activityLogsTable.createdAt, toDate)]     : []),
      ...(cursorId ? [lt(activityLogsTable.id, cursorId)]           : []),
    ];

    const rows = await db
      .select({
        id:        activityLogsTable.id,
        actorId:   activityLogsTable.userId,
        actorEmail: usersTable.email,
        actorName: usersTable.fullName,
        action:    activityLogsTable.action,
        metadata:  activityLogsTable.metadata,
        createdAt: activityLogsTable.createdAt,
      })
      .from(activityLogsTable)
      .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit + 1);

    // Enrich + apply app-level filters (group, result, severity, targetUserId)
    let enriched: EnrichedActivityRow[] = rows.map(enrichRow);

    if (group)        enriched = enriched.filter((r) => r.group    === group);
    if (result)       enriched = enriched.filter((r) => r.result   === result);
    if (severity)     enriched = enriched.filter((r) => r.severity === severity);
    if (targetUserId) enriched = enriched.filter((r) => r.targetUserId === String(targetUserId));

    // Cursor pagination: if we fetched limit+1 items, there is a next page
    const hasMore    = enriched.length > limit;
    const items      = enriched.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    req.log.info({ count: items.length, hasMore }, "GET /platform/activity");

    res.json({ items, nextCursor });
  },
);

// ── GET /platform/users/:userId/activity ─────────────────────────────────────

router.get(
  "/platform/users/:userId/activity",
  requireAuth,
  requireAnyPlatformPermission(["platform.activity.read", "audit.read"]),
  async (req: AuthRequest, res) => {
    const userId   = Number(req.params["userId"]);
    const limit    = parseLimit(req.query["limit"], PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT, PLATFORM_USER_ACTIVITY_MAX_LIMIT);
    const cursorId = parseCursor(req.query["cursor"]);

    if (!Number.isFinite(userId) || userId < 1) {
      res.status(400).json({ code: "INVALID_USER_ID", message: "userId must be a positive integer" });
      return;
    }

    // Verify the target is actually a platform user (workspaceId IS NULL)
    const targetUser = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)))
      .limit(1);

    if (targetUser.length === 0) {
      res.status(404).json({ code: "NOT_FOUND", message: "Platform user not found" });
      return;
    }

    const conditions = [
      isNull(activityLogsTable.workspaceId),
      or(
        // User is the actor
        eq(activityLogsTable.userId, userId),
        // User is the target (stored in metadata JSON)
        sql`${activityLogsTable.metadata} IS NOT NULL AND ${activityLogsTable.metadata}::jsonb->>'targetUserId' = ${String(userId)}`,
      ),
      ...(cursorId ? [lt(activityLogsTable.id, cursorId)] : []),
    ];

    const rows = await db
      .select({
        id:        activityLogsTable.id,
        actorId:   activityLogsTable.userId,
        actorEmail: usersTable.email,
        actorName: usersTable.fullName,
        action:    activityLogsTable.action,
        metadata:  activityLogsTable.metadata,
        createdAt: activityLogsTable.createdAt,
      })
      .from(activityLogsTable)
      .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit + 1);

    const enriched = rows.map(enrichRow);
    const hasMore  = enriched.length > limit;
    const items    = enriched.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    req.log.info({ userId, count: items.length }, "GET /platform/users/:userId/activity");

    res.json({ items, nextCursor });
  },
);

export default router;
