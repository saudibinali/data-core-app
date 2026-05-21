/**
 * @phase P16-E - Workspace access routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const accessFind = vi.fn();
const subFind = vi.fn();
const policyFind = vi.fn();
const accountFind = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();
const dbSelect = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    workspaceAccessEnforcementTable: { findFirst: accessFind },
    workspaceSubscriptionsTable: { findFirst: subFind },
    workspaceSubscriptionPoliciesTable: { findFirst: policyFind },
    commercialAccountsTable: { findFirst: accountFind },
  },
  insert: dbInsert,
  update: dbUpdate,
  select: dbSelect,
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  workspacesTable: {},
  activityLogsTable: {},
  workspaceAccessEnforcementTable: {},
  workspaceSubscriptionsTable: {},
  workspaceSubscriptionPoliciesTable: {},
  commercialAccountsTable: {},
  commercialContractTermsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  desc: () => ({}),
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

const { default: accessRouter } = await import("../workspace-access");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", accessRouter as any);

const TID = 7;
const WS = { id: TID, name: "Tenant" };

beforeEach(() => {
  denyPermission = false;
  wsFind.mockResolvedValue(WS);
  accessFind.mockResolvedValue(null);
  subFind.mockResolvedValue({ id: 11, workspaceId: TID, status: "active", endDate: null });
  policyFind.mockResolvedValue(null);
  accountFind.mockResolvedValue(null);
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
  });
  dbInsert.mockImplementation(() => ({
    values: () => ({
      returning: async () => [
        {
          id: 1,
          workspaceId: TID,
          subscriptionId: 11,
          enforcementStatus: "read_only",
          enforcementReason: "Manual read-only for testing purposes",
          source: "manual",
          appliedBy: 1,
          appliedAt: new Date(),
          expiresAt: null,
          allowLogin: true,
          allowRead: true,
          allowCreate: false,
          allowUpdate: false,
          allowDelete: false,
          allowExport: true,
          allowAdminAccess: true,
          internalNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
  }));
});

describe("GET workspace-access", () => {
  it("requires read permission", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/workspace-access`);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.workspaceAccess.read");
  });

  it("returns normal default when no enforcement row", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/workspace-access`);
    expect(res.status).toBe(200);
    expect(res.body.access.enforcementStatus).toBe("normal");
    expect(res.body.access.allowCreate).toBe(true);
  });
});

describe("PATCH workspace-access", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/workspace-access`)
      .send({ enforcementStatus: "read_only", reason: "Applying read only mode test" });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.workspaceAccess.update");
  });

  it("rejects allowRead=false", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/workspace-access`)
      .send({
        enforcementStatus: "read_only",
        allowRead: false,
        reason: "Attempt to block read access entirely",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowRead/);
  });

  it("rejects allowLogin=false", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/workspace-access`)
      .send({
        enforcementStatus: "read_only",
        allowLogin: false,
        reason: "Attempt full login block which is forbidden",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowLogin/);
  });

  it("requires reason", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${TID}/workspace-access`)
      .send({ enforcementStatus: "read_only" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });
});

describe("route safety", () => {
  it("no DELETE route", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../workspace-access.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/router\.delete\(/);
  });
});
