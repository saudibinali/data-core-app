/**
 * @file   src/lib/__tests__/workspace-lifecycle.test.ts
 * @phase  P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *
 * Pure config/model tests for the frontend workspace lifecycle layer.
 * No React, no DOM, no fetch - all pure Node.js.
 *
 * Tests:
 *   T1   LIFECYCLE_STATE_CONFIG: all 5 states present with required fields
 *   T2   LIFECYCLE_ACTION_CONFIG: all 5 actions present; all have allowedFrom
 *   T3   getAllowedActionsFromState("active"): suspend, lock, archive
 *   T4   getAllowedActionsFromState("pending_activation"): only activate
 *   T5   getAllowedActionsFromState("archived"): suspend and restore
 *   T6   isLifecycleFormValid: returns false for empty reason
 *   T7   isLifecycleFormValid: returns false for unconfirmed
 *   T8   isLifecycleFormValid: returns true for fully valid form
 *   T9   LIFECYCLE_SAFETY_CONTRACT: all properties are true
 *   T10  LIFECYCLE_SAFETY_CONTRACT: exactly 14 properties
 *   T11  LIFECYCLE_MUTATION_HOOK_NAMES: exactly 1 entry
 *   T12  LIFECYCLE_MUTATION_HOOK_NAMES: contains useWorkspaceLifecycleTransition
 *   T13  getLifecycleFormError: returns correct error messages
 *   T14  No delete/destroy/billing/payment wording in action config labels
 *   T15  LIFECYCLE_API_PATHS.transition: function returning correct path
 *   T16  deriveLifecycleStateFromWorkspaceStatus: stable mapping
 */

import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_STATE_CONFIG,
  LIFECYCLE_ACTION_CONFIG,
  LIFECYCLE_SAFETY_CONTRACT,
  LIFECYCLE_MUTATION_HOOK_NAMES,
  LIFECYCLE_API_PATHS,
  ALL_LIFECYCLE_ACTIONS,
  REASON_MIN_LENGTH,
  deriveLifecycleStateFromWorkspaceStatus,
  getAllowedActionsFromState,
  isLifecycleFormValid,
  getLifecycleFormError,
  type WorkspaceLifecycleAction,
  type WorkspaceLifecycleState,
  type LifecycleFormState,
} from "../workspace-lifecycle-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - LIFECYCLE_STATE_CONFIG: all 5 states present with required fields
// ─────────────────────────────────────────────────────────────────────────────
describe("T1 - LIFECYCLE_STATE_CONFIG: all 5 states present with required fields", () => {
  const states: WorkspaceLifecycleState[] = [
    "pending_activation", "active", "suspended", "locked", "archived",
  ];

  it("has exactly 5 entries", () => {
    expect(Object.keys(LIFECYCLE_STATE_CONFIG)).toHaveLength(5);
  });

  it("every state has label, tier, description, badgeClass, order", () => {
    for (const state of states) {
      const cfg = LIFECYCLE_STATE_CONFIG[state];
      expect(typeof cfg.label, `${state}: label`).toBe("string");
      expect(typeof cfg.tier, `${state}: tier`).toBe("string");
      expect(typeof cfg.description, `${state}: description`).toBe("string");
      expect(typeof cfg.badgeClass, `${state}: badgeClass`).toBe("string");
      expect(typeof cfg.order, `${state}: order`).toBe("number");
    }
  });

  it("active has good tier", () => expect(LIFECYCLE_STATE_CONFIG.active.tier).toBe("good"));
  it("suspended has critical tier", () => expect(LIFECYCLE_STATE_CONFIG.suspended.tier).toBe("critical"));
  it("archived has muted tier", () => expect(LIFECYCLE_STATE_CONFIG.archived.tier).toBe("muted"));

  it("order values are unique integers", () => {
    const orders = states.map(s => LIFECYCLE_STATE_CONFIG[s].order);
    const set = new Set(orders);
    expect(set.size).toBe(orders.length);
    for (const o of orders) expect(Number.isInteger(o)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - LIFECYCLE_ACTION_CONFIG: all 5 actions present; all have allowedFrom
// ─────────────────────────────────────────────────────────────────────────────
describe("T2 - LIFECYCLE_ACTION_CONFIG: all 5 actions present with required fields", () => {
  const actions = Object.keys(LIFECYCLE_ACTION_CONFIG) as WorkspaceLifecycleAction[];

  it("has exactly 5 action entries", () => expect(actions).toHaveLength(5));

  it("every action has label, description, allowedFrom, targetState, buttonClass", () => {
    for (const action of actions) {
      const cfg = LIFECYCLE_ACTION_CONFIG[action];
      expect(typeof cfg.label, `${action}: label`).toBe("string");
      expect(typeof cfg.description, `${action}: description`).toBe("string");
      expect(Array.isArray(cfg.allowedFrom), `${action}: allowedFrom`).toBe(true);
      expect(cfg.allowedFrom.length, `${action}: allowedFrom not empty`).toBeGreaterThan(0);
      expect(typeof cfg.targetState, `${action}: targetState`).toBe("string");
      expect(typeof cfg.buttonClass, `${action}: buttonClass`).toBe("string");
    }
  });

  it("every action has requiresReason = true", () => {
    for (const action of actions) {
      expect(LIFECYCLE_ACTION_CONFIG[action].requiresReason, action).toBe(true);
    }
  });

  it("every action has requiresConfirmation = true", () => {
    for (const action of actions) {
      expect(LIFECYCLE_ACTION_CONFIG[action].requiresConfirmation, action).toBe(true);
    }
  });

  it("every action has isDestructive = false", () => {
    for (const action of actions) {
      expect(LIFECYCLE_ACTION_CONFIG[action].isDestructive, action).toBe(false);
    }
  });

  it("every action has confirmationPrompt non-empty", () => {
    for (const action of actions) {
      expect(LIFECYCLE_ACTION_CONFIG[action].confirmationPrompt.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - getAllowedActionsFromState("active"): suspend, lock, archive
// ─────────────────────────────────────────────────────────────────────────────
describe("T3 - getAllowedActionsFromState(active): suspend, lock, archive", () => {
  const actions = getAllowedActionsFromState("active");

  it("contains suspend", () => expect(actions).toContain("suspend"));
  it("contains lock", () => expect(actions).toContain("lock"));
  it("contains archive", () => expect(actions).toContain("archive"));
  it("does not contain activate", () => expect(actions).not.toContain("activate"));
  it("does not contain restore", () => expect(actions).not.toContain("restore"));
  it("returns exactly 3 actions", () => expect(actions).toHaveLength(3));
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - getAllowedActionsFromState("pending_activation"): only activate
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 - getAllowedActionsFromState(pending_activation): only activate", () => {
  const actions = getAllowedActionsFromState("pending_activation");

  it("returns exactly 1 action", () => expect(actions).toHaveLength(1));
  it("that action is activate", () => expect(actions[0]).toBe("activate"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - getAllowedActionsFromState("archived"): suspend and restore
// ─────────────────────────────────────────────────────────────────────────────
describe("T5 - getAllowedActionsFromState(archived): suspend and restore", () => {
  const actions = getAllowedActionsFromState("archived");

  it("contains restore", () => expect(actions).toContain("restore"));
  it("contains suspend", () => expect(actions).toContain("suspend"));
  it("does not contain activate", () => expect(actions).not.toContain("activate"));
  it("does not contain lock", () => expect(actions).not.toContain("lock"));
  it("does not contain archive", () => expect(actions).not.toContain("archive"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - isLifecycleFormValid: returns false for empty reason
// ─────────────────────────────────────────────────────────────────────────────
describe("T6 - isLifecycleFormValid: returns false for empty reason", () => {
  const base: LifecycleFormState = {
    action:       "activate",
    reason:       "",
    internalNote: "",
    confirmed:    true,
  };

  it("empty reason → invalid", () => expect(isLifecycleFormValid(base)).toBe(false));

  it("reason shorter than REASON_MIN_LENGTH → invalid", () => {
    const form = { ...base, reason: "x".repeat(REASON_MIN_LENGTH - 1) };
    expect(isLifecycleFormValid(form)).toBe(false);
  });

  it("reason of exactly REASON_MIN_LENGTH → valid", () => {
    const form = { ...base, reason: "x".repeat(REASON_MIN_LENGTH) };
    expect(isLifecycleFormValid(form)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - isLifecycleFormValid: returns false for unconfirmed
// ─────────────────────────────────────────────────────────────────────────────
describe("T7 - isLifecycleFormValid: returns false for unconfirmed", () => {
  const longReason = "This reason is sufficiently long to pass validation checks.";

  it("confirmed = false → invalid", () => {
    const form: LifecycleFormState = {
      action: "activate", reason: longReason, internalNote: "", confirmed: false,
    };
    expect(isLifecycleFormValid(form)).toBe(false);
  });

  it("null action → invalid", () => {
    const form: LifecycleFormState = {
      action: null, reason: longReason, internalNote: "", confirmed: true,
    };
    expect(isLifecycleFormValid(form)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - isLifecycleFormValid: returns true for fully valid form
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 - isLifecycleFormValid: returns true for fully valid form", () => {
  const validForm: LifecycleFormState = {
    action:       "activate",
    reason:       "Activation approved by platform operations team after review.",
    internalNote: "",
    confirmed:    true,
  };

  it("fully valid form returns true", () => expect(isLifecycleFormValid(validForm)).toBe(true));

  it("all 5 actions pass when reason and confirmation are present", () => {
    const allActions: WorkspaceLifecycleAction[] = ALL_LIFECYCLE_ACTIONS;
    for (const action of allActions) {
      const form = { ...validForm, action };
      expect(isLifecycleFormValid(form), `action: ${action}`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - LIFECYCLE_SAFETY_CONTRACT: all properties are true
// ─────────────────────────────────────────────────────────────────────────────
describe("T9 - LIFECYCLE_SAFETY_CONTRACT: all properties are true", () => {
  const entries = Object.entries(LIFECYCLE_SAFETY_CONTRACT);

  it("every property value is true", () => {
    for (const [key, value] of entries) {
      expect(value, `${key} should be true`).toBe(true);
    }
  });

  it("superAdminOnly is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.superAdminOnly).toBe(true));
  it("requiresReason is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.requiresReason).toBe(true));
  it("requiresConfirmation is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.requiresConfirmation).toBe(true));
  it("noWorkspaceDeletion is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noWorkspaceDeletion).toBe(true));
  it("noHardArchive is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noHardArchive).toBe(true));
  it("noHrDataMutation is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noHrDataMutation).toBe(true));
  it("noBillingActions is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noBillingActions).toBe(true));
  it("noPaymentActions is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noPaymentActions).toBe(true));
  it("noAutomaticSuspension is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noAutomaticSuspension).toBe(true));
  it("noExternalLegalNotices is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noExternalLegalNotices).toBe(true));
  it("noEmailNotifications is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noEmailNotifications).toBe(true));
  it("noAiDecisions is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.noAiDecisions).toBe(true));
  it("failClosedOnUnknownState is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.failClosedOnUnknownState).toBe(true));
  it("nonDestructive is true", () => expect(LIFECYCLE_SAFETY_CONTRACT.nonDestructive).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - LIFECYCLE_SAFETY_CONTRACT: exactly 14 properties
// ─────────────────────────────────────────────────────────────────────────────
describe("T10 - LIFECYCLE_SAFETY_CONTRACT: exactly 14 properties", () => {
  const props = Object.keys(LIFECYCLE_SAFETY_CONTRACT);

  it("has exactly 14 properties", () => expect(props).toHaveLength(14));

  it("no property is false or undefined", () => {
    for (const key of props) {
      expect(
        LIFECYCLE_SAFETY_CONTRACT[key as keyof typeof LIFECYCLE_SAFETY_CONTRACT],
        `${key} should be true`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - LIFECYCLE_MUTATION_HOOK_NAMES: exactly 1 entry
// ─────────────────────────────────────────────────────────────────────────────
describe("T11 - LIFECYCLE_MUTATION_HOOK_NAMES: exactly 1 entry", () => {
  it("has exactly 1 entry", () => expect(LIFECYCLE_MUTATION_HOOK_NAMES).toHaveLength(1));

  it("entry starts with 'use'", () => {
    for (const name of LIFECYCLE_MUTATION_HOOK_NAMES) {
      expect(name.startsWith("use")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - LIFECYCLE_MUTATION_HOOK_NAMES: contains useWorkspaceLifecycleTransition
// ─────────────────────────────────────────────────────────────────────────────
describe("T12 - LIFECYCLE_MUTATION_HOOK_NAMES: contains useWorkspaceLifecycleTransition", () => {
  it("includes useWorkspaceLifecycleTransition", () => {
    expect(LIFECYCLE_MUTATION_HOOK_NAMES).toContain("useWorkspaceLifecycleTransition");
  });

  it("no duplicates", () => {
    const set = new Set(LIFECYCLE_MUTATION_HOOK_NAMES);
    expect(set.size).toBe(LIFECYCLE_MUTATION_HOOK_NAMES.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - getLifecycleFormError: returns correct error messages
// ─────────────────────────────────────────────────────────────────────────────
describe("T13 - getLifecycleFormError: returns correct error messages", () => {
  it("returns error for null action", () => {
    const err = getLifecycleFormError({ action: null, reason: "long enough reason", internalNote: "", confirmed: true });
    expect(err).not.toBeNull();
  });

  it("returns error for empty reason", () => {
    const err = getLifecycleFormError({ action: "activate", reason: "", internalNote: "", confirmed: true });
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toContain("reason");
  });

  it("returns error for short reason", () => {
    const err = getLifecycleFormError({ action: "activate", reason: "short", internalNote: "", confirmed: true });
    expect(err).not.toBeNull();
  });

  it("returns error when not confirmed", () => {
    const err = getLifecycleFormError({
      action:       "activate",
      reason:       "This reason is more than ten characters long.",
      internalNote: "",
      confirmed:    false,
    });
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toContain("confirm");
  });

  it("returns null for fully valid form", () => {
    const err = getLifecycleFormError({
      action:       "activate",
      reason:       "This reason is more than ten characters long.",
      internalNote: "",
      confirmed:    true,
    });
    expect(err).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - No delete/destroy/billing/payment wording in action config
// ─────────────────────────────────────────────────────────────────────────────
describe("T14 - No forbidden wording in LIFECYCLE_ACTION_CONFIG labels and descriptions", () => {
  const FORBIDDEN = [
    "delete workspace", "hard archive", "destroy", "billing", "payment",
    "invoice", "charge", "auto-suspend", "automatically suspend",
    "legal notice", "email tenant", "ai verdict",
  ];

  function collectText(): string {
    const parts: string[] = [];
    for (const action of Object.keys(LIFECYCLE_ACTION_CONFIG) as WorkspaceLifecycleAction[]) {
      const cfg = LIFECYCLE_ACTION_CONFIG[action];
      parts.push(cfg.label, cfg.description, cfg.confirmationPrompt);
    }
    return parts.join(" ").toLowerCase();
  }

  const allText = collectText();

  it("no forbidden phrase in any config text", () => {
    for (const phrase of FORBIDDEN) {
      expect(allText.includes(phrase.toLowerCase()), `Found forbidden phrase: "${phrase}"`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - LIFECYCLE_API_PATHS.transition: function returning correct path
// ─────────────────────────────────────────────────────────────────────────────
describe("T15 - LIFECYCLE_API_PATHS.transition: function returning correct path", () => {
  it("transition is a function", () => {
    expect(typeof LIFECYCLE_API_PATHS.transition).toBe("function");
  });

  it("transition('42') returns /api/platform/tenants/42/lifecycle", () => {
    expect(LIFECYCLE_API_PATHS.transition("42")).toBe("/api/platform/tenants/42/lifecycle");
  });

  it("path starts with /api/platform/tenants/", () => {
    const path = LIFECYCLE_API_PATHS.transition("99");
    expect(path.startsWith("/api/platform/tenants/")).toBe(true);
    expect(path.endsWith("/lifecycle")).toBe(true);
  });

  it("includes the tenantId in the path", () => {
    const path = LIFECYCLE_API_PATHS.transition("123");
    expect(path).toContain("123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - deriveLifecycleStateFromWorkspaceStatus: stable mapping
// ─────────────────────────────────────────────────────────────────────────────
describe("T16 - deriveLifecycleStateFromWorkspaceStatus: stable mapping", () => {
  it("active → active", () => expect(deriveLifecycleStateFromWorkspaceStatus("active")).toBe("active"));
  it("suspended → suspended", () => expect(deriveLifecycleStateFromWorkspaceStatus("suspended")).toBe("suspended"));
  it("locked → locked", () => expect(deriveLifecycleStateFromWorkspaceStatus("locked")).toBe("locked"));
  it("disabled → archived", () => expect(deriveLifecycleStateFromWorkspaceStatus("disabled")).toBe("archived"));
  it("unknown → pending_activation", () => {
    expect(deriveLifecycleStateFromWorkspaceStatus("anything")).toBe("pending_activation");
  });
  it("empty string → pending_activation", () => {
    expect(deriveLifecycleStateFromWorkspaceStatus("")).toBe("pending_activation");
  });

  it("mapping is deterministic - calling twice gives same result", () => {
    const statuses = ["active", "suspended", "locked", "disabled", "unknown"];
    for (const status of statuses) {
      expect(deriveLifecycleStateFromWorkspaceStatus(status)).toBe(
        deriveLifecycleStateFromWorkspaceStatus(status),
      );
    }
  });
});
