/**
 * @phase P15-E - Commercial Payments - Route Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const acctFind = vi.fn();
const invoiceFind = vi.fn();
const paymentFind = vi.fn();
const paymentMany = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    commercialAccountsTable: { findFirst: acctFind },
    commercialInvoicesTable: { findFirst: invoiceFind },
    commercialPaymentRecordsTable: { findFirst: paymentFind, findMany: paymentMany },
  },
  insert: dbInsert,
  update: dbUpdate,
};

const insertValuesLog: unknown[] = [];

function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {
    values: (v: unknown) => { insertValuesLog.push(v); return c; },
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
  commercialInvoicesTable: {},
  commercialPaymentRecordsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

let denyPermission = false;
let deniedPerm = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as unknown as Record<string, unknown>;
    r["userId"] = 1;
    r["userRole"] = "super_admin";
    r["platformRoleCode"] = "finance_admin";
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requirePlatformPermission: (perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission || (deniedPerm && deniedPerm === perm)) {
        res.status(403).json({ error: "denied" });
        return;
      }
      next();
    },
}));

const { default: paymentsRouter } = await import("../commercial-payments");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", paymentsRouter as any);

const TID = 42;
const WS = { id: TID, name: "Acme" };
const ACCT = { id: 10, workspaceId: TID, status: "active" };
const INVOICE = {
  id: 1,
  workspaceId: TID,
  commercialAccountId: 10,
  invoiceNumber: "INV-1",
  invoiceAmount: "1000.00",
  currency: "SAR",
};
const PAYMENT = {
  id: 5,
  workspaceId: TID,
  commercialAccountId: 10,
  invoiceId: 1,
  paymentReference: "TRX-1",
  paymentDate: "2026-01-15",
  receivedAmount: "500.00",
  currency: "SAR",
  paymentMethod: "bank_transfer",
  collectionStatus: "pending_verification",
  recordedByUserId: 1,
  verifiedByUserId: null,
  verificationDate: null,
  internalNotes: null,
  rejectionReason: null,
  createdBy: 1,
  updatedBy: 1,
  createdAt: "2026-01-15T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
};

const VALID_CREATE = {
  paymentReference: "TRX-NEW",
  paymentDate: "2026-02-01",
  receivedAmount: 250,
  currency: "SAR",
  paymentMethod: "bank_transfer",
};

beforeEach(() => {
  vi.clearAllMocks();
  insertValuesLog.length = 0;
  denyPermission = false;
  deniedPerm = "";
  wsFind.mockResolvedValue(WS);
  acctFind.mockResolvedValue(ACCT);
  invoiceFind.mockResolvedValue(INVOICE);
  paymentFind.mockResolvedValue(PAYMENT);
  paymentMany.mockResolvedValue([PAYMENT]);
  dbInsert.mockReturnValue(chain([{ ...PAYMENT, id: 6, ...VALID_CREATE, receivedAmount: "250.00" }]));
  dbUpdate.mockReturnValue(chain([PAYMENT]));
});

describe("GET commercial-payments", () => {
  it("requires commercial.payments.read", async () => {
    deniedPerm = "commercial.payments.read";
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-payments`);
    expect(res.status).toBe(403);
  });

  it("returns payments list", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-payments`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
  });
});

describe("GET collection-summary", () => {
  it("requires commercial.payments.read", async () => {
    deniedPerm = "commercial.payments.read";
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/commercial-invoices/1/collection-summary`,
    );
    expect(res.status).toBe(403);
  });

  it("computes summary for invoice", async () => {
    paymentMany.mockResolvedValue([
      { receivedAmount: "400.00", collectionStatus: "verified" },
      { receivedAmount: "100.00", collectionStatus: "rejected" },
    ]);
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/commercial-invoices/1/collection-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.collectionState).toBe("disputed");
    expect(res.body.summary.totalVerifiedPayments).toBe("400.00");
  });
});

describe("POST payment", () => {
  it("requires commercial.payments.record", async () => {
    deniedPerm = "commercial.payments.record";
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send(VALID_CREATE);
    expect(res.status).toBe(403);
  });

  it("records payment and audits", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send(VALID_CREATE);
    expect(res.status).toBe(201);
    const audit = insertValuesLog.find(
      v => typeof v === "object" && v !== null && (v as { action?: string }).action === "commercial_payment_recorded",
    );
    expect(audit).toBeDefined();
  });

  it("rejects receivedAmount <= 0", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send({ ...VALID_CREATE, receivedAmount: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects currency mismatch", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send({ ...VALID_CREATE, currency: "USD" });
    expect(res.status).toBe(400);
  });

  it("rejects sensitive fields", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send({ ...VALID_CREATE, cardNumber: "4111" });
    expect(res.status).toBe(400);
  });

  it("rejects cross-tenant invoice", async () => {
    invoiceFind.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices/1/payments`)
      .send(VALID_CREATE);
    expect(res.status).toBe(404);
  });
});

describe("PATCH payment", () => {
  it("requires commercial.payments.record", async () => {
    deniedPerm = "commercial.payments.record";
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-payments/5`)
      .send({ paymentReference: "TRX-2" });
    expect(res.status).toBe(403);
  });

  it("blocks edit on verified payment", async () => {
    paymentFind.mockResolvedValue({ ...PAYMENT, collectionStatus: "verified" });
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-payments/5`)
      .send({ paymentReference: "TRX-2" });
    expect(res.status).toBe(409);
  });
});

describe("verify / reject / reverse", () => {
  it("verify requires commercial.payments.verify", async () => {
    deniedPerm = "commercial.payments.verify";
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-payments/5/verify`)
      .send({ reason: "Bank statement matched" });
    expect(res.status).toBe(403);
  });

  it("verify requires reason length", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-payments/5/verify`)
      .send({ reason: "short" });
    expect(res.status).toBe(400);
  });

  it("verify succeeds with reason", async () => {
    dbUpdate.mockReturnValue(chain([{ ...PAYMENT, collectionStatus: "verified" }]));
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-payments/5/verify`)
      .send({ reason: "Bank statement matched on 2026-02-01" });
    expect(res.status).toBe(200);
  });
});

describe("P15-E safety - no DELETE", () => {
  it("no DELETE payment route", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/commercial-payments/5`);
    expect(res.status).toBe(404);
  });
});
