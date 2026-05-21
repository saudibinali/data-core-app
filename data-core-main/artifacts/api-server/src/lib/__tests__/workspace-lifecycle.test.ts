/**
 * @file   src/lib/__tests__/workspace-lifecycle.test.ts
 * @phase  P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *
 * Pure model tests for workspace lifecycle state machine.
 * No DB, no HTTP - all functions are testable in isolation.
 *
 * Tests:
 *   T1   deriveLifecycleState: all known DB statuses map correctly
 *   T2   LIFECYCLE_ACTION_MODEL: all actions have required fields
 *   T3   isTransitionAllowed: all documented transitions are allowed
 *   T4   validateLifecycleRequest: invalid transition is rejected
 *   T5   validateLifecycleRequest: reason too short is rejected
 *   T6   validateLifecycleRequest: confirmation=false is rejected
 *   T7   validateLifecycleActorRole: non-super-admin returns false
 *   T8   validateLifecycleRequest: unknown action is rejected
 *   T9   lifecycleStateToDbStatus: state → DB status mapping correct
 *   T10  buildLifecycleAuditPayload: correct eventType and occurredAt
 *   T11  buildTenantProfile: updated workspace returns new tenantStatus
 *   T12  getAllowedActionsFrom: pending_activation only allows activate
 *   T13  getAllowedActionsFrom: active allows suspend, lock, archive
 *   T14  LIFECYCLE_ACTION_MODEL: no action has isDestructive = true
 *   T15  LIFECYCLE_ACTION_MODEL: all actions requiresReason = true
 *   T16  ALL_LIFECYCLE_ACTIONS: 5 total; no duplicates
 */

import { describe, it, expect } from "vitest";
import {
  deriveLifecycleState,
  lifecycleStateToDbStatus,
  isTransitionAllowed,
  getAllowedActionsFrom,
  validateLifecycleRequest,
  validateLifecycleActorRole,
  buildLifecycleAuditPayload,
  LIFECYCLE_ACTION_MODEL,
  LIFECYCLE_STATE_TO_DB_STATUS,
  ALL_LIFECYCLE_ACTIONS,
  REASON_MIN_LENGTH,
  type WorkspaceLifecycleState,
  type WorkspaceLifecycleAction,
} from "../workspace-lifecycle";

import { buildTenantProfile } from "../tenant-registry";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - deriveLifecycleState: all known DB statuses map correctly
// ─────────────────────────────────────────────────────────────────────────────
describe("T1 - deriveLifecycleState: all known DB statuses map correctly", () => {
  it("active → active", () => expect(deriveLifecycleState("active")).toBe("active"));
  it("suspended → suspended", () => expect(deriveLifecycleState("suspended")).toBe("suspended"));
  it("locked → locked", () => expect(deriveLifecycleState("locked")).toBe("locked"));
  it("disabled → archived", () => expect(deriveLifecycleState("disabled")).toBe("archived"));
  it("unknown → pending_activation", () => expect(deriveLifecycleState("unknown")).toBe("pending_activation"));
  it("empty string → pending_activation", () => expect(deriveLifecycleState("")).toBe("pending_activation"));
  it("any_other_value → pending_activation", () => expect(deriveLifecycleState("provisioning")).toBe("pending_activation"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - LIFECYCLE_ACTION_MODEL: all actions have required fields
// ─────────────────────────────────────────────────────────────────────────────
describe("T2 - LIFECYCLE_ACTION_MODEL: all actions have required fields", () => {
  const entries = Object.entries(LIFECYCLE_ACTION_MODEL);

  it("has exactly 5 action entries", () => expect(entries).toHaveLength(5));

  it("every entry has label, description, allowedFrom, targetState, severity, auditEventType", () => {
    for (const [key, def] of entries) {
      expect(typeof def.label, `${key}: label`).toBe("string");
      expect(typeof def.description, `${key}: description`).toBe("string");
      expect(Array.isArray(def.allowedFrom), `${key}: allowedFrom`).toBe(true);
      expect(typeof def.targetState, `${key}: targetState`).toBe("string");
      expect(typeof def.severity, `${key}: severity`).toBe("string");
      expect(typeof def.auditEventType, `${key}: auditEventType`).toBe("string");
    }
  });

  it("severity is one of standard | warning | critical", () => {
    const validSeverities = new Set(["standard", "warning", "critical"]);
    for (const [key, def] of entries) {
      expect(validSeverities.has(def.severity), `${key}: severity`).toBe(true);
    }
  });

  it("archive has critical severity", () => expect(LIFECYCLE_ACTION_MODEL.archive.severity).toBe("critical"));
  it("activate has standard severity", () => expect(LIFECYCLE_ACTION_MODEL.activate.severity).toBe("standard"));
  it("suspend has warning severity", () => expect(LIFECYCLE_ACTION_MODEL.suspend.severity).toBe("warning"));
  it("lock has warning severity", () => expect(LIFECYCLE_ACTION_MODEL.lock.severity).toBe("warning"));
  it("restore has standard severity", () => expect(LIFECYCLE_ACTION_MODEL.restore.severity).toBe("standard"));

  it("audit event types start with workspace_lifecycle_", () => {
    for (const [, def] of entries) {
      expect(def.auditEventType.startsWith("workspace_lifecycle_")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - isTransitionAllowed: all documented transitions are allowed
// ─────────────────────────────────────────────────────────────────────────────
describe("T3 - isTransitionAllowed: documented transitions are allowed", () => {
  const allowed: [WorkspaceLifecycleState, WorkspaceLifecycleAction][] = [
    ["pending_activation", "activate"],
    ["active",             "suspend"],
    ["active",             "lock"],
    ["active",             "archive"],
    ["suspended",          "restore"],
    ["suspended",          "lock"],
    ["suspended",          "archive"],
    ["locked",             "restore"],
    ["locked",             "suspend"],
    ["locked",             "archive"],
    ["archived",           "restore"],
    ["archived",           "suspend"],
  ];

  for (const [from, action] of allowed) {
    it(`${from} → ${action} is allowed`, () => {
      expect(isTransitionAllowed(from, action)).toBe(true);
    });
  }

  const forbidden: [WorkspaceLifecycleState, WorkspaceLifecycleAction][] = [
    ["active",    "restore"],
    ["active",    "activate"],
    ["archived",  "lock"],
    ["archived",  "archive"],
    ["locked",    "activate"],
    ["suspended", "activate"],
    ["suspended", "suspend"],
  ];

  for (const [from, action] of forbidden) {
    it(`${from} → ${action} is forbidden`, () => {
      expect(isTransitionAllowed(from, action)).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - validateLifecycleRequest: invalid transition is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 - validateLifecycleRequest: invalid transition is rejected", () => {
  const validBase = {
    action:       "suspend",
    reason:       "This workspace needs to be reviewed and access suspended.",
    confirmation: true as const,
  };

  it("rejects suspend from pending_activation with TRANSITION_NOT_ALLOWED", () => {
    const result = validateLifecycleRequest(validBase, "pending_activation");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TRANSITION_NOT_ALLOWED");
  });

  it("rejects archive from archived state", () => {
    const result = validateLifecycleRequest({ ...validBase, action: "archive" }, "archived");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TRANSITION_NOT_ALLOWED");
  });

  it("rejects restore from active state", () => {
    const result = validateLifecycleRequest({ ...validBase, action: "restore" }, "active");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TRANSITION_NOT_ALLOWED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - validateLifecycleRequest: reason too short is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe("T5 - validateLifecycleRequest: reason too short is rejected", () => {
  it("rejects empty reason", () => {
    const result = validateLifecycleRequest(
      { action: "activate", reason: "", confirmation: true },
      "pending_activation",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("REASON_REQUIRED");
  });

  it("rejects reason shorter than REASON_MIN_LENGTH", () => {
    const shortReason = "x".repeat(REASON_MIN_LENGTH - 1);
    const result = validateLifecycleRequest(
      { action: "activate", reason: shortReason, confirmation: true },
      "pending_activation",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("REASON_REQUIRED");
  });

  it("accepts reason of exactly REASON_MIN_LENGTH characters", () => {
    const okReason = "x".repeat(REASON_MIN_LENGTH);
    const result = validateLifecycleRequest(
      { action: "activate", reason: okReason, confirmation: true },
      "pending_activation",
    );
    expect(result.valid).toBe(true);
  });

  it("REASON_MIN_LENGTH is 10", () => expect(REASON_MIN_LENGTH).toBe(10));
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - validateLifecycleRequest: confirmation=false is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe("T6 - validateLifecycleRequest: confirmation=false is rejected", () => {
  const longReason = "This is a sufficiently long reason for the action.";

  it("rejects when confirmation is false", () => {
    const result = validateLifecycleRequest(
      { action: "activate", reason: longReason, confirmation: false },
      "pending_activation",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("accepts when confirmation is true", () => {
    const result = validateLifecycleRequest(
      { action: "activate", reason: longReason, confirmation: true },
      "pending_activation",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when confirmation is coerced (non-boolean true)", () => {
    const result = validateLifecycleRequest(
      { action: "activate", reason: longReason, confirmation: "yes" as unknown as boolean },
      "pending_activation",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - validateLifecycleActorRole: non-super-admin returns false
// ─────────────────────────────────────────────────────────────────────────────
describe("T7 - validateLifecycleActorRole: non-super-admin blocked", () => {
  it("super_admin returns true", () => expect(validateLifecycleActorRole("super_admin")).toBe(true));
  it("admin returns false", () => expect(validateLifecycleActorRole("admin")).toBe(false));
  it("manager returns false", () => expect(validateLifecycleActorRole("manager")).toBe(false));
  it("member returns false", () => expect(validateLifecycleActorRole("member")).toBe(false));
  it("undefined returns false", () => expect(validateLifecycleActorRole(undefined)).toBe(false));
  it("empty string returns false", () => expect(validateLifecycleActorRole("")).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - validateLifecycleRequest: unknown action is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 - validateLifecycleRequest: unknown action is rejected", () => {
  const longReason = "This reason is sufficiently long to pass validation.";

  it("rejects unknown action with UNKNOWN_ACTION code", () => {
    const result = validateLifecycleRequest(
      { action: "delete", reason: longReason, confirmation: true },
      "active",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("UNKNOWN_ACTION");
  });

  it("rejects 'destroy' action", () => {
    const result = validateLifecycleRequest(
      { action: "destroy", reason: longReason, confirmation: true },
      "active",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("UNKNOWN_ACTION");
  });

  it("rejects empty string action", () => {
    const result = validateLifecycleRequest(
      { action: "", reason: longReason, confirmation: true },
      "active",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("UNKNOWN_ACTION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - lifecycleStateToDbStatus: lifecycle state → DB status correct
// ─────────────────────────────────────────────────────────────────────────────
describe("T9 - lifecycleStateToDbStatus: state → DB status mapping correct", () => {
  it("active → 'active'", () => expect(lifecycleStateToDbStatus("active")).toBe("active"));
  it("suspended → 'suspended'", () => expect(lifecycleStateToDbStatus("suspended")).toBe("suspended"));
  it("locked → 'locked'", () => expect(lifecycleStateToDbStatus("locked")).toBe("locked"));
  it("archived → 'disabled'", () => expect(lifecycleStateToDbStatus("archived")).toBe("disabled"));
  it("pending_activation → 'pending_activation'", () => {
    expect(lifecycleStateToDbStatus("pending_activation")).toBe("pending_activation");
  });

  it("LIFECYCLE_STATE_TO_DB_STATUS covers all 5 states", () => {
    const states: WorkspaceLifecycleState[] = ["pending_activation", "active", "suspended", "locked", "archived"];
    for (const state of states) {
      expect(LIFECYCLE_STATE_TO_DB_STATUS).toHaveProperty(state);
    }
  });

  it("round-trip: deriveLifecycleState(lifecycleStateToDbStatus(state)) = state for active states", () => {
    const roundTripStates: WorkspaceLifecycleState[] = ["active", "suspended", "locked"];
    for (const state of roundTripStates) {
      const dbStatus   = lifecycleStateToDbStatus(state);
      const derivedBack = deriveLifecycleState(dbStatus);
      expect(derivedBack, `${state} round-trip`).toBe(state);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - buildLifecycleAuditPayload: correct eventType and occurredAt
// ─────────────────────────────────────────────────────────────────────────────
describe("T10 - buildLifecycleAuditPayload: correct eventType and occurredAt", () => {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const base = {
    tenantId:      "42",
    workspaceId:   42,
    actorId:       1,
    action:        "suspend" as WorkspaceLifecycleAction,
    previousState: "active"  as WorkspaceLifecycleState,
    targetState:   "suspended" as WorkspaceLifecycleState,
    reason:        "Compliance review required for this workspace.",
    internalNote:  null,
    now,
  };

  it("eventType is workspace_lifecycle_suspended", () => {
    const payload = buildLifecycleAuditPayload(base);
    expect(payload.eventType).toBe("workspace_lifecycle_suspended");
  });

  it("occurredAt is ISO string matching now", () => {
    const payload = buildLifecycleAuditPayload(base);
    expect(payload.occurredAt).toBe(now.toISOString());
  });

  it("all fields are present and correct", () => {
    const payload = buildLifecycleAuditPayload(base);
    expect(payload.tenantId).toBe("42");
    expect(payload.workspaceId).toBe(42);
    expect(payload.actorId).toBe(1);
    expect(payload.action).toBe("suspend");
    expect(payload.previousState).toBe("active");
    expect(payload.targetState).toBe("suspended");
    expect(payload.reason).toBe(base.reason);
    expect(payload.internalNote).toBeNull();
  });

  it("internalNote preserved when provided", () => {
    const payload = buildLifecycleAuditPayload({ ...base, internalNote: "Audit trail note" });
    expect(payload.internalNote).toBe("Audit trail note");
  });

  it("each action produces correct event type", () => {
    const cases: [WorkspaceLifecycleAction, string][] = [
      ["activate", "workspace_lifecycle_activated"],
      ["suspend",  "workspace_lifecycle_suspended"],
      ["restore",  "workspace_lifecycle_restored"],
      ["lock",     "workspace_lifecycle_locked"],
      ["archive",  "workspace_lifecycle_archived"],
    ];
    for (const [action, expectedEventType] of cases) {
      const payload = buildLifecycleAuditPayload({
        ...base,
        action,
        targetState: LIFECYCLE_ACTION_MODEL[action].targetState,
      });
      expect(payload.eventType, `action: ${action}`).toBe(expectedEventType);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - buildTenantProfile: updated workspace returns new tenantStatus
// ─────────────────────────────────────────────────────────────────────────────
describe("T11 - buildTenantProfile: workspace updated to locked returns tenantStatus=locked", () => {
  const now = new Date();
  const makeWorkspace = (status: string) => ({
    id:              10,
    name:            "Acme Corp",
    slug:            "acme-corp",
    status,
    logoUrl:         null,
    primaryColor:    null,
    userCount:       5,
    ticketCount:     12,
    departmentCount: 3,
    createdAt:       now,
    updatedAt:       now,
  });

  it("workspace status 'locked' → tenantStatus 'locked'", () => {
    const profile = buildTenantProfile(makeWorkspace("locked"), null, now);
    expect(profile.tenantStatus).toBe("locked");
    expect(profile.workspaceStatus).toBe("locked");
  });

  it("workspace status 'active' after restore → tenantStatus 'active'", () => {
    const profile = buildTenantProfile(makeWorkspace("active"), null, now);
    expect(profile.tenantStatus).toBe("active");
  });

  it("workspace status 'disabled' → tenantStatus 'archived'", () => {
    const profile = buildTenantProfile(makeWorkspace("disabled"), null, now);
    expect(profile.tenantStatus).toBe("archived");
  });

  it("workspace status 'suspended' → tenantStatus 'suspended'", () => {
    const profile = buildTenantProfile(makeWorkspace("suspended"), null, now);
    expect(profile.tenantStatus).toBe("suspended");
  });

  it("all fields present after status change", () => {
    const profile = buildTenantProfile(makeWorkspace("locked"), null, now);
    expect(profile.tenantId).toBe("10");
    expect(profile.workspaceName).toBe("Acme Corp");
    expect(profile.riskSignalSummary).toBeDefined();
    expect(profile.usageSummary).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - getAllowedActionsFrom: pending_activation only allows activate
// ─────────────────────────────────────────────────────────────────────────────
describe("T12 - getAllowedActionsFrom: pending_activation only allows activate", () => {
  const actions = getAllowedActionsFrom("pending_activation");

  it("returns exactly 1 action", () => expect(actions).toHaveLength(1));
  it("that action is activate", () => expect(actions[0]).toBe("activate"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - getAllowedActionsFrom: active allows suspend, lock, archive
// ─────────────────────────────────────────────────────────────────────────────
describe("T13 - getAllowedActionsFrom: active allows suspend, lock, archive", () => {
  const actions = getAllowedActionsFrom("active");

  it("does not include activate", () => expect(actions).not.toContain("activate"));
  it("does not include restore", () => expect(actions).not.toContain("restore"));
  it("includes suspend", () => expect(actions).toContain("suspend"));
  it("includes lock", () => expect(actions).toContain("lock"));
  it("includes archive", () => expect(actions).toContain("archive"));
  it("returns exactly 3 actions", () => expect(actions).toHaveLength(3));
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - LIFECYCLE_ACTION_MODEL: no action has isDestructive = true
// ─────────────────────────────────────────────────────────────────────────────
describe("T14 - LIFECYCLE_ACTION_MODEL: no action is destructive", () => {
  it("every action has isDestructive = false", () => {
    for (const [key, def] of Object.entries(LIFECYCLE_ACTION_MODEL)) {
      expect(def.isDestructive, `${key}: isDestructive`).toBe(false);
    }
  });

  it("no action label contains 'delete' or 'destroy' or 'hard'", () => {
    const forbidden = ["delete", "destroy", "hard", "billing", "payment", "invoice"];
    for (const [key, def] of Object.entries(LIFECYCLE_ACTION_MODEL)) {
      const labelLower = def.label.toLowerCase();
      const descLower  = def.description.toLowerCase();
      for (const word of forbidden) {
        expect(labelLower.includes(word), `${key} label contains "${word}"`).toBe(false);
        expect(descLower.includes(word), `${key} description contains "${word}"`).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - LIFECYCLE_ACTION_MODEL: all actions requiresReason = true
// ─────────────────────────────────────────────────────────────────────────────
describe("T15 - LIFECYCLE_ACTION_MODEL: all actions require reason and confirmation", () => {
  it("every action has requiresReason = true", () => {
    for (const [key, def] of Object.entries(LIFECYCLE_ACTION_MODEL)) {
      expect(def.requiresReason, `${key}: requiresReason`).toBe(true);
    }
  });

  it("every action has requiresConfirmation = true", () => {
    for (const [key, def] of Object.entries(LIFECYCLE_ACTION_MODEL)) {
      expect(def.requiresConfirmation, `${key}: requiresConfirmation`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - ALL_LIFECYCLE_ACTIONS: 5 total; no duplicates
// ─────────────────────────────────────────────────────────────────────────────
describe("T16 - ALL_LIFECYCLE_ACTIONS: 5 total; no duplicates", () => {
  it("has exactly 5 entries", () => expect(ALL_LIFECYCLE_ACTIONS).toHaveLength(5));

  it("contains all 5 expected actions", () => {
    const expected: WorkspaceLifecycleAction[] = ["activate", "suspend", "restore", "lock", "archive"];
    for (const action of expected) {
      expect(ALL_LIFECYCLE_ACTIONS).toContain(action);
    }
  });

  it("no duplicates", () => {
    const set = new Set(ALL_LIFECYCLE_ACTIONS);
    expect(set.size).toBe(ALL_LIFECYCLE_ACTIONS.length);
  });

  it("all entries exist in LIFECYCLE_ACTION_MODEL", () => {
    for (const action of ALL_LIFECYCLE_ACTIONS) {
      expect(LIFECYCLE_ACTION_MODEL).toHaveProperty(action);
    }
  });
});
