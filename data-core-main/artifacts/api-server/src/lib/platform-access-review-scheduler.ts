/**
 * F2.7 — Weekly stale platform permission review job.
 */

import { logger } from "./logger";
import { buildPlatformAccessReviewSummary } from "./platform-access-review";
import { db, activityLogsTable } from "@workspace/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;

export async function runPlatformAccessReviewJob(): Promise<void> {
  try {
    const summary = await buildPlatformAccessReviewSummary();
    await db.insert(activityLogsTable).values({
      userId: null,
      workspaceId: null,
      action: "platform_access_review_weekly",
      metadata: JSON.stringify({
        staleUsers: summary.staleUsers.length,
        highRiskUsers: summary.highRiskUsers.length,
        usersMissingRecentReview: summary.usersMissingRecentReview,
        generatedAt: summary.generatedAt,
      }),
    });
    logger.info(
      {
        staleUsers: summary.staleUsers.length,
        highRiskUsers: summary.highRiskUsers.length,
      },
      "[access-review] weekly stale-permissions report recorded",
    );
  } catch (err) {
    logger.warn({ err }, "[access-review] weekly job failed");
  }
}

export function startPlatformAccessReviewScheduler(intervalMs = WEEK_MS): void {
  void runPlatformAccessReviewJob();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void runPlatformAccessReviewJob(), intervalMs);
}

export function stopPlatformAccessReviewSchedulerForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
