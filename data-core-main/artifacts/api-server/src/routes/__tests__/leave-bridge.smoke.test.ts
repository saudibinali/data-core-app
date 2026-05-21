/**
 * @phase P18-D2 — Leave read bridge smoke tests (canonical list + isolation)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { eq, and, sql } from "drizzle-orm";
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

let empCtx: Ctx;
let otherEmpCtx: Ctx;
let hrCtx: Ctx;
let wsA: number;
let wsB: number;
let policyId: number;
let tablesReady = false;

async function insertUser(wsId: number, role: string, name: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [wsId, `${name}-${Date.now()}@bridge.test`, name, role],
  );
  return r.rows[0]!.id;
}

function mountLeaveRouter(ctx: Ctx) {
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
  return import("../leave").then(({ default: leaveRouter }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(leaveRouter as any);
    return app;
  });
}

describe.skipIf(!RUN)("P18-D2 leave bridge smoke", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    initializeDatabase(process.env.DATABASE_URL);
    tablesReady = true;

    const [ws1] = await db.insert(workspacesTable).values({ name: "Bridge A", slug: `bridge-a-${Date.now()}` }).returning();
    const [ws2] = await db.insert(workspacesTable).values({ name: "Bridge B", slug: `bridge-b-${Date.now()}` }).returning();
    wsA = ws1!.id;
    wsB = ws2!.id;

    const empUserId = await insertUser(wsA, "member", "Bridge Emp");
    const otherUserId = await insertUser(wsA, "member", "Bridge Other");
    const hrUserId = await insertUser(wsA, "admin", "Bridge HR");

    const [emp] = await db.insert(employeesTable).values({
      workspaceId: wsA, userId: empUserId, fullName: "Bridge Emp", status: "active",
    }).returning();
    await db.insert(employeesTable).values({
      workspaceId: wsA, userId: otherUserId, fullName: "Bridge Other", status: "active",
    });

    const [policy] = await db.insert(hrLeavePoliciesTable).values({
      workspaceId: wsA, name: "Annual", leaveType: "annual", requiresApproval: true,
    }).returning();
    policyId = policy!.id;

    await db.insert(hrLeaveBalancesTable).values({
      workspaceId: wsA, employeeId: emp!.id, leavePolicyId: policyId, leaveType: "annual",
      year: 2032, entitled: "10",
    });

    empCtx = { userId: empUserId, workspaceId: wsA, userRole: "member", perms: [] };
    otherEmpCtx = { userId: otherUserId, workspaceId: wsA, userRole: "member", perms: [] };
    hrCtx = { userId: hrUserId, workspaceId: wsA, userRole: "admin", perms: ["hr.manage"] };

    await db.insert(leaveRequestsTable).values({
      workspaceId: wsA,
      employeeId: emp!.id,
      requestedByUserId: empUserId,
      leavePolicyId: policyId,
      leaveType: "annual",
      startDate: "2032-04-01",
      endDate: "2032-04-03",
      daysRequested: 3,
      businessDaysCount: 3,
      status: "pending_approval",
      requestNumber: `LRQ-BRIDGE-${Date.now()}`,
    });
  }, 60_000);

  afterAll(async () => {
    if (wsA) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsA));
    if (wsB) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsB));
    await pool.end().catch(() => undefined);
  });

  it("employee sees own canonical leave list", async () => {
    const app = await mountLeaveRouter(empCtx);
    const res = await request(app).get("/hr/leave-requests");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((r: { employeeId: number }) => r.employeeId)).toBe(true);
  });

  it("employee cannot read another employee request by id", async () => {
    const appEmp = await mountLeaveRouter(empCtx);
    const list = await request(appEmp).get("/hr/leave-requests");
    const id = list.body[0].id as number;

    const appOther = await mountLeaveRouter(otherEmpCtx);
    const res = await request(appOther).get(`/hr/leave-requests/${id}`);
    expect(res.status).toBe(403);
  });

  it("HR user can list all workspace requests", async () => {
    const app = await mountLeaveRouter(hrCtx);
    const res = await request(app).get("/hr/leave-requests");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /hr/me/leave-policies returns active policies", async () => {
    const app = await mountLeaveRouter(empCtx);
    const res = await request(app).get("/hr/me/leave-policies");
    expect(res.status).toBe(200);
    expect(res.body.some((p: { id: number }) => p.id === policyId)).toBe(true);
  });

  it("legacy write does not create canonical row (no dual-write)", async () => {
    const before = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.workspaceId, wsA));

    vi.resetModules();
    vi.doMock("../../middlewares/requireAuth", () => ({
      requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        const r = req as unknown as Ctx;
        r.userId = empCtx.userId;
        r.workspaceId = empCtx.workspaceId;
        r.userRole = empCtx.userRole;
        next();
      },
      requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(),
      requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(),
    }));
    const { default: hrRouter } = await import("../hr");
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(hrRouter as any);

    const post = await request(app).post("/hr/me/leave-requests").send({
      leaveType: "annual",
      startDate: "2032-05-01",
      endDate: "2032-05-02",
      daysCount: 2,
    });
    expect(post.status).toBe(201);

    const after = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.workspaceId, wsA));

    const legacyCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hrEmployeeLeavesTable)
      .where(eq(hrEmployeeLeavesTable.workspaceId, wsA));

    expect(after[0]!.c).toBe(before[0]!.c);
    expect(legacyCount[0]!.c).toBeGreaterThan(0);
  });

  it("workspace isolation on list", async () => {
    const otherUser = await insertUser(wsB, "member", "WsB Emp");
    const [empB] = await db.insert(employeesTable).values({
      workspaceId: wsB, userId: otherUser, fullName: "WsB Emp", status: "active",
    }).returning();
    await db.insert(leaveRequestsTable).values({
      workspaceId: wsB,
      employeeId: empB!.id,
      requestedByUserId: otherUser,
      leaveType: "annual",
      startDate: "2032-06-01",
      endDate: "2032-06-02",
      daysRequested: 2,
      businessDaysCount: 2,
      status: "approved",
      requestNumber: `LRQ-WSB-${Date.now()}`,
    });

    const app = await mountLeaveRouter({
      userId: otherUser,
      workspaceId: wsB,
      userRole: "member",
      perms: [],
    });
    const res = await request(app).get("/hr/leave-requests");
    expect(res.status).toBe(200);
    expect(res.body.every((r: { workspaceId: number }) => r.workspaceId === wsB)).toBe(true);

    const appA = await mountLeaveRouter(empCtx);
    const resA = await request(appA).get("/hr/leave-requests");
    expect(resA.body.every((r: { workspaceId: number }) => r.workspaceId === wsA)).toBe(true);
  });
});
