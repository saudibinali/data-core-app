/**
 * Post-database initialization sequence.
 *
 * Called both at server startup (when DATABASE_URL is already set) and from
 * the setup wizard endpoint (after the user configures the DB through the UI).
 * Extracted so both callers share identical logic without circular imports.
 */
import { logger } from "./logger";
import { runMigrations } from "../seed/migrate";
import { seedModules } from "../seed/modules";
import { seedEventRegistry } from "./events/registry";
import { seedWorkflowTemplates } from "../seed/workflows";
import { seedFormTemplates } from "../seed/forms";
import { bootstrapDevAdmin } from "../seed/bootstrap";
import { workflowEngine } from "./workflows";
import { governanceScheduler } from "./workflows/governance-scheduler";
import { seedNotificationTemplates } from "./notifications/seed-templates";
import { startNotificationQueueProcessor } from "./notifications/queue-processor";
import { startExportJobProcessor } from "./reports/export-job-processor";
import { startScheduledReportScheduler } from "./reports/scheduled-report-scheduler";
import { seedAllWorkspaceAttendanceSources } from "./workforce-attendance/source-seed";
import { attendancePolicyService } from "./workforce-attendance/attendance-policy-service";
import { startAttendanceSyncWorker } from "./workforce-integration/sync-worker";

export async function runInitSequence(): Promise<void> {
  // 1. Apply pending migrations
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, "Database migration failed");
    throw err; // surface to caller so wizard can report the failure
  }

  // 2. Start workflow engine (includes P6-A delay scheduler)
  try {
    workflowEngine.start();
  } catch (err) {
    logger.warn({ err }, "Workflow engine failed to start");
  }

  // 3. Start governance snapshot scheduler (P7-B)
  //    Captures tenant health snapshots every 5 minutes across all active
  //    workspaces and prunes raw rows older than 30 days.
  //    Non-fatal: failure here does not block the rest of the init sequence.
  try {
    governanceScheduler.start();
  } catch (err) {
    logger.warn({ err }, "Governance snapshot scheduler failed to start");
  }

  // 4. Seed reference data
  const seeds: Array<[() => Promise<unknown>, string]> = [
    [seedModules,          "Platform modules"],
    [seedEventRegistry,    "Event registry"],
    [seedWorkflowTemplates,"Workflow templates"],
    [seedFormTemplates,    "Form templates"],
    [seedNotificationTemplates, "Notification templates"],
  ];

  for (const [fn, name] of seeds) {
    try {
      await fn();
      logger.info(`${name} seeded`);
    } catch (err) {
      logger.error({ err }, `Failed to seed ${name}`);
    }
  }

  // 4. Auto-create dev admin if no users exist (dev only)
  try {
    await bootstrapDevAdmin();
  } catch (err) {
    logger.error({ err }, "Failed to bootstrap dev admin");
  }

  // 5. P19-B: DB-backed notification job processor (no Redis)
  try {
    startNotificationQueueProcessor();
  } catch (err) {
    logger.warn({ err }, "Notification queue processor failed to start");
  }

  // 6. P19-D: DB-backed export job processor (no Redis)
  try {
    startExportJobProcessor();
  } catch (err) {
    logger.warn({ err }, "Export job processor failed to start");
  }

  // 7. P19-E: Scheduled report scheduler (no Redis)
  try {
    startScheduledReportScheduler();
  } catch (err) {
    logger.warn({ err }, "Scheduled report scheduler failed to start");
  }

  // 8. P20-B: Default attendance sources per workspace
  try {
    await seedAllWorkspaceAttendanceSources();
  } catch (err) {
    logger.warn({ err }, "Attendance source seed failed");
  }

  // 9. P20-D: Default attendance policies per workspace
  try {
    const { db, workspacesTable } = await import("@workspace/db");
    const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);
    for (const ws of workspaces) {
      await attendancePolicyService.ensureDefaultPolicy(ws.id);
    }
  } catch (err) {
    logger.warn({ err }, "Attendance policy seed failed");
  }

  // 10. P20-E: DB-backed attendance integration sync worker (no Redis)
  try {
    startAttendanceSyncWorker();
  } catch (err) {
    logger.warn({ err }, "Attendance sync worker failed to start");
  }

  // 11. P21-B: Default payroll policies per workspace
  try {
    const { payrollPolicyService } = await import("./payroll/payroll-policy-service");
    const count = await payrollPolicyService.seedAllWorkspaces();
    logger.info({ count }, "Payroll policy defaults seeded");
  } catch (err) {
    logger.warn({ err }, "Payroll policy seed failed");
  }
}
