/**
 * @phase F0.3 — Production smoke suite (auth, HR employee CRUD, tenant isolation)
 *
 * Run after deploy / migrate:
 *   RUN_POST_DEPLOY_SMOKE=1 DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run production-smoke.core.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  initializeDatabase,
  workspacesTable,
  employeesTable,
  hrOrgUnitsTable,
} from "@workspace/db";
import { postDeploySmokeEnabled } from "../../test-utils/smoke-db";

const RUN = postDeploySmokeEnabled();

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
let adminB: AuthCtx;
let loginPassword: string;
let loginEmployeeNumber: string;
let createdEmployeeId: number;

async function insertUser(
  wsId: number,
  role: string,
  name: string,
  opts?: { employeeNumber?: string; password?: string },
) {
  const hash = opts?.password ? await bcrypt.hash(opts.password, 10) : null;
  const empNo = opts?.employeeNumber ?? `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status, employee_number, password_hash)
     VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING id`,
    [wsId, `${name}-${Date.now()}@f03-smoke.test`, name, role, empNo, hash],
  );
  return { id: r.rows[0]!.id, employeeNumber: empNo };
}

function mountAuthApp() {
  return import("../auth").then(({ default: authRouter }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(authRouter as any);
    return app;
  });
}

function mountHrApp(ctx: AuthCtx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as AuthCtx;
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      r.userPermissions = ctx.userPermissions ?? ["hr.view", "hr.manage"];
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

describe.skipIf(!RUN)("F0.3 production smoke core", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);

    const slugA = `f03-a-${Date.now()}`;
    const slugB = `f03-b-${Date.now()}`;
    const [a] = await db.insert(workspacesTable).values({ name: "F03 WS A", slug: slugA }).returning();
    const [b] = await db.insert(workspacesTable).values({ name: "F03 WS B", slug: slugB }).returning();
    wsA = a!.id;
    wsB = b!.id;

    loginPassword = "SmokeTest!2026";
    const loginUser = await insertUser(wsA, "admin", "LoginAdmin", {
      password: loginPassword,
      employeeNumber: `F03-LOGIN-${Date.now()}`,
    });
    loginEmployeeNumber = loginUser.employeeNumber;

    const adminUserA = await insertUser(wsA, "admin", "AdminA");
    const adminUserB = await insertUser(wsB, "admin", "AdminB");
    adminA = { userId: adminUserA.id, workspaceId: wsA, userRole: "admin" };
    adminB = { userId: adminUserB.id, workspaceId: wsB, userRole: "admin" };
  });

  afterAll(async () => {
    if (createdEmployeeId) {
      await db.delete(employeesTable).where(eq(employeesTable.id, createdEmployeeId)).catch(() => undefined);
    }
    if (wsA) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsA)).catch(() => undefined);
    if (wsB) await db.delete(workspacesTable).where(eq(workspacesTable.id, wsB)).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("auth login returns access token for valid credentials", async () => {
    const app = await mountAuthApp();
    const res = await request(app)
      .post("/auth/login")
      .send({ employeeNumber: loginEmployeeNumber, password: loginPassword });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user?.employeeNumber).toBe(loginEmployeeNumber);
  });

  it("auth login rejects invalid password", async () => {
    const app = await mountAuthApp();
    const res = await request(app)
      .post("/auth/login")
      .send({ employeeNumber: loginEmployeeNumber, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("HR employee CRUD — create, read, update", async () => {
    const app = await mountHrApp(adminA);
    const [orgUnit] = await db
      .insert(hrOrgUnitsTable)
      .values({ workspaceId: wsA, name: "F03 Org", code: `F03-${Date.now()}`, isActive: true })
      .returning();

    const createRes = await request(app)
      .post("/hr/employees")
      .send({
        fullName: "Smoke Employee",
        email: `smoke-${Date.now()}@f03.test`,
        status: "active",
        orgUnitId: orgUnit!.id,
      });
    expect(createRes.status).toBe(201);
    createdEmployeeId = createRes.body.id;
    expect(createdEmployeeId).toBeTruthy();

    const getRes = await request(app).get(`/hr/employees/${createdEmployeeId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.fullName).toBe("Smoke Employee");

    const patchRes = await request(app)
      .patch(`/hr/employees/${createdEmployeeId}`)
      .send({ fullName: "Smoke Employee Updated" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.fullName).toBe("Smoke Employee Updated");
  });

  it("tenant isolation — workspace A admin cannot read workspace B employee", async () => {
    const [orgB] = await db
      .insert(hrOrgUnitsTable)
      .values({ workspaceId: wsB, name: "F03 Org B", code: `F03B-${Date.now()}`, isActive: true })
      .returning();

    const [empB] = await db
      .insert(employeesTable)
      .values({
        workspaceId: wsB,
        fullName: "Tenant B Employee",
        email: `tenant-b-${Date.now()}@f03.test`,
        status: "active",
        orgUnitId: orgB!.id,
      })
      .returning();

    const appA = await mountHrApp(adminA);
    const res = await request(appA).get(`/hr/employees/${empB!.id}`);
    expect(res.status).toBe(404);

    await db
      .delete(employeesTable)
      .where(and(eq(employeesTable.id, empB!.id), eq(employeesTable.workspaceId, wsB)));
  });
});
