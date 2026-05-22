/**
 * @phase P15-C — Operational commercial invoices (document records)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const acctFind = vi.fn();
const contractFind = vi.fn();
const invoiceFind = vi.fn();
const invoiceMany = vi.fn();
const docFind = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    commercialAccountsTable: { findFirst: acctFind },
    commercialContractTermsTable: { findFirst: contractFind },
    commercialInvoicesTable: { findFirst: invoiceFind, findMany: invoiceMany },
    commercialInvoiceDocumentsTable: { findFirst: docFind },
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
  commercialInvoicesTable: {},
  commercialInvoiceDocumentsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  desc: (_a: unknown) => ({ op: "desc" }),
}));

vi.mock("../../lib/invoice-document-storage", () => {
  const { Readable } = require("node:stream");
  return {
    invoiceDocumentStorage: {
      buildStorageKey: vi.fn(() => "tenants/42/invoices/1/abc.pdf"),
      saveInvoicePdf: vi.fn(async () => ({ checksum: "abc123" })),
      getInvoicePdfStream: vi.fn(() => Readable.from(Buffer.from("%PDF-1.4"))),
      deleteInvoicePdfIfExists: vi.fn(async () => {}),
    },
    INVOICE_PDF_MIME: "application/pdf",
  };
});

vi.mock("../../lib/parse-invoice-pdf-upload", () => ({
  parseInvoicePdfUpload: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { invoicePdfUpload?: unknown }).invoicePdfUpload = {
      buffer: Buffer.from("%PDF-1.4"),
      originalFileName: "official.pdf",
      mimeType: "application/pdf",
    };
    next();
  },
}));

let denyPermission = false;
let deniedPerm = "";

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
  requirePlatformPermission: (perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission || (deniedPerm && deniedPerm === perm)) {
        res.status(403).json({ error: "denied", code: "NOT_PLATFORM_USER" });
        return;
      }
      next();
    },
}));

const { default: invoicesRouter } = await import("../commercial-invoices");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", invoicesRouter as any);

const TID = 42;
const WS = { id: TID, name: "Acme" };
const ACCT = { id: 10, workspaceId: TID, status: "active" };
const INVOICE = {
  id: 1,
  workspaceId: TID,
  commercialAccountId: 10,
  contractTermId: null,
  invoiceNumber: "INV-001",
  responsiblePersonName: "Finance",
  responsiblePersonPhone: null,
  responsiblePersonEmail: "finance@acme.test",
  reminderDate: "2026-02-15",
  notes: null,
  status: "shared",
  createdBy: 1,
  updatedBy: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const DOC = {
  id: 5,
  invoiceId: 1,
  fileName: "official.pdf",
  originalFileName: "official.pdf",
  fileSize: 100,
  mimeType: "application/pdf",
  storageKey: "tenants/42/invoices/1/abc.pdf",
  checksum: "abc",
  uploadedBy: 1,
  uploadedAt: new Date("2026-01-02T00:00:00Z"),
  createdAt: new Date("2026-01-02T00:00:00Z"),
};

const VALID_CREATE = {
  commercialAccountId: 10,
  invoiceNumber: "INV-002",
  responsiblePersonName: "Ops",
  reminderDate: "2026-03-01",
};

beforeEach(() => {
  vi.resetAllMocks();
  insertValuesLog.length = 0;
  denyPermission = false;
  deniedPerm = "";
  wsFind.mockResolvedValue(WS);
  acctFind.mockResolvedValue(ACCT);
  invoiceFind.mockResolvedValue(INVOICE);
  invoiceMany.mockResolvedValue([INVOICE]);
  docFind.mockResolvedValue(null);
  contractFind.mockResolvedValue(undefined);
  dbInsert.mockReturnValue(chain([INVOICE]));
  dbUpdate.mockReturnValue(chain([INVOICE]));
});

describe("GET /commercial-invoices", () => {
  it("returns 403 without commercial.invoices.read", async () => {
    deniedPerm = "commercial.invoices.read";
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-invoices`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with operational invoices", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-invoices`);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0]).toHaveProperty("hasDocument");
  });
});

describe("POST /commercial-invoices", () => {
  it("returns 403 without commercial.invoices.update", async () => {
    deniedPerm = "commercial.invoices.update";
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices`)
      .send(VALID_CREATE);
    expect(res.status).toBe(403);
  });

  it("creates invoice with 201", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices`)
      .send(VALID_CREATE);
    expect(res.status).toBe(201);
    expect(res.body.invoice.invoiceNumber).toBeDefined();
  });

  it("rejects invalid responsiblePersonEmail", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices`)
      .send({ ...VALID_CREATE, responsiblePersonEmail: "bad" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("rejects cross-tenant contractTermId", async () => {
    contractFind.mockResolvedValue({ id: 99, workspaceId: TID, commercialAccountId: 999 });
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices`)
      .send({ ...VALID_CREATE, contractTermId: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractTermId/i);
  });

  it("records commercial_invoice_created audit", async () => {
    await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-invoices`)
      .send(VALID_CREATE);
    const audit = insertValuesLog.find(
      (r): r is { action: string } =>
        typeof r === "object" &&
        r !== null &&
        "action" in r &&
        (r as { action: string }).action === "commercial_invoice_created",
    );
    expect(audit).toBeDefined();
  });
});

describe("PATCH status", () => {
  it("returns 410 — accounting status workflow removed", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-invoices/1/status`)
      .send({ status: "issued", reason: "short reason ok" });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/removed/i);
  });
});

describe("document upload/download", () => {
  it("upload returns 403 without commercial.invoiceDocuments.upload", async () => {
    deniedPerm = "commercial.invoiceDocuments.upload";
    const res = await request(app).post(
      `/api/platform/tenants/${TID}/commercial-invoices/1/document`,
    );
    expect(res.status).toBe(403);
  });

  it("upload succeeds with 201", async () => {
    dbInsert.mockReturnValue(chain([DOC]));
    const res = await request(app).post(
      `/api/platform/tenants/${TID}/commercial-invoices/1/document`,
    );
    expect(res.status).toBe(201);
  });

  it("returns 404 when no PDF uploaded", async () => {
    docFind.mockResolvedValue(null);
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/commercial-invoices/1/document`,
    );
    expect(res.status).toBe(404);
  });
});

describe("P15-C safety", () => {
  it("no DELETE invoice route", async () => {
    const res = await request(app).delete(`/api/platform/tenants/${TID}/commercial-invoices/1`);
    expect(res.status).toBe(404);
  });
});
