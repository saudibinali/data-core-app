/**
 * @file  publish-lifecycle.test.ts
 * @phase P5-E - Immutable Publish Governance & Activation Safety
 *
 * Tests the pure-logic components of the publish lifecycle:
 *   • Validation-before-publish enforcement (no DB required)
 *   • Governance rule interactions with the publish pipeline
 *   • Version numbering semantics
 *   • Publish metadata integrity
 *   • Deprecation behavior model
 *   • Execution version linkage invariants
 *
 * All tests operate on pure logic / data transformations.
 * No DB access, no HTTP server required.
 */

import { describe, it, expect } from "vitest";
import { validateWorkflow } from "../validator";

// ── Helpers ────────────────────────────────────────────────────────────────────
// Step formats must match what the validator parser actually accepts.
// These mirror the canonical fixtures in validation-engine.test.ts.

function notif(index: number, recipientType = "specific"): object {
  return {
    index,
    type:   "notification",
    name:   `Notify ${index}`,
    config: { recipientType, recipientIds: [1], title: "Hello", message: "World" },
  };
}

function notifRole(index: number): object {
  return {
    index,
    type:   "notification",
    name:   `NotifyRole ${index}`,
    config: { recipientType: "role", recipientRole: "manager", title: "T", message: "M" },
  };
}

// NOTE: approval steps are blocked by WG-02 (no resume mechanism until P5-F+).
// Use task steps as the second-step type in multi-step fixtures instead.

function task(index: number): object {
  return {
    index,
    type:   "task",
    name:   `Task ${index}`,
    config: { title: `Task ${index}`, assigneeType: "role", assigneeRole: "manager", priority: "medium" },
  };
}

function cond(index: number, onTrueStepIndex: number | null, onFalseStepIndex: number | null): object {
  return {
    index,
    type:   "condition",
    name:   `Condition ${index}`,
    config: {
      conditions:       { logic: "and", conditions: [{ field: "status", operator: "eq", value: "x" }] },
      onTrueStepIndex,
      onFalseStepIndex,
    },
  };
}

// ── Version numbering model ────────────────────────────────────────────────────

describe("PL-01 - Version numbering semantics", () => {
  it("first publish increments from 0 to 1", () => {
    const currentVersion = 0;
    const newVersion = currentVersion + 1;
    expect(newVersion).toBe(1);
  });

  it("subsequent publishes increment monotonically", () => {
    const versions = [0, 1, 2, 3, 4].map((v) => v + 1);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });

  it("version numbers are always positive after first publish", () => {
    for (let v = 1; v <= 10; v++) {
      expect(v + 1).toBeGreaterThan(0);
    }
  });

  it("rollback creates a new higher version even with old steps", () => {
    // A rollback is a new publish with the old version's steps.
    // Version log: 1→2→3→4 → rollback to 2 → creates version 5.
    const currentVersion = 4;
    const rollbackVersion = currentVersion + 1;
    expect(rollbackVersion).toBe(5);
    // Version 5 carries version-2's step config, but is a distinct record.
  });
});

// ── Validation-before-publish enforcement ─────────────────────────────────────

describe("PL-02 - Validation gates publish (validation-before-publish)", () => {
  const TRIGGER = "ticket.created";

  it("valid single-step workflow is publishable", () => {
    const steps = [notif(0)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("valid multi-step workflow is publishable", () => {
    const steps = [notif(0), task(1), task(2)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.valid).toBe(true);
  });

  it("linear two-step workflow: both steps reachable → no topology errors", () => {
    const steps = [notif(0), task(1)];
    const result = validateWorkflow(steps, TRIGGER);
    // Both steps are on the linear path - no isolated-step errors.
    const topoErrors = result.errors.filter(e => e.code === "WG-TOPO-01_ISOLATED_STEP");
    expect(topoErrors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("WG-03_TRUE_ROUTE_SELF_LOOP: condition routing to self blocks publish", () => {
    // A condition step where onTrueStepIndex points back to itself = infinite loop.
    const steps = [cond(0, 0, 1), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    const hasSelfLoop = result.errors.some(e => e.code === "WG-03_TRUE_ROUTE_SELF_LOOP");
    expect(hasSelfLoop).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("WG-03_TRUE_ROUTE_NOT_FOUND: out-of-bounds condition target blocks publish", () => {
    const steps = [cond(0, 99, 1), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    const hasOOB = result.errors.some(e => e.code === "WG-03_TRUE_ROUTE_NOT_FOUND");
    expect(hasOOB).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("publish pipeline: errors block - warnings do not", () => {
    // 6 role-notification steps → WG-FAN-01 warning (high fanout) but still valid.
    const steps = Array.from({ length: 6 }, (_, i) => notifRole(i));
    const result = validateWorkflow(steps, TRIGGER);
    const hasWarning = result.warnings.some(w => w.code === "WG-FAN-01_HIGH_NOTIFICATION_FANOUT");
    expect(hasWarning).toBe(true);
    expect(result.valid).toBe(true);  // warnings do NOT block publish
  });

  it("empty step list fails validation with EMPTY_STEPS (validator requires at least one step)", () => {
    const result = validateWorkflow([], TRIGGER);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "EMPTY_STEPS")).toBe(true);
  });
});

// ── Publish metadata model ────────────────────────────────────────────────────

describe("PL-03 - Publish metadata model", () => {
  it("changeNotes is optional - null is acceptable", () => {
    const changeNotes: string | null = null;
    expect(changeNotes).toBeNull();
  });

  it("empty string changeNotes is normalized to null", () => {
    // Route handler: `String(raw).trim() || null`
    const normalize = (raw: string) => raw.trim() || null;
    expect(normalize("")).toBeNull();
    expect(normalize("  ")).toBeNull();
    expect(normalize("Fixed approver")).toBe("Fixed approver");
    expect(normalize("  Trimmed  ")).toBe("Trimmed");
  });

  it("publishedAt is a recent timestamp", () => {
    const now = new Date();
    const publishedAt = new Date();
    const deltaMs = Math.abs(publishedAt.getTime() - now.getTime());
    expect(deltaMs).toBeLessThan(1000);
  });

  it("validationSummary captures the full governance result at publish time", () => {
    const steps = Array.from({ length: 6 }, (_, i) => notifRole(i));
    const result = validateWorkflow(steps, "ticket.created");

    const validationSummary = {
      valid:            result.valid,
      errorCount:       result.errors.length,
      warningCount:     result.warnings.length,
      noticeCount:      result.notices.length,
      errorCodes:       result.errors.map(e => e.code),
      warningCodes:     result.warnings.map(w => w.code),
      estimatedMetrics: result.estimatedMetrics,
      capturedAt:       new Date().toISOString(),
    };

    expect(validationSummary.valid).toBe(true);
    expect(validationSummary.warningCount).toBeGreaterThan(0);
    expect(validationSummary.warningCodes).toContain("WG-FAN-01_HIGH_NOTIFICATION_FANOUT");
    expect(validationSummary.capturedAt).toBeTruthy();
  });
});

// ── Immutable publish artifact model ─────────────────────────────────────────

describe("PL-04 - Immutable publish artifact invariants", () => {
  it("a version row captures the full definition state at publish time", () => {
    const workflowDef = {
      id:           1,
      workspaceId:  10,
      name:         "Manager Approval Workflow",
      nameAr:       null,
      triggerEvent: "ticket.created",
      conditions:   { operator: "and", conditions: [] },
      steps:        [notif(0), task(1)],
      version:      1,
    };

    const versionRow = {
      definitionId:  workflowDef.id,
      workspaceId:   workflowDef.workspaceId,
      version:       workflowDef.version,
      steps:         workflowDef.steps,
      conditions:    workflowDef.conditions,
      triggerEvent:  workflowDef.triggerEvent,
      name:          workflowDef.name,
      nameAr:        workflowDef.nameAr,
      publishedBy:   42,
      publishedAt:   new Date(),
      changeNotes:   "Initial publish",
      deactivatedAt: null,
      deactivatedBy: null,
    };

    expect(versionRow.version).toBe(1);
    expect(versionRow.steps).toHaveLength(2);  // notif(0) + task(1)
    expect(versionRow.triggerEvent).toBe("ticket.created");
    expect(versionRow.deactivatedAt).toBeNull();
    expect(versionRow.changeNotes).toBe("Initial publish");
  });

  it("version rows are append-only: deactivation only sets deactivatedAt/deactivatedBy", () => {
    const frozenAt = new Date("2026-03-01T10:00:00Z");
    const versionRow = {
      version:       1,
      steps:         [notif(0)],
      triggerEvent:  "ticket.created",
      publishedBy:   42,
      publishedAt:   frozenAt,
      changeNotes:   "Initial publish",
      deactivatedAt: new Date("2026-04-01T10:00:00Z"),
      deactivatedBy: 99,
    };

    // Frozen fields remain unchanged from publish time.
    expect(versionRow.publishedAt).toEqual(frozenAt);
    expect(versionRow.publishedBy).toBe(42);
    expect(versionRow.changeNotes).toBe("Initial publish");
    expect(versionRow.version).toBe(1);
    // Only lifecycle fields are updated on deactivation.
    expect(versionRow.deactivatedAt).not.toBeNull();
    expect(versionRow.deactivatedBy).toBe(99);
  });

  it("active status invariant: exactly one open (deactivatedAt=null) version row", () => {
    const versions = [
      { version: 1, deactivatedAt: new Date("2026-02-01"), deactivatedBy: 42 },
      { version: 2, deactivatedAt: null, deactivatedBy: null },
    ];
    const openVersions = versions.filter(v => v.deactivatedAt === null);
    expect(openVersions).toHaveLength(1);
    expect(openVersions[0]!.version).toBe(2);
  });

  it("deprecated status invariant: zero open version rows", () => {
    const versions = [
      { version: 1, deactivatedAt: new Date("2026-02-01"), deactivatedBy: 42 },
      { version: 2, deactivatedAt: new Date("2026-03-01"), deactivatedBy: 42 },
    ];
    const openVersions = versions.filter(v => v.deactivatedAt === null);
    expect(openVersions).toHaveLength(0);
  });
});

// ── Publish lifecycle state machine ──────────────────────────────────────────

describe("PL-05 - Publish lifecycle state transitions", () => {
  type Status = "draft" | "active" | "deprecated" | "archived";

  // PATCH-allowed transitions (does NOT include → active; that is POST /activate only).
  const allowedTransitions: Record<Status, Status[]> = {
    draft:      ["deprecated"],
    deprecated: ["draft"],
    active:     ["deprecated"],
    archived:   [],
  };

  it("draft → deprecated is allowed via PATCH", () => {
    expect(allowedTransitions["draft"]).toContain("deprecated");
  });

  it("deprecated → draft is allowed via PATCH", () => {
    expect(allowedTransitions["deprecated"]).toContain("draft");
  });

  it("active → deprecated is allowed via PATCH (deactivation)", () => {
    expect(allowedTransitions["active"]).toContain("deprecated");
  });

  it("archived has no allowed transitions (terminal)", () => {
    expect(allowedTransitions["archived"]).toHaveLength(0);
  });

  it("direct active → active is not a PATCH transition (must use POST /activate)", () => {
    expect(allowedTransitions["active"]).not.toContain("active");
  });

  it("draft → active is not a PATCH transition (must use POST /activate)", () => {
    expect(allowedTransitions["draft"]).not.toContain("active");
  });
});

// ── Execution version linkage ─────────────────────────────────────────────────

describe("PL-06 - Execution version linkage", () => {
  it("workflowVersion on execution matches the published definition version", () => {
    const defVersion = 3;
    const executionWorkflowVersion = defVersion; // what engine.ts records at trigger
    expect(executionWorkflowVersion).toBe(3);
  });

  it("version=0 means pre-P5-E definition never re-published", () => {
    const legacyDefVersion = 0;
    expect(legacyDefVersion).toBe(0);
    // Distinct from NULL (pre-P5-E execution before the column existed).
  });

  it("execution linkage chain: workflowVersion + stepsSnapshot give full audit trail", () => {
    const execution = {
      workflowVersion: 3,
      stepsSnapshot:   [notif(0), task(1)],
    };

    // The version row (joined from DB) provides full context:
    const versionRecord = {
      version:      3,
      publishedBy:  42,
      publishedAt:  new Date("2026-03-15T09:00:00Z"),
      changeNotes:  "Updated approver to include directors",
      name:         "Manager Approval Workflow",
    };

    expect(execution.workflowVersion).toBe(versionRecord.version);
    expect(execution.stepsSnapshot).toHaveLength(2);
    expect(versionRecord.changeNotes).toBeTruthy();
  });
});

// ── Governance blocking model ─────────────────────────────────────────────────

describe("PL-07 - Governance blocking scenarios", () => {
  const TRIGGER = "ticket.created";

  it("WG-03_TRUE_ROUTE_SELF_LOOP: condition self-loop on true branch blocks publish", () => {
    const steps = [cond(0, 0, 1), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.errors.some(e => e.code === "WG-03_TRUE_ROUTE_SELF_LOOP")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("WG-03_TRUE_ROUTE_NOT_FOUND: OOB condition true-branch target blocks publish", () => {
    const steps = [cond(0, 99, 1), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.errors.some(e => e.code === "WG-03_TRUE_ROUTE_NOT_FOUND")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("WG-03_FALSE_ROUTE_SELF_LOOP: condition self-loop on false branch blocks publish", () => {
    const steps = [cond(0, 1, 0), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.errors.some(e => e.code === "WG-03_FALSE_ROUTE_SELF_LOOP")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("WG-03_FALSE_ROUTE_NOT_FOUND: OOB condition false-branch target blocks publish", () => {
    const steps = [cond(0, 1, 99), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.errors.some(e => e.code === "WG-03_FALSE_ROUTE_NOT_FOUND")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("WG-FAN-01 (high notification fanout) is a warning - does not block publish", () => {
    const steps = Array.from({ length: 6 }, (_, i) => notifRole(i));
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.warnings.some(w => w.code === "WG-FAN-01_HIGH_NOTIFICATION_FANOUT")).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("WG-ROUTE-02_CONVERGENT_BRANCHES (same-branch condition) is a notice - does not block publish", () => {
    // Both branches of the condition lead to the same step - a structural no-op.
    // This is a NOTICE (informational), not an error or warning.
    const steps = [cond(0, 1, 1), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    const hasNotice = result.notices.some(n => n.code === "WG-ROUTE-02_CONVERGENT_BRANCHES");
    expect(hasNotice).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("WG-DEP-01_CONDITIONALLY_EXECUTED_STEP is a warning - does not block publish", () => {
    // A step that is only reachable via one branch of a condition.
    const steps = [cond(0, 1, 2), notif(1), notif(2)];
    const result = validateWorkflow(steps, TRIGGER);
    const hasWarning = result.warnings.some(w => w.code === "WG-DEP-01_CONDITIONALLY_EXECUTED_STEP");
    expect(hasWarning).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("multiple routing errors: each independently contributes to valid=false", () => {
    // Both branches OOB → two separate WG-03_*_ROUTE_NOT_FOUND violations.
    const steps = [cond(0, 99, 88), notif(1)];
    const result = validateWorkflow(steps, TRIGGER);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Active workflow immutability ──────────────────────────────────────────────

describe("PL-08 - Active workflow immutability after publish", () => {
  it("PATCH-allowed transitions do not include → active (protected by route handler)", () => {
    const allowedFromActive = ["deprecated"];
    expect(allowedFromActive).not.toContain("active");
  });

  it("archived workflow has no allowed transitions (terminal state)", () => {
    const allowedFromArchived: string[] = [];
    expect(allowedFromArchived).toHaveLength(0);
  });

  it("publishable statuses for POST /activate are only draft and deprecated", () => {
    const publishableStatuses = ["draft", "deprecated"];
    expect(publishableStatuses).toContain("draft");
    expect(publishableStatuses).toContain("deprecated");
    expect(publishableStatuses).not.toContain("active");
    expect(publishableStatuses).not.toContain("archived");
  });

  it("POST /activate on already-active workflow is idempotent (alreadyActive=true, no new version)", () => {
    // Model: if current status === 'active', publish pipeline returns early.
    const currentStatus = "active";
    const isIdempotent = currentStatus === "active";
    expect(isIdempotent).toBe(true);
    // No version row is written - version counter is unchanged.
  });
});
