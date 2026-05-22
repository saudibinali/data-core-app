/**
 * commercial-contracts.test.ts — operational contract timeline API
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const acctFind = vi.fn();
const contractFind = vi.fn();
const contractDocFind = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();
const dbSelect = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    commercialAccountsTable: { findFirst: acctFind },
    commercialContractTermsTable: { findFirst: contractFind },
    commercialContractDocumentsTable: { findFirst: contractDocFind },
  },
  insert: dbInsert,
  update: dbUpdate,
  select: dbSelect,
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
    from: vi.fn(() => c),
    orderBy: vi.fn(() => Promise.resolve(rows)),
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
  commercialContractDocumentsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  desc: (_a: unknown) => ({ op: "desc" }),
}));

vi.mock("../../lib/contract-document-storage", () => {
  const { Readable } = require("node:stream");
  return {
    contractDocumentStorage: {
      buildStorageKey: vi.fn(() => "tenants/42/contracts/1/abc.pdf"),
      saveContractPdf: vi.fn(async () => ({ checksum: "abc123" })),
      getContractPdfStream: vi.fn(() => Readable.from(Buffer.from("%PDF-1.4"))),
    },
    CONTRACT_PDF_MIME: "application/pdf",
  };
});

vi.mock("../../lib/parse-contract-pdf-upload", () => ({
  parseContractPdfUpload: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { contractPdfUpload?: unknown }).contractPdfUpload = {
      buffer: Buffer.from("%PDF-1.4"),
      originalFileName: "contract.pdf",
      mimeType: "application/pdf",
    };
    next();
  },
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
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
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
  companyName: "Acme Ltd",
  responsiblePersonName: "Sara",
  responsiblePersonPhone: "+966500000000",
  responsiblePersonEmail: "sara@acme.test",
  contractStartDate: "2026-01-01",
  contractEndDate: "2026-12-31",
  renewalDate: "2026-10-01",
  notes: null,
  status: "active",
  createdBy: 1,
  updatedBy: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const VALID_CREATE = {
  commercialAccountId: 10,
  contractNumber: "C-002",
  contractTitle: "Add-on",
  startDate: "2026-02-01",
  endDate: "2026-08-01",
  renewalReminderDate: "2026-07-01",
  responsiblePersonEmail: "ops@acme.test",
};

beforeEach(() => {
  vi.resetAllMocks();
  insertValuesLog.length = 0;
  denyPermission = false;
  wsFind.mockResolvedValue(WS);
  acctFind.mockResolvedValue(ACCT);
  contractFind.mockResolvedValue(CONTRACT);
  contractDocFind.mockResolvedValue(null);
  dbInsert.mockReturnValue(chain([CONTRACT]));
  dbUpdate.mockReturnValue(chain([CONTRACT]));
  dbSelect.mockReturnValue(chain([CONTRACT]));
});

describe("GET /platform/tenants/:tenantId/commercial-contracts", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with operational contracts list", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].id).toBe(1);
    expect(res.body.contracts[0]).toHaveProperty("hasDocument");
    expect(res.body.contracts[0]).toHaveProperty("primaryReminder");
  });

  it("returns 404 when no commercial account exists", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contracts`);
    expect(res.status).toBe(404);
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

  it("creates contract with only title and contact fields (no dates)", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({
        commercialAccountId: 10,
        contractTitle: "Ops only",
        responsiblePersonName: "Ali",
        responsiblePersonPhone: "+966511111111",
        responsiblePersonEmail: "ali@test.com",
      });
    expect(res.status).toBe(201);
    const row = insertValuesLog.find(
      (v): v is { contractStartDate?: string | null } =>
        typeof v === "object" && v !== null && "contractStartDate" in v,
    );
    expect(row?.contractStartDate ?? null).toBeNull();
  });

  it("records commercial_contract_created audit event", async () => {
    await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send(VALID_CREATE);
    const auditRow = insertValuesLog.find(
      (row): row is { action: string } =>
        typeof row === "object" &&
        row !== null &&
        "action" in row &&
        (row as { action: string }).action === "commercial_contract_created",
    );
    expect(auditRow).toBeDefined();
  });

  it("rejects invalid responsiblePersonEmail", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({ ...VALID_CREATE, responsiblePersonEmail: "not-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("rejects invalid date order (start after end)", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contracts`)
      .send({
        ...VALID_CREATE,
        startDate: "2026-12-01",
        endDate: "2026-01-01",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate/i);
  });
});

describe("PATCH /platform/tenants/:tenantId/commercial-contracts/:contractId/status", () => {
  it("returns 410 — status workflow removed", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contracts/1/status`)
      .send({ status: "active", reason: "Customer signed renewal agreement" });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/removed/i);
  });
});

describe("contract PDF document", () => {
  it("upload returns 201", async () => {
    dbInsert.mockReturnValue(chain([{ id: 9, contractId: 1 }]));
    const res = await request(app).post(
      `/api/platform/tenants/${TID}/commercial-contracts/1/document`,
    );
    expect(res.status).toBe(201);
  });

  it("download returns 404 when no PDF", async () => {
    contractDocFind.mockResolvedValue(null);
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/commercial-contracts/1/document`,
    );
    expect(res.status).toBe(404);
  });
});

describe("safety", () => {
  it("does not expose DELETE handler for contracts", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/commercial-contracts/1`);
    expect(res.status).toBe(404);
  });
});
