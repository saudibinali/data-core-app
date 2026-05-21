/**
 * P20-D — Self-service clocking & geofence smoke tests
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server vitest run workforce-self-service.smoke
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { db, pool, initializeDatabase, workspacesTable, employeesTable } from "@workspace/db";
import { haversineMeters } from "../../lib/workforce-attendance/geofence-validation-service";
import { DEFAULT_ATTENDANCE_POLICY } from "../../lib/workforce-attendance/policy-types";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_WORKFORCE_SELF_SERVICE_SMOKE !== "0";

describe("P20-D geofence unit", () => {
  it("haversine distance is zero for same point", () => {
    expect(haversineMeters(24.7, 46.6, 24.7, 46.6)).toBeLessThan(1);
  });

  it("default policy uses warning mode not hard reject", () => {
    expect(DEFAULT_ATTENDANCE_POLICY.geofenceRequired).toBe(false);
    expect(DEFAULT_ATTENDANCE_POLICY.suspiciousLocationAction).toBe("flag");
  });
});

describe.skipIf(!RUN)("P20-D self-service integration", () => {
  let workspaceId: number;
  let userId: number;
  let employeeId: number;
  let tablesReady = false;

  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = 'attendance_geofences'`,
    );
    tablesReady = Number(r.rows[0]?.c) >= 1;
    if (!tablesReady) return;

    const slug = `ss-att-${Date.now()}`;
    const [ws] = await db.insert(workspacesTable).values({ name: "SS Att", slug }).returning();
    workspaceId = ws!.id;

    const u = await pool.query<{ id: number }>(
      `INSERT INTO users (workspace_id, email, full_name, role, status)
       VALUES ($1, $2, 'SS User', 'member', 'active') RETURNING id`,
      [workspaceId, `ss-${slug}@test.local`],
    );
    userId = u.rows[0]!.id;

    const [emp] = await db
      .insert(employeesTable)
      .values({
        workspaceId,
        userId,
        fullName: "SS Employee",
        employeeNumber: "SS-001",
        status: "active",
      })
      .returning();
    employeeId = emp!.id;

    const { seedAttendanceSourcesForWorkspace } = await import(
      "../../lib/workforce-attendance/source-seed"
    );
    const { attendancePolicyService } = await import(
      "../../lib/workforce-attendance/attendance-policy-service"
    );
    await seedAttendanceSourcesForWorkspace(workspaceId);
    await attendancePolicyService.ensureDefaultPolicy(workspaceId);
    void employeeId;
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("GET me/status and clock in/out", async () => {
    if (!tablesReady) return;

    vi.resetModules();
    const auth = { userId, workspaceId, userRole: "member" };
    vi.doMock("../../middlewares/requireAuth", () => ({
      requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        Object.assign(req, auth);
        next();
      },
    }));

    const { default: router } = await import("../workforce-attendance");
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);

    const statusRes = await request(app).get("/hr/workforce/me/status");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.canClockIn).toBe(true);

    const inRes = await request(app)
      .post("/hr/workforce/clock-in")
      .send({ location: { lat: 24.7136, lng: 46.6753, accuracyM: 30 } });
    expect(inRes.status).toBe(201);
    expect(inRes.body.success).toBe(true);

    const status2 = await request(app).get("/hr/workforce/me/status");
    expect(status2.body.canClockOut).toBe(true);

    const outRes = await request(app).post("/hr/workforce/clock-out").send({});
    expect(outRes.status).toBe(201);
  });

  it("geofence validation warns outside radius", async () => {
    if (!tablesReady) return;
    const { geofenceValidationService } = await import(
      "../../lib/workforce-attendance/geofence-validation-service"
    );
    const result = geofenceValidationService.validateAgainstGeofences(
      { lat: 25.0, lng: 47.0, accuracyM: 20 },
      [{ id: 1, latitude: 24.7136, longitude: 46.6753, radiusMeters: 200 }],
      DEFAULT_ATTENDANCE_POLICY,
    );
    expect(result.withinGeofence).toBe(false);
    expect(result.warnings.some((w) => w.code === "out_of_geofence")).toBe(true);
    expect(result.shouldReject).toBe(false);
  });
});
