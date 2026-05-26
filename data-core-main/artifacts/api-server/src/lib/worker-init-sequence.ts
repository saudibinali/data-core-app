import { logger } from "./logger";
import { runMigrations } from "../seed/migrate";
import { startBackgroundWorkers } from "./background-workers";
import { pool } from "@workspace/db";
import { runOrgRuntimeStartupChecks } from "./workforce/org/org-runtime-startup";
import { runApprovalRuntimeStartupChecks } from "./approval/approval-startup";

/** Worker-only bootstrap: migrations + schema checks + background processors. */
export async function runWorkerInitSequence(): Promise<void> {
  const runMigrationsFlag = process.env.WORKER_RUN_MIGRATIONS !== "false";
  if (runMigrationsFlag) {
    await runMigrations();
  }

  try {
    await runOrgRuntimeStartupChecks(pool);
    await runApprovalRuntimeStartupChecks(pool);
  } catch (err) {
    logger.error({ err }, "Worker schema checks failed");
    throw err;
  }

  await startBackgroundWorkers();
}
