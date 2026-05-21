/**
 * P20-F — Replay & recovery (non-destructive; original payload unchanged)
 */
import { db } from "@workspace/db";
import {
  attendanceRawEventsTable,
  attendanceSyncJobsTable,
  attendanceEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { attendanceNormalizationService } from "../workforce-attendance/normalization-service";
import { attendanceSummaryService } from "../workforce-attendance/summary-service";
import { syncSummaryToLegacyAttendance } from "../workforce-attendance/legacy-bridge";
import { getWorkspaceTimezone } from "../workforce-attendance/calendar-context";
import { toLocalDateString } from "../workforce-attendance/time-utils";
import { logAttendanceAccess } from "../workforce-attendance/access-log";
import { integrationService } from "../workforce-integration/integration-service";
import { payrollLockService } from "../payroll/payroll-lock-service";
import { payrollPolicyService, type PayrollLockPolicy } from "../payroll/payroll-policy-service";
import { logger } from "../logger";

export type ReplayLockOptions = {
  breakGlass?: boolean;
  breakGlassReason?: string;
};

export class ReplayService {
  async getRawEvent(workspaceId: number, rawEventId: number) {
    const [row] = await db
      .select()
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.id, rawEventId),
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Raw event not found");
    return row;
  }

  /** Re-run normalization + daily summary from existing raw row (payload untouched). */
  async replayRawEvent(
    workspaceId: number,
    rawEventId: number,
    userId?: number,
    lockOptions?: ReplayLockOptions,
  ): Promise<{ eventId: number; summaryId: number; skipped: boolean }> {
    const raw = await this.getRawEvent(workspaceId, rawEventId);
    if (raw.processingStatus === "ignored") {
      throw new Error("Cannot replay ignored event");
    }
    if (!raw.employeeId) {
      throw new Error("Employee not resolved on raw event");
    }

    const tz = await getWorkspaceTimezone(workspaceId);
    const localDate = toLocalDateString(raw.occurredAt, tz);
    const lockPolicy = await payrollPolicyService.resolvePolicy<PayrollLockPolicy>(
      workspaceId,
      "payroll.lock",
    );
    if (lockPolicy.block_ingest_when_locked !== false) {
      await payrollLockService.assertDateNotLocked(workspaceId, localDate, {
        breakGlass: lockOptions?.breakGlass,
        userId,
        reason: lockOptions?.breakGlassReason,
        action: "attendance_replay",
      });
    }

    logAttendanceAccess({
      workspaceId,
      userId,
      action: "replay_raw_event",
      resourceType: "attendance_raw_event",
      resourceId: rawEventId,
    });

    await db
      .update(attendanceRawEventsTable)
      .set({ processingStatus: "received", errorMessage: null })
      .where(eq(attendanceRawEventsTable.id, rawEventId));

    const norm = await attendanceNormalizationService.normalizeRawEvent(rawEventId);

    const summary = await attendanceSummaryService.buildDailySummary(
      workspaceId,
      raw.employeeId,
      localDate,
    );
    await syncSummaryToLegacyAttendance(summary, userId);

    logger.info({ rawEventId, eventId: norm.eventId }, "[workforce-ops] raw event replayed");

    return {
      eventId: norm.eventId,
      summaryId: summary.id,
      skipped: norm.skipped,
    };
  }

  async retryNormalization(
    workspaceId: number,
    rawEventId: number,
    userId?: number,
    lockOptions?: ReplayLockOptions,
  ): Promise<{ eventId: number; skipped: boolean }> {
    const result = await this.replayRawEvent(workspaceId, rawEventId, userId, lockOptions);
    return { eventId: result.eventId, skipped: result.skipped };
  }

  async markRawEventIgnored(
    workspaceId: number,
    rawEventId: number,
    userId?: number,
  ): Promise<void> {
    await this.getRawEvent(workspaceId, rawEventId);
    logAttendanceAccess({
      workspaceId,
      userId,
      action: "ignore_raw_event",
      resourceType: "attendance_raw_event",
      resourceId: rawEventId,
    });
    await db
      .update(attendanceRawEventsTable)
      .set({ processingStatus: "ignored", errorMessage: null })
      .where(
        and(
          eq(attendanceRawEventsTable.id, rawEventId),
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
        ),
      );
  }

  async retrySyncJob(workspaceId: number, jobId: number, userId?: number) {
    const [job] = await db
      .select()
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.id, jobId),
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!job) throw new Error("Sync job not found");
    if (!["failed", "retry", "dead_letter", "completed"].includes(job.status)) {
      throw new Error(`Cannot retry job in status: ${job.status}`);
    }

    logAttendanceAccess({
      workspaceId,
      userId,
      action: "retry_sync_job",
      resourceType: "attendance_sync_job",
      resourceId: jobId,
    });

    await db
      .update(attendanceSyncJobsTable)
      .set({
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        lastError: null,
        completedAt: null,
      })
      .where(eq(attendanceSyncJobsTable.id, jobId));

    return { jobId, status: "pending" };
  }

  async cancelSyncJob(workspaceId: number, jobId: number, userId?: number) {
    const [job] = await db
      .select()
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.id, jobId),
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!job) throw new Error("Sync job not found");
    if (!["pending", "retry"].includes(job.status)) {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }

    logAttendanceAccess({
      workspaceId,
      userId,
      action: "cancel_sync_job",
      resourceType: "attendance_sync_job",
      resourceId: jobId,
    });

    await db
      .update(attendanceSyncJobsTable)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(attendanceSyncJobsTable.id, jobId));

    return { jobId, status: "cancelled" };
  }

  async replayDeadLetterJob(workspaceId: number, jobId: number, userId?: number) {
    const [job] = await db
      .select()
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.id, jobId),
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
          eq(attendanceSyncJobsTable.status, "dead_letter"),
        ),
      )
      .limit(1);
    if (!job) throw new Error("Dead letter job not found");

    return this.retrySyncJob(workspaceId, jobId, userId);
  }

  async replaySyncBatch(workspaceId: number, integrationId: number, userId?: number) {
    await integrationService.requireIntegration(workspaceId, integrationId);
    logAttendanceAccess({
      workspaceId,
      userId,
      action: "replay_sync_batch",
      resourceType: "attendance_integration",
      resourceId: integrationId,
    });
    return integrationService.syncNow(workspaceId, integrationId, userId);
  }

  /** Check if canonical event exists for diagnostics */
  async getRawEventDiagnostics(workspaceId: number, rawEventId: number) {
    const raw = await this.getRawEvent(workspaceId, rawEventId);
    const [canonical] = await db
      .select({ id: attendanceEventsTable.id })
      .from(attendanceEventsTable)
      .where(eq(attendanceEventsTable.rawEventId, rawEventId))
      .limit(1);
    return { raw, hasCanonicalEvent: Boolean(canonical) };
  }
}

export const replayService = new ReplayService();
