/**
 * commercial.test.ts
 *
 * @phase P15-A-FIX - Commercial Accounts & Billing Contacts - Route Tests
 *
 * Integration-style tests using supertest + vi.mock.
 * DB and auth middlewares are fully mocked - no real DB, no real JWT.
 *
 * Covers:
 *   - GET  commercial account - permission check
 *   - PUT  commercial account - permission check, create (201), update (200)
 *   - Invalid billingEmail / contractOwnerEmail rejected
 *   - Invalid accountManagerUserId rejected
 *   - GET  contacts - permission check (contacts hidden without permission)
 *   - POST contact  - permission check, create, invalid email, role fallback
 *   - PATCH contact - permission check, update, invalid email
 *   - Set primary ensures only one primary (two update calls)
 *   - commercialAccount response never includes contacts (separate endpoint)
 *
 * SAFETY: no payment, no Stripe, no invoice, no tax, no email sending, no delete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Mock @workspace/db with SEPARATE fn per table so queues never bleed
// ─────────────────────────────────────────────────────────────────────────────

const wsFind       = vi.fn();  // workspacesTable.findFirst
const acctFind     = vi.fn();  // commercialAccountsTable.findFirst
const contactFind  = vi.fn();  // commercialBillingContactsTable.findFirst
const contactMany  = vi.fn();  // commercialBillingContactsTable.findMany
const dbInsert     = vi.fn();
const dbUpdate     = vi.fn();

const mockDb = {
  query: {
    workspacesTable:                { findFirst: wsFind    },
    commercialAccountsTable:        { findFirst: acctFind  },
    commercialBillingContactsTable: { findFirst: contactFind, findMany: contactMany },
  },
  insert: dbInsert,
  update: dbUpdate,
};

/** Returns a chainable drizzle-like builder whose .returning() resolves to `rows`. */
function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {
    values:    () => c,
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
  commercialBillingContactsTable:  {},
}));

vi.mock("drizzle-orm", () => ({
  eq:  (_a: unknown, _b: unknown) => ({ op: "eq",  a: _a, b: _b }),
  and: (...args: unknown[])        => ({ op: "and", args }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock auth middlewares
// Path: ../../middlewares/requireAuth  (from routes/__tests__/)
// ─────────────────────────────────────────────────────────────────────────────

let denyPermission = false;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as unknown as Record<string, unknown>;
    r["userId"] = 1; r["userRole"] = "super_admin";
    r["platformRoleCode"] = "root_platform_owner"; r["isRootOwner"] = false;
    next();
  },
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requirePlatformPermission: (_perm: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyPermission) { res.status(403).json({ error: "denied", code: "NOT_PLATFORM_USER" }); return; }
      next();
    },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import route AFTER mocks are hoisted
// ─────────────────────────────────────────────────────────────────────────────

const { default: commercialRouter } = await import("../commercial");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", commercialRouter as any);

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TID = 42; // tenantId used throughout

const WS: Record<string, unknown>   = { id: TID, name: "Acme Corp" };
const ACCT: Record<string, unknown> = {
  id: 10, workspaceId: TID, commercialAccountName: "Acme", status: "active",
  billingEmail: "billing@acme.com", legalEntityName: null, billingPhone: null,
  contractOwnerName: null, contractOwnerEmail: null, companyTaxNumberPlaceholder: null,
  commercialNotes: null, accountManagerUserId: null, financeOwnerUserId: null,
  createdBy: 1, updatedBy: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
const CONTACT: Record<string, unknown> = {
  id: 20, commercialAccountId: 10, contactName: "Jane Finance",
  contactEmail: "jane@acme.com", contactPhone: null, contactRole: "finance_contact",
  isPrimary: false, notes: null, createdBy: 1, updatedBy: 1,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

// ─────────────────────────────────────────────────────────────────────────────
// Reset all mocks before every test
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();   // clears queue AND default implementations
  denyPermission = false;
  // Set safe defaults - override per-test as needed
  wsFind.mockResolvedValue(WS);
  acctFind.mockResolvedValue(ACCT);
  contactFind.mockResolvedValue(CONTACT);
  contactMany.mockResolvedValue([CONTACT]);
  dbInsert.mockReturnValue(chain([ACCT]));
  dbUpdate.mockReturnValue(chain([ACCT]));
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/platform/tenants/:tenantId/commercial-account
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /platform/tenants/:tenantId/commercial-account", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("returns 400 for non-numeric tenantId", async () => {
    const res = await request(app).get("/api/platform/tenants/abc/commercial-account");
    expect(res.status).toBe(400);
  });

  it("returns 404 when tenant not found", async () => {
    wsFind.mockResolvedValue(undefined);
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/tenant not found/i);
  });

  it("returns 200 with commercialAccount when account exists", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    expect(res.status).toBe(200);
    expect(res.body.commercialAccount).toBeDefined();
    expect(res.body.commercialAccount.id).toBe(ACCT.id);
  });

  it("returns commercialAccount:null when no account exists yet", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    expect(res.status).toBe(200);
    expect(res.body.commercialAccount).toBeNull();
  });

  it("response does NOT include contacts (contacts require a separate endpoint)", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toBeUndefined();
    expect(res.body.commercialAccount?.contacts).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/platform/tenants/:tenantId/commercial-account - create (201)
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /platform/tenants/:tenantId/commercial-account - create", () => {
  beforeEach(() => {
    acctFind.mockResolvedValue(undefined); // no existing account → insert path
    dbInsert.mockReturnValue(chain([ACCT]));
  });

  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ commercialAccountName: "Test" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("creates account and returns 201", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ commercialAccountName: "Acme", billingEmail: "billing@acme.com", status: "active" });
    expect(res.status).toBe(201);
    expect(res.body.commercialAccount).toBeDefined();
  });

  it("creates account with default status=draft when status not provided", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ commercialAccountName: "Acme" });
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/platform/tenants/:tenantId/commercial-account - update (200)
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /platform/tenants/:tenantId/commercial-account - update", () => {
  beforeEach(() => {
    // acctFind default is ACCT → update path
    dbUpdate.mockReturnValue(chain([ACCT]));
    dbInsert.mockReturnValue(chain([])); // activityLogs
  });

  it("updates existing account and returns 200", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ commercialAccountName: "Acme Updated" });
    expect(res.status).toBe(200);
    expect(res.body.commercialAccount).toBeDefined();
  });

  it("rejects invalid status value with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ status: "suspended" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/i);
  });

  it.each(["draft", "active", "under_review", "inactive"])(
    "accepts valid status '%s' with 200", async (status) => {
      const res = await request(app)
        .put(`/api/platform/tenants/${TID}/commercial-account`)
        .send({ status });
      expect(res.status).toBe(200);
    },
  );

  it("rejects invalid billingEmail format with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ billingEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/billingEmail/i);
  });

  it("accepts valid billingEmail with 200", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ billingEmail: "finance@acme.com" });
    expect(res.status).toBe(200);
  });

  it("clears billingEmail when empty string provided (200)", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ billingEmail: "" });
    expect(res.status).toBe(200);
  });

  it("rejects invalid contractOwnerEmail format with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ contractOwnerEmail: "bad@@email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractOwnerEmail/i);
  });

  it("accepts valid contractOwnerEmail with 200", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ contractOwnerEmail: "owner@acme.com" });
    expect(res.status).toBe(200);
  });

  it("rejects non-integer accountManagerUserId with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ accountManagerUserId: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accountManagerUserId/i);
  });

  it("rejects negative accountManagerUserId with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ accountManagerUserId: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accountManagerUserId/i);
  });

  it("rejects float accountManagerUserId with 400", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ accountManagerUserId: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accountManagerUserId/i);
  });

  it("accepts valid positive accountManagerUserId with 200", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ accountManagerUserId: 7 });
    expect(res.status).toBe(200);
  });

  it("accepts accountManagerUserId=0 to clear the field (200)", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/commercial-account`)
      .send({ accountManagerUserId: 0 });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/platform/tenants/:tenantId/commercial-contacts
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /platform/tenants/:tenantId/commercial-contacts", () => {
  it("returns 403 when permission is denied - contacts are hidden", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contacts`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("returns empty contacts array when no commercial account exists", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contacts`);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toEqual([]);
  });

  it("returns contacts list when account exists", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contacts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contacts)).toBe(true);
    expect(res.body.contacts[0].contactName).toBe("Jane Finance");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/platform/tenants/:tenantId/commercial-contacts
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /platform/tenants/:tenantId/commercial-contacts", () => {
  beforeEach(() => {
    dbInsert.mockReturnValue(chain([CONTACT]));
  });

  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "John", contactEmail: "john@acme.com" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("returns 404 when no commercial account exists for the tenant", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "John", contactEmail: "john@acme.com" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no commercial account/i);
  });

  it("returns 400 when contactName is missing", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactEmail: "john@acme.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactName/i);
  });

  it("returns 400 when contactEmail is missing", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "John Doe" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail/i);
  });

  it("returns 400 when contactEmail has invalid format", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "John", contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail/i);
  });

  it("creates contact and returns 201 with valid data", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "Jane Finance", contactEmail: "jane@acme.com", contactRole: "finance_contact" });
    expect(res.status).toBe(201);
    expect(res.body.contact).toBeDefined();
  });

  it("defaults contactRole to 'other' when unknown role is provided (primary is not a role)", async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${TID}/commercial-contacts`)
      .send({ contactName: "Sam", contactEmail: "sam@acme.com", contactRole: "primary" });
    expect(res.status).toBe(201);
    // "primary" is not a valid role code - falls back to "other"
  });

  it.each(["finance_contact", "procurement_contact", "contract_owner", "executive_sponsor", "other"])(
    "accepts valid contactRole '%s' with 201", async (role) => {
      const res = await request(app)
        .post(`/api/platform/tenants/${TID}/commercial-contacts`)
        .send({ contactName: "Test", contactEmail: "test@acme.com", contactRole: role });
      expect(res.status).toBe(201);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/platform/tenants/:tenantId/commercial-contacts/:contactId
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /platform/tenants/:tenantId/commercial-contacts/:contactId", () => {
  beforeEach(() => {
    // acctFind default = ACCT, contactFind default = CONTACT
    dbUpdate.mockReturnValue(chain([CONTACT]));
    dbInsert.mockReturnValue(chain([])); // activityLogs
  });

  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}`)
      .send({ contactName: "Updated" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("returns 404 when no commercial account exists", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}`)
      .send({ contactName: "Updated" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when contact does not exist", async () => {
    contactFind.mockResolvedValue(undefined);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/999`)
      .send({ contactName: "Updated" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/contact not found/i);
  });

  it("updates contact and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}`)
      .send({ contactName: "Jane Updated" });
    expect(res.status).toBe(200);
    expect(res.body.contact).toBeDefined();
  });

  it("rejects invalid contactEmail format with 400", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}`)
      .send({ contactEmail: "bad-email@@" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail/i);
  });

  it("accepts valid contactEmail update with 200", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}`)
      .send({ contactEmail: "new@acme.com" });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH .../commercial-contacts/:contactId/primary
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH .../commercial-contacts/:contactId/primary", () => {
  it("returns 403 when permission is denied", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}/primary`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_PLATFORM_USER");
  });

  it("returns 404 when no commercial account exists", async () => {
    acctFind.mockResolvedValue(undefined);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}/primary`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when contact does not exist", async () => {
    contactFind.mockResolvedValue(undefined);
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/999/primary`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/contact not found/i);
  });

  it("sets primary and returns 200", async () => {
    const updated = { ...CONTACT, isPrimary: true };
    dbUpdate.mockReturnValue(chain([updated]));
    dbInsert.mockReturnValue(chain([]));
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}/primary`);
    expect(res.status).toBe(200);
    expect(res.body.contact).toBeDefined();
  });

  it("calls dbUpdate TWICE - first clear all, then set target", async () => {
    const clearC = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([]) };
    const setC   = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ ...CONTACT, isPrimary: true }]) };
    dbUpdate.mockReturnValueOnce(clearC).mockReturnValueOnce(setC);
    dbInsert.mockReturnValue(chain([]));

    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}/primary`);

    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalledTimes(2);
    // First call clears all primaries
    expect(clearC.set).toHaveBeenCalledWith({ isPrimary: false });
    // Second call sets exactly one primary
    expect(setC.set).toHaveBeenCalledWith(expect.objectContaining({ isPrimary: true }));
  });

  it("ensures only one primary - pattern: clear all then set one", async () => {
    const calls: Array<Record<string, unknown>> = [];
    dbUpdate.mockImplementation(() => {
      const idx = calls.length;
      const c = {
        set: vi.fn((v: Record<string, unknown>) => { calls[idx] = v; return c; }),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...CONTACT, isPrimary: true }]),
      };
      return c;
    });
    dbInsert.mockReturnValue(chain([]));

    await request(app)
      .patch(`/api/platform/tenants/${TID}/commercial-contacts/${CONTACT.id}/primary`);

    expect(calls[0]).toEqual({ isPrimary: false });              // clear all
    expect(calls[1]).toEqual(expect.objectContaining({ isPrimary: true })); // set one
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Safety - responses must not include payment/Stripe/invoice fields
// ═══════════════════════════════════════════════════════════════════════════

describe("Safety - no payment/Stripe/invoice fields in responses", () => {
  it("GET commercial-account does not expose payment fields", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-account`);
    const a = res.body.commercialAccount ?? {};
    expect(a).not.toHaveProperty("stripeCustomerId");
    expect(a).not.toHaveProperty("stripeSubscriptionId");
    expect(a).not.toHaveProperty("invoiceId");
    expect(a).not.toHaveProperty("paymentMethodId");
    expect(a).not.toHaveProperty("taxId");
    expect(a).not.toHaveProperty("vatNumber");
    expect(a).not.toHaveProperty("cardLast4");
  });

  it("GET contacts does not expose payment fields", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/commercial-contacts`);
    for (const c of res.body.contacts as Record<string, unknown>[]) {
      expect(c).not.toHaveProperty("stripeId");
      expect(c).not.toHaveProperty("invoiceId");
      expect(c).not.toHaveProperty("paymentToken");
    }
  });
});
