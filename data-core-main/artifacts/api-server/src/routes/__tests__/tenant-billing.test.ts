/**
 * @phase P15-D - Tenant Billing Portal - Route Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const invoiceFind = vi.fn();
const invoiceMany = vi.fn();
const docFind = vi.fn();
const dbInsert = vi.fn();

const mockDb = {
  query: {
    commercialInvoicesTable: { findFirst: invoiceFind, findMany: invoiceMany },
    commercialInvoiceDocumentsTable: { findFirst: docFind },
  },
  insert: dbInsert,
};

function chain() {
  const c: Record<string, unknown> = {
    values: vi.fn(() => c),
    set: vi.fn(() => c),
    where: vi.fn(() => c),
    returning: () => Promise.resolve([]),
  };
  return c;
}

vi.mock("@workspace/db", () => ({
  db: mockDb,
  activityLogsTable: {},
  commercialInvoicesTable: {},
  commercialInvoiceDocumentsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gte: (_a: unknown, _b: unknown) => ({ op: "gte" }),
  lte: (_a: unknown, _b: unknown) => ({ op: "lte" }),
  ne: (_a: unknown, _b: unknown) => ({ op: "ne" }),
}));

vi.mock("../../lib/invoice-document-storage", () => {
  const { PassThrough } = require("node:stream");
  return {
    invoiceDocumentStorage: {
      getInvoicePdfStream: vi.fn(() => {
        const stream = new PassThrough();
        stream.end(Buffer.from("%PDF-1.4"));
        return stream;
      }),
    },
    INVOICE_PDF_MIME: "application/pdf",
  };
});

let denyPermission = false;
let deniedPerm = "";
let mockWorkspaceId: number | null = 42;
let mockUserRole = "member";
let mockPermissions: string[] = [
  "tenant.billing.invoices.read",
  "tenant.billing.invoiceDocuments.download",
];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as unknown as Record<string, unknown>;
    r["userId"] = 7;
    r["userRole"] = mockUserRole;
    r["workspaceId"] = mockWorkspaceId;
    r["userPermissions"] = mockPermissions;
    next();
  },
  requirePermission: (perm: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission || (deniedPerm && deniedPerm === perm)) {
        res.status(403).json({ error: "Permission denied", required: perm });
        return;
      }
      const role = (req as unknown as Record<string, unknown>)["userRole"] as string;
      if (role === "admin" || role === "manager" || role === "super_admin") {
        next();
        return;
      }
      const perms = (req as unknown as Record<string, unknown>)["userPermissions"] as string[];
      if (perms?.includes(perm)) {
        next();
        return;
      }
      res.status(403).json({ error: "Permission denied", required: perm });
    },
}));

const { default: tenantBillingRouter } = await import("../tenant-billing");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", tenantBillingRouter as any);

const WS = 42;
const ISSUED_INVOICE = {
  id: 1,
  workspaceId: WS,
  commercialAccountId: 10,
  contractTermId: null,
  invoiceNumber: "INV-001",
  invoiceTitle: "January",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-31",
  invoiceAmount: "1000.00",
  currency: "SAR",
  billingPeriodStart: "2026-01-01",
  billingPeriodEnd: "2026-01-31",
  status: "issued",
  externalAccountingSystemName: null,
  externalAccountingReference: "ERP-REF-SECRET",
  notes: "internal finance note",
  createdBy: 1,
  updatedBy: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
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
  uploadedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-02T00:00:00Z",
};

const auditActions: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  denyPermission = false;
  deniedPerm = "";
  mockWorkspaceId = WS;
  mockUserRole = "member";
  mockPermissions = [
    "tenant.billing.invoices.read",
    "tenant.billing.invoiceDocuments.download",
  ];
  auditActions.length = 0;
  invoiceFind.mockImplementation(async () => ISSUED_INVOICE);
  invoiceMany.mockResolvedValue([ISSUED_INVOICE]);
  docFind.mockResolvedValue(DOC);
  dbInsert.mockImplementation(() => {
    const c = chain();
    c.values = vi.fn((v: { action?: string }) => {
      if (v && typeof v === "object" && "action" in v && typeof v.action === "string") {
        auditActions.push(v.action);
      }
      return c;
    });
    return c;
  });
});

describe("tenant billing permissions", () => {
  it("exports tenant.billing.invoices.read and tenant.billing.invoiceDocuments.download", async () => {
    const { TENANT_BILLING_PERMISSIONS } = await import("../../lib/tenant-billing-config");
    expect(TENANT_BILLING_PERMISSIONS.INVOICES_READ).toBe("tenant.billing.invoices.read");
    expect(TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD).toBe(
      "tenant.billing.invoiceDocuments.download",
    );
  });
});

describe("GET /tenant/billing/invoices", () => {
  it("requires tenant.billing.invoices.read", async () => {
    deniedPerm = "tenant.billing.invoices.read";
    const res = await request(app).get("/api/tenant/billing/invoices");
    expect(res.status).toBe(403);
  });

  it("returns workspace invoices without sensitive fields", async () => {
    const res = await request(app).get("/api/tenant/billing/invoices");
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(1);
    const inv = res.body.invoices[0];
    expect(inv.invoiceNumber).toBe("INV-001");
    expect(inv.documentAvailable).toBe(true);
    expect(inv.documentFileName).toBe("official.pdf");
    expect(inv).not.toHaveProperty("notes");
    expect(inv).not.toHaveProperty("storageKey");
    expect(inv).not.toHaveProperty("checksum");
    expect(inv).not.toHaveProperty("createdBy");
    expect(inv).not.toHaveProperty("externalAccountingReference");
    expect(auditActions).toContain("tenant_invoice_viewed");
  });

  it("blocks super_admin without workspace context", async () => {
    mockUserRole = "super_admin";
    mockWorkspaceId = null;
    const res = await request(app).get("/api/tenant/billing/invoices");
    expect(res.status).toBe(403);
  });
});

describe("GET /tenant/billing/invoices/:invoiceId", () => {
  it("requires tenant.billing.invoices.read", async () => {
    deniedPerm = "tenant.billing.invoices.read";
    const res = await request(app).get("/api/tenant/billing/invoices/1");
    expect(res.status).toBe(403);
  });

  it("returns detail with document metadata, no public URL", async () => {
    const res = await request(app).get("/api/tenant/billing/invoices/1");
    expect(res.status).toBe(200);
    expect(res.body.invoice.documentAvailable).toBe(true);
    expect(res.body.invoice).not.toHaveProperty("storageKey");
    expect(res.body.invoice).not.toHaveProperty("notes");
    expect(auditActions.filter((a) => a === "tenant_invoice_viewed").length).toBeGreaterThan(0);
  });

  it("denies cross-workspace invoice (404 + audit)", async () => {
    invoiceFind.mockResolvedValue(undefined);
    const res = await request(app).get("/api/tenant/billing/invoices/1");
    expect(res.status).toBe(404);
    expect(auditActions).toContain("tenant_invoice_access_denied");
  });

  it("does not use tenantId from query", async () => {
    const res = await request(app).get("/api/tenant/billing/invoices/1?tenantId=999");
    expect(res.status).toBe(200);
    expect(invoiceFind).toHaveBeenCalled();
  });
});

describe("GET /tenant/billing/invoices/:invoiceId/document", () => {
  it("requires tenant.billing.invoiceDocuments.download", async () => {
    mockPermissions = ["tenant.billing.invoices.read"];
    const res = await request(app).get("/api/tenant/billing/invoices/1/document");
    expect(res.status).toBe(403);
  });

  it("audits download on authorized request (protected stream)", async () => {
    try {
      await request(app).get("/api/tenant/billing/invoices/1/document").timeout({ deadline: 500 });
    } catch {
      // supertest may abort before stream completes; audit is written before pipe
    }
    expect(auditActions).toContain("tenant_invoice_document_downloaded");
  });

  it("blocks download when no document", async () => {
    docFind.mockResolvedValue(null);
    const res = await request(app).get("/api/tenant/billing/invoices/1/document");
    expect(res.status).toBe(404);
    expect(auditActions).toContain("tenant_invoice_document_download_blocked");
  });

  it("denies cross-workspace download", async () => {
    invoiceFind.mockResolvedValue(undefined);
    const res = await request(app).get("/api/tenant/billing/invoices/1/document");
    expect(res.status).toBe(404);
    expect(auditActions).toContain("tenant_invoice_access_denied");
  });
});

describe("tenant billing safety - no mutating routes", () => {
  it("has no POST/PATCH/DELETE handlers on tenant billing paths", async () => {
    const post = await request(app).post("/api/tenant/billing/invoices");
    const patch = await request(app).patch("/api/tenant/billing/invoices/1");
    const del = await request(app).delete("/api/tenant/billing/invoices/1");
    expect(post.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
  });
});
