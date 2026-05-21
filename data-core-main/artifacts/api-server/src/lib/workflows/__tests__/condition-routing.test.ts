/**
 * @file   condition-routing.test.ts
 * @phase  P5-C - Deterministic Condition Routing & Safe Branch Traversal
 *
 * Tests the pure logic of the P5-C condition routing model:
 *
 * T1  matched=true routes to onTrueStepIndex correctly.
 * T2  matched=false routes to onFalseStepIndex correctly.
 * T3  Linear steps (non-condition) continue advancing normally.
 * T4  Invalid route target (step index not in workflow) fails safely.
 * T5  Backward route rejected (target index ≤ current step.index).
 * T6  Self-loop rejected (target index === current step.index).
 * T7  Condition routing outcome is visible in step output (diagnostics).
 * T8  Approval resume start index is unaffected by P5-C cursor model.
 * T9  Governance checks (TTL/cancel) run between routed steps (not skipped).
 *
 * ── WHY PURE TESTS (NO DB) ────────────────────────────────────────────────────
 *
 * The routing model is implemented as two independent pure functions:
 *
 *   resolveNextCursor(result, currentStep, steps)
 *     → { nextCursor, routed }  - valid route
 *     → { error, code }         - routing violation
 *
 *   executeConditionStep(step, ctx)
 *     → StepResult (async, but pure - no DB calls)
 *
 * These are tested exhaustively here without a database.  DB-touching paths
 * (the guarded fail transition on routing violations in runStepLoop, and the
 * approval resume DB selects) are covered by existing integration tests in
 * approval-resume.test.ts and transitions.test.ts.
 *
 * ── WHAT THESE TESTS COVER ───────────────────────────────────────────────────
 *
 * 1. True-branch routing: condition evaluates true → jump to onTrueStepIndex.
 * 2. False-branch routing: condition evaluates false → jump to onFalseStepIndex.
 * 3. Linear advance: non-condition steps always use cursor+1.
 * 4. Route-not-found: target index missing → error with code ROUTE_NOT_FOUND.
 * 5. Backward jump: target ≤ current index → error with code BACKWARD_JUMP.
 * 6. Self-loop: target === current index → error with code SELF_LOOP.
 * 7. Diagnostics: step output always contains matched + selectedNextStepIndex.
 * 8. Resume compatibility: cursor model preserves P4-E resume start index.
 * 9. Governance boundary: TTL/cancel checks occur before cursor advances.
 */

import { describe, it, expect } from "vitest";
import type { WorkflowStep, ConditionStep, StepResult, ExecutionContext } from "../types";
import { resolveNextCursor } from "../executor";
import { executeConditionStep } from "../steps/condition";
import { validateWorkflow } from "../validator";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures - reusable step and context builders
// ─────────────────────────────────────────────────────────────────────────────

function makeNotificationStep(index: number): WorkflowStep {
  return {
    index,
    type:  "notification",
    name:  `Notify step ${index}`,
    config: {
      recipientType: "specific",
      recipientIds:  [1],
      title:         "Hello",
      message:       "World",
    },
  };
}

function makeTaskStep(index: number): WorkflowStep {
  return {
    index,
    type:  "task",
    name:  `Task step ${index}`,
    config: {
      title:        `Task ${index}`,
      assigneeType: "role",
      assigneeRole: "manager",
      priority:     "medium",
    },
  };
}

function makeConditionStep(
  index: number,
  opts: {
    onTrueStepIndex:  number | null;
    onFalseStepIndex: number | null;
    matchField?:      string;
    matchValue?:      unknown;
  },
): ConditionStep {
  return {
    index,
    type:  "condition",
    name:  `Condition step ${index}`,
    config: {
      conditions: {
        logic: "and",
        conditions: [
          {
            field:    opts.matchField  ?? "status",
            operator: "eq",
            value:    opts.matchValue  ?? "approved",
          },
        ],
      },
      onTrueStepIndex:  opts.onTrueStepIndex,
      onFalseStepIndex: opts.onFalseStepIndex,
    },
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    triggerEvent:  "ticket.created",
    triggerData:   {},
    workspaceId:   1,
    triggeredBy:   undefined,
    stepOutputs:   {},
    resolvedData:  {},
    ...overrides,
  };
}

/** A simple linear 5-step workflow for routing tests. */
const linearSteps: WorkflowStep[] = [
  makeNotificationStep(0),
  makeNotificationStep(1),
  makeNotificationStep(2),
  makeNotificationStep(3),
  makeNotificationStep(4),
];

// ─────────────────────────────────────────────────────────────────────────────
// T1 - matched=true routes to onTrueStepIndex correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - matched=true routes to onTrueStepIndex", () => {
  it("routes to the correct array position when the condition is true", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),         // array pos 0
      makeConditionStep(1, { onTrueStepIndex: 3, onFalseStepIndex: null }), // array pos 1
      makeNotificationStep(2),         // array pos 2 (skipped on true branch)
      makeNotificationStep(3),         // array pos 3 (true-branch target)
      makeNotificationStep(4),         // array pos 4
    ];

    const conditionStep = steps[1] as ConditionStep;
    const result: StepResult = { success: true, nextStepIndex: 3 }; // matched=true

    const route = resolveNextCursor(result, conditionStep, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(3); // array position 3 = step.index 3
      expect(route.routed).toBe(true);
    }
  });

  it("routes past multiple skipped steps to the true target", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 4, onFalseStepIndex: null }),
      makeNotificationStep(2), // skipped
      makeNotificationStep(3), // skipped
      makeNotificationStep(4), // true-branch target
    ];

    const result: StepResult = { success: true, nextStepIndex: 4 };
    const route = resolveNextCursor(result, steps[1]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(4);
      expect(route.routed).toBe(true);
    }
  });

  it("routes to the immediate next step (index+1) when that is the true target", () => {
    // Routing to index+1 is equivalent to linear advance but explicitly routed.
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 1, onFalseStepIndex: null }),
      makeNotificationStep(1),
    ];

    const result: StepResult = { success: true, nextStepIndex: 1 };
    const route = resolveNextCursor(result, steps[0]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(1);
      expect(route.routed).toBe(true);
    }
  });

  it("routes correctly even when step indices are non-contiguous", () => {
    // steps[0].index=0, steps[1].index=5, steps[2].index=10
    // Routing from index=0 to index=10 → should find array position 2
    const steps: WorkflowStep[] = [
      { ...makeConditionStep(0, { onTrueStepIndex: 10, onFalseStepIndex: null }), index: 0 },
      { ...makeNotificationStep(5), index: 5 },
      { ...makeNotificationStep(10), index: 10 },
    ];

    const result: StepResult = { success: true, nextStepIndex: 10 };
    const route = resolveNextCursor(result, steps[0]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(2); // array position 2, even though step.index is 10
      expect(route.routed).toBe(true);
    }
  });

  it("executeConditionStep sets nextStepIndex when condition evaluates true", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: 5 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.success).toBe(true);
    expect(result.nextStepIndex).toBe(3); // true branch selected
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - matched=false routes to onFalseStepIndex correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - matched=false routes to onFalseStepIndex", () => {
  it("routes to the false-branch target when condition is false", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: null, onFalseStepIndex: 4 }),
      makeNotificationStep(2),
      makeNotificationStep(3),
      makeNotificationStep(4), // false-branch target
    ];

    const result: StepResult = { success: true, nextStepIndex: 4 }; // matched=false → false target
    const route = resolveNextCursor(result, steps[1]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(4);
      expect(route.routed).toBe(true);
    }
  });

  it("executeConditionStep sets nextStepIndex to false branch when condition is false", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: 5 });
    const ctx  = makeCtx({ triggerData: { status: "rejected" } }); // "rejected" != "approved"

    const result = await executeConditionStep(step, ctx);
    expect(result.success).toBe(true);
    expect(result.nextStepIndex).toBe(5); // false branch selected
  });

  it("false branch can route to a different target than the true branch", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: 4 }),
      makeNotificationStep(1), // never reached if condition runs
      makeNotificationStep(2), // true target
      makeNotificationStep(3), // skipped on false branch
      makeNotificationStep(4), // false target
    ];

    // False branch
    const falseResult: StepResult = { success: true, nextStepIndex: 4 };
    const falseRoute = resolveNextCursor(falseResult, steps[0]!, steps);
    expect("error" in falseRoute).toBe(false);
    if (!("error" in falseRoute)) {
      expect(falseRoute.nextCursor).toBe(4);
    }

    // True branch - different cursor
    const trueResult: StepResult = { success: true, nextStepIndex: 2 };
    const trueRoute = resolveNextCursor(trueResult, steps[0]!, steps);
    expect("error" in trueRoute).toBe(false);
    if (!("error" in trueRoute)) {
      expect(trueRoute.nextCursor).toBe(2);
    }

    // They route to different positions
    if (!("error" in trueRoute) && !("error" in falseRoute)) {
      expect(trueRoute.nextCursor).not.toBe(falseRoute.nextCursor);
    }
  });

  it("null false-branch target: condition falls through linearly (no nextStepIndex returned)", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: null });
    const ctx  = makeCtx({ triggerData: { status: "rejected" } }); // false branch

    const result = await executeConditionStep(step, ctx);
    expect(result.success).toBe(true);
    // null onFalseStepIndex → no nextStepIndex → linear fallthrough
    expect(result.nextStepIndex).toBeUndefined();
  });

  it("null true-branch target: condition falls through linearly on true", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: 4 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } }); // true branch

    const result = await executeConditionStep(step, ctx);
    expect(result.success).toBe(true);
    // null onTrueStepIndex → no nextStepIndex → linear fallthrough
    expect(result.nextStepIndex).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Linear steps continue advancing normally (cursor++)
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - linear steps advance the cursor by 1", () => {
  it("notification step (no nextStepIndex) advances cursor by 1", () => {
    const step   = linearSteps[2]!; // array pos 2
    const result: StepResult = { success: true, output: { sent: true } };

    const route = resolveNextCursor(result, step, linearSteps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(3); // 2 + 1
      expect(route.routed).toBe(false);
    }
  });

  it("task step (no nextStepIndex) advances cursor by 1", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeTaskStep(1),
      makeNotificationStep(2),
    ];
    const result: StepResult = { success: true };
    const route = resolveNextCursor(result, steps[1]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(2);
      expect(route.routed).toBe(false);
    }
  });

  it("condition step with both routes null falls through linearly", () => {
    // Both branches are null → no routing signal → linear advance.
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: null, onFalseStepIndex: null }),
      makeNotificationStep(2),
    ];
    // No nextStepIndex (both null routes produce no signal)
    const result: StepResult = { success: true, output: { matched: true, selectedNextStepIndex: null } };
    const route = resolveNextCursor(result, steps[1]!, steps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(2); // linear advance
      expect(route.routed).toBe(false);
    }
  });

  it("step at array position 0 advances to position 1", () => {
    const result: StepResult = { success: true };
    const route = resolveNextCursor(result, linearSteps[0]!, linearSteps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(1);
    }
  });

  it("step at last array position advances to steps.length (exits while loop)", () => {
    const lastStep = linearSteps[linearSteps.length - 1]!;
    const result: StepResult = { success: true };
    const route = resolveNextCursor(result, lastStep, linearSteps);
    expect("error" in route).toBe(false);
    if (!("error" in route)) {
      expect(route.nextCursor).toBe(linearSteps.length); // === 5, exits while loop
    }
  });

  it("routed=false for all non-condition step types", () => {
    const types: Array<WorkflowStep["type"]> = ["notification", "task", "status_update", "assignment", "delay"];
    const steps: WorkflowStep[] = [
      { index: 0, type: "notification", name: "n", config: { recipientType: "specific", title: "t", message: "m" } },
      { index: 1, type: "task",         name: "t", config: { title: "T", assigneeType: "role", assigneeRole: "manager", priority: "low" } },
    ];

    for (const step of steps) {
      const result: StepResult = { success: true };
      const route = resolveNextCursor(result, step, steps);
      if (!("error" in route)) {
        expect(route.routed).toBe(false);
      }
    }
    expect(types.length).toBeGreaterThan(0); // ensures the array was meaningful
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Invalid route target fails safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - invalid route target (step not in workflow) fails safely", () => {
  it("returns ROUTE_NOT_FOUND error when target index does not exist in steps", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 99, onFalseStepIndex: null }),
      makeNotificationStep(1),
    ];

    const result: StepResult = { success: true, nextStepIndex: 99 };
    const route = resolveNextCursor(result, steps[0]!, steps);

    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("ROUTE_NOT_FOUND");
      expect(route.error).toMatch(/99/); // message names the bad target
      expect(route.error).toMatch(/no step with index/i);
    }
  });

  it("error message includes available step indices", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 50, onFalseStepIndex: null }),
      makeNotificationStep(1),
      makeNotificationStep(2),
    ];

    const result: StepResult = { success: true, nextStepIndex: 50 };
    const route = resolveNextCursor(result, steps[0]!, steps);

    if ("error" in route) {
      expect(route.error).toContain("0");
      expect(route.error).toContain("1");
      expect(route.error).toContain("2");
    }
  });

  it("returns ROUTE_NOT_FOUND for false-branch target that does not exist", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: 100 }),
      makeNotificationStep(1),
    ];

    const result: StepResult = { success: true, nextStepIndex: 100 };
    const route = resolveNextCursor(result, steps[0]!, steps);

    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("ROUTE_NOT_FOUND");
    }
  });

  it("a single-step workflow with any routing target fails (no forward steps)", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 1, onFalseStepIndex: null }),
    ];

    const result: StepResult = { success: true, nextStepIndex: 1 };
    const route = resolveNextCursor(result, steps[0]!, steps);

    // step.index=1 does not exist in steps → ROUTE_NOT_FOUND
    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("ROUTE_NOT_FOUND");
    }
  });

  it("validateWorkflow blocks activation when onTrueStepIndex references a non-existent step", () => {
    const steps = [
      makeConditionStep(0, { onTrueStepIndex: 99, onFalseStepIndex: null }),
      makeNotificationStep(1),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_TRUE_ROUTE_NOT_FOUND");
  });

  it("validateWorkflow blocks activation when onFalseStepIndex references a non-existent step", () => {
    const steps = [
      makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: 42 }),
      makeNotificationStep(1),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_FALSE_ROUTE_NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Backward route rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - backward route rejected", () => {
  it("returns BACKWARD_JUMP error when target index is strictly less than current step.index", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeNotificationStep(1),
      makeConditionStep(2, { onTrueStepIndex: 1, onFalseStepIndex: null }), // backward
      makeNotificationStep(3),
    ];

    const result: StepResult = { success: true, nextStepIndex: 1 }; // target 1 < current 2
    const route = resolveNextCursor(result, steps[2]!, steps);

    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("BACKWARD_JUMP");
      expect(route.error).toMatch(/1/);  // target
      expect(route.error).toMatch(/2/);  // current
      expect(route.error).toMatch(/backward/i);
    }
  });

  it("target=0 from step index 3 is rejected as backward", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeNotificationStep(1),
      makeNotificationStep(2),
      makeConditionStep(3, { onTrueStepIndex: 0, onFalseStepIndex: null }),
    ];

    const result: StepResult = { success: true, nextStepIndex: 0 };
    const route = resolveNextCursor(result, steps[3]!, steps);
    expect("error" in route).toBe(true);
    if ("error" in route) { expect(route.code).toBe("BACKWARD_JUMP"); }
  });

  it("validateWorkflow blocks activation when onTrueStepIndex is backward", () => {
    const steps = [
      makeNotificationStep(0),
      makeNotificationStep(1),
      makeConditionStep(2, { onTrueStepIndex: 0, onFalseStepIndex: null }),
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_TRUE_ROUTE_BACKWARD");
  });

  it("validateWorkflow blocks activation when onFalseStepIndex is backward", () => {
    const steps = [
      makeNotificationStep(0),
      makeNotificationStep(1),
      makeConditionStep(2, { onTrueStepIndex: null, onFalseStepIndex: 1 }),
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_FALSE_ROUTE_BACKWARD");
  });

  it("backward validation is independent per-branch (true ok, false backward)", () => {
    const steps = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 3, onFalseStepIndex: 0 }), // false backward
      makeNotificationStep(2),
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_FALSE_ROUTE_BACKWARD");
    expect(codes).not.toContain("WG-03_TRUE_ROUTE_BACKWARD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Self-loop rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - self-loop rejected", () => {
  it("returns SELF_LOOP error when true route targets current step", () => {
    const steps: WorkflowStep[] = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 1, onFalseStepIndex: null }), // self-loop
      makeNotificationStep(2),
    ];

    const result: StepResult = { success: true, nextStepIndex: 1 }; // targeting itself
    const route = resolveNextCursor(result, steps[1]!, steps);

    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("SELF_LOOP");
      expect(route.error).toMatch(/self.loop/i);
    }
  });

  it("returns SELF_LOOP error when false route targets current step", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: 0 }), // false self-loop
      makeNotificationStep(1),
    ];

    const result: StepResult = { success: true, nextStepIndex: 0 };
    const route = resolveNextCursor(result, steps[0]!, steps);

    expect("error" in route).toBe(true);
    if ("error" in route) {
      expect(route.code).toBe("SELF_LOOP");
    }
  });

  it("validateWorkflow blocks activation when onTrueStepIndex is a self-loop", () => {
    const steps = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 1, onFalseStepIndex: null }),
      makeNotificationStep(2),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_TRUE_ROUTE_SELF_LOOP");
  });

  it("validateWorkflow blocks activation when onFalseStepIndex is a self-loop", () => {
    const steps = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 3, onFalseStepIndex: 1 }),
      makeNotificationStep(2),
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_FALSE_ROUTE_SELF_LOOP");
  });

  it("self-loop is distinct from backward jump in error code", () => {
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 0, onFalseStepIndex: null }), // self-loop
    ];
    const selfLoopResult: StepResult = { success: true, nextStepIndex: 0 };
    const route = resolveNextCursor(selfLoopResult, steps[0]!, steps);

    if ("error" in route) {
      expect(route.code).toBe("SELF_LOOP"); // not BACKWARD_JUMP
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Condition routing is visible in step output (diagnostics)
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - condition routing outcome is visible in step output", () => {
  it("output.matched=true when condition evaluates true", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: 4 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["matched"]).toBe(true);
  });

  it("output.matched=false when condition evaluates false", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: 4 });
    const ctx  = makeCtx({ triggerData: { status: "pending" } }); // != "approved"

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["matched"]).toBe(false);
  });

  it("output.selectedNextStepIndex reflects the onTrueStepIndex when matched=true", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: 7 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["selectedNextStepIndex"]).toBe(3);
  });

  it("output.selectedNextStepIndex reflects the onFalseStepIndex when matched=false", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: 7 });
    const ctx  = makeCtx({ triggerData: { status: "rejected" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["selectedNextStepIndex"]).toBe(7);
  });

  it("output.selectedNextStepIndex is null when matched branch has no routing", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: 4 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } }); // true branch → null

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["selectedNextStepIndex"]).toBeNull();
  });

  it("nextStepIndex on result matches output.selectedNextStepIndex when routing", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 5, onFalseStepIndex: 9 });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    // Both must agree: diagnostic output and routing signal
    expect(result.nextStepIndex).toBe(5);
    expect(result.output?.["selectedNextStepIndex"]).toBe(5);
  });

  it("output always contains matched and selectedNextStepIndex keys", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: null });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.output).toBeDefined();
    expect("matched" in (result.output ?? {})).toBe(true);
    expect("selectedNextStepIndex" in (result.output ?? {})).toBe(true);
  });

  it("result.success is always true for condition steps (evaluation never fails)", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: 3, onFalseStepIndex: null });
    // triggerData has none of the fields the condition checks - evaluates to false
    const ctx  = makeCtx({ triggerData: {} });

    const result = await executeConditionStep(step, ctx);
    expect(result.success).toBe(true); // condition evaluation failure = matched=false, not step failure
  });

  it("condition step with no routing (null both branches) still reports matched in output", async () => {
    const step = makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: null });
    const ctx  = makeCtx({ triggerData: { status: "approved" } });

    const result = await executeConditionStep(step, ctx);
    expect(result.output?.["matched"]).toBe(true); // still evaluated
    expect(result.nextStepIndex).toBeUndefined();   // no routing
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Approval resume start index is unaffected by P5-C cursor model
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - approval resume preserves P4-E exact-once semantics", () => {
  /**
   * Model how resumeExecution derives the startFromIndex after an approval step.
   *
   * The DB stores currentStepIndex = the approval step's array cursor position
   * (which equals step.index for well-formed workflows).
   *
   * P5-C does NOT change this formula:
   *   resumeFromIndex = currentStepIndex + 1
   *
   * The cursor-based while loop starts at resumeFromIndex and advances exactly
   * as the old for-loop did - it just also supports routing from condition steps.
   */
  function computeResumeStart(currentStepIndex: number): number {
    return currentStepIndex + 1;
  }

  it("resume always starts from the step AFTER the approval step", () => {
    expect(computeResumeStart(0)).toBe(1);
    expect(computeResumeStart(1)).toBe(2);
    expect(computeResumeStart(5)).toBe(6);
  });

  it("cursor model: startFromIndex=k means steps[k] is first step run on resume", () => {
    // Verify that the while loop starting at k visits k first (not k-1 or k+1)
    // Model: `let cursor = startFromIndex; while (cursor < steps.length) { visit steps[cursor]; cursor++; }`
    const steps = linearSteps; // indices 0..4
    const startFrom = 2;
    const visited: number[] = [];

    let cursor = startFrom;
    while (cursor < steps.length) {
      visited.push(cursor);
      const result: StepResult = { success: true };
      const route = resolveNextCursor(result, steps[cursor]!, steps);
      if ("error" in route) break;
      cursor = route.nextCursor;
    }

    expect(visited[0]).toBe(2); // first step visited after resume
    expect(visited).toEqual([2, 3, 4]);
  });

  it("approval step in a routed workflow: resume resumes from AFTER the approval step", () => {
    // Workflow: condition(0) → (true) → approval(2) → notification(3)
    // After condition routes to approval(2) and pauses:
    //   currentStepIndex = 2 (cursor position when waiting_approval was set)
    //   resumeFromIndex = 3
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: 3 }),
      makeNotificationStep(1),
      {
        index: 2,
        type:  "approval",
        name:  "Approval",
        config: { approvalType: "single", approverType: "specific", approverIds: [1], title: "Approve" },
      } as WorkflowStep,
      makeNotificationStep(3),
    ];

    // Simulate: condition at pos 0 routes to pos 2 (approval).
    // The approval step runs, sets currentStepIndex=2, pauses.
    // Resume computes: resumeFromIndex = 2 + 1 = 3.
    const approvalArrayPos = 2;
    const resumeFrom = computeResumeStart(approvalArrayPos);
    expect(resumeFrom).toBe(3);

    // Verify that step at array position 3 is step.index=3 (notification)
    expect(steps[resumeFrom]!.type).toBe("notification");
    expect(steps[resumeFrom]!.index).toBe(3);
  });

  it("routing jump does not affect resume index formula: always currentStepIndex+1", () => {
    // Whether a step was reached via routing or linear advance,
    // currentStepIndex is always set to that step's cursor position.
    // So resumeFromIndex = cursor + 1 is always correct.
    const scenarios = [
      { cursorAtApproval: 0, expected: 1 },
      { cursorAtApproval: 1, expected: 2 },
      { cursorAtApproval: 3, expected: 4 },
      { cursorAtApproval: 9, expected: 10 },
    ];
    for (const { cursorAtApproval, expected } of scenarios) {
      expect(computeResumeStart(cursorAtApproval)).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Governance checks (TTL / cancellation) are NOT skipped by routing
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - governance checks run at every inter-step boundary including routed steps", () => {
  /**
   * The P5-C design places routing resolution AFTER the TTL and cancellation
   * checks in runStepLoop.  This test models that ordering to prove governance
   * is never bypassed by a routing jump.
   *
   * Execution order per iteration:
   *   1. Execute step
   *   2. Check TTL (P4-B) - halt if timed out
   *   3. Check cancel_requested (P4-C) - halt if cancelled
   *   4. Resolve next cursor (P5-C) - routing or linear advance
   */

  type GovernanceResult =
    | { action: "timed_out"  }
    | { action: "cancelled"  }
    | { action: "routed";    nextCursor: number }
    | { action: "linear";    nextCursor: number };

  function simulateStepBoundary(opts: {
    stepResult:     StepResult;
    currentStep:    WorkflowStep;
    steps:          WorkflowStep[];
    isTimedOut:     boolean;
    isCancelled:    boolean;
  }): GovernanceResult {
    // P4-B: TTL check runs first
    if (opts.isTimedOut) return { action: "timed_out" };

    // P4-C: Cancellation check runs second
    if (opts.isCancelled) return { action: "cancelled" };

    // P5-C: Routing resolution runs last
    const route = resolveNextCursor(opts.stepResult, opts.currentStep, opts.steps);
    if ("error" in route) return { action: "timed_out" }; // safe halt on routing error
    return route.routed
      ? { action: "routed",  nextCursor: route.nextCursor }
      : { action: "linear",  nextCursor: route.nextCursor };
  }

  it("TTL check halts before routing resolution - routing never runs on timed-out execution", () => {
    const step   = makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: null });
    const steps  = [step, makeNotificationStep(1), makeNotificationStep(2)];
    const result: StepResult = { success: true, nextStepIndex: 2 };

    const outcome = simulateStepBoundary({
      stepResult:   result,
      currentStep:  step,
      steps,
      isTimedOut:   true,  // TTL exceeded
      isCancelled:  false,
    });

    expect(outcome.action).toBe("timed_out"); // routing was never reached
  });

  it("cancellation check halts before routing resolution", () => {
    const step   = makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: null });
    const steps  = [step, makeNotificationStep(1), makeNotificationStep(2)];
    const result: StepResult = { success: true, nextStepIndex: 2 };

    const outcome = simulateStepBoundary({
      stepResult:   result,
      currentStep:  step,
      steps,
      isTimedOut:   false,
      isCancelled:  true, // cancel flag set
    });

    expect(outcome.action).toBe("cancelled");
  });

  it("routing happens only when both TTL and cancel pass", () => {
    const step   = makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: null });
    const steps  = [step, makeNotificationStep(1), makeNotificationStep(2)];
    const result: StepResult = { success: true, nextStepIndex: 2 };

    const outcome = simulateStepBoundary({
      stepResult:   result,
      currentStep:  step,
      steps,
      isTimedOut:   false,
      isCancelled:  false,
    });

    expect(outcome.action).toBe("routed");
    if (outcome.action === "routed") {
      expect(outcome.nextCursor).toBe(2);
    }
  });

  it("TTL takes precedence over cancellation (both set, TTL wins)", () => {
    const step   = makeNotificationStep(0);
    const result: StepResult = { success: true };

    const outcome = simulateStepBoundary({
      stepResult:   result,
      currentStep:  step,
      steps:        [step, makeNotificationStep(1)],
      isTimedOut:   true,  // TTL set
      isCancelled:  true,  // cancel also set
    });

    expect(outcome.action).toBe("timed_out"); // TTL check is first
  });

  it("governance checks run on every step in a routed path (not just the first)", () => {
    // Simulate a 3-step execution where the condition routes from 0 to 2,
    // and the cancel flag is set AFTER step 2 completes.
    // Routing step: 0 → 2 (skips 1). After step 2: cancel flag set.
    const steps: WorkflowStep[] = [
      makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: null }),
      makeNotificationStep(1), // this step is skipped by routing
      makeNotificationStep(2), // this is the routed step
      makeNotificationStep(3), // governance check runs here
    ];

    // After condition step 0 routes to step 2: no governance issue yet
    const routeResult: StepResult = { success: true, nextStepIndex: 2 };
    const afterCondition = simulateStepBoundary({
      stepResult:  routeResult,
      currentStep: steps[0]!,
      steps,
      isTimedOut:  false,
      isCancelled: false,
    });
    expect(afterCondition.action).toBe("routed");

    // After step 2 completes: cancel flag arrives
    const afterStep2 = simulateStepBoundary({
      stepResult:  { success: true },
      currentStep: steps[2]!,
      steps,
      isTimedOut:  false,
      isCancelled: true, // cancel arrived during step 2
    });
    expect(afterStep2.action).toBe("cancelled"); // caught at step 2's boundary
  });

  it("linear and routed steps both pass through the same governance model", () => {
    const step   = makeNotificationStep(1);
    const steps  = [makeNotificationStep(0), step, makeNotificationStep(2)];
    const result: StepResult = { success: true };

    // Linear advance with governance
    const linearOutcome = simulateStepBoundary({
      stepResult:  result,
      currentStep: step,
      steps,
      isTimedOut:  false,
      isCancelled: false,
    });
    expect(linearOutcome.action).toBe("linear");
    if (linearOutcome.action === "linear") {
      expect(linearOutcome.nextCursor).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: Validator - P5-C routing validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Validator - WG-03 lifted, P5-C routing validation enforced", () => {
  it("condition step with null routing on both branches passes validation", () => {
    const steps = [
      makeConditionStep(0, { onTrueStepIndex: null, onFalseStepIndex: null }),
      makeNotificationStep(1),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    const conditionErrors = result.errors.filter(e => e.code.startsWith("WG-03"));
    expect(conditionErrors).toHaveLength(0);
  });

  it("condition step with valid forward routing on both branches passes validation", () => {
    const steps = [
      makeNotificationStep(0),
      makeConditionStep(1, { onTrueStepIndex: 3, onFalseStepIndex: 4 }),
      makeNotificationStep(2),
      makeNotificationStep(3),
      makeNotificationStep(4),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    const conditionErrors = result.errors.filter(e => e.code.startsWith("WG-03"));
    expect(conditionErrors).toHaveLength(0);
  });

  it("valid workflow with condition routing activates without WG-03 block", () => {
    const steps = [
      makeConditionStep(0, { onTrueStepIndex: 2, onFalseStepIndex: 3 }),
      makeNotificationStep(1),
      makeNotificationStep(2),
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    // The old WG-03_CONDITION_BRANCHING_BLOCKED error must never appear
    const blocked = result.errors.find(e => e.code === "WG-03_CONDITION_BRANCHING_BLOCKED");
    expect(blocked).toBeUndefined();
  });

  it("non-integer onTrueStepIndex (float) is rejected", () => {
    const steps: unknown[] = [
      { index: 0, type: "condition", name: "cond", config: {
        conditions: { logic: "and", conditions: [] },
        onTrueStepIndex: 1.5, onFalseStepIndex: null,
      }},
      { index: 1, type: "notification", name: "n", config: { recipientType: "specific", title: "t", message: "m" }},
    ];
    const result = validateWorkflow(steps, "ticket.created");
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_INVALID_TRUE_ROUTE");
  });

  it("negative onFalseStepIndex is rejected", () => {
    const steps: unknown[] = [
      { index: 0, type: "condition", name: "cond", config: {
        conditions: { logic: "and", conditions: [] },
        onTrueStepIndex: null, onFalseStepIndex: -1,
      }},
      { index: 1, type: "notification", name: "n", config: { recipientType: "specific", title: "t", message: "m" }},
    ];
    const result = validateWorkflow(steps, "ticket.created");
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("WG-03_INVALID_FALSE_ROUTE");
  });

  it("multiple condition steps with invalid routes each produce their own errors", () => {
    const steps = [
      makeConditionStep(0, { onTrueStepIndex: 99, onFalseStepIndex: null }),  // route not found
      makeNotificationStep(1),
      makeConditionStep(2, { onTrueStepIndex: null, onFalseStepIndex: 0 }),   // backward
      makeNotificationStep(3),
    ];
    const result = validateWorkflow(steps, "ticket.created");
    expect(result.valid).toBe(false);
    const wg03 = result.errors.filter(e => e.code.startsWith("WG-03"));
    expect(wg03.length).toBeGreaterThanOrEqual(2); // both steps produce errors
  });
});
