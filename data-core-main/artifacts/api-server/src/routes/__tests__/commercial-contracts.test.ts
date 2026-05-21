/**
 * commercial-contracts.test.ts
 *
 * @phase P15-B - Contract Terms & Renewal Commitments - Route Tests
 *
 * SAFETY: no payment, Stripe, invoice generation, PDF upload, tax, email, or delete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind       = vi.fn();
const acctFind     = vi.fn();
const contractFind = vi.fn();
const contractMany = vi.fn();
const userFind     = vi.fn();
const dbInsert     = vi.fn();
const dbUpdate     = vi.fn();

const mockDb = {
  query: {
    workspacesTable:             { findFirst: wsFind       },
    commercialAccountsTable:     { findFirst: acctFind     },
    commercialContractTermsTable: { findFirst: contractFind, findMany: contractMany },
    usersTable:                  { findFirst: userFind     },
  },
  insert: dbInsert,
  update: dbUpdate,
};

const insertValuesLog: unknown[] = [];

function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {
    values:    (v: unknown) => { insertValuesLog.push(v); return c; },
    set:       vi.fn(() => c),
    where:     vi.fn(() => c),
    returning: () => Promise.resolve(rows),
  };
  return c;
}

vi.mock("@workspace/db", () => ({
  db:                              mockDb,
  workspacesTable:                 {},
  activityLogsTable:               {},
  commercialAccountsTable:         {},
  commercialContractTermsTable:    {},
  usersTable:                      {},
}));

vi.mock("drizzle-orm", () => ({
  eq:  (_a: unknown, _b: unknown) => ({ op: "eq",  a: _a, b: _b }),
  and: (...args: unknown[])        => ({ op: "and", args }),
  ne:  (_a: unknown, _b: unknown) => ({ op: "ne",  a: _a, b: _b }),
  isNull: (_a: unknown)            => ({ op: "isNull", a: _a }),
}));

let denyPermission = false;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as unknown as Record<string, unknown>;
    r["userId"] = 1;
    r["userRole"] = "super_admin";
    r["platformRoleCode"] = "root_platform_owner";
    r["isRootOwner"] = false;
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requirePlatformPermission: (_perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission) {
        res.status(403).json({ error: "denied", code: "NOT_PLATFORM_USER" });
        return;
      }
      next();
    },
}));

const { default: contractsRouter } = await import("../commercial-contracts");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", contractsRouter as any);

const TID = 42;

const WS = { id: TID, name: "Acme Corp" };
const ACCT = { id: 10, workspaceId: TID, commercialAccountName: "Acme", status: "active" };

const CONTRACT = {
  id: 1,
  workspaceId: TID,
  commercialAccountId: 10,
  contractNumber: "C-001",
  contractTitle: "Master Agreement",
  contractStartDate: "2026-01-01",
  contractEndDate: "2026-12-31",
  renewalDate: "2026-10-01",
  renewalNoticeDays: 90,
  contractTermMonths: 12,
  renewalType: "manual",
  renewalCommitmentStatus: "not_started",
  contractValue: "10000.00",
  currency: "SAR",
  billingCycle: "annual",
  paymentTerms: "net_30",
  internalOwnerUserId: null,
  customerDecisionMakerName: null,
  customerDecisionMakerEmail: null,
  renewalNotes: null,
  status: "draft",
  createdBy: 1,
  updatedBy: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const VALID_CREATE = {
  commercialAccountId: 10,
  contractNumber: "C-002",
  contractTitle: "Add-on",
  contractStartDate: "2026-02-01",
  contractEndDate: "2026-08-01",
  renewalDate: "2026-07-01",
  renewalType: "manual",
  renewalCommitmentStatus: "pending_customer",
  contractValue: 5000,
  currency: "SAR",
  status: "draft",
};

beforeEach(() => {
  vi.resetAllMocks();
  insertValuesLog.length = 0;
  denyPermission = false;
  wsFind.mockResolvedValue(WS);
  acctFind.mockResolvedValue(ACCT);
  contractFind.mockResolvedValue(CONTRACT);
  contractMany.mockResolvedValue([CONTRACT]);
  userFind.mockResolvedValue({ id: 99, role: "super_admin", workspaceId: null });
  dbInsert.mockReturnValue(chain([CONTRACT]));
  dbUpdate.mockReturnValue(chain([CONTRACT]));
});

describe("GET /platform/tenants/:tenantId/commercial-contracts", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with contracts list", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].id).toBe(1);
  });

  it("returns 404 when no commercial account exists", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(404);
  });
});

describe("GET /platform/tenants/:tenantId/commercial-contracts/:contractId", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts/1`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with contract", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts/1`);
    expect(res.status).toBe(200);
    expect(res.body.contract.id).toBe(1);
  });
});

describe("POST /platform/tenants/:tenantId/commercial-contracts", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send(VALID_CREATE);
    expect(res.status).toBe(403);
  });

  it("creates contract and returns 201", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send(VALID_CREATE);
    expect(res.status).toBe(201);
    expect(res.body.contract).toBeDefined();
    expect(dbInsert).toHaveBeenCalled();
  });

  it("records commercial_contract_created audit event", async () => {
    await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send(VALID_CREATE);
    const auditRow = insertValuesLog.find(
      (row): row is { action: string } =>
        typeof row === "object" && row !== null && "action" in row
        && (row as { action: string }).action === "commercial_contract_created",
    );
    expect(auditRow).toBeDefined();
  });

  it("rejects invalid customerDecisionMakerEmail", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({ ...VALID_CREATE, customerDecisionMakerEmail: "not-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("rejects invalid date order (start after end)", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({
        ...VALID_CREATE,
        contractStartDate: "2026-12-01",
        contractEndDate: "2026-01-01",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractStartDate/i);
  });

  it("rejects invalid renewalType enum", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({ ...VALID_CREATE, renewalType: "stripe_auto" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/renewalType/i);
  });

  it("rejects negative contractValue", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({ ...VALID_CREATE, contractValue: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractValue/i);
  });

  it("rejects invalid internalOwnerUserId when user is not platform", async () => {
    userFind.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({ ...VALID_CREATE, internalOwnerUserId: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/internalOwnerUserId/i);
  });
});

describe("PATCH /platform/tenants/:tenantId/commercial-contracts/:contractId", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1`)
      .send({ contractTitle: "Updated" });
    expect(res.status).toBe(403);
  });

  it("updates contract and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1`)
      .send({ contractTitle: "Updated Title" });
    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
  });
});

describe("PATCH /platform/tenants/:tenantId/commercial-contracts/:contractId/status", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1/status`)
      .send({ status: "active", reason: "Customer signed renewal" });
    expect(res.status).toBe(403);
  });

  it("requires reason with at least 10 characters", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1/status`)
      .send({ status: "active", reason: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
    const blocked = insertValuesLog.find(
      (row): row is { action: string } =>
        typeof row === "object" && row !== null && "action" in row
        && (row as { action: string }).action === "commercial_contract_status_change_blocked",
    );
    expect(blocked).toBeDefined();
  });

  it("changes status with valid reason", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1/status`)
      .send({ status: "active", reason: "Customer signed renewal agreement" });
    expect(res.status).toBe(200);
    expect(res.body.contract).toBeDefined();
  });
});

describe("P15-B safety - route module", () => {
  it("does not expose DELETE handler for contracts", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/commercial-contracts/1`);
    expect(res.status).toBe(404);
  });

  it("does not expose invoice or payment endpoints under commercial-contracts", async () => {
    const invoice = await request(app).post(`/api/platform/tenants/${TID}/commercial-contracts/1/invoice`);
    const pay = await request(app).post(`/api/platform/tenants/${TID}/commercial-contracts/1/pay`);
    expect(invoice.status).toBe(404);
    expect(pay.status).toBe(404);
  });
});
