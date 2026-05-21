/**
 * @phase P16-E - Commercial workspace enforcement evaluation tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const subFind = vi.fn();
const policyFind = vi.fn();
const accountFind = vi.fn();
const dbSelect = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      workspaceSubscriptionsTable: { findFirst: subFind },
      workspaceSubscriptionPoliciesTable: { findFirst: policyFind },
      commercialAccountsTable: { findFirst: accountFind },
    },
    select: dbSelect,
  },
  workspaceSubscriptionsTable: {},
  workspaceSubscriptionPoliciesTable: {},
  commercialAccountsTable: {},
  commercialContractTermsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  desc: () => ({}),
}));

const { evaluateCommercialWorkspaceEnforcement } = await import(
  "../commercial-workspace-enforcement-evaluator"
);

beforeEach(() => {
  subFind.mockReset();
  policyFind.mockReset();
  accountFind.mockReset();
  dbSelect.mockReset();
  policyFind.mockResolvedValue(null);
  accountFind.mockResolvedValue(null);
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  });
});

describe("evaluateCommercialWorkspaceEnforcement", () => {
  it("active subscription recommends normal", async () => {
    subFind.mockResolvedValue({
      id: 1,
      status: "active",
      endDate: "2099-12-31",
      commercialAccountId: null,
    });
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("normal");
    expect(r.isAutomaticAllowed).toBe(false);
  });

  it("grace_period recommends normal by default", async () => {
    subFind.mockResolvedValue({ id: 1, status: "grace_period", endDate: "2020-01-01" });
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("normal");
  });

  it("past_due recommends read_only", async () => {
    subFind.mockResolvedValue({ id: 1, status: "past_due", endDate: "2020-01-01" });
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("read_only");
  });

  it("suspended recommends suspended_view_only", async () => {
    subFind.mockResolvedValue({ id: 1, status: "suspended", endDate: "2020-01-01" });
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("suspended_view_only");
  });

  it("terminated recommends terminated_view_only", async () => {
    subFind.mockResolvedValue({ id: 1, status: "terminated", endDate: "2020-01-01" });
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("terminated_view_only");
  });

  it("no subscription returns review_required", async () => {
    subFind.mockResolvedValue(null);
    const r = await evaluateCommercialWorkspaceEnforcement(7);
    expect(r.recommendation).toBe("review_required");
  });
});
