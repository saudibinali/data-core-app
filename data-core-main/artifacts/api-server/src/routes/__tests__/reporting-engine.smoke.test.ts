/**
 * @phase P19-D — Reporting engine smoke tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
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
  reportAccessLogsTable,
  notificationsTable,
} from "@workspace/db";
import { exportJobService } from "../../lib/reports/export-job-service";
import { processExportJobBatch, resetStuckExportJobs } from "../../lib/reports/export-job-processor";
import { reportService } from "../../lib/reports/report-service";
import { verifyReportDownloadToken } from "../../lib/reports/report-download-token";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_P19D_SMOKE !== "0";

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MIGRATION_0004 = path.resolve(
  fileURLToPath(new URL("../../../../../lib/db/drizzle/0004_reporting_infrastructure.sql", import.meta.url)),
);

async function ensureP19DMigration(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='report_access_logs' LIMIT 1`,
  );
  if (rows.length > 0) return;
  const raw = fs.readFileSync(MIGRATION_0004, "utf8");
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
    [wsId, `p19d-${Date.now()}@test.local`],
  );
  return r.rows[0]!.id;
}

function mountReportsRouter(ctx: Ctx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as Ctx & { userPermissions?: string[] };
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      r.userPermissions = ctx.perms;
      next();
    },
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  return import("../reports").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

describe.skipIf(!RUN)("P19-D reporting engine smoke", () => {
  beforeAll(async () => {
    process.env.REPORT_ARTIFACT_DIR = path.join(process.cwd(), "data", "test-report-artifacts");
    initializeDatabase(process.env.DATABASE_URL!);
    await ensureP19DMigration();
    const [a] = await db.insert(workspacesTable).values({ name: "P19D A", slug: `p19d-a-${Date.now()}` }).returning();
    const [b] = await db.insert(workspacesTable).values({ name: "P19D B", slug: `p19d-b-${Date.now()}` }).returning();
    wsA = a!.id;
    wsB = b!.id;
    adminA = { userId: await insertUser(wsA), workspaceId: wsA, userRole: "admin", perms: ["hr.manage"] };
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("export job lifecycle — pending to completed", async () => {
    const { job } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.employees.roster",
      format: "csv",
      parameters: {},
    });

    await processExportJobBatch();
    const [updated] = await db
      .select()
      .from(exportJobsTable)
      .where(eq(exportJobsTable.id, job.id))
      .limit(1);
    expect(updated!.status).toBe("completed");
    expect(updated!.progressPercent).toBe(100);

    const [report] = await db
      .select()
      .from(generatedReportsTable)
      .where(eq(generatedReportsTable.id, job.generatedReportId!))
      .limit(1);
    expect(report!.status).toBe("completed");
    expect(report!.storageKey).toMatch(/^local:\/\/reports\//);
  });

  it("workspace isolation — export job not visible cross-workspace", async () => {
    const { job } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.leave.balances",
      format: "csv",
    });
    const cross = await exportJobService.getJob(job.id, wsB);
    expect(cross).toBeNull();
  });

  it("generated report download token + access log", async () => {
    const { job, generatedReport } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.employees.roster",
      format: "csv",
    });
    await resetStuckExportJobs();
    await processExportJobBatch();

    const req = {
      userId: adminA.userId,
      workspaceId: wsA,
      userRole: "admin",
      userPermissions: adminA.perms,
      ip: "127.0.0.1",
    } as express.Request;

    const issued = await reportService.issueDownload(req, generatedReport.id);
    expect(issued.token).toBeTruthy();

    const payload = verifyReportDownloadToken(issued.token);
    expect(payload?.generatedReportId).toBe(generatedReport.id);

    const logs = await db
      .select()
      .from(reportAccessLogsTable)
      .where(eq(reportAccessLogsTable.generatedReportId, generatedReport.id));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("export authorization — member without hr.manage forbidden", async () => {
    const memberId = await insertUser(wsA);
    const req = {
      userId: memberId,
      workspaceId: wsA,
      userRole: "member",
      userPermissions: [],
    } as express.Request;
    await expect(
      exportJobService.createReportJob({
        workspaceId: wsA,
        userId: memberId,
        userRole: "member",
        userPermissions: [],
        reportDefinitionKey: "hr.employees.roster",
        format: "csv",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("notification on export completion", async () => {
    const { job, generatedReport } = await exportJobService.createReportJob({
      ...adminA,
      workspaceId: wsA,
      userId: adminA.userId,
      reportDefinitionKey: "hr.leave.balances",
      format: "csv",
    });
    await processExportJobBatch();

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, adminA.userId),
          eq(notificationsTable.workspaceId, wsA),
          eq(notificationsTable.type, "export_completed"),
        ),
      );
    expect(notifs.length).toBeGreaterThan(0);

    const [report] = await db
      .select()
      .from(generatedReportsTable)
      .where(eq(generatedReportsTable.id, generatedReport.id))
      .limit(1);
    expect(report!.status).toBe("completed");
  });

  it("reports API — create job and list generated", async () => {
    const app = await mountReportsRouter(adminA);
    const create = await request(app)
      .post("/reports/export-jobs")
      .send({ reportDefinitionKey: "hr.employees.roster", format: "csv", parameters: {} });
    expect(create.status).toBe(201);

    const list = await request(app).get("/reports/generated");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });
});
