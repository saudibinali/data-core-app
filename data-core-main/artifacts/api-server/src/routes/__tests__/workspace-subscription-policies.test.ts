/**
 * @phase P16-D - Subscription policy routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const subFind = vi.fn();
const policyFind = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

const mockDb = {
  query: {
    workspacesTable: { findFirst: wsFind },
    workspaceSubscriptionsTable: { findFirst: subFind },
    workspaceSubscriptionPoliciesTable: { findFirst: policyFind },
  },
  insert: dbInsert,
  update: dbUpdate,
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  workspacesTable: {},
  activityLogsTable: {},
  workspaceSubscriptionsTable: {},
  workspaceSubscriptionPoliciesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ op: "eq" }),
  and: (...args: unknown[]) => ({ op: "and", args }),
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

const { default: policyRouter } = await import("../workspace-subscription-policies");

const app = express();
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", policyRouter as any);

const TID = 7;
const WS = { id: TID, name: "Tenant" };
const SUB = { id: 11, workspaceId: TID, status: "active", endDate: "2020-01-01" };

beforeEach(() => {
  denyPermission = false;
  deniedPermission = "";
  wsFind.mockReset();
  subFind.mockReset();
  policyFind.mockReset();
  dbInsert.mockReset();
  dbUpdate.mockReset();
  wsFind.mockResolvedValue(WS);
  subFind.mockResolvedValue(SUB);
  policyFind.mockResolvedValue(null);
  dbInsert.mockImplementation(() => ({
    values: () => ({
      returning: async () => [
        {
          id: 1,
          workspaceId: TID,
          subscriptionId: 11,
          policyName: "Test",
          gracePeriodDays: 7,
          pastDueAfterDays: 14,
          suspensionAfterDays: 30,
          terminationAfterDays: 90,
          allowReadOnlyDuringSuspension: true,
          allowAdminAccessDuringSuspension: true,
          allowDataExportDuringSuspension: true,
          enforcementMode: "advisory_only",
          isActive: true,
          reason: "Policy setup for testing",
          internalNotes: null,
          createdBy: 1,
          updatedBy: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
  }));
});

describe("GET /subscription-policy", () => {
  it("requires read permission", async () => {
    denyPermission = true;
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription-policy`);
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptionPolicies.read");
  });

  it("returns default policy when none saved", async () => {
    const res = await request(app).get(`/api/platform/tenants/${TID}/subscription-policy`);
    expect(res.status).toBe(200);
    expect(res.body.policy.isDefault).toBe(true);
    expect(res.body.policy.enforcementMode).toBe("advisory_only");
  });
});

describe("PUT /subscription-policy", () => {
  it("requires update permission", async () => {
    denyPermission = true;
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/subscription-policy`)
      .send({ reason: "Updating policy for test" });
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptionPolicies.update");
  });

  it("rejects invalid day ordering", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/subscription-policy`)
      .send({
        policyName: "Bad",
        gracePeriodDays: 30,
        pastDueAfterDays: 7,
        suspensionAfterDays: 30,
        reason: "Invalid ordering test case",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pastDueAfterDays/);
  });

  it("requires reason on update", async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/subscription-policy`)
      .send({ policyName: "Test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  it("rejects cross-tenant subscriptionId", async () => {
    subFind.mockResolvedValueOnce(null);
    const res = await request(app)
      .put(`/api/platform/tenants/${TID}/subscription-policy`)
      .send({
        policyName: "Test",
        gracePeriodDays: 7,
        pastDueAfterDays: 14,
        suspensionAfterDays: 30,
        subscriptionId: 999,
        reason: "Cross tenant subscription link attempt",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subscriptionId/);
  });
});

describe("GET /subscription-policy/evaluation", () => {
  it("requires evaluate permission", async () => {
    denyPermission = true;
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/subscription-policy/evaluation`,
    );
    expect(res.status).toBe(403);
    expect(deniedPermission).toBe("platform.subscriptionPolicies.evaluate");
  });

  it("returns evaluation without mutating subscription", async () => {
    const res = await request(app).get(
      `/api/platform/tenants/${TID}/subscription-policy/evaluation`,
    );
    expect(res.status).toBe(200);
    expect(res.body.evaluation.isAutomaticAllowed).toBe(false);
    expect(res.body.evaluation.recommendedStatus).toBeDefined();
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

describe("route safety", () => {
  it("has no DELETE route", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../workspace-subscription-policies.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/router\.delete\(/);
    expect(src).not.toMatch(/\/tenant\//);
  });
});
