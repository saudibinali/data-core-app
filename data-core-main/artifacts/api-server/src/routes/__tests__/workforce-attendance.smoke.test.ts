/**
 * P20-B — Workforce attendance foundation smoke tests (real DB)
 *
 * Requires DATABASE_URL and migration 0006_workforce_attendance_foundation.
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server test workforce-attendance.smoke
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  initializeDatabase,
  workspacesTable,
  employeesTable,
  hrAttendanceTable,
  attendanceRawEventsTable,
  attendanceEventsTable,
  attendanceDailySummariesTable,
  attendanceSourcesTable,
} from "@workspace/db";

import { isSmokeDatabaseAvailable } from "../../test-utils/smoke-db";

const RUN = isSmokeDatabaseAvailable() && process.env.RUN_WORKFORCE_ATTENDANCE_SMOKE !== "0";

vi.mock("../../lib/events/app-bus", () => ({
  appEventBus: { emit: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type AuthCtx = { userId: number; workspaceId: number; userRole: string };

let auth: AuthCtx;
let otherWorkspaceId: number;
let employeeId: number;
let workspaceId: number;
let tablesReady = false;

async function tablesExist(): Promise<boolean> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'attendance_raw_events'`,
  );
  return Number(r.rows[0]?.c) >= 1;
}

function mountWorkforceRouter(as: AuthCtx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as AuthCtx;
      r.userId = as.userId;
      r.workspaceId = as.workspaceId;
      r.userRole = as.userRole;
      next();
    },
  }));

  return import("../workforce-attendance").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

describe.skipIf(!RUN)("P20-B workforce attendance smoke (integration)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    initializeDatabase(process.env.DATABASE_URL);
    tablesReady = await tablesExist();
    if (!tablesReady) return;

    const slug = `wf-att-${Date.now()}`;
    const [ws] = await db.insert(workspacesTable).values({ name: "WF Att WS", slug }).returning();
    workspaceId = ws!.id;

    const [ws2] = await db
      .insert(workspacesTable)
      .values({ name: "WF Att Other", slug: `${slug}-other` })
      .returning();
    otherWorkspaceId = ws2!.id;

    const userInsert = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status)
       VALUES ($1, $2, $3, 'member', 'active') RETURNING id`,
      [workspaceId, `emp-${slug}@test.local`, "WF Employee"],
    );
    const userId = userInsert.rows[0]!.id;

    const [emp] = await db
      .insert(employeesTable)
      .values({
        workspaceId,
        userId,
        fullName: "WF Employee",
        employeeNumber: `E-${slug}`,
        status: "active",
      })
      .returning();
    employeeId = emp!.id;

    auth = { userId, workspaceId, userRole: "member" };

    const { seedAttendanceSourcesForWorkspace } = await import(
      "../../lib/workforce-attendance/source-seed"
    );
    await seedAttendanceSourcesForWorkspace(workspaceId);
    await seedAttendanceSourcesForWorkspace(otherWorkspaceId);
  });

  afterAll(async () => {
    if (!tablesReady) return;
    await pool.end().catch(() => undefined);
  });

  it("seeds default attendance sources", async () => {
    if (!tablesReady) return;
    const sources = await db
      .select({ code: attendanceSourcesTable.code })
      .from(attendanceSourcesTable)
      .where(eq(attendanceSourcesTable.workspaceId, workspaceId));
    const codes = sources.map((s) => s.code).sort();
    expect(codes).toEqual(["excel", "manual", "system", "web"]);
  });

  it("ingests raw event and normalizes to canonical event", async () => {
    if (!tablesReady) return;
    const { processIngestedEvent } = await import("../../lib/workforce-attendance/pipeline");
    const occurredAt = new Date("2026-05-19T08:00:00Z");

    const result = await processIngestedEvent({
      workspaceId,
      sourceCode: "manual",
      employeeId,
      eventTypeHint: "clock_in",
      occurredAt,
      timezone: "UTC",
      payload: { test: "smoke-in" },
      externalId: `smoke-in-${Date.now()}`,
    });

    expect(result.duplicate).toBe(false);
    expect(result.rawEventId).toBeGreaterThan(0);
    expect(result.eventId).toBeGreaterThan(0);
    expect(result.summaryId).toBeGreaterThan(0);
    expect(result.legacyAttendanceId).toBeGreaterThan(0);

    const [raw] = await db
      .select()
      .from(attendanceRawEventsTable)
      .where(eq(attendanceRawEventsTable.id, result.rawEventId));
    expect(raw?.processingStatus).toBe("normalized");

    const [evt] = await db
      .select()
      .from(attendanceEventsTable)
      .where(eq(attendanceEventsTable.id, result.eventId));
    expect(evt?.employeeId).toBe(employeeId);
  });

  it("prevents duplicate raw events (idempotency)", async () => {
    if (!tablesReady) return;
    const { attendanceIngestionService } = await import(
      "../../lib/workforce-attendance/ingestion-service"
    );
    const externalId = `dup-${Date.now()}`;
    const base = {
      workspaceId,
      sourceCode: "web",
      employeeId,
      eventTypeHint: "clock_in" as const,
      occurredAt: new Date("2026-05-19T09:00:00Z"),
      timezone: "UTC",
      payload: { dup: true },
      externalId,
    };

    const first = await attendanceIngestionService.ingestRawEvent(base);
    const second = await attendanceIngestionService.ingestRawEvent(base);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.rawEventId).toBe(first.rawEventId);
  });

  it("builds daily summary and dual-writes hr_attendance", async () => {
    if (!tablesReady) return;
    const { processIngestedEvent } = await import("../../lib/workforce-attendance/pipeline");
    const day = "2026-05-20";
    const ext = `summary-${Date.now()}`;

    await processIngestedEvent({
      workspaceId,
      sourceCode: "web",
      employeeId,
      eventTypeHint: "clock_in",
      occurredAt: new Date(`${day}T08:00:00Z`),
      timezone: "UTC",
      payload: {},
      externalId: `${ext}-in`,
    });
    const out = await processIngestedEvent({
      workspaceId,
      sourceCode: "web",
      employeeId,
      eventTypeHint: "clock_out",
      occurredAt: new Date(`${day}T17:00:00Z`),
      timezone: "UTC",
      payload: {},
      externalId: `${ext}-out`,
    });

    const [summary] = await db
      .select()
      .from(attendanceDailySummariesTable)
      .where(eq(attendanceDailySummariesTable.id, out.summaryId));
    expect(summary?.firstIn).toBeTruthy();
    expect(summary?.lastOut).toBeTruthy();
    expect(summary?.workedMinutes).toBeGreaterThan(0);

    const [legacy] = await db
      .select()
      .from(hrAttendanceTable)
      .where(
        and(
          eq(hrAttendanceTable.workspaceId, workspaceId),
          eq(hrAttendanceTable.employeeId, employeeId),
          eq(hrAttendanceTable.date, day),
        ),
      );
    expect(legacy?.id).toBe(out.legacyAttendanceId);
    expect(legacy?.checkIn).toBe(summary?.firstIn);
  });

  it("enforces workspace isolation on employee resolution", async () => {
    if (!tablesReady) return;
    const { attendanceIngestionService } = await import(
      "../../lib/workforce-attendance/ingestion-service"
    );
    await expect(
      attendanceIngestionService.ingestRawEvent({
        workspaceId: otherWorkspaceId,
        sourceCode: "manual",
        employeeId,
        eventTypeHint: "clock_in",
        occurredAt: new Date(),
        payload: {},
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("web clock-in / clock-out APIs", async () => {
    if (!tablesReady) return;
    const app = await mountWorkforceRouter(auth);

    const inRes = await request(app)
      .post("/hr/workforce/clock-in")
      .send({ location: { lat: 24.7, lng: 46.6 } });
    expect(inRes.status).toBe(201);
    expect(inRes.body.success).toBe(true);
    expect(inRes.body.rawEventId).toBeGreaterThan(0);

    const outRes = await request(app).post("/hr/workforce/clock-out").send({});
    expect(outRes.status).toBe(201);
    expect(outRes.body.success).toBe(true);
  });

  it("hr.attendance.period report definition remains registered", async () => {
    if (!tablesReady) return;
    const { REPORT_DEFINITIONS } = await import("../../lib/reports/report-definition-registry");
    const def = REPORT_DEFINITIONS.find((d) => d.key === "hr.attendance.period");
    expect(def).toBeDefined();
    expect(def?.module).toBe("hr");
  });
});
