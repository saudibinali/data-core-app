/**
 * @phase P16-C - Quota usage resolver (read-only)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const dbSelect = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select: dbSelect },
  workspaceQuotaLimitsTable: {},
  usersTable: { workspaceId: "workspaceId" },
  employeesTable: { workspaceId: "workspaceId" },
  hrOrgUnitsTable: { workspaceId: "workspaceId", type: "type" },
  hrEmployeeDocumentsTable: { workspaceId: "workspaceId", fileSize: "fileSize" },
  workflowDefinitionsTable: { workspaceId: "workspaceId", deletedAt: "deletedAt" },
  workspaceCustomRolesTable: { workspaceId: "workspaceId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  count: () => ({ as: "n" }),
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { raw: (s: string) => s }),
}));

function chainSelect(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: vi.fn(() => c),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelect.mockImplementation(() => chainSelect([{ n: 5 }]));
});

const { resolveWorkspaceQuotaUsage } = await import("../workspace-quota-resolver");

describe("resolveWorkspaceQuotaUsage", () => {
  beforeEach(() => {
    dbSelect.mockImplementation((sel?: unknown) => {
      if (sel && typeof sel === "object" && sel !== null && "from" in (sel as object)) {
        return chainSelect([{ bytes: 0 }]);
      }
      return chainSelect([{ n: 3 }]);
    });
  });

  it("returns one item per catalog quota", async () => {
    dbSelect
      .mockReturnValueOnce(chainSelect([]))
      .mockImplementation(() => chainSelect([{ n: 2 }]));

    const result = await resolveWorkspaceQuotaUsage(1);
    expect(result.length).toBe(11);
    expect(result.some((r) => r.quotaKey === "users.max")).toBe(true);
  });

  it("marks metering quotas as unknown usage", async () => {
    dbSelect.mockReturnValue(chainSelect([]));
    const result = await resolveWorkspaceQuotaUsage(1);
    const api = result.find((r) => r.quotaKey === "api.requests.monthly");
    expect(api?.currentUsage).toBeNull();
    expect(api?.status).toBe("unknown");
  });

  it("does not mutate data - read-only select calls", async () => {
    dbSelect.mockReturnValue(chainSelect([]));
    await resolveWorkspaceQuotaUsage(99);
    expect(dbSelect).toHaveBeenCalled();
    const insertCalls = dbSelect.mock.calls.filter((c) => String(c).includes("insert"));
    expect(insertCalls.length).toBe(0);
  });
});
