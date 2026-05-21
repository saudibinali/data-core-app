/**
 * P20-E — DB-backed attendance sync job processor (no Redis)
 */
import { db } from "@workspace/db";
import {
  attendanceIntegrationsTable,
  attendanceSyncJobsTable,
} from "@workspace/db";
import { and, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { integrationService } from "./integration-service";
import { connectorRegistry } from "./connector-registry";
import { registerWorkforceConnectors } from "./register-connectors";
import { ingestVendorDrafts } from "./integration-pipeline";
import { parseConfigJson } from "./integration-security";
import { logger } from "../logger";

registerWorkforceConnectors();

const BATCH = 5;
const BASE_BACKOFF_MS = 60_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let processing = false;

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 30 * 60_000);
}

export async function processAttendanceSyncBatch(): Promise<number> {
  if (processing) return 0;
  processing = true;
  try {
    const now = new Date();
    const jobs = await db
      .select()
      .from(attendanceSyncJobsTable)
      .where(
        and(
          inArray(attendanceSyncJobsTable.status, ["pending", "retry"]),
          or(
            isNull(attendanceSyncJobsTable.nextRunAt),
            lte(attendanceSyncJobsTable.nextRunAt, now),
          ),
        ),
      )
      .limit(BATCH);

    for (const job of jobs) {
      await processOneSyncJob(job);
    }
    return jobs.length;
  } finally {
    processing = false;
  }
}

async function processOneSyncJob(
  job: typeof attendanceSyncJobsTable.$inferSelect,
): Promise<void> {
  await db
    .update(attendanceSyncJobsTable)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(attendanceSyncJobsTable.id, job.id));

  try {
    if (!job.integrationId) {
      throw new Error("Sync job missing integration_id");
    }

    const [integration] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.id, job.integrationId))
      .limit(1);

    if (!integration || !integration.isEnabled) {
      throw new Error("Integration not found or disabled");
    }

    const connector = connectorRegistry.resolve(integration.connectorKey);
    if (!connector.capabilities.includes("poll")) {
      await db
        .update(attendanceSyncJobsTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          lastError: "Connector does not support polling",
        })
        .where(eq(attendanceSyncJobsTable.id, job.id));
      return;
    }

    const ctx = integrationService.buildContext(integration);
    const cursor = job.cursorJson ? JSON.parse(job.cursorJson).cursor : undefined;
    const poll = await connector.poll(ctx, cursor);
    const result = await ingestVendorDrafts(
      integration.workspaceId,
      integration.id,
      integration.connectorKey,
      ctx,
      poll.events,
    );

    const nextStatus = poll.hasMore ? "pending" : "completed";
    await db
      .update(attendanceSyncJobsTable)
      .set({
        status: nextStatus,
        cursorJson: JSON.stringify({ cursor: poll.nextCursor ?? cursor }),
        recordsFetched: (job.recordsFetched ?? 0) + poll.events.length,
        recordsNormalized: (job.recordsNormalized ?? 0) + result.ingested,
        completedAt: poll.hasMore ? null : new Date(),
        lastError: result.errors.length ? result.errors.join("; ").slice(0, 500) : null,
        attempts: 0,
        nextRunAt: poll.hasMore ? new Date() : null,
      })
      .where(eq(attendanceSyncJobsTable.id, job.id));

    await integrationService.recordSyncResult(integration.id, "completed", result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = (job.attempts ?? 0) + 1;
    const maxAttempts = job.maxAttempts ?? 5;
    const deadLetter = attempts >= maxAttempts;

    await db
      .update(attendanceSyncJobsTable)
      .set({
        status: deadLetter ? "dead_letter" : "retry",
        attempts,
        lastError: message.slice(0, 500),
        nextRunAt: deadLetter ? null : new Date(Date.now() + backoffMs(attempts)),
        completedAt: deadLetter ? new Date() : null,
      })
      .where(eq(attendanceSyncJobsTable.id, job.id));

    if (job.integrationId) {
      await integrationService.recordSyncResult(job.integrationId, "failed", {
        errors: [message],
      });
    }

    logger.error({ jobId: job.id, err: message }, "[integration-sync] job failed");

    if (deadLetter && job.workspaceId) {
      void import("../workforce-ops/workforce-ops-notifications").then(({ dispatchOperationalAlerts }) =>
        import("../workforce-ops/operations-service").then(({ operationsService }) =>
          operationsService.evaluateAlerts(job.workspaceId).then((alerts) =>
            dispatchOperationalAlerts(job.workspaceId, alerts),
          ),
        ),
      );
    }
  }
}

/** Schedule poll jobs for integrations due for sync */
export async function enqueueDueIntegrationPolls(): Promise<number> {
  const integrations = await db
    .select()
    .from(attendanceIntegrationsTable)
    .where(eq(attendanceIntegrationsTable.isEnabled, true));

  let enqueued = 0;
  const now = Date.now();
  for (const int of integrations) {
    const connector = connectorRegistry.resolve(int.connectorKey);
    if (!connector.capabilities.includes("poll")) continue;

    const intervalMs = (int.pollIntervalMinutes ?? 15) * 60_000;
    const last = int.lastSyncAt?.getTime() ?? 0;
    if (now - last < intervalMs) continue;

    const pending = await db
      .select({ id: attendanceSyncJobsTable.id })
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.integrationId, int.id),
          inArray(attendanceSyncJobsTable.status, ["pending", "processing", "retry"]),
        ),
      )
      .limit(1);
    if (pending[0]) continue;

    await db.insert(attendanceSyncJobsTable).values({
      workspaceId: int.workspaceId,
      integrationId: int.id,
      jobType: "poll",
      status: "pending",
      cursorJson: parseConfigJson(int.configJson).cursor
        ? JSON.stringify({ cursor: parseConfigJson(int.configJson).cursor })
        : null,
    });
    enqueued++;
  }
  return enqueued;
}

export function startAttendanceSyncWorker(intervalMs = 30_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void enqueueDueIntegrationPolls()
      .then(() => processAttendanceSyncBatch())
      .catch((err) => logger.error({ err }, "[integration-sync] batch error"));
  }, intervalMs);
  logger.info({ intervalMs }, "[integration-sync] worker started");
}

export function stopAttendanceSyncWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
