/**
 * @phase P18-D4 — Pilot production cutover safety tests
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
  leaveApprovalStepsTable,
} from "@workspace/db";
import { resetLeaveCutoverMetrics, getLeaveCutoverMetrics } from "../../lib/leave-cutover-metrics";

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

let pilotWs: number;
let otherWs: number;
let empCtx: Ctx;
let hrManageCtx: Ctx;
let otherEmpCtx: Ctx;
let policyId: number;
let empId: number;

async function insertUser(wsId: number, role: string, name: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [wsId, `${name}-${Date.now()}@pilot.test`, name, role],
  );
  return r.rows[0]!.id;
}

function mountHr(ctx: Ctx) {
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

function mountLeave(ctx: Ctx) {
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

describe.skipIf(!RUN)("P18-D4 pilot production cutover", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    resetLeaveCutoverMetrics();

    const [pilot] = await db
      .insert(workspacesTable)
      .values({ name: "Leave Pilot WS", slug: `leave-pilot-${Date.now()}` })
      .returning();
    const [other] = await db
      .insert(workspacesTable)
      .values({ name: "Leave Other WS", slug: `leave-other-${Date.now()}` })
      .returning();
    pilotWs = pilot!.id;
    otherWs = other!.id;

    process.env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID = String(pilotWs);
    process.env.CANONICAL_LEAVE_SUBMIT = "true";
    process.env.CANONICAL_LEAVE_APPROVE = "true";
    process.env.LEGACY_LEAVE_FREEZE = "true";

    const empUser = await insertUser(pilotWs, "member", "Pilot Emp");
    const hrMgrUser = await insertUser(pilotWs, "member", "Pilot HR");
    const otherUser = await insertUser(otherWs, "member", "Other Emp");

    const [emp] = await db
      .insert(employeesTable)
      .values({ workspaceId: pilotWs, userId: empUser, fullName: "Pilot Emp", status: "active" })
      .returning();
    empId = emp!.id;
    const [otherEmp] = await db
      .insert(employeesTable)
      .values({ workspaceId: otherWs, userId: otherUser, fullName: "Other Emp", status: "active" })
      .returning();

    const [policy] = await db
      .insert(hrLeavePoliciesTable)
      .values({
        workspaceId: pilotWs, name: "Annual", leaveType: "annual", requiresApproval: true,
      })
      .returning();
    policyId = policy!.id;

    await db.insert(hrLeaveBalancesTable).values({
      workspaceId: pilotWs,
      employeeId: empId,
      leavePolicyId: policyId,
      leaveType: "annual",
      year: 2035,
      entitled: "20",
    });

    empCtx = { userId: empUser, workspaceId: pilotWs, userRole: "member", perms: [] };
    hrManageCtx = { userId: hrMgrUser, workspaceId: pilotWs, userRole: "member", perms: ["hr.manage"] };
    otherEmpCtx = { userId: otherUser, workspaceId: otherWs, userRole: "member", perms: [] };
    void otherEmp;
  }, 90_000);

  afterAll(async () => {
    delete process.env.LEAVE_CUTOVER_PILOT_WORKSPACE_ID;
    delete process.env.CANONICAL_LEAVE_SUBMIT;
    delete process.env.CANONICAL_LEAVE_APPROVE;
    delete process.env.LEGACY_LEAVE_FREEZE;
    if (pilotWs) await db.delete(workspacesTable).where(eq(workspacesTable.id, pilotWs));
    if (otherWs) await db.delete(workspacesTable).where(eq(workspacesTable.id, otherWs));
    await pool.end().catch(() => undefined);
  });

  it("legacy POST returns 410 on pilot when frozen", async () => {
    const app = await mountHr(empCtx);
    const res = await request(app).post("/hr/me/leave-requests").send({
      leaveType: "annual",
      startDate: "2035-02-01",
      endDate: "2035-02-02",
      daysCount: 2,
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("LEGACY_LEAVE_FROZEN");
    expect(res.body.canonicalEndpoints?.submit).toBe("POST /hr/leave-requests");
  });

  it("legacy POST still allowed on non-pilot workspace", async () => {
    const app = await mountHr(otherEmpCtx);
    const before = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hrEmployeeLeavesTable)
      .where(eq(hrEmployeeLeavesTable.workspaceId, otherWs));
    const res = await request(app).post("/hr/me/leave-requests").send({
      leaveType: "annual",
      startDate: "2035-03-01",
      endDate: "2035-03-02",
      daysCount: 2,
    });
    expect(res.status).toBe(201);
    const after = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hrEmployeeLeavesTable)
      .where(eq(hrEmployeeLeavesTable.workspaceId, otherWs));
    expect(after[0]!.c).toBe(before[0]!.c + 1);
  });

  it("canonical submit blocked by legacy overlap", async () => {
    await db.insert(hrEmployeeLeavesTable).values({
      workspaceId: pilotWs,
      employeeId: empId,
      leaveType: "annual",
      startDate: "2035-04-01",
      endDate: "2035-04-03",
      daysCount: 3,
      status: "pending",
      createdBy: empCtx.userId,
    });
    const app = await mountLeave(empCtx);
    const res = await request(app).post("/hr/leave-requests").send({
      leaveType: "annual",
      startDate: "2035-04-02",
      endDate: "2035-04-04",
      leavePolicyId: policyId,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/legacy/i);
  });

  it("canonical submit succeeds and creates approval step", async () => {
    const app = await mountLeave(empCtx);
    const res = await request(app).post("/hr/leave-requests").send({
      leaveType: "annual",
      startDate: "2035-05-10",
      endDate: "2035-05-12",
      leavePolicyId: policyId,
    });
    expect(res.status).toBe(201);
    expect(res.body.leaveRequest.status).toBe("pending_approval");
    expect(res.body.leaveApprovalStep).toBeTruthy();

    const steps = await db
      .select()
      .from(leaveApprovalStepsTable)
      .where(eq(leaveApprovalStepsTable.leaveRequestId, res.body.leaveRequest.id));
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it("hr.manage user can approve canonical request", async () => {
    const appSubmit = await mountLeave(empCtx);
    const created = await request(appSubmit).post("/hr/leave-requests").send({
      leaveType: "annual",
      startDate: "2035-06-10",
      endDate: "2035-06-11",
      leavePolicyId: policyId,
    });
    const id = created.body.leaveRequest.id as number;

    const appHr = await mountLeave(hrManageCtx);
    const approved = await request(appHr).patch(`/hr/leave-requests/${id}/approve`).send({ comment: "ok" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
  });

  it("cutover status reflects pilot flags only for pilot workspace", async () => {
    const appPilot = await mountLeave(empCtx);
    const pilotStatus = await request(appPilot).get("/hr/leave-cutover/status");
    expect(pilotStatus.body.isPilotWorkspace).toBe(true);
    expect(pilotStatus.body.legacyFreeze).toBe(true);

    const appOther = await mountLeave(otherEmpCtx);
    const otherStatus = await request(appOther).get("/hr/leave-cutover/status");
    expect(otherStatus.body.isPilotWorkspace).toBe(false);
    expect(otherStatus.body.legacyFreeze).toBe(false);
  });
});
