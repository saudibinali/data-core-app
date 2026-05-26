/**
 * F2.1 — Cross-tenant isolation security suite.
 *
 *   RUN_TENANT_ISOLATION_TESTS=1 DATABASE_URL=... vitest run tenant-isolation.security.test.ts
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
  ticketsTable,
  usersTable,
  leaveRequestsTable,
  hrPayrollRunsTable,
  hrPayslipsTable,
} from "@workspace/db";
import { isSmokeDatabaseAvailable } from "../../test-utils/smoke-db";

const RUN =
  process.env.RUN_TENANT_ISOLATION_TESTS === "1" && isSmokeDatabaseAvailable();

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../lib/events", () => ({
  appEventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  EVENT_TYPES: {},
}));

type AuthCtx = {
  userId: number;
  workspaceId: number;
  userRole: string;
  userPermissions?: string[];
};

let wsA: number;
let wsB: number;
let adminA: AuthCtx;
let userBId: number;
let ticketBId: number;
let leaveBId: number;
let payslipBId: number;
let payrollRunBId: number;
let empBId: number;

function mockAuth(ctx: AuthCtx) {
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as AuthCtx;
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      r.userPermissions = ctx.userPermissions ?? [
        "tickets.view",
        "users.view",
        "hr.view",
        "hr.manage",
        "leave.view",
        "leave.manage",
      ];
      next();
    },
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
}

async function mountRouter(modulePath: string, ctx: AuthCtx) {
  vi.resetModules();
  mockAuth(ctx);
  const mod = await import(modulePath);
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(mod.default as any);
  return app;
}

describe.skipIf(!RUN)("F2.1 tenant isolation security", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);

    const [a] = await db
      .insert(workspacesTable)
      .values({ name: "F2 WS A", slug: `f2-a-${Date.now()}` })
      .returning();
    const [b] = await db
      .insert(workspacesTable)
      .values({ name: "F2 WS B", slug: `f2-b-${Date.now()}` })
      .returning();
    wsA = a!.id;
    wsB = b!.id;

    const userAR = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status, employee_number)
       VALUES ($1, $2, 'Admin A', 'admin', 'active', $3) RETURNING id`,
      [wsA, `f2-admin-a-${Date.now()}@test`, `F2-A-${Date.now()}`],
    );
    const userBR = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status, employee_number)
       VALUES ($1, $2, 'User B', 'member', 'active', $3) RETURNING id`,
      [wsB, `f2-user-b-${Date.now()}@test`, `F2-B-${Date.now()}`],
    );
    adminA = { userId: userAR.rows[0]!.id, workspaceId: wsA, userRole: "admin" };
    userBId = userBR.rows[0]!.id;

    const [empB] = await db
      .insert(employeesTable)
      .values({
        workspaceId: wsB,
        fullName: "Employee B",
        email: `emp-b-${Date.now()}@test`,
        status: "active",
        userId: userBId,
      })
      .returning();
    empBId = empB!.id;

    const [ticketB] = await db
      .insert(ticketsTable)
      .values({
        workspaceId: wsB,
        title: "Secret ticket B",
        createdByUserId: userBId,
      })
      .returning();
    ticketBId = ticketB!.id;

    const [leaveB] = await db
      .insert(leaveRequestsTable)
      .values({
        workspaceId: wsB,
        employeeId: empBId,
        requestedByUserId: userBId,
        leaveType: "annual",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        daysRequested: 2,
        businessDaysCount: 2,
        status: "pending_approval",
        requestNumber: `LRQ-F2B-${Date.now()}`,
      })
      .returning();
    leaveBId = leaveB!.id;

    const [runB] = await db
      .insert(hrPayrollRunsTable)
      .values({
        workspaceId: wsB,
        code: `F2-RUN-${Date.now()}`,
        name: "F2 Test Run B",
        periodYear: 2026,
        periodMonth: 5,
        status: "draft",
        createdBy: userBId,
      })
      .returning();
    payrollRunBId = runB!.id;

    const [payslipB] = await db
      .insert(hrPayslipsTable)
      .values({
        workspaceId: wsB,
        payrollRunId: payrollRunBId,
        employeeId: empBId,
      })
      .returning();
    payslipBId = payslipB!.id;
  });

  afterAll(async () => {
    if (payslipBId) {
      await db.delete(hrPayslipsTable).where(eq(hrPayslipsTable.id, payslipBId)).catch(() => undefined);
    }
    if (payrollRunBId) {
      await db.delete(hrPayrollRunsTable).where(eq(hrPayrollRunsTable.id, payrollRunBId)).catch(() => undefined);
    }
    if (leaveBId) {
      await db.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, leaveBId)).catch(() => undefined);
    }
    if (ticketBId) {
      await db.delete(ticketsTable).where(eq(ticketsTable.id, ticketBId)).catch(() => undefined);
    }
    if (empBId) {
      await db.delete(employeesTable).where(eq(employeesTable.id, empBId)).catch(() => undefined);
    }
    if (userBId) {
      await db.delete(usersTable).where(eq(usersTable.id, userBId)).catch(() => undefined);
    }
    if (wsA) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsA)).catch(() => undefined);
    if (wsB) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsB)).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("tickets — workspace A cannot read workspace B ticket", async () => {
    const app = await mountRouter("../tickets", adminA);
    const res = await request(app).get(`/tickets/${ticketBId}`);
    expect(res.status).toBe(404);
  });

  it("users — workspace A cannot read workspace B user", async () => {
    const app = await mountRouter("../users", adminA);
    const res = await request(app).get(`/users/${userBId}`);
    expect(res.status).toBe(404);
  });

  it("HR employees — workspace A cannot read workspace B employee", async () => {
    const app = await mountRouter("../hr", adminA);
    const res = await request(app).get(`/hr/employees/${empBId}`);
    expect(res.status).toBe(404);
  });

  it("leave — workspace A cannot read workspace B leave request", async () => {
    const app = await mountRouter("../leave", adminA);
    const res = await request(app).get(`/hr/leave-requests/${leaveBId}`);
    expect(res.status).toBe(404);
  });

  it("payroll payslips — workspace A cannot read workspace B payslip", async () => {
    const app = await mountRouter("../hr", adminA);
    const res = await request(app).get(`/hr/payroll/runs/${payrollRunBId}/payslips/${payslipBId}`);
    expect(res.status).toBe(404);
  });
});
