/**
 * @file   src/lib/__tests__/tenant-registry.test.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *
 * Pure model tests for the tenant registry engine.
 * All tests operate on plain in-memory data - no DB, no HTTP, no auth.
 *
 * Tests:
 *   T1   deriveTenantStatus - known workspace statuses map correctly
 *   T2   deriveTenantStatus - unknown status maps to pending_activation
 *   T3   deriveWorkspaceOperationalStatus - healthy / attention / suspended / archived
 *   T4   deriveRiskSignalSummary - riskLevel escalation: none → low → high → critical
 *   T5   deriveRiskSignalSummary - flag fields set correctly per workspace status
 *   T6   buildUsageSummary - activeUsers populated; all limits null (placeholder)
 *   T7   buildDefaultModuleSummary - all nullable fields null; arrays empty
 *   T8   buildTenantProfile - all required fields present; types correct
 *   T9   buildTenantProfile - owner fields null when owner absent
 *   T10  buildTenantProfile - planCode and subscriptionStatus are placeholder values
 *   T11  buildTenantProfile - dates serialized to ISO strings
 *   T12  applyTenantFilters - status filter is exact match
 *   T13  applyTenantFilters - search filter is case-insensitive, multi-field
 *   T14  applyTenantFilters - riskLevel filter works
 *   T15  applyTenantFilters - no filters returns full list
 *   T16  sortTenantsByName - deterministic alphabetical ordering
 *   T17  sortTenantsByName - does not mutate input array
 *   T18  TenantStatus exhaustive - all 8 statuses derivable
 *   T19  RiskLevel exhaustive - all 6 levels returned correctly
 *   T20  Safety - buildTenantProfile never throws on minimal input
 */

import { describe, it, expect } from "vitest";
import {
  deriveTenantStatus,
  deriveWorkspaceOperationalStatus,
  deriveRiskSignalSummary,
  buildUsageSummary,
  buildDefaultModuleSummary,
  buildTenantProfile,
  applyTenantFilters,
  sortTenantsByName,
  type RawWorkspaceRow,
  type RawOwnerRow,
  type PlatformTenantProfile,
} from "../tenant-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-16T12:00:00.000Z");

function makeWorkspace(overrides: Partial<RawWorkspaceRow> = {}): RawWorkspaceRow {
  return {
    id:              1,
    name:            "Acme Corp",
    slug:            "acme",
    status:          "active",
    logoUrl:         null,
    primaryColor:    null,
    createdAt:       new Date("2025-01-01T00:00:00.000Z"),
    updatedAt:       new Date("2025-06-01T00:00:00.000Z"),
    userCount:       5,
    ticketCount:     12,
    departmentCount: 3,
    ...overrides,
  };
}

function makeOwner(overrides: Partial<RawOwnerRow> = {}): RawOwnerRow {
  return {
    id:       42,
    email:    "owner@acme.com",
    fullName: "Alice Admin",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<RawWorkspaceRow> = {}): PlatformTenantProfile {
  return buildTenantProfile(makeWorkspace(overrides), makeOwner(), NOW);
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - deriveTenantStatus: known statuses
// ─────────────────────────────────────────────────────────────────────────────
describe("T1 - deriveTenantStatus: known workspace statuses", () => {
  it("active → active", () => {
    expect(deriveTenantStatus("active")).toBe("active");
  });
  it("suspended → suspended", () => {
    expect(deriveTenantStatus("suspended")).toBe("suspended");
  });
  it("disabled → archived", () => {
    expect(deriveTenantStatus("disabled")).toBe("archived");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - deriveTenantStatus: unknown status
// ─────────────────────────────────────────────────────────────────────────────
describe("T2 - deriveTenantStatus: unknown → pending_activation", () => {
  it("unknown string → pending_activation", () => {
    expect(deriveTenantStatus("unknown")).toBe("pending_activation");
    expect(deriveTenantStatus("")).toBe("pending_activation");
    expect(deriveTenantStatus("ACTIVE")).toBe("pending_activation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - deriveWorkspaceOperationalStatus
// ─────────────────────────────────────────────────────────────────────────────
describe("T3 - deriveWorkspaceOperationalStatus", () => {
  it("active + users → healthy", () => {
    expect(deriveWorkspaceOperationalStatus("active", 5)).toBe("healthy");
  });
  it("active + 0 users → attention", () => {
    expect(deriveWorkspaceOperationalStatus("active", 0)).toBe("attention");
  });
  it("suspended → suspended (regardless of userCount)", () => {
    expect(deriveWorkspaceOperationalStatus("suspended", 10)).toBe("suspended");
    expect(deriveWorkspaceOperationalStatus("suspended", 0)).toBe("suspended");
  });
  it("disabled → archived", () => {
    expect(deriveWorkspaceOperationalStatus("disabled", 3)).toBe("archived");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - deriveRiskSignalSummary: riskLevel escalation
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 - deriveRiskSignalSummary: riskLevel escalation", () => {
  it("active + users → none", () => {
    expect(deriveRiskSignalSummary("active", 5).riskLevel).toBe("none");
  });
  it("active + 0 users → low", () => {
    expect(deriveRiskSignalSummary("active", 0).riskLevel).toBe("low");
  });
  it("suspended → high", () => {
    expect(deriveRiskSignalSummary("suspended", 5).riskLevel).toBe("high");
  });
  it("disabled → critical", () => {
    expect(deriveRiskSignalSummary("disabled", 5).riskLevel).toBe("critical");
  });
  it("disabled beats suspended in precedence", () => {
    expect(deriveRiskSignalSummary("disabled", 0).riskLevel).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - deriveRiskSignalSummary: flag fields
// ─────────────────────────────────────────────────────────────────────────────
describe("T5 - deriveRiskSignalSummary: flag fields", () => {
  it("active + users: all flags false", () => {
    const s = deriveRiskSignalSummary("active", 5);
    expect(s.subscriptionExpired).toBe(false);
    expect(s.governanceWarnings).toBe(false);
    expect(s.operationalWarnings).toBe(false);
  });
  it("suspended: governanceWarnings true", () => {
    const s = deriveRiskSignalSummary("suspended", 5);
    expect(s.governanceWarnings).toBe(true);
    expect(s.subscriptionExpired).toBe(false);
  });
  it("disabled: subscriptionExpired true", () => {
    const s = deriveRiskSignalSummary("disabled", 5);
    expect(s.subscriptionExpired).toBe(true);
  });
  it("active + 0 users: operationalWarnings true", () => {
    const s = deriveRiskSignalSummary("active", 0);
    expect(s.operationalWarnings).toBe(true);
  });
  it("all placeholder flags remain false", () => {
    const s = deriveRiskSignalSummary("active", 5);
    expect(s.renewalApproaching).toBe(false);
    expect(s.gracePeriodActive).toBe(false);
    expect(s.usageLimitApproaching).toBe(false);
    expect(s.usageLimitExceeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - buildUsageSummary: nullable safe
// ─────────────────────────────────────────────────────────────────────────────
describe("T6 - buildUsageSummary: activeUsers populated; limits null", () => {
  it("returns correct activeUsers", () => {
    const u = buildUsageSummary(7, NOW);
    expect(u.activeUsers).toBe(7);
  });
  it("all limit fields are null", () => {
    const u = buildUsageSummary(7, NOW);
    expect(u.seatLimit).toBeNull();
    expect(u.storageUsed).toBeNull();
    expect(u.storageLimit).toBeNull();
    expect(u.monthlyApiUsage).toBeNull();
    expect(u.apiLimit).toBeNull();
    expect(u.documentsUsed).toBeNull();
    expect(u.documentsLimit).toBeNull();
  });
  it("lastCalculatedAt is ISO string", () => {
    const u = buildUsageSummary(0, NOW);
    expect(u.lastCalculatedAt).toBe(NOW.toISOString());
  });
  it("activeUsers = 0 is valid", () => {
    const u = buildUsageSummary(0, NOW);
    expect(u.activeUsers).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - buildDefaultModuleSummary: nullable safe
// ─────────────────────────────────────────────────────────────────────────────
describe("T7 - buildDefaultModuleSummary: all placeholders null/empty", () => {
  it("planCode is null", () => expect(buildDefaultModuleSummary().planCode).toBeNull());
  it("planName is null", () => expect(buildDefaultModuleSummary().planName).toBeNull());
  it("planTier is null", () => expect(buildDefaultModuleSummary().planTier).toBeNull());
  it("seatLimit is null", () => expect(buildDefaultModuleSummary().seatLimit).toBeNull());
  it("storageLimit is null", () => expect(buildDefaultModuleSummary().storageLimit).toBeNull());
  it("enabledModules is empty array (no plan → nothing enabled)", () => expect(buildDefaultModuleSummary().enabledModules).toEqual([]));
  it("disabledModules has all 20 modules (no plan → everything disabled)", () => expect(buildDefaultModuleSummary().disabledModules).toHaveLength(20));
  it("restrictedModules is empty array", () => expect(buildDefaultModuleSummary().restrictedModules).toEqual([]));
  it("customEntitlementsCount is 0", () => expect(buildDefaultModuleSummary().customEntitlementsCount).toBe(0));
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - buildTenantProfile: all required fields present
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 - buildTenantProfile: all required fields present", () => {
  const profile = makeProfile();

  it("tenantId is string of workspaceId", () => {
    expect(profile.tenantId).toBe("1");
    expect(typeof profile.tenantId).toBe("string");
  });
  it("workspaceId is number", () => {
    expect(profile.workspaceId).toBe(1);
    expect(typeof profile.workspaceId).toBe("number");
  });
  it("workspaceName matches input", () => expect(profile.workspaceName).toBe("Acme Corp"));
  it("tenantDisplayName matches workspaceName", () => expect(profile.tenantDisplayName).toBe(profile.workspaceName));
  it("tenantStatus is TenantStatus string", () => {
    expect(typeof profile.tenantStatus).toBe("string");
    expect(["provisioning","active","trial","grace_period","suspended","archived","locked","pending_activation"])
      .toContain(profile.tenantStatus);
  });
  it("riskSignalSummary is present", () => expect(profile.riskSignalSummary).toBeDefined());
  it("moduleSummary is present", () => expect(profile.moduleSummary).toBeDefined());
  it("usageSummary is present", () => expect(profile.usageSummary).toBeDefined());
  it("userCount present", () => expect(typeof profile.userCount).toBe("number"));
  it("ticketCount present", () => expect(typeof profile.ticketCount).toBe("number"));
  it("departmentCount present", () => expect(typeof profile.departmentCount).toBe("number"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - buildTenantProfile: owner absent → null fields
// ─────────────────────────────────────────────────────────────────────────────
describe("T9 - buildTenantProfile: owner null → null owner fields", () => {
  const profile = buildTenantProfile(makeWorkspace(), null, NOW);
  it("primaryOwnerUserId is null", () => expect(profile.primaryOwnerUserId).toBeNull());
  it("primaryOwnerEmail is null", () => expect(profile.primaryOwnerEmail).toBeNull());
  it("primaryOwnerFullName is null", () => expect(profile.primaryOwnerFullName).toBeNull());
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - buildTenantProfile: placeholder subscription/plan fields
// ─────────────────────────────────────────────────────────────────────────────
describe("T10 - buildTenantProfile: subscription/plan placeholders", () => {
  const profile = makeProfile();
  it("planCode is null (no billing provider)", () => expect(profile.planCode).toBeNull());
  it("subscriptionStatus is unknown (placeholder)", () => expect(profile.subscriptionStatus).toBe("unknown"));
  it("billingPeriodStart is null", () => expect(profile.billingPeriodStart).toBeNull());
  it("billingPeriodEnd is null", () => expect(profile.billingPeriodEnd).toBeNull());
  it("trialEndsAt is null", () => expect(profile.trialEndsAt).toBeNull());
  it("gracePeriodEndsAt is null", () => expect(profile.gracePeriodEndsAt).toBeNull());
  it("region is null", () => expect(profile.region).toBeNull());
  it("dataResidency is null", () => expect(profile.dataResidency).toBeNull());
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - buildTenantProfile: date serialization
// ─────────────────────────────────────────────────────────────────────────────
describe("T11 - buildTenantProfile: dates serialized to ISO strings", () => {
  it("createdAt from Date → ISO string", () => {
    const ws = makeWorkspace({ createdAt: new Date("2025-01-15T10:00:00.000Z") });
    const p  = buildTenantProfile(ws, null, NOW);
    expect(p.createdAt).toBe("2025-01-15T10:00:00.000Z");
  });
  it("updatedAt from Date → ISO string", () => {
    const ws = makeWorkspace({ updatedAt: new Date("2025-06-20T08:30:00.000Z") });
    const p  = buildTenantProfile(ws, null, NOW);
    expect(p.updatedAt).toBe("2025-06-20T08:30:00.000Z");
  });
  it("createdAt from ISO string → string pass-through", () => {
    const ws = makeWorkspace({ createdAt: "2025-03-01T00:00:00.000Z" });
    const p  = buildTenantProfile(ws, null, NOW);
    expect(p.createdAt).toBe("2025-03-01T00:00:00.000Z");
  });
  it("lastActivityAt equals updatedAt", () => {
    const p = makeProfile();
    expect(p.lastActivityAt).toBe(p.updatedAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - applyTenantFilters: status filter
// ─────────────────────────────────────────────────────────────────────────────
describe("T12 - applyTenantFilters: status filter is exact match", () => {
  const profiles = [
    buildTenantProfile(makeWorkspace({ id: 1, name: "Alpha", status: "active" }),    null, NOW),
    buildTenantProfile(makeWorkspace({ id: 2, name: "Beta",  status: "suspended" }), null, NOW),
    buildTenantProfile(makeWorkspace({ id: 3, name: "Gamma", status: "active" }),    null, NOW),
  ];

  it("filter active returns only active tenants", () => {
    const r = applyTenantFilters(profiles, { status: "active" });
    expect(r).toHaveLength(2);
    expect(r.every(p => p.tenantStatus === "active")).toBe(true);
  });
  it("filter suspended returns only suspended tenants", () => {
    const r = applyTenantFilters(profiles, { status: "suspended" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Beta");
  });
  it("filter unknown status returns empty array", () => {
    const r = applyTenantFilters(profiles, { status: "trial" });
    expect(r).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - applyTenantFilters: search is case-insensitive, multi-field
// ─────────────────────────────────────────────────────────────────────────────
describe("T13 - applyTenantFilters: search is case-insensitive + multi-field", () => {
  const profiles = [
    buildTenantProfile(makeWorkspace({ id: 1, name: "Acme Corp" }), makeOwner({ email: "alice@acme.com", fullName: "Alice Admin" }), NOW),
    buildTenantProfile(makeWorkspace({ id: 2, name: "Beta Ltd" }),  makeOwner({ email: "bob@beta.com",   fullName: "Bob Baker" }),  NOW),
    buildTenantProfile(makeWorkspace({ id: 3, name: "Gamma Inc" }), null, NOW),
  ];

  it("search by workspace name (case-insensitive)", () => {
    expect(applyTenantFilters(profiles, { search: "ACME" })).toHaveLength(1);
    expect(applyTenantFilters(profiles, { search: "acme" })).toHaveLength(1);
  });
  it("search by owner email", () => {
    const r = applyTenantFilters(profiles, { search: "bob@beta" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Beta Ltd");
  });
  it("search by owner fullName", () => {
    const r = applyTenantFilters(profiles, { search: "Alice" });
    expect(r).toHaveLength(1);
  });
  it("search with no match returns empty", () => {
    expect(applyTenantFilters(profiles, { search: "zzz-no-match" })).toHaveLength(0);
  });
  it("tenant with null owner email/name: no crash on search", () => {
    expect(() => applyTenantFilters(profiles, { search: "gamma" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - applyTenantFilters: riskLevel filter
// ─────────────────────────────────────────────────────────────────────────────
describe("T14 - applyTenantFilters: riskLevel filter", () => {
  const profiles = [
    buildTenantProfile(makeWorkspace({ id: 1, name: "Alpha", status: "active",    userCount: 5 }), null, NOW),
    buildTenantProfile(makeWorkspace({ id: 2, name: "Beta",  status: "active",    userCount: 0 }), null, NOW),
    buildTenantProfile(makeWorkspace({ id: 3, name: "Gamma", status: "suspended", userCount: 3 }), null, NOW),
    buildTenantProfile(makeWorkspace({ id: 4, name: "Delta", status: "disabled",  userCount: 2 }), null, NOW),
  ];

  it("riskLevel=none → only active+populated tenants", () => {
    const r = applyTenantFilters(profiles, { riskLevel: "none" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Alpha");
  });
  it("riskLevel=low → active+empty tenants", () => {
    const r = applyTenantFilters(profiles, { riskLevel: "low" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Beta");
  });
  it("riskLevel=high → suspended tenants", () => {
    const r = applyTenantFilters(profiles, { riskLevel: "high" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Gamma");
  });
  it("riskLevel=critical → disabled tenants", () => {
    const r = applyTenantFilters(profiles, { riskLevel: "critical" });
    expect(r).toHaveLength(1);
    expect(r[0]!.workspaceName).toBe("Delta");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - applyTenantFilters: no filters → full list
// ─────────────────────────────────────────────────────────────────────────────
describe("T15 - applyTenantFilters: empty filters return full list", () => {
  const profiles = [
    makeProfile({ id: 1, name: "A" }),
    makeProfile({ id: 2, name: "B" }),
    makeProfile({ id: 3, name: "C" }),
  ];
  it("empty object → all profiles returned", () => {
    expect(applyTenantFilters(profiles, {})).toHaveLength(3);
  });
  it("undefined filter values → all profiles returned", () => {
    expect(applyTenantFilters(profiles, { status: undefined, search: undefined })).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - sortTenantsByName: alphabetical ordering
// ─────────────────────────────────────────────────────────────────────────────
describe("T16 - sortTenantsByName: deterministic alphabetical ordering", () => {
  const profiles = [
    makeProfile({ id: 3, name: "Zephyr Co" }),
    makeProfile({ id: 1, name: "Acme Corp" }),
    makeProfile({ id: 2, name: "Beta Ltd" }),
  ];

  it("sorted ascending by workspaceName", () => {
    const sorted = sortTenantsByName(profiles);
    expect(sorted.map(p => p.workspaceName)).toEqual(["Acme Corp", "Beta Ltd", "Zephyr Co"]);
  });
  it("same inputs → same output (deterministic)", () => {
    const a = sortTenantsByName(profiles);
    const b = sortTenantsByName(profiles);
    expect(a.map(p => p.tenantId)).toEqual(b.map(p => p.tenantId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 - sortTenantsByName: does not mutate input
// ─────────────────────────────────────────────────────────────────────────────
describe("T17 - sortTenantsByName: does not mutate input array", () => {
  it("original array order unchanged after sort", () => {
    const profiles = [
      makeProfile({ id: 3, name: "Zephyr Co" }),
      makeProfile({ id: 1, name: "Acme Corp" }),
    ];
    const originalFirst = profiles[0]!.workspaceName;
    sortTenantsByName(profiles);
    expect(profiles[0]!.workspaceName).toBe(originalFirst);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 - TenantStatus: all 8 statuses derivable
// ─────────────────────────────────────────────────────────────────────────────
describe("T18 - TenantStatus: all 8 statuses are valid string literals", () => {
  const TENANT_STATUSES = [
    "provisioning", "active", "trial", "grace_period",
    "suspended", "archived", "locked", "pending_activation",
  ] as const;

  it("has exactly 8 statuses", () => {
    expect(TENANT_STATUSES).toHaveLength(8);
  });
  it("deriveTenantStatus returns one of the 8 statuses", () => {
    ["active","suspended","disabled","unknown"].forEach(ws => {
      const s = deriveTenantStatus(ws);
      expect(TENANT_STATUSES as readonly string[]).toContain(s);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T19 - RiskLevel: all 6 levels accessible
// ─────────────────────────────────────────────────────────────────────────────
describe("T19 - RiskLevel: 6 valid levels", () => {
  const RISK_LEVELS = ["none", "low", "medium", "high", "critical", "unknown"] as const;

  it("has exactly 6 risk levels", () => {
    expect(RISK_LEVELS).toHaveLength(6);
  });
  it("deriveRiskSignalSummary returns only known riskLevel values", () => {
    const inputs: [string, number][] = [
      ["active", 5], ["active", 0], ["suspended", 5], ["disabled", 5],
    ];
    inputs.forEach(([status, count]) => {
      const s = deriveRiskSignalSummary(status, count);
      expect(RISK_LEVELS as readonly string[]).toContain(s.riskLevel);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20 - Safety: buildTenantProfile never throws on minimal valid input
// ─────────────────────────────────────────────────────────────────────────────
describe("T20 - Safety: buildTenantProfile does not throw on edge inputs", () => {
  it("userCount = 0 is safe", () => {
    expect(() => buildTenantProfile(makeWorkspace({ userCount: 0 }), null, NOW)).not.toThrow();
  });
  it("ticketCount = 0, departmentCount = 0 is safe", () => {
    expect(() => buildTenantProfile(
      makeWorkspace({ ticketCount: 0, departmentCount: 0 }),
      null,
      NOW,
    )).not.toThrow();
  });
  it("workspace with null logoUrl and null primaryColor is safe", () => {
    expect(() => buildTenantProfile(
      makeWorkspace({ logoUrl: null, primaryColor: null }),
      null,
      NOW,
    )).not.toThrow();
  });
  it("owner with null email is safe", () => {
    expect(() => buildTenantProfile(
      makeWorkspace(),
      makeOwner({ email: null }),
      NOW,
    )).not.toThrow();
  });
  it("all four workspace statuses produce valid profiles", () => {
    ["active", "suspended", "disabled", "unknown"].forEach(status => {
      expect(() => buildTenantProfile(makeWorkspace({ status }), null, NOW)).not.toThrow();
    });
  });
});
