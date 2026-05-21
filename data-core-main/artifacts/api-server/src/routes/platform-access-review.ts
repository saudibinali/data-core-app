/**
 * @phase P17-D - Platform Access Review & Audit APIs (read-only + review metadata)
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogsTable, platformUserAccessReviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  buildPlatformAccessReviewSummary,
  buildPlatformUserAccessReview,
  queryPlatformAccessAuditEvents,
} from "../lib/platform-access-review";
import {
  ACCESS_REVIEW_STATUSES,
  type AccessReviewStatus,
} from "../lib/platform-access-review-config";
import { parseDate } from "../lib/platform-activity-helpers";

const router: IRouter = Router();

router.get(
  "/platform/access-review/summary",
  requireAuth,
  requirePlatformPermission("platform.accessReview.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const summary = await buildPlatformAccessReviewSummary();
    res.json(summary);
  },
);

router.get(
  "/platform/access-review/users/:userId",
  requireAuth,
  requirePlatformPermission("platform.accessReview.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    const detail = await buildPlatformUserAccessReview(userId);
    if (!detail) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }
    res.json(detail);
  },
);

router.get(
  "/platform/access-review/audit-events",
  requireAuth,
  requirePlatformPermission("platform.accessReview.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const q = req.query;
    const result = await queryPlatformAccessAuditEvents({
      userId: q.userId ? Number(q.userId) : undefined,
      actorId: q.actorId ? Number(q.actorId) : undefined,
      action: q.action ? String(q.action) : undefined,
      severity: q.severity ? String(q.severity) : undefined,
      dateFrom: parseDate(q.dateFrom) ?? undefined,
      dateTo: parseDate(q.dateTo) ?? undefined,
      permissionCode: q.permissionCode ? String(q.permissionCode) : undefined,
      blockedOnly: q.blockedOnly === "true" || q.blockedOnly === "1",
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 50,
    });
    res.json(result);
  },
);

router.post(
  "/platform/access-review/users/:userId/review",
  requireAuth,
  requirePlatformPermission("platform.accessReview.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const actorId = req.userId!;
    const userId = parseInt(String(req.params.userId ?? ""), 10);
    const { reviewStatus, reviewNotes } = req.body as {
      reviewStatus?: string;
      reviewNotes?: string;
    };

    if (!userId || userId <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    if (!reviewStatus || !ACCESS_REVIEW_STATUSES.includes(reviewStatus as AccessReviewStatus)) {
      res.status(400).json({ error: "Invalid reviewStatus", codes: ["INVALID_REVIEW_STATUS"] });
      return;
    }

    const detail = await buildPlatformUserAccessReview(userId);
    if (!detail) {
      res.status(404).json({ error: "Platform user not found" });
      return;
    }

    const now = new Date();
    const [existing] = await db
      .select({ id: platformUserAccessReviewsTable.id })
      .from(platformUserAccessReviewsTable)
      .where(eq(platformUserAccessReviewsTable.platformUserId, userId));

    if (existing) {
      await db
        .update(platformUserAccessReviewsTable)
        .set({
          reviewedBy: actorId,
          reviewedAt: now,
          reviewStatus,
          reviewNotes: reviewNotes?.trim() || null,
          updatedAt: now,
        })
        .where(eq(platformUserAccessReviewsTable.id, existing.id));
    } else {
      await db.insert(platformUserAccessReviewsTable).values({
        platformUserId: userId,
        reviewedBy: actorId,
        reviewedAt: now,
        reviewStatus,
        reviewNotes: reviewNotes?.trim() || null,
      });
    }

    await db.insert(activityLogsTable).values({
      userId: actorId,
      action: "platform_access_review_recorded",
      metadata: JSON.stringify({
        actorId,
        targetUserId: userId,
        reviewStatus,
        reason: reviewNotes?.trim() || null,
        timestamp: now.toISOString(),
        result: "success",
      }),
      workspaceId: null,
    });

    const updated = await buildPlatformUserAccessReview(userId);
    res.json({
      success: true,
      reviewStatus,
      reviewNotes: reviewNotes?.trim() || null,
      reviewedAt: now.toISOString(),
      user: updated,
    });
  },
);

export default router;
