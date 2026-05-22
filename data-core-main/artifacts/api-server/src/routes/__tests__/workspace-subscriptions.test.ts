/**
 * @phase P16-A - Workspace Subscription State APIs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const subFind = vi.fn();
const acctFind = vi.fn();
const contractFind = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    workspaceSubscriptionsTable: { findFirst: subFind },
    commercialAccountsTable: { findFirst: acctFind },
    commercialContractTermsTable: { findFirst: contractFind },
  },
  insert: dbInsert,
  update: dbUpdate,
};

const insertValuesLog: unknown[] = [];

function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {
    values: (v: unknown) => {
      insertValuesLog.push(v);
      return c;
    },
    set: vi.fn(() => c),
    where: vi.fn(() => c),
    returning: () => Promise.resolve(rows),
  };
  return c;
}

vi.mock("@workspace/db", () => ({
  db: mockDb,
  workspacesTable: {},
  activityLogsTable: {},
  commercialAccountsTable: {},
  commercialContractTermsTable: {},
  workspaceSubscriptionsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq", a: _a, b: _b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

let denyPermission = false;
let deniedPermission = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as unknown as Record<string, unknown>;
    r["userId"] = 1;
    r["userRole"] = "super_admin";
    r["platformRoleCode"] = "root_platform_owner";
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requirePlatformPermission: (perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission) {
        deniedPermission = perm;
        res.status(403).json({ error: "denied", code: "NOT_PLATFORM_USER" });
        return;
      }
      next();
    },
}));

const { default: subscriptionRouter } = await import("../workspace-subscriptions");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", subscriptionRouter as any);

const TID = 42;
const WS = { id: TID, name: "Acme" };
const ACCT = { id: 10, workspaceId: TID };
const CONTRACT = { id: 5, workspaceId: TID, commercialAccountId: 10 };

const SUB = {
  id: 1,
  workspaceId: TID,
  commercialAccountId: 10,
  activeContractTermId: 5,
  subscriptionCode: "SUB-001",
  subscriptionName: "Enterprise",
  status: "trial",
  statusReason: null,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  renewalDate: "2026-11-01",
  gracePeriodEndsAt: null,
  suspensionStartedAt: null,
  terminationDate: null,
  planName: "Enterprise",
  internalNotes: null,
  createdBy: 1,
  updatedBy: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  insertValuesLog.length = 0;
  denyPermission = false;
  deniedPermission = "";
  wsFind.mockResolvedValue(WS);
  subFind.mockResolvedValue(null);
  acctFind.mockResolvedValue(ACCT);
  contractFind.mockResolvedValue(CONTRACT);
  dbInsert.mockImplementation(() => chain([SUB]));
  dbUpdate.mockImplementation(() => chain([{ ...SUB, status: "active", statusReason: "Renewed" }]));
});

describe("GET /platform/tenants/:tenantId/subscription", () => {
  it("returns 403 when read permission denied", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription`);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptions.read");
  });

  it("returns null when no subscription", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription`);
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
  });

  it("returns subscription when present", async () => {
    subFind.mockResolvedValue(SUB);
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription`);
    expect(res.status).toBe(200);
    expect(res.body.subscription.subscriptionCode).toBe("SUB-001");
  });

  it("returns 404 for invalid tenant", async () => {
    wsFind.mockResolvedValue(null);
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription`);
    expect(res.status).toBe(404);
  });
});

describe("POST /platform/tenants/:tenantId/subscription", () => {
  const validBody = {
    subscriptionCode: "SUB-NEW",
    subscriptionName: "New Plan",
    commercialAccountId: 10,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    renewalDate: "2026-11-01",
  };

  it("returns 403 when update permission denied", async () => {
    denyPermission = true;
    const res = await request(app).post(`/api/platform/tenants/${TID}/subscription`).send(validBody);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptions.update");
  });

  it("creates subscription successfully", async () => {
    const res = await request(app).post(`/api/platform/tenants/${TID}/subscription`).send(validBody);
    expect(res.status).toBe(201);
    expect(dbInsert).toHaveBeenCalled();
  });

  it("persists null for omitted optional dates and foreign keys (not MISSING sentinel)", async () => {
    const res = await request(app).post(`/api/platform/tenants/${TID}/subscription`).send({
      subscriptionCode: "SUB-MIN",
      subscriptionName: "Minimal Plan",
      status: "trial",
    });
    expect(res.status).toBe(201);
    const values = insertValuesLog[0] as Record<string, unknown>;
    expect(values.startDate).toBeNull();
    expect(values.endDate).toBeNull();
    expect(values.renewalDate).toBeNull();
    expect(values.commercialAccountId).toBeNull();
    expect(values.activeContractTermId).toBeNull();
    expect(values.endDate).not.toBe("MISSING");
    expect(values.renewalDate).not.toBe("MISSING");
  });

  it("rejects duplicate subscription", async () => {
    subFind.mockResolvedValue(SUB);
    const res = await request(app).post(`/api/platform/tenants/${TID}/subscription`).send(validBody);
    expect(res.status).toBe(409);
  });

  it("rejects cross-tenant commercialAccountId", async () => {
    acctFind.mockResolvedValue(null);
    const res = await request(app).post(`/api/platform/tenants/${TID}/subscription`).send(validBody);
    expect(res.status).toBe(400);
  });

  it("rejects invalid dates", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/subscription`)
      .send({ ...validBody, startDate: "2027-01-01", endDate: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("rejects stripe fields", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/subscription`)
      .send({ ...validBody, stripeCustomerId: "cus_123" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /platform/tenants/:tenantId/subscription", () => {
  beforeEach(() => {
    subFind.mockResolvedValue(SUB);
  });

  it("returns 403 when update permission denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription`)
      .send({ subscriptionName: "Updated" });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptions.update");
  });

  it("updates non-status fields", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription`)
      .send({ subscriptionName: "Updated Name" });
    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
  });

  it("rejects status in body", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription`)
      .send({ status: "active" });
    expect(res.status).toBe(400);
  });

  it("rejects cross-tenant contract", async () => {
    contractFind.mockResolvedValue(null);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription`)
      .send({ activeContractTermId: 99 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /platform/tenants/:tenantId/subscription/status", () => {
  beforeEach(() => {
    subFind.mockResolvedValue(SUB);
  });

  it("requires status.change permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription/status`)
      .send({ status: "active", reason: "Customer activated account" });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptions.status.change");
  });

  it("requires reason", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription/status`)
      .send({ status: "active" });
    expect(res.status).toBe(400);
  });

  it("changes status on valid transition", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription/status`)
      .send({ status: "active", reason: "Customer activated account" });
    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
    expect(dbInsert).toHaveBeenCalled();
  });

  it("blocks invalid transition and audits", async () => {
    subFind.mockResolvedValue({ ...SUB, status: "archived" });
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/subscription/status`)
      .send({ status: "active", reason: "Attempt reactivate archived" });
    expect(res.status).toBe(400);
    expect(dbInsert).toHaveBeenCalled();
  });
});

describe("route safety", () => {
  it("has no DELETE subscription route on router", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/subscription`);
    expect(res.status).toBe(404);
  });
});
