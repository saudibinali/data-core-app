/**
 * @phase P15-F - Commercial Risk routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const loadAll = vi.fn();
const loadOne = vi.fn();
const dbInsert = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { insert: dbInsert },
  activityLogsTable: {},
}));

vi.mock("../../lib/commercial-risk-loader", () => ({
  loadAllTenantCommercialRiskAssessments: loadAll,
  loadTenantCommercialRiskAssessment: loadOne,
}));

function chain() {
  const c: Record<string, unknown> = {
    values: vi.fn(() => c),
  };
  return c;
}

let denyPermission = false;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requirePlatformPermission: (perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission || perm !== "commercial.risk.read") {
        res.status(403).json({ error: "denied" });
        return;
      }
      next();
    },
}));

const { default: riskRouter } = await import("../commercial-risk");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", riskRouter as any);

const SAMPLE = {
  tenantId: 1,
  tenantName: "Acme",
  riskLevel: "high" as const,
  renewalReadinessStatus: "attention_needed" as const,
  signals: {
    activeContractExists: true,
    daysUntilContractEnd: 100,
    daysUntilRenewalDate: 50,
    renewalCommitmentStatus: "committed",
    renewalNoticeDays: 30,
    unpaidInvoiceCount: 1,
    overdueInvoiceCount: 1,
    outstandingAmount: "500.00",
    disputedPaymentCount: 0,
    hasRejectedPayments: false,
    hasOverdueInvoices: true,
    hasExpiredContract: false,
    hasMissingBillingContact: false,
    hasMissingInvoicePdf: false,
    lastPaymentDate: null,
    lastInvoiceDate: "2026-01-01",
    contractEndDate: "2027-01-01",
    renewalDate: "2026-08-01",
  },
  reasons: ["overdue_invoices_present"] as const,
  recommendedActions: ["verify_collection_status"] as const,
};

beforeEach(() => {
  denyPermission = false;
  loadAll.mockReset();
  loadOne.mockReset();
  dbInsert.mockReset();
  dbInsert.mockReturnValue(chain());
  loadAll.mockResolvedValue([SAMPLE]);
  loadOne.mockResolvedValue(SAMPLE);
});

describe("commercial risk routes - GET only", () => {
  it("router has no POST/PATCH/DELETE handlers for commercial-risk paths", () => {
    const stack = (riskRouter as express.Router & { stack?: { route?: { methods?: Record<string, boolean>; path?: string } }[] }).stack ?? [];
    const riskRoutes = stack.filter(layer => {
      const path = layer.route?.path ?? "";
      return path.includes("commercial-risk");
    });
    for (const layer of riskRoutes) {
      const methods = layer.route?.methods ?? {};
      expect(methods.get).toBe(true);
      expect(methods.post).toBeUndefined();
      expect(methods.patch).toBeUndefined();
      expect(methods.delete).toBeUndefined();
    }
  });
});

describe("GET /platform/commercial-risk/summary", () => {
  it("returns summary when permitted", async () => {
    const res = await request(app).get("/api/platform/commercial-risk/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.totalTenants).toBe(1);
    expect(res.body.summary.highRiskCount).toBe(1);
  });

  it("403 without commercial.risk.read", async () => {
    denyPermission = true;
    const res = await request(app).get("/api/platform/commercial-risk/summary");
    expect(res.status).toBe(403);
  });
});

describe("GET /platform/commercial-risk/list", () => {
  it("returns tenant list when permitted", async () => {
    const res = await request(app).get("/api/platform/commercial-risk/list");
    expect(res.status).toBe(200);
    expect(res.body.tenants).toHaveLength(1);
    expect(res.body.tenants[0].tenantName).toBe("Acme");
  });

  it("403 without permission", async () => {
    denyPermission = true;
    const res = await request(app).get("/api/platform/commercial-risk/list");
    expect(res.status).toBe(403);
  });
});

describe("GET /platform/tenants/:tenantId/commercial-risk", () => {
  it("returns detail and audits view", async () => {
    const res = await request(app).get("/api/platform/tenants/1/commercial-risk");
    expect(res.status).toBe(200);
    expect(res.body.risk.riskLevel).toBe("high");
    expect(dbInsert).toHaveBeenCalled();
  });

  it("404 and audits denied when tenant missing", async () => {
    loadOne.mockResolvedValue(null);
    const res = await request(app).get("/api/platform/tenants/99/commercial-risk");
    expect(res.status).toBe(404);
    expect(dbInsert).toHaveBeenCalled();
  });

  it("403 without permission", async () => {
    denyPermission = true;
    const res = await request(app).get("/api/platform/tenants/1/commercial-risk");
    expect(res.status).toBe(403);
  });
});
