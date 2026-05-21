/**
 * @phase P16-G - Tenant subscription visibility routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const buildSummary = vi.fn();
const buildEntitlements = vi.fn();
const buildQuotas = vi.fn();

vi.mock("../../lib/tenant-subscription-visibility", () => ({
  buildTenantSubscriptionSummary: (...args: unknown[]) => buildSummary(...args),
  buildTenantSubscriptionEntitlements: (...args: unknown[]) => buildEntitlements(...args),
  buildTenantSubscriptionQuotas: (...args: unknown[]) => buildQuotas(...args),
}));

let denyPermission = false;
let deniedPerm = "";
let mockWorkspaceId: number | null = 42;
let mockUserRole = "member";
let mockPermissions: string[] = ["tenant.subscription.read"];

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
      if (role === "admin" || role === "manager") {
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

const { default: tenantSubscriptionRouter } = await import("../tenant-subscription");

function app() {
  const a = express();
  a.use(express.json());
  a.use(tenantSubscriptionRouter);
  return a;
}

describe("tenant subscription visibility routes", () => {
  beforeEach(() => {
    denyPermission = false;
    deniedPerm = "";
    mockWorkspaceId = 42;
    mockUserRole = "member";
    mockPermissions = ["tenant.subscription.read"];
    buildSummary.mockResolvedValue({
      subscriptionStatus: "active",
      planName: "Enterprise",
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      renewalDate: "2026-12-31",
      gracePeriodEndsAt: null,
      accessMode: "normal",
      readOnlyMode: false,
      readOnlyReason: null,
      daysUntilEnd: 100,
      daysPastEnd: null,
      recommendedStatus: null,
      supportContact: null,
    });
    buildEntitlements.mockResolvedValue({
      modules: [{ moduleKey: "hr", label: "HR", labelAr: "HR", isEnabled: true, isCore: false, features: [] }],
    });
    buildQuotas.mockResolvedValue({
      quotas: [
        {
          quotaKey: "users.max",
          label: "Users",
          labelAr: "Users",
          unit: "users",
          limitValue: 10,
          currentUsage: 3,
          usagePercent: 30,
          status: "ok",
          warningThresholdPercent: 80,
        },
      ],
    });
  });

  it("GET summary requires tenant.subscription.read", async () => {
    deniedPerm = "tenant.subscription.read";
    const res = await request(app()).get("/tenant/subscription/summary");
    expect(res.status).toBe(403);
  });

  it("GET summary returns tenant-safe payload", async () => {
    const res = await request(app()).get("/tenant/subscription/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.planName).toBe("Enterprise");
    expect(res.body.summary).not.toHaveProperty("internalNotes");
  });

  it("GET entitlements with read permission", async () => {
    const res = await request(app()).get("/tenant/subscription/entitlements");
    expect(res.status).toBe(200);
    expect(res.body.modules).toHaveLength(1);
  });

  it("GET quotas with read permission", async () => {
    const res = await request(app()).get("/tenant/subscription/quotas");
    expect(res.status).toBe(200);
    expect(res.body.quotas[0].quotaKey).toBe("users.max");
  });

  it("rejects super_admin", async () => {
    mockUserRole = "super_admin";
    const res = await request(app()).get("/tenant/subscription/summary");
    expect(res.status).toBe(403);
  });

  it("router is GET-only", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(dir, "../tenant-subscription.ts"), "utf8");
    expect(src).toMatch(/router\.get\(/);
    expect(src).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });
});
