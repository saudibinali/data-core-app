/**
 * @phase P16-B - Workspace entitlements routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const subFind = vi.fn();
const entFind = vi.fn();
const entFindFirst = vi.fn();
const dbSelect = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    workspaceSubscriptionsTable: { findFirst: subFind },
    workspaceEntitlementsTable: { findFirst: entFindFirst },
  },
  select: dbSelect,
  insert: dbInsert,
  update: dbUpdate,
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  workspacesTable: {},
  activityLogsTable: {},
  workspaceSubscriptionsTable: {},
  workspaceEntitlementsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

let denyPermission = false;
let deniedPermission = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>)["userId"] = 1;
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requirePlatformPermission: (perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission) {
        deniedPermission = perm;
        res.status(403).json({ error: "denied" });
        return;
      }
      next();
    },
}));

const { default: entitlementsRouter } = await import("../workspace-entitlements");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", entitlementsRouter as any);

const TID = 7;
const WS = { id: TID, name: "Tenant" };

const ENT_ROW = {
  id: 1,
  workspaceId: TID,
  subscriptionId: null,
  moduleKey: "hr",
  featureKey: "",
  isEnabled: true,
  source: "manual",
  effectiveFrom: null,
  effectiveUntil: null,
  reason: null,
  internalNotes: null,
  createdBy: 1,
  updatedBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {
    values: vi.fn(() => c),
    onConflictDoUpdate: vi.fn(() => c),
    set: vi.fn(() => c),
    where: vi.fn(() => c),
    returning: () => Promise.resolve(rows),
    from: vi.fn(() => c),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  denyPermission = false;
  wsFind.mockResolvedValue(WS);
  subFind.mockResolvedValue({ id: 1, workspaceId: TID });
  entFindFirst.mockResolvedValue(ENT_ROW);
  dbSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve([ENT_ROW]) }) });
  dbInsert.mockReturnValue(chain([ENT_ROW]));
  dbUpdate.mockReturnValue(chain([ENT_ROW]));
});

describe("GET catalog", () => {
  it("requires platform.entitlements.read", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/entitlements/catalog`);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.entitlements.read");
  });

  it("returns catalog", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/entitlements/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.catalog.modules.some((m: { key: string }) => m.key === "core")).toBe(true);
  });
});

describe("GET entitlements", () => {
  it("requires read permission", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/entitlements`);
    expect(res.status).toBe(403);
  });

  it("returns entitlements list", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/entitlements`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entitlements)).toBe(true);
  });
});

describe("PUT bulk upsert", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({ entitlements: [{ moduleKey: "hr", isEnabled: true }] });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.entitlements.update");
  });

  it("upserts valid entitlement", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({
        entitlements: [
          {
            moduleKey: "hr",
            isEnabled: true,
            source: "manual",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(dbInsert).toHaveBeenCalled();
  });

  it("rejects disabling core", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({
        entitlements: [
          {
            moduleKey: "core",
            isEnabled: false,
            reason: "Attempt disable core module",
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(dbInsert).toHaveBeenCalled();
  });

  it("requires reason when disabling", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({
        entitlements: [{ moduleKey: "hr", isEnabled: false }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects invalid module", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({ entitlements: [{ moduleKey: "not_a_module", isEnabled: true }] });
    expect(res.status).toBe(400);
  });

  it("rejects feature/module mismatch", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({
        entitlements: [
          {
            moduleKey: "hr",
            featureKey: "payroll.salary_components",
            isEnabled: true,
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects cross-tenant subscriptionId", async () => {
    subFind.mockResolvedValue(null);
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/entitlements`)
      .send({
        entitlements: [
          { moduleKey: "hr", isEnabled: true, subscriptionId: 99 },
        ],
      });
    expect(res.status).toBe(400);
  });
});

describe("PATCH single entitlement", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/entitlements/1`)
      .send({ isEnabled: false, reason: "Temporary disable for review" });
    expect(res.status).toBe(403);
  });

  it("updates entitlement", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/entitlements/1`)
      .send({ isEnabled: false, reason: "Temporary disable for review" });
    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
  });
});

describe("route safety", () => {
  it("no DELETE route", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/entitlements/1`);
    expect(res.status).toBe(404);
  });
});
