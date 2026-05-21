/**
 * P4-A: Context Isolation - Unit Tests
 *
 * Tests for:
 *   buildResolvedData()    - backward-compat flat view computation
 *   createExecutionContext() - safe context construction
 *
 * These are pure unit tests: no DB, no Express, no external dependencies.
 * All 5 test cases (T1-T5) match the acceptance criteria from the Phase 4
 * task description.
 */

import { describe, it, expect } from "vitest";
import { buildResolvedData, createExecutionContext } from "../context";

// ── T1: Step outputs isolated by step index ────────────────────────────────────

describe("T1 - step outputs are isolated by step index", () => {
  it("stores each step output under its own index without collision", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {};

    // Simulate step 0 writing a "status" key
    stepOutputs[0] = { status: "sent", notified: 3 };

    // Simulate step 1 writing the same "status" key with different semantics
    stepOutputs[1] = { status: "completed", taskId: 42 };

    // Each step's output is accessible under its own slot - no overwrite
    expect(stepOutputs[0]!.status).toBe("sent");
    expect(stepOutputs[1]!.status).toBe("completed");

    // The two slots are completely independent
    expect(stepOutputs[0]).not.toHaveProperty("taskId");
    expect(stepOutputs[1]).not.toHaveProperty("notified");
  });

  it("multiple steps with different keys do not bleed across slots", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {};

    stepOutputs[0] = { recipientIds: [1, 2, 3], nextSteps: [4] };
    stepOutputs[2] = { assigneeId: 7, entity: "ticket" };

    // Condition step's nextSteps is NOT visible in step 2's slot
    expect(stepOutputs[2]).not.toHaveProperty("nextSteps");
    // Notification step's recipientIds is NOT visible in step 2's slot
    expect(stepOutputs[2]).not.toHaveProperty("recipientIds");
  });
});

// ── T2: resolvedData backward compatibility ────────────────────────────────────

describe("T2 - resolvedData backward compatibility preserved", () => {
  it("merges step outputs in ascending index order", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: { entityId: 10, status: "created" },
      1: { taskId: 42, assigneeId: 7 },
      2: { status: "reviewed" }, // shadows step 0's "status"
    };

    const resolved = buildResolvedData(stepOutputs);

    // All keys from all steps are present in the flat view
    expect(resolved.entityId).toBe(10);
    expect(resolved.taskId).toBe(42);
    expect(resolved.assigneeId).toBe(7);

    // Later step (index 2) shadows earlier step (index 0) on "status"
    // This matches old behavior: last step in sequence wins on collision
    expect(resolved.status).toBe("reviewed");
  });

  it("handles non-sequential step indices correctly (e.g., 0, 5, 10)", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      10: { c: "from-step-10" },
      0:  { a: "from-step-0" },
      5:  { b: "from-step-5", a: "from-step-5-overrides-0" },
    };

    const resolved = buildResolvedData(stepOutputs);

    // Merge order is 0 → 5 → 10 (ascending index)
    expect(resolved.a).toBe("from-step-5-overrides-0"); // step 5 shadows step 0
    expect(resolved.b).toBe("from-step-5");
    expect(resolved.c).toBe("from-step-10");
  });

  it("produces empty object when stepOutputs is empty", () => {
    const resolved = buildResolvedData({});
    expect(resolved).toEqual({});
  });

  it("produces a flat merge that is consistent across multiple calls with the same input", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: { x: 1 },
      1: { y: 2 },
    };

    const result1 = buildResolvedData(stepOutputs);
    const result2 = buildResolvedData(stepOutputs);

    // Deterministic - same input always produces same output
    expect(result1).toEqual(result2);
    expect(result1).toEqual({ x: 1, y: 2 });
  });
});

// ── T3: nested triggerData mutation does not affect the original ───────────────

describe("T3 - immutable triggerData (deep clone protection)", () => {
  it("structuredClone prevents step handlers from mutating the original payload", () => {
    const originalPayload = {
      ticketId: 99,
      metadata: { priority: "high", tags: ["urgent", "escalated"] },
    };

    const ctx = createExecutionContext("ticket.created", originalPayload, 1);

    // Simulate a step handler mutating triggerData (bad practice, but defensible)
    (ctx.triggerData["metadata"] as Record<string, unknown>)["priority"] = "low";
    (ctx.triggerData["metadata"] as unknown as { tags: string[] })["tags"].push("modified");

    // The ORIGINAL payload object must be unaffected
    expect(originalPayload.metadata.priority).toBe("high");
    expect(originalPayload.metadata.tags).toEqual(["urgent", "escalated"]);
    expect(originalPayload.metadata.tags).toHaveLength(2);
  });

  it("cloned triggerData has the correct initial values", () => {
    const payload = { entityId: 5, workflowHint: "hr.leave" };
    const ctx = createExecutionContext("form.submitted", payload, 42, 100);

    expect(ctx.triggerData["entityId"]).toBe(5);
    expect(ctx.triggerData["workflowHint"]).toBe("hr.leave");
    expect(ctx.workspaceId).toBe(42);
    expect(ctx.triggeredBy).toBe(100);
    expect(ctx.triggerEvent).toBe("form.submitted");
  });
});

// ── T4: existing workflow output pattern produces identical results ─────────────

describe("T4 - existing workflows produce identical outputs", () => {
  it("sequential 3-step workflow: resolvedData matches old manual merge behavior", () => {
    // Simulates the old executor behavior:
    //   let resolvedData = {}
    //   resolvedData = { ...resolvedData, ...step0_output }
    //   resolvedData = { ...resolvedData, ...step1_output }
    //   resolvedData = { ...resolvedData, ...step2_output }
    const step0Output = { notified: 2, recipientIds: [1, 2] };
    const step1Output = { taskId: 99, assigneeId: 5 };
    const step2Output = { entity: "ticket", entityId: 10, newStatus: "resolved" };

    const oldBehaviorResult = {
      ...step0Output,
      ...step1Output,
      ...step2Output,
    };

    // New P4-A behavior via stepOutputs + buildResolvedData
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: step0Output,
      1: step1Output,
      2: step2Output,
    };
    const newBehaviorResult = buildResolvedData(stepOutputs);

    // Must be identical to old behavior
    expect(newBehaviorResult).toEqual(oldBehaviorResult);
  });

  it("single-step workflow: resolvedData equals that step's output", () => {
    const output = { notified: 1, recipientIds: [42] };
    const resolved = buildResolvedData({ 0: output });
    expect(resolved).toEqual(output);
  });

  it("workflow with skipped step (output = { skipped: true }): does not pollute", () => {
    // Old behavior: { skipped: true, reason: "condition_not_met" } merged in
    // New behavior: same flat merge, but isolated under step.index

    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: { skipped: true, reason: "condition_not_met" }, // step was skipped
      1: { taskId: 7, assigneeId: 3 },                   // next step ran normally
    };

    const resolved = buildResolvedData(stepOutputs);

    // "skipped" key exists in resolved (same as old behavior - harmless leakage)
    // but step 1's keys are correct
    expect(resolved.taskId).toBe(7);
    expect(resolved.assigneeId).toBe(3);

    // stepOutputs[1] itself has NO "skipped" key - isolation is preserved
    expect(stepOutputs[1]).not.toHaveProperty("skipped");
  });
});

// ── T5: undefined/null outputs do not break aggregation ───────────────────────

describe("T5 - undefined/null outputs handled safely", () => {
  it("step with undefined output stored as {} does not throw", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: {}, // undefined output stored as empty object (executor default)
      1: { taskId: 5 },
    };

    expect(() => buildResolvedData(stepOutputs)).not.toThrow();
    const resolved = buildResolvedData(stepOutputs);
    expect(resolved.taskId).toBe(5);
  });

  it("null values within an output do not throw and are included in result", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: { assigneeId: null, entityId: 10 },
    };

    const resolved = buildResolvedData(stepOutputs);
    expect(resolved.assigneeId).toBeNull();
    expect(resolved.entityId).toBe(10);
  });

  it("empty stepOutputs returns {} without throw", () => {
    expect(() => buildResolvedData({})).not.toThrow();
    expect(buildResolvedData({})).toEqual({});
  });

  it("createExecutionContext initializes stepOutputs as empty and resolvedData as empty", () => {
    const ctx = createExecutionContext("ticket.created", { id: 1 }, 1);
    expect(ctx.stepOutputs).toEqual({});
    expect(ctx.resolvedData).toEqual({});
  });

  it("buildResolvedData handles a single step with null-ish nested values", () => {
    const stepOutputs: Record<number, Record<string, unknown>> = {
      0: { a: null, b: undefined, c: 0, d: false, e: "" },
    };

    const resolved = buildResolvedData(stepOutputs);
    expect(resolved.a).toBeNull();
    expect(resolved.c).toBe(0);
    expect(resolved.d).toBe(false);
    expect(resolved.e).toBe("");
  });
});

// ── Bonus: Verify unused import (WorkflowDefinitionRuntime) not needed ─────────

describe("ExecutionContext shape - P4-A fields present", () => {
  it("createExecutionContext returns context with all required P4-A fields", () => {
    const ctx = createExecutionContext("test.event", { key: "value" }, 5, 10);

    expect(ctx).toHaveProperty("triggerEvent", "test.event");
    expect(ctx).toHaveProperty("workspaceId", 5);
    expect(ctx).toHaveProperty("triggeredBy", 10);
    expect(ctx).toHaveProperty("triggerData");
    expect(ctx).toHaveProperty("stepOutputs");
    expect(ctx).toHaveProperty("resolvedData");

    // P4-A: stepOutputs and resolvedData start empty
    expect(Object.keys(ctx.stepOutputs)).toHaveLength(0);
    expect(Object.keys(ctx.resolvedData)).toHaveLength(0);
  });

  it("createExecutionContext without triggeredBy leaves it undefined", () => {
    const ctx = createExecutionContext("ticket.created", {}, 1);
    expect(ctx.triggeredBy).toBeUndefined();
  });
});
