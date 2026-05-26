/**
 * F10.2 — Background processors (DB-backed queues, no Redis required).
 */
import { logger } from "./logger";
import { startNotificationQueueProcessor } from "./notifications/queue-processor";
import { startExportJobProcessor } from "./reports/export-job-processor";
import { startScheduledReportScheduler } from "./reports/scheduled-report-scheduler";
import { seedAllWorkspaceAttendanceSources } from "./workforce-attendance/source-seed";
import { attendancePolicyService } from "./workforce-attendance/attendance-policy-service";
import { startAttendanceSyncWorker } from "./workforce-integration/sync-worker";

export async function startBackgroundWorkers(): Promise<void> {
  try {
    startNotificationQueueProcessor();
  } catch (err) {
    logger.warn({ err }, "Notification queue processor failed to start");
  }

  try {
    startExportJobProcessor();
  } catch (err) {
    logger.warn({ err }, "Export job processor failed to start");
  }

  try {
    startScheduledReportScheduler();
  } catch (err) {
    logger.warn({ err }, "Scheduled report scheduler failed to start");
  }

  try {
    const { startPlatformAccessReviewScheduler } = await import("./platform-access-review-scheduler");
    startPlatformAccessReviewScheduler();
  } catch (err) {
    logger.warn({ err }, "Platform access review scheduler failed to start");
  }

  try {
    await seedAllWorkspaceAttendanceSources();
  } catch (err) {
    logger.warn({ err }, "Attendance source seed failed");
  }

  try {
    const { db, workspacesTable } = await import("@workspace/db");
    const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);
    for (const ws of workspaces) {
      await attendancePolicyService.ensureDefaultPolicy(ws.id);
    }
  } catch (err) {
    logger.warn({ err }, "Attendance policy seed failed");
  }

  try {
    startAttendanceSyncWorker();
  } catch (err) {
    logger.warn({ err }, "Attendance sync worker failed to start");
  }

  try {
    const { startEventOutboxWorker } = await import("./events/outbox-worker");
    startEventOutboxWorker();
  } catch (err) {
    logger.warn({ err }, "Event outbox worker failed to start");
  }

  try {
    const { payrollPolicyService } = await import("./payroll/payroll-policy-service");
    const count = await payrollPolicyService.seedAllWorkspaces();
    logger.info({ count }, "Payroll policy defaults seeded");
  } catch (err) {
    logger.warn({ err }, "Payroll policy seed failed");
  }

  logger.info("Background workers started");
}
