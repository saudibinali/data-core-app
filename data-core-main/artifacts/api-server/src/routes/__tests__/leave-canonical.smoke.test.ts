/**
 * @phase P18-D1 — Canonical leave API smoke tests (real DB)
 *
 * Requires DATABASE_URL and applied migration 0001_leave_canonical.
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server test leave-canonical.smoke
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
  usersTable,
  employeesTable,
  hrLeavePoliciesTable,
  hrLeaveBalancesTable,
  leaveRequestsTable,
  hrEmployeeLeavesTable,
} from "@workspace/db";

import { isSmokeDatabaseAvailable } from "../../test-utils/smoke-db";

const RUN = isSmokeDatabaseAvailable() && process.env.RUN_LEAVE_SMOKE !== "0";

vi.mock("../../lib/events", () => ({
  appEventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  EVENT_TYPES: {
    LEAVE_REQUESTED: "leave.requested",
    LEAVE_APPROVED: "leave.approved",
    LEAVE_REJECTED: "leave.rejected",
    LEAVE_WITHDRAWN: "leave.withdrawn",
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type AuthCtx = {
  userId: number;
  workspaceId: number;
  userRole: string;
};

let employeeAuth: AuthCtx;
let managerAuth: AuthCtx;
let policyId: number;
let balanceId: number;
let workspaceId: number;
let tablesReady = false;

async function tablesExist(): Promise<boolean> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('leave_requests', 'leave_approval_steps')`,
  );
  return Number(r.rows[0]?.c) >= 2;
}

function mountLeaveRouter(as: AuthCtx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as AuthCtx;
      r.userId = as.userId;
      r.workspaceId = as.workspaceId;
      r.userRole = as.userRole;
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

describe.skipIf(!RUN)("P18-D1 leave canonical smoke (integration)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    initializeDatabase(process.env.DATABASE_URL);
    tablesReady = await tablesExist();
    if (!tablesReady) return;

    const slug = `leave-smoke-${Date.now()}`;
    const [ws] = await db
      .insert(workspacesTable)
      .values({ name: "Leave Smoke WS", slug })
      .returning();
    workspaceId = ws!.id;

    // Raw insert: local DB may lag schema on optional platform profile columns (P18-B drift).
    const mgrInsert = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status)
       VALUES ($1, $2, $3, 'admin', 'active') RETURNING id`,
      [workspaceId, `mgr-${slug}@test.local`, "Leave Manager"],
    );
    const empInsert = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status)
       VALUES ($1, $2, $3, 'member', 'active') RETURNING id`,
      [workspaceId, `emp-${slug}@test.local`, "Leave Employee"],
    );
    const mgrUser = { id: mgrInsert.rows[0]!.id };
    const empUser = { id: empInsert.rows[0]!.id };

    const [mgrEmp] = await db
      .insert(employeesTable)
      .values({
        workspaceId,
        userId: mgrUser!.id,
        fullName: "Leave Manager",
        status: "active",
      })
      .returning();

    await db.insert(employeesTable).values({
      workspaceId,
      userId: empUser!.id,
      fullName: "Leave Employee",
      status: "active",
      directManagerId: mgrEmp!.id,
    });

    const [policy] = await db
      .insert(hrLeavePoliciesTable)
      .values({
        workspaceId,
        name: "Annual Smoke",
        leaveType: "annual",
        annualDays: 20,
        requiresApproval: true,
        isActive: true,
      })
      .returning();
    policyId = policy!.id;

    const year = 2031;
    const [empRow] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(
        and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, empUser!.id)),
      );

    const [bal] = await db
      .insert(hrLeaveBalancesTable)
      .values({
        workspaceId,
        employeeId: empRow!.id,
        leavePolicyId: policyId,
        leaveType: "annual",
        year,
        entitled: "10",
        used: "0",
        pending: "0",
      })
      .returning();
    balanceId = bal!.id;

    managerAuth = { userId: mgrUser!.id, workspaceId, userRole: "admin" };
    employeeAuth = { userId: empUser!.id, workspaceId, userRole: "member" };
  }, 60_000);

  afterAll(async () => {
    if (!tablesReady || !workspaceId) return;
    await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
    await pool.end().catch(() => undefined);
  }, 30_000);

  it("prerequisite: canonical tables exist", () => {
    expect(tablesReady).toBe(true);
  });

  it("submits a leave request", async () => {
    const app = await mountLeaveRouter(employeeAuth);
    const res = await request(app)
      .post("/hr/leave-requests")
      .send({
        leaveType: "annual",
        startDate: "2031-03-03",
        endDate: "2031-03-05",
        leavePolicyId: policyId,
        employeeNote: "smoke submit",
      });
    expect(res.status).toBe(201);
    expect(res.body.leaveRequest?.requestNumber).toMatch(/^LRQ-/);
    expect(res.body.leaveRequest?.status).toBe("pending_approval");
    expect(res.body.leaveApprovalStep?.status).toBe("pending");

    const [bal] = await db
      .select()
      .from(hrLeaveBalancesTable)
      .where(eq(hrLeaveBalancesTable.id, balanceId));
    expect(parseFloat(bal!.pending)).toBeGreaterThan(0);
  });

  it("returns 409 on overlapping request", async () => {
    const app = await mountLeaveRouter(employeeAuth);
    const res = await request(app)
      .post("/hr/leave-requests")
      .send({
        leaveType: "annual",
        startDate: "2031-03-04",
        endDate: "2031-03-04",
        leavePolicyId: policyId,
      });
    expect(res.status).toBe(409);
  });

  it("returns 422 on insufficient balance", async () => {
    await db
      .update(hrLeaveBalancesTable)
      .set({ entitled: "1", pending: "0", used: "0" })
      .where(eq(hrLeaveBalancesTable.id, balanceId));

    const app = await mountLeaveRouter(employeeAuth);
    const res = await request(app)
      .post("/hr/leave-requests")
      .send({
        leaveType: "annual",
        startDate: "2031-06-02",
        endDate: "2031-06-10",
        leavePolicyId: policyId,
      });
    expect(res.status).toBe(422);

    await db
      .update(hrLeaveBalancesTable)
      .set({ entitled: "10" })
      .where(eq(hrLeaveBalancesTable.id, balanceId));
  });

  it("approves a pending request", async () => {
    const [pending] = await db
      .select()
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.workspaceId, workspaceId),
          eq(leaveRequestsTable.status, "pending_approval"),
        ),
      )
      .limit(1);

    const app = await mountLeaveRouter(managerAuth);
    const res = await request(app)
      .patch(`/hr/leave-requests/${pending!.id}/approve`)
      .send({ comment: "approved in smoke" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("rejects a new pending request", async () => {
    const appEmp = await mountLeaveRouter(employeeAuth);
    const submit = await request(appEmp)
      .post("/hr/leave-requests")
      .send({
        leaveType: "annual",
        startDate: "2031-07-07",
        endDate: "2031-07-08",
        leavePolicyId: policyId,
      });
    expect(submit.status).toBe(201);
    const id = submit.body.leaveRequest.id as number;

    const appMgr = await mountLeaveRouter(managerAuth);
    const res = await request(appMgr)
      .patch(`/hr/leave-requests/${id}/reject`)
      .send({ comment: "rejected in smoke" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
  });

  it("withdraws own pending request", async () => {
    const appEmp = await mountLeaveRouter(employeeAuth);
    const submit = await request(appEmp)
      .post("/hr/leave-requests")
      .send({
        leaveType: "annual",
        startDate: "2031-08-11",
        endDate: "2031-08-12",
        leavePolicyId: policyId,
      });
    expect(submit.status).toBe(201);
    const id = submit.body.leaveRequest.id as number;

    const res = await request(appEmp)
      .patch(`/hr/leave-requests/${id}/withdraw`)
      .send({ reason: "changed plans" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("withdrawn");
  });

  it("legacy hr_employee_leaves insert still works", async () => {
    vi.resetModules();
    vi.doMock("../../middlewares/requireAuth", () => ({
      requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        const r = req as unknown as AuthCtx;
        r.userId = employeeAuth.userId;
        r.workspaceId = employeeAuth.workspaceId;
        r.userRole = employeeAuth.userRole;
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

    const before = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hrEmployeeLeavesTable)
      .where(eq(hrEmployeeLeavesTable.workspaceId, workspaceId));

    const res = await request(app).post("/hr/me/leave-requests").send({
      leaveType: "annual",
      startDate: "2031-09-01",
      endDate: "2031-09-02",
      daysCount: 2,
    });
    expect(res.status).toBe(201);

    const after = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hrEmployeeLeavesTable)
      .where(eq(hrEmployeeLeavesTable.workspaceId, workspaceId));
    expect(after[0]!.c).toBeGreaterThan(before[0]!.c);
  });
});
