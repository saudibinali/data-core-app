/**
 * @phase P19-E — PDF & scheduled reports smoke tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  initializeDatabase,
  workspacesTable,
  exportJobsTable,
  generatedReportsTable,
  notificationDeliveriesTable,
  notificationJobsTable,
  scheduledReportSchedulesTable,
} from "@workspace/db";
import { exportJobService } from "../../lib/reports/export-job-service";
import { processExportJobBatch } from "../../lib/reports/export-job-processor";
import { generatePdfReport } from "../../lib/reports/pdf-report-generator";
import { scheduledReportService } from "../../lib/reports/scheduled-report-service";
import { processScheduledReportBatch } from "../../lib/reports/scheduled-report-scheduler";
import { reportDefinitionRegistry } from "../../lib/reports/report-definition-registry";
import { verifyReportDownloadToken, issueReportDownloadToken } from "../../lib/reports/report-download-token";
import { reportService } from "../../lib/reports/report-service";
import { readReportArtifact } from "../../lib/reports/report-artifact-storage";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_P19E_SMOKE !== "0";

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MIGRATION_0005 = path.resolve(
  fileURLToPath(new URL("../../../../../lib/db/drizzle/0005_pdf_scheduled_reports.sql", import.meta.url)),
);

async function ensureP19EMigration(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='scheduled_report_schedules' LIMIT 1`,
  );
  if (rows.length > 0) return;
  const raw = fs.readFileSync(MIGRATION_0005, "utf8");
  for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
}

type Ctx = { userId: number; workspaceId: number; userRole: string; perms: string[] };

let wsA: number;
let wsB: number;
let adminA: Ctx;

async function insertUser(wsId: number) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, 'Admin', 'admin', 'active') RETURNING id`,
    [wsId, `p19e-${Date.now()}-${Math.random()}@test.local`],
  );
  return r.rows[0]!.id;
}

describe.skipIf(!RUN)("P19-E PDF & scheduled reports smoke", () => {
  beforeAll(async () => {
    process.env.REPORT_ARTIFACT_DIR = path.join(process.cwd(), "data", "test-report-artifacts-p19e");
    initializeDatabase(process.env.DATABASE_URL!);
    await ensureP19EMigration();
    const [a] = await db.insert(workspacesTable).values({ name: "P19E A", slug: `p19e-a-${Date.now()}` }).returning();
    const [b] = await db.insert(workspacesTable).values({ name: "P19E B", slug: `p19e-b-${Date.now()}` }).returning();
    wsA = a!.id;
    wsB = b!.id;
    adminA = { userId: await insertUser(wsA), workspaceId: wsA, userRole: "admin", perms: ["hr.manage"] };
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("report definitions include pdf format", () => {
    const def = reportDefinitionRegistry.get("hr.employees.roster");
    expect(def?.supportedFormats).toContain("pdf");
  });

  it("PDF generation produces valid PDF bytes", async () => {
    const artifact = await generatePdfReport("hr.employees.roster", wsA, {});
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(artifact.fileName.endsWith(".pdf")).toBe(true);
  });

  it("PDF export job lifecycle via generated_reports", async () => {
    const { job, generatedReport } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.employees.roster",
      format: "pdf",
      parameters: {},
    });

    await processExportJobBatch();

    const [updatedJob] = await db.select().from(exportJobsTable).where(eq(exportJobsTable.id, job.id)).limit(1);
    expect(updatedJob?.status).toBe("completed");

    const [report] = await db
      .select()
      .from(generatedReportsTable)
      .where(eq(generatedReportsTable.id, generatedReport.id))
      .limit(1);
    expect(report?.status).toBe("completed");
    expect(report?.format).toBe("pdf");
    expect(report?.storageKey).toBeTruthy();

    const buf = await readReportArtifact(report!.storageKey!);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("workspace isolation on generated report download token", async () => {
    const { generatedReport } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.leave.balances",
      format: "pdf",
    });
    await processExportJobBatch();

    const token = issueReportDownloadToken({
      generatedReportId: generatedReport.id,
      workspaceId: wsB,
      userId: adminA.userId,
    });
    const payload = verifyReportDownloadToken(token);
    expect(payload?.workspaceId).toBe(wsB);
    expect(payload?.generatedReportId).toBe(generatedReport.id);

    const req = {
      userId: adminA.userId,
      workspaceId: wsB,
      userRole: "admin",
      userPermissions: ["hr.manage"],
    } as Parameters<typeof reportService.streamDownload>[0];

    await expect(reportService.streamDownload(req, token)).rejects.toThrow();
  });

  it("scheduled report creates export job without duplicate on second tick", async () => {
    const past = new Date(Date.now() - 60_000);
    const schedule = await scheduledReportService.createSchedule({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.employees.roster",
      format: "pdf",
      scheduleCron: "0 8 * * *",
      scheduleTimezone: "UTC",
      recipients: [{ userId: adminA.userId }],
    });

    await db
      .update(scheduledReportSchedulesTable)
      .set({ nextRunAt: past })
      .where(eq(scheduledReportSchedulesTable.id, schedule.id));

    const first = await processScheduledReportBatch();
    expect(first).toBeGreaterThanOrEqual(1);

    const jobsAfterFirst = await db
      .select()
      .from(exportJobsTable)
      .where(and(eq(exportJobsTable.workspaceId, wsA), eq(exportJobsTable.format, "pdf")));
    const countFirst = jobsAfterFirst.length;

    const second = await processScheduledReportBatch();
    expect(second).toBe(0);

    const jobsAfterSecond = await db
      .select()
      .from(exportJobsTable)
      .where(and(eq(exportJobsTable.workspaceId, wsA), eq(exportJobsTable.format, "pdf")));
    expect(jobsAfterSecond.length).toBe(countFirst);
  });

  it("email notification enqueued on report completion with recipients", async () => {
    const email = `p19e-recipient-${Date.now()}@test.local`;
    const { job, generatedReport } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.leave.balances",
      format: "pdf",
      recipients: [{ userId: adminA.userId, email }],
    });

    await processExportJobBatch();
    const [updated] = await db.select().from(exportJobsTable).where(eq(exportJobsTable.id, job.id)).limit(1);
    expect(updated?.status).toBe("completed");

    const emailJobs = await db
      .select()
      .from(notificationJobsTable)
      .where(
        and(
          eq(notificationJobsTable.workspaceId, wsA),
          eq(notificationJobsTable.channel, "email"),
        ),
      );

    const readyJob = emailJobs.find((j) => j.templateKey === "report.ready");
    expect(readyJob).toBeTruthy();
    expect(readyJob?.payloadJson).toContain("downloadUrl");
    expect(readyJob?.payloadJson).not.toContain("attachment");

    const deliveries = await db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.notificationJobId, readyJob!.id));
    expect(deliveries.length).toBeGreaterThan(0);

    void generatedReport;
  });
});
