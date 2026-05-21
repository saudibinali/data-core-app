/**
 * @phase P18-D3 — Transitional safety tests (no freeze applied; flags default OFF)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  initializeDatabase,
  workspacesTable,
  employeesTable,
  hrLeavePoliciesTable,
  hrLeaveBalancesTable,
  leaveRequestsTable,
  hrEmployeeLeavesTable,
} from "@workspace/db";
import { getLeaveCutoverFlags } from "../../lib/leave-cutover-flags";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_LEAVE_SMOKE !== "0";

vi.mock("../../lib/events", () => ({
  appEventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  EVENT_TYPES: {},
}));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Ctx = { userId: number; workspaceId: number; userRole: string; perms: string[] };

let hrCtx: Ctx;
let empCtx: Ctx;
let wsId: number;
let canonicalId: number;
let legacyId: number;

async function insertUser(ws: number, role: string, name: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [ws, `${name}-${Date.now()}@cutover.test`, name, role],
  );
  return r.rows[0]!.id;
}

function mountHrRouter(ctx: Ctx) {
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
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  return import("../hr").then(({ default: hrRouter }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(hrRouter as any);
    return app;
  });
}

function mountLeaveRouter(ctx: Ctx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as Ctx;
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      next();
    },
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  return import("../leave").then(({ default: leaveRouter }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(leaveRouter as any);
    return app;
  });
}

describe("P18-D3 leave cutover flags (unit)", () => {
  it("freeze flag defaults off (readiness only)", () => {
    expect(getLeaveCutoverFlags({}).legacyLeaveFreeze).toBe(false);
  });

  it("parses LEGACY_LEAVE_FREEZE when set", () => {
    expect(getLeaveCutoverFlags({ LEGACY_LEAVE_FREEZE: "true" }).legacyLeaveFreeze).toBe(true);
  });
});

describe.skipIf(!RUN)("P18-D3 leave cutover safety (integration)", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    const [ws] = await db
      .insert(workspacesTable)
      .values({ name: "Cutover Safety", slug: `cutover-${Date.now()}` })
      .returning();
    wsId = ws!.id;

    const hrUserId = await insertUser(wsId, "admin", "Cutover HR");
    const empUserId = await insertUser(wsId, "member", "Cutover Emp");
    const [emp] = await db
      .insert(employeesTable)
      .values({ workspaceId: wsId, userId: empUserId, fullName: "Cutover Emp", status: "active" })
      .returning();
    const [policy] = await db
      .insert(hrLeavePoliciesTable)
      .values({
        workspaceId: wsId,
        name: "Annual",
        leaveType: "annual",
        requiresApproval: true,
      })
      .returning();

    await db.insert(hrLeaveBalancesTable).values({
      workspaceId: wsId,
      employeeId: emp!.id,
      leavePolicyId: policy!.id,
      leaveType: "annual",
      year: 2033,
      entitled: "10",
    });

    const [canon] = await db
      .insert(leaveRequestsTable)
      .values({
        workspaceId: wsId,
        employeeId: emp!.id,
        requestedByUserId: empUserId,
        leavePolicyId: policy!.id,
        leaveType: "annual",
        startDate: "2033-07-01",
        endDate: "2033-07-03",
        daysRequested: 3,
        businessDaysCount: 3,
        status: "pending_approval",
        requestNumber: `LRQ-CUTOVER-${Date.now()}`,
      })
      .returning();
    canonicalId = canon!.id;

    const [leg] = await db
      .insert(hrEmployeeLeavesTable)
      .values({
        workspaceId: wsId,
        employeeId: emp!.id,
        leaveType: "annual",
        startDate: "2033-08-01",
        endDate: "2033-08-02",
        daysCount: 2,
        status: "pending",
        createdBy: empUserId,
      })
      .returning();
    legacyId = leg!.id;

    hrCtx = { userId: hrUserId, workspaceId: wsId, userRole: "admin", perms: ["hr.manage"] };
    empCtx = { userId: empUserId, workspaceId: wsId, userRole: "member", perms: [] };
  }, 60_000);

  afterAll(async () => {
    if (wsId) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsId));
    await pool.end().catch(() => undefined);
  });

  it("legacy PATCH does not modify canonical leave_requests row", async () => {
    const app = await mountHrRouter(hrCtx);
    const res = await request(app)
      .patch(`/hr/attendance/leaves/${canonicalId}`)
      .send({ status: "approved" });
    expect(res.status).toBe(404);

    const [row] = await db
      .select({ status: leaveRequestsTable.status })
      .from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.id, canonicalId));
    expect(row?.status).toBe("pending_approval");
  });

  it("legacy PATCH still updates hr_employee_leaves when id matches legacy", async () => {
    const app = await mountHrRouter(hrCtx);
    const res = await request(app)
      .patch(`/hr/attendance/leaves/${legacyId}`)
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("HR sees canonical pending in list (approval visibility)", async () => {
    const app = await mountLeaveRouter(hrCtx);
    const res = await request(app).get("/hr/leave-requests?status=pending");
    expect(res.status).toBe(200);
    expect(res.body.some((r: { id: number }) => r.id === canonicalId)).toBe(true);
  });

  it("legacy POST does not increment leave_requests (no dual-write)", async () => {
    const before = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.workspaceId, wsId));

    const app = await mountHrRouter(empCtx);
    const post = await request(app).post("/hr/me/leave-requests").send({
      leaveType: "annual",
      startDate: "2033-09-01",
      endDate: "2033-09-02",
      daysCount: 2,
    });
    expect(post.status).toBe(201);

    const after = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.workspaceId, wsId));

    expect(after[0]!.c).toBe(before[0]!.c);
  });
});
