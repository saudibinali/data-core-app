/**
 * @phase P15-H - Commercial activity route tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const wsFind = vi.fn();
const activityRows = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    query: { workspacesTable: { findFirst: wsFind } },
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => activityRows(),
            }),
          }),
        }),
      }),
    }),
  },
  workspacesTable: {},
  activityLogsTable: {},
  usersTable: {},
}));

let denyActivity = false;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAnyPlatformPermission: () =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (denyActivity) {
        res.status(403).json({ error: "denied" });
        return;
      }
      next();
    },
}));

const { default: activityRouter } = await import("../commercial-activity");

const app = express();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api", activityRouter as any);

beforeEach(() => {
  denyActivity = false;
  wsFind.mockResolvedValue({ id: 42 });
  activityRows.mockResolvedValue([
    {
      id: 10,
      actorId: 1,
      actorEmail: "admin@test.com",
      actorName: "Admin",
      action: "commercial_invoice_created",
      metadata: JSON.stringify({ result: "success", tenantId: 42 }),
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
    },
  ]);
});

describe("GET /platform/tenants/:tenantId/commercial-activity", () => {
  it("returns items when permitted", async () => {
    const res = await request(app).get("/api/platform/tenants/42/commercial-activity");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe("commercial_invoice_created");
    expect(res.body.items[0].metadataSummary).toBeTruthy();
  });

  it("403 without activity permission", async () => {
    denyActivity = true;
    const res = await request(app).get("/api/platform/tenants/42/commercial-activity");
    expect(res.status).toBe(403);
  });

  it("404 when tenant missing", async () => {
    wsFind.mockResolvedValue(null);
    const res = await request(app).get("/api/platform/tenants/99/commercial-activity");
    expect(res.status).toBe(404);
  });
});

describe("commercial activity router - GET only", () => {
  it("has no POST/PATCH/DELETE on commercial-activity path", () => {
    const stack = (activityRouter as express.Router & { stack?: { route?: { methods?: Record<string, boolean>; path?: string } }[] }).stack ?? [];
    const routes = stack.filter(l => l.route?.path?.includes("commercial-activity"));
    for (const layer of routes) {
      expect(layer.route?.methods?.get).toBe(true);
      expect(layer.route?.methods?.post).toBeUndefined();
      expect(layer.route?.methods?.delete).toBeUndefined();
    }
  });
});
