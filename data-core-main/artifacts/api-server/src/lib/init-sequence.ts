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
import { startBackgroundWorkers } from "./background-workers";
import { shouldStartBackgroundWorkers } from "./runtime-mode";
import { runOrgRuntimeStartupChecks } from "./workforce/org/org-runtime-startup";
import { runApprovalRuntimeStartupChecks } from "./approval/approval-startup";
import { runWorkforceOpsStartupChecks } from "./workforce/operations/workforce-ops-startup";
import { runLegacyCompatStartupChecks } from "./workforce/stabilization/legacy-compat-startup";
import { runHrImportRuntimeStartupChecks } from "./hr-import/hr-import-startup";
import { runHrImportAutoCreateStartupChecks } from "./hr-import/health/auto-create-startup";
import { runPlatformRuntimeStartupChecks } from "./hr-import/health/platform-runtime-startup";
import { pool } from "@workspace/db";
import { startCorsOriginRefresh } from "./cors-settings";

export async function runInitSequence(): Promise<void> {
  // 1. Apply pending migrations
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, "Database migration failed");
    throw err; // surface to caller so wizard can report the failure
  }

  startCorsOriginRefresh();

  // 1b. Org runtime schema verification + idempotent backfill (Phase 2)
  try {
    await runOrgRuntimeStartupChecks(pool);
  } catch (err) {
    logger.error({ err }, "Org runtime startup checks failed");
    throw err;
  }

  // 1c. Approval runtime schema verification + SLA escalation sweep (Phase 3)
  try {
    await runApprovalRuntimeStartupChecks(pool);
  } catch (err) {
    logger.error({ err }, "Approval runtime startup checks failed");
    throw err;
  }

  // 1d. Workforce operations schema verification (Phase 4)
  try {
    await runWorkforceOpsStartupChecks(pool);
  } catch (err) {
    logger.error({ err }, "Workforce operations startup checks failed");
    throw err;
  }

  // 1e. Legacy compat telemetry + schema registry (Phase 5)
  try {
    await runLegacyCompatStartupChecks(pool);
  } catch (err) {
    logger.error({ err }, "Legacy compat startup checks failed");
    throw err;
  }

  // 1f. HR universal import/export runtime foundation (Phase 0+1, non-fatal if schema pending)
  try {
    await runHrImportRuntimeStartupChecks(pool);
  } catch (err) {
    logger.warn({ err }, "HR import runtime startup checks failed (non-fatal)");
  }

  // 1g. HR import auto-create Phase 5 (non-fatal if schema pending)
  try {
    await runHrImportAutoCreateStartupChecks(pool);
  } catch (err) {
    logger.warn({ err }, "HR import auto-create startup checks failed (non-fatal)");
  }

  // 1h. Platform import/export final phase (non-fatal if schema pending)
  try {
    await runPlatformRuntimeStartupChecks(pool);
  } catch (err) {
    logger.warn({ err }, "Platform runtime final phase startup checks failed (non-fatal)");
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

  // 5–11. Background workers (F10.2: skip when WORKER_MODE=api — use separate worker process)
  if (shouldStartBackgroundWorkers()) {
    await startBackgroundWorkers();
  } else {
    logger.info("Background workers disabled in API-only mode (WORKER_MODE=api)");
  }
}
