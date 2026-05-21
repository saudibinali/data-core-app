/**
 * @phase P16-B - Entitlement resolver (read-only)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();

vi.mock("@workspace/db", () => ({
  workspaceEntitlementsTable: {},
  db: { select: () => ({ from: () => ({ where: selectMock }) }) },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

import {
  canWorkspaceUseFeature,
  resolveWorkspaceEntitlements,
} from "../workspace-entitlement-resolver";

beforeEach(() => {
  vi.clearAllMocks();
  selectMock.mockResolvedValue([
    {
      workspaceId: 1,
      moduleKey: "hr",
      featureKey: "",
      isEnabled: true,
      source: "manual",
      effectiveFrom: null,
      effectiveUntil: null,
    },
    {
      workspaceId: 1,
      moduleKey: "payroll",
      featureKey: "",
      isEnabled: false,
      source: "manual",
      effectiveFrom: null,
      effectiveUntil: null,
    },
    {
      workspaceId: 1,
      moduleKey: "payroll",
      featureKey: "payroll.salary_components",
      isEnabled: true,
      source: "contract_override",
      effectiveFrom: null,
      effectiveUntil: null,
    },
  ]);
});

describe("resolveWorkspaceEntitlements", () => {
  it("core is always enabled", async () => {
    const resolved = await resolveWorkspaceEntitlements(1);
    expect(resolved.core.isEnabled).toBe(true);
  });

  it("reflects module and feature rows", async () => {
    const resolved = await resolveWorkspaceEntitlements(1);
    expect(resolved.hr.isEnabled).toBe(true);
    expect(resolved.payroll.isEnabled).toBe(false);
    expect(resolved.payroll.features["payroll.salary_components"]).toBe(true);
  });
});

describe("canWorkspaceUseFeature", () => {
  it("returns true for core regardless of rows", async () => {
    selectMock.mockResolvedValue([]);
    expect(await canWorkspaceUseFeature(1, "core")).toBe(true);
    expect(await canWorkspaceUseFeature(1, "core", "any.feature")).toBe(true);
  });

  it("returns false for disabled module without feature override", async () => {
    expect(await canWorkspaceUseFeature(1, "analytics")).toBe(false);
  });

  it("returns true for enabled feature override on disabled module", async () => {
    expect(await canWorkspaceUseFeature(1, "payroll", "payroll.salary_components")).toBe(true);
  });
});
