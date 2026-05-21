/**
 * @phase P16-A - Workspace subscription status transitions
 */

import { describe, it, expect } from "vitest";
import {
  WORKSPACE_SUBSCRIPTION_STATUSES,
  canTransitionWorkspaceSubscriptionStatus,
  isWorkspaceSubscriptionStatus,
} from "../workspace-subscription-transitions";

describe("WORKSPACE_SUBSCRIPTION_STATUSES", () => {
  it("includes all seven lifecycle states", () => {
    expect(WORKSPACE_SUBSCRIPTION_STATUSES).toHaveLength(7);
    expect(WORKSPACE_SUBSCRIPTION_STATUSES).toContain("archived");
  });
});

describe("canTransitionWorkspaceSubscriptionStatus", () => {
  it("allows trial → active", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("trial", "active").allowed).toBe(true);
  });

  it("allows active → suspended", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("active", "suspended").allowed).toBe(true);
  });

  it("allows terminated → archived", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("terminated", "archived").allowed).toBe(true);
  });

  it("blocks archived → any", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("archived", "active").allowed).toBe(false);
  });

  it("blocks terminated → active", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("terminated", "active").allowed).toBe(false);
  });

  it("blocks suspended → trial", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("suspended", "trial").allowed).toBe(false);
  });

  it("blocks past_due → trial", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("past_due", "trial").allowed).toBe(false);
  });

  it("blocks disallowed active → trial", () => {
    expect(canTransitionWorkspaceSubscriptionStatus("active", "trial").allowed).toBe(false);
  });
});

describe("isWorkspaceSubscriptionStatus", () => {
  it("validates enum members", () => {
    expect(isWorkspaceSubscriptionStatus("grace_period")).toBe(true);
    expect(isWorkspaceSubscriptionStatus("invalid")).toBe(false);
  });
});
