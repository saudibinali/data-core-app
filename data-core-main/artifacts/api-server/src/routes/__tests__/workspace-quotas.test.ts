/**
 * @phase P16-C - Workspace quotas routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const subFind = vi.fn();
const quotaFindFirst = vi.fn();
const dbSelect = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    workspaceSubscriptionsTable: { findFirst: subFind },
    workspaceQuotaLimitsTable: { findFirst: quotaFindFirst },
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
  workspaceQuotaLimitsTable: {},
  usersTable: {},
  employeesTable: {},
  hrOrgUnitsTable: {},
  hrEmployeeDocumentsTable: {},
  workflowDefinitionsTable: {},
  workspaceCustomRolesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  isNull: () => ({ op: "isNull" }),
  count: () => ({ as: "n" }),
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { raw: (s: string) => s }),
}));

vi.mock("../../lib/workspace-quota-resolver", () => ({
  resolveWorkspaceQuotaUsage: vi.fn(async () => [
    {
      quotaKey: "users.max",
      label: "Maximum users",
      labelAr: "المستخدمين",
      unit: "count",
      limitValue: 50,
      currentUsage: 2,
      usagePercent: 4,
      status: "ok",
      warningThresholdPercent: 80,
      isHardLimit: false,
      source: "system_default",
      quotaLimitId: null,
      effectiveFrom: null,
      effectiveUntil: null,
    },
  ]),
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

const { default: quotasRouter } = await import("../workspace-quotas");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", quotasRouter as any);

const TID = 7;
const WS = { id: TID, name: "Tenant" };

const QUOTA_ROW = {
  id: 1,
  workspaceId: TID,
  subscriptionId: null,
  quotaKey: "users.max",
  limitValue: 50,
  warningThresholdPercent: 80,
  isHardLimit: false,
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
  quotaFindFirst.mockResolvedValue(null);
  dbSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve([QUOTA_ROW]) }) });
  dbInsert.mockReturnValue(chain([QUOTA_ROW]));
  dbUpdate.mockReturnValue(chain([QUOTA_ROW]));
});

describe("GET catalog", () => {
  it("requires platform.quotas.read", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/quotas/catalog`);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.quotas.read");
  });

  it("returns catalog with users.max", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/quotas/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.catalog.quotas.some((q: { key: string }) => q.key === "users.max")).toBe(true);
  });
});

describe("GET quotas", () => {
  it("requires read permission", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/quotas`);
    expect(res.status).toBe(403);
  });
});

describe("GET usage", () => {
  it("requires read permission", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/quotas/usage`);
    expect(res.status).toBe(403);
  });

  it("returns usage snapshot", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/quotas/usage`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.usage)).toBe(true);
  });
});

describe("PUT bulk upsert", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({ quotas: [{ quotaKey: "users.max", limitValue: 100, isHardLimit: false }] });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.quotas.update");
  });

  it("rejects invalid quotaKey", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({ quotas: [{ quotaKey: "invalid.key", limitValue: 10, isHardLimit: false }] });
    expect(res.status).toBe(400);
  });

  it("rejects negative limit", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({ quotas: [{ quotaKey: "users.max", limitValue: -1, isHardLimit: false }] });
    expect(res.status).toBe(400);
  });

  it("rejects warningThresholdPercent outside 1..100", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({
        quotas: [
          {
            quotaKey: "users.max",
            limitValue: 10,
            warningThresholdPercent: 150,
            isHardLimit: false,
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("requires reason when reducing limit", async () => {
    quotaFindFirst.mockResolvedValue({ ...QUOTA_ROW, limitValue: 100 });
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({
        quotas: [{ quotaKey: "users.max", limitValue: 50, isHardLimit: false }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it("bulk upsert success", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({
        quotas: [
          {
            quotaKey: "users.max",
            limitValue: 100,
            warningThresholdPercent: 80,
            isHardLimit: false,
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.quotas.length).toBe(1);
  });

  it("rejects cross-tenant subscriptionId", async () => {
    subFind.mockResolvedValue(null);
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/quotas`)
      .send({
        quotas: [
          {
            quotaKey: "users.max",
            limitValue: 50,
            isHardLimit: false,
            subscriptionId: 999,
          },
        ],
      });
    expect(res.status).toBe(400);
  });
});

describe("PATCH single quota", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/quotas/1`)
      .send({ limitValue: 60 });
    expect(res.status).toBe(403);
  });

  it("requires reason when enabling hard limit", async () => {
    quotaFindFirst.mockResolvedValue(QUOTA_ROW);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/quotas/1`)
      .send({ isHardLimit: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });
});

describe("safety", () => {
  it("no DELETE route in router module", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const routes = readFileSync(resolve(__dirname, "../workspace-quotas.ts"), "utf8");
    expect(routes).not.toMatch(/router\.delete\(/);
    expect(routes).not.toMatch(/\/tenant\//);
  });
});
