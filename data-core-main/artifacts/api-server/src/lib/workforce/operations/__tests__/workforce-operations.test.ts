import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

describe("workforce governance", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns ok in legacy mode without blocking", async () => {
    const { validateWorkforceGovernance } = await import("../governance-service");
    vi.doMock("../settings", () => ({
      getWorkforceGovernanceMode: vi.fn().mockResolvedValue("legacy"),
      getWorkforceActivationRequires: vi.fn().mockResolvedValue({ employmentType: true }),
    }));
    vi.doMock("../org/employee-org-validation", () => ({
      validateEmployeeOrgLinking: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const result = await validateWorkforceGovernance(1, 1, {
      status: "active",
      orgUnitId: null,
      directManagerId: null,
      employmentType: null,
    }, "legacy");

    expect(result.ok).toBe(true);
  });
});

describe("movement type labels", () => {
  it("exports listEmployeeMovements function", async () => {
    const mod = await import("../movement-service");
    expect(typeof mod.listEmployeeMovements).toBe("function");
    expect(typeof mod.recordAndApplyMovement).toBe("function");
  });
});

describe("timeline service", () => {
  it("exports appendTimelineEvent", async () => {
    const mod = await import("../timeline-service");
    expect(typeof mod.appendTimelineEvent).toBe("function");
    expect(typeof mod.getEmployeeTimeline).toBe("function");
  });
});

describe("schema guard", () => {
  it("returns 503 body with migration hint", async () => {
    const { workforceOpsSchemaUnavailableBody } = await import("../schema-guard");
    const body = workforceOpsSchemaUnavailableBody();
    expect(body.error).toBe("WORKFORCE_OPS_SCHEMA_UNAVAILABLE");
    expect(body.migrationHint).toContain("migrate-workforce-operations");
  });
});
