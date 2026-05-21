import { db } from "@workspace/db";
import { exportJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { exportJobService } from "./export-job-service";
import { logger } from "../logger";

const BATCH = 5;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let processing = false;

export async function processExportJobBatch(): Promise<number> {
  if (processing) return 0;
  processing = true;
  try {
    const jobs = await db
      .select()
      .from(exportJobsTable)
      .where(eq(exportJobsTable.status, "pending"))
      .limit(BATCH);

    for (const job of jobs) {
      await exportJobService.processJob(job);
    }
    return jobs.length;
  } finally {
    processing = false;
  }
}

export function startExportJobProcessor(intervalMs = 10_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void processExportJobBatch().catch((err) => {
      logger.error({ err }, "[export-job] batch error");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "[export-job] processor started");
}

export function stopExportJobProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** Reset stuck processing jobs (tests) */
export async function resetStuckExportJobs(): Promise<void> {
  await db
    .update(exportJobsTable)
    .set({ status: "pending" })
    .where(eq(exportJobsTable.status, "processing"));
}
