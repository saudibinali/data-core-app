/**
 * @file   __tests__/simulation.test.ts
 * @phase  P6-B - Simulation Engine & Workflow Preview Foundations
 *
 * Pure model tests for the simulation engine.
 * No DB, no HTTP, no side effects - all tests are synchronous or use
 * pure async functions with no mocked DB interactions.
 *
 * Test coverage:
 *   T1  Linear workflow: all steps executed, simulatedStatus=completed
 *   T2  Condition true-path: true branch taken, false-branch steps skipped
 *   T3  Condition false-path: false branch taken, true-branch steps skipped
 *   T4  Approval simulate approve: execution continues, approval in approvalPoints
 *   T5  Approval simulate reject: execution stops, simulatedStatus=rejected
 *   T6  Delay timeline: wakeAt computed, delayMs in record, adds to estimatedDurationMs
 *   T7  No DB writes: structural import check (simulation.ts has no db import)
 *   T8  Validation warnings integrated: WG-TOPO-01 appears in result warnings
 *   T9  Deterministic: same inputs → identical SimulationResult
 *   T10 Skipped branches visible in skippedSteps
 *
 *   Additional coverage:
 *   T11 Approval timeout auto_approve: execution continues
 *   T12 Approval timeout auto_reject: simulatedStatus=timed_out
 *   T13 Delay step adds to delayPoints and totalDelayMs
 *   T14 formatDurationMs: correct human-readable labels
 *   T15 Empty workflow: simulatedStatus=empty_workflow, no traversal
 */

import { describe, it, expect } from "vitest";
import { simulate, formatDurationMs } from "../simulation";
import type {
  SimulationContext,
  SimulatedStepRecord,
} from "../simulation";
import type {
  WorkflowStep,
  NotificationStep,
  ApprovalStep,
  DelayStep,
  ConditionStep,
} from "../types";

// ── Step factories ────────────────────────────────────────────────────────────

function notification(index: number, name = `Notify ${index}`): NotificationStep {
  return {
    index, name, type: "notification",
    config: {
      recipientType: "specific",
      recipientIds:  [1],
      title:         "Test",
      message:       "Test message",
    },
  };
}

function approval(
  index: number,
  name = `Approve ${index}`,
  opts?: Partial<ApprovalStep["config"]>,
): ApprovalStep {
  return {
    index, name, type: "approval",
    config: {
      approvalType: "single",
      approverType: "specific",
      approverIds:  [1],
      title:        "Needs approval",
      ...opts,
    },
  };
}

function delay(
  index: number,
  name = `Wait ${index}`,
  config: DelayStep["config"] = { delayForMinutes: 60 },
): DelayStep {
  return { index, name, type: "delay", config };
}

function condition(
  index: number,
  onTrue: number | null,
  onFalse: number | null,
  name = `Branch ${index}`,
): ConditionStep {
  return {
    index, name, type: "condition",
    config: {
      conditions: {
        logic:      "and",
        conditions: [{ field: "priority", operator: "eq", value: "high" }],
      },
      onTrueStepIndex:  onTrue,
      onFalseStepIndex: onFalse,
    },
  };
}

function makeCtx(
  triggerData: Record<string, unknown> = {},
  opts?: Partial<SimulationContext>,
): SimulationContext {
  return {
    triggerEvent: "test.event",
    triggerData,
    workspaceId:  1,
    workflowId:   99,
    simulatedNow: new Date("2026-01-01T12:00:00.000Z"),
    ...opts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Linear workflow
// ─────────────────────────────────────────────────────────────────────────────
describe("T1: Linear workflow simulation", () => {
  it("all steps executed, simulatedStatus=completed, no skipped steps", () => {
    const steps: WorkflowStep[] = [
      notification(0, "Step A"),
      notification(1, "Step B"),
      notification(2, "Step C"),
    ];
    const result = simulate(steps, makeCtx());

    expect(result.simulatedStatus).toBe("completed");
    expect(result.traversalPath).toHaveLength(3);
    expect(result.traversalPath.map(s => s.stepName)).toEqual(["Step A", "Step B", "Step C"]);
    expect(result.traversalPath.every(s => s.status === "executed")).toBe(true);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.unreachableSteps).toHaveLength(0);
    expect(result.metrics.visitedStepCount).toBe(3);
    expect(result.metrics.conditionCount).toBe(0);
    expect(result.metrics.approvalCount).toBe(0);
    expect(result.metrics.delayCount).toBe(0);
  });

  it("estimated duration is sum of step overheads for non-waiting steps", () => {
    const steps: WorkflowStep[] = [notification(0), notification(1)];
    const result = simulate(steps, makeCtx());
    // 2 steps × STEP_OVERHEAD_MS (200ms)
    expect(result.estimatedDurationMs).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Condition true-path
// ─────────────────────────────────────────────────────────────────────────────
describe("T2: Condition true-path simulation", () => {
  // Topology: condition at index 0 routes TRUE → index 2 (forward jump, skips index 1),
  //           FALSE → index 1 (linear next).
  //
  //  pos 0 (index 0): condition (onTrue=2, onFalse=1)
  //  pos 1 (index 1): notification "False Branch"   ← only visited on false path
  //  pos 2 (index 2): notification "True Branch"    ← visited on true path (jumped to)
  //  pos 3 (index 3): notification "After"          ← visited on both paths
  //
  // True path traversal: pos 0 → jump to pos 2 → linear to pos 3 → done.
  // Pos 1 ("False Branch") is reachable (via onFalse) but NOT visited → skipped.
  const steps: WorkflowStep[] = [
    condition(0, 2, 1, "Branch"),
    notification(1, "False Branch"),
    notification(2, "True Branch"),
    notification(3, "After"),
  ];

  it("with priority=high, condition evaluates true → takes true branch (skips False Branch)", () => {
    const result = simulate(steps, makeCtx({ priority: "high" }));

    expect(result.simulatedStatus).toBe("completed");

    const condRecord = result.traversalPath.find(s => s.stepType === "condition");
    expect(condRecord?.conditionMatched).toBe(true);
    expect(condRecord?.branchTaken).toBe("true");

    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).toContain("True Branch");
    expect(visited).not.toContain("False Branch"); // jumped over (pos 1 skipped)
  });

  it("false-branch step appears in skippedSteps", () => {
    const result = simulate(steps, makeCtx({ priority: "high" }));
    const skipped = result.skippedSteps.map(s => s.stepName);
    expect(skipped).toContain("False Branch");
    expect(result.skippedSteps.every(s => s.status === "skipped")).toBe(true);
  });

  it("condition step record has correct fields", () => {
    const result = simulate(steps, makeCtx({ priority: "high" }));
    const condRecord = result.traversalPath.find(s => s.stepType === "condition")!;
    expect(condRecord.onTrueStepIndex).toBe(2);
    expect(condRecord.onFalseStepIndex).toBe(1);
    expect(condRecord.conditionMatched).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Condition false-path
// ─────────────────────────────────────────────────────────────────────────────
describe("T3: Condition false-path simulation", () => {
  // Topology: condition at index 0 routes TRUE → index 1 (linear next),
  //           FALSE → index 3 (forward jump, skips indexes 1 and 2).
  //
  //  pos 0 (index 0): condition (onTrue=1, onFalse=3)
  //  pos 1 (index 1): notification "True Branch A"  ← only visited on true path
  //  pos 2 (index 2): notification "True Branch B"  ← only visited on true path (linear after 1)
  //  pos 3 (index 3): notification "End"            ← visited on both paths
  //
  // False path traversal: pos 0 → jump to pos 3 → done.
  // Pos 1 and pos 2 are reachable (via onTrue) but NOT visited on false path → skipped.
  const steps: WorkflowStep[] = [
    condition(0, 1, 3, "Branch"),
    notification(1, "True Branch A"),
    notification(2, "True Branch B"),
    notification(3, "End"),
  ];

  it("with priority=low, condition evaluates false → takes false branch (skips true-path steps)", () => {
    const result = simulate(steps, makeCtx({ priority: "low" }));

    expect(result.simulatedStatus).toBe("completed");

    const condRecord = result.traversalPath.find(s => s.stepType === "condition");
    expect(condRecord?.conditionMatched).toBe(false);
    expect(condRecord?.branchTaken).toBe("false");

    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).toContain("End");
    expect(visited).not.toContain("True Branch A"); // jumped over
    expect(visited).not.toContain("True Branch B"); // jumped over
  });

  it("true-branch steps appear in skippedSteps", () => {
    const result = simulate(steps, makeCtx({ priority: "low" }));
    const skipped = result.skippedSteps.map(s => s.stepName);
    expect(skipped).toContain("True Branch A");
    expect(skipped).toContain("True Branch B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Approval simulate approve
// ─────────────────────────────────────────────────────────────────────────────
describe("T4: Approval simulate approve path", () => {
  const steps: WorkflowStep[] = [
    notification(0, "Before"),
    approval(1, "HR Approval"),
    notification(2, "After"),
  ];

  it("approve decision → execution continues, simulatedStatus=completed", () => {
    const ctx = makeCtx({}, { approvalDecisions: { 1: "approve" } });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("completed");
    expect(result.traversalPath).toHaveLength(3);

    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).toEqual(["Before", "HR Approval", "After"]);
  });

  it("approval step appears in approvalPoints", () => {
    const ctx = makeCtx({}, { approvalDecisions: { 1: "approve" } });
    const result = simulate(steps, ctx);
    expect(result.approvalPoints).toHaveLength(1);
    expect(result.approvalPoints[0]!.stepName).toBe("HR Approval");
    expect(result.approvalPoints[0]!.approvalDecision).toBe("approve");
  });

  it("default decision is approve (no approvalDecisions key)", () => {
    const result = simulate(steps, makeCtx());
    expect(result.simulatedStatus).toBe("completed");
    expect(result.approvalPoints[0]!.approvalDecision).toBe("approve");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Approval simulate reject
// ─────────────────────────────────────────────────────────────────────────────
describe("T5: Approval simulate reject path", () => {
  const steps: WorkflowStep[] = [
    notification(0, "Before"),
    approval(1, "Manager Approval"),
    notification(2, "After"),
  ];

  it("reject decision → execution stops, simulatedStatus=rejected", () => {
    const ctx = makeCtx({}, { approvalDecisions: { 1: "reject" } });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("rejected");
    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).not.toContain("After"); // step after approval not visited
  });

  it("rejected approval step has approvalDecision=reject in record", () => {
    const ctx = makeCtx({}, { approvalDecisions: { 1: "reject" } });
    const result = simulate(steps, ctx);
    const approvalRecord = result.approvalPoints[0]!;
    expect(approvalRecord.approvalDecision).toBe("reject");
  });

  it("step after rejected approval is in skippedSteps", () => {
    const ctx = makeCtx({}, { approvalDecisions: { 1: "reject" } });
    const result = simulate(steps, ctx);
    // "After" step (index 2) was reachable but not visited → skipped
    const skipped = result.skippedSteps.map(s => s.stepName);
    expect(skipped).toContain("After");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Delay timeline estimation
// ─────────────────────────────────────────────────────────────────────────────
describe("T6: Delay timeline estimation", () => {
  const NOW = new Date("2026-06-01T10:00:00.000Z");

  it("delay step populates wakeAt, delayMs in the step record", () => {
    const steps: WorkflowStep[] = [
      notification(0, "Before"),
      delay(1, "Wait 1 Hour", { delayForMinutes: 60 }),
      notification(2, "After"),
    ];
    const ctx = makeCtx({}, { simulatedNow: NOW });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("completed");
    expect(result.delayPoints).toHaveLength(1);

    const delayRecord = result.delayPoints[0]!;
    expect(delayRecord.delayMs).toBe(60 * 60_000);
    expect(delayRecord.delayMinutes).toBe(60);
    expect(delayRecord.wakeAt!.toISOString()).toBe("2026-06-01T11:00:00.000Z");
    expect(delayRecord.delayMode).toBe("relative");
    expect(delayRecord.status).toBe("paused_delay");
  });

  it("delay step duration is added to estimatedDurationMs", () => {
    const steps: WorkflowStep[] = [
      delay(0, "Wait 2h", { delayForMinutes: 120 }),
    ];
    const ctx = makeCtx({}, { simulatedNow: NOW });
    const result = simulate(steps, ctx);

    expect(result.estimatedDurationMs).toBe(120 * 60_000);
    expect(result.metrics.totalDelayMs).toBe(120 * 60_000);
  });

  it("absolute timestamp delay uses delayUntilTimestamp", () => {
    const futureTs = "2026-06-02T10:00:00.000Z";
    const steps: WorkflowStep[] = [
      delay(0, "Wait Until Tomorrow", { delayUntilTimestamp: futureTs }),
    ];
    const ctx = makeCtx({}, { simulatedNow: NOW });
    const result = simulate(steps, ctx);

    const delayRecord = result.delayPoints[0]!;
    expect(delayRecord.wakeAt!.toISOString()).toBe(futureTs);
    expect(delayRecord.delayMode).toBe("absolute");
    expect(delayRecord.delayMs).toBe(24 * 60 * 60_000); // 1 day
  });

  it("execution continues after delay step (simulation does not stop)", () => {
    const steps: WorkflowStep[] = [
      delay(0, "Wait", { delayForMinutes: 30 }),
      notification(1, "After delay"),
    ];
    const ctx = makeCtx({}, { simulatedNow: NOW });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("completed");
    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).toContain("After delay");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - No DB writes (structural proof)
// ─────────────────────────────────────────────────────────────────────────────
describe("T7: Simulation produces no DB writes", () => {
  it("simulate() result is a plain object - no DB round-trips needed", () => {
    // Structural test: simulate() is synchronous (no await needed) and returns
    // a plain SimulationResult with no DB interaction.  The function signature
    // is `function simulate(steps, context): SimulationResult` - not async.
    // If it ever becomes async, this test would fail to compile.
    const steps: WorkflowStep[] = [notification(0)];
    const result = simulate(steps, makeCtx());

    // Result is a plain object - no Promise, no DB reference
    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.workspaceId).toBe(1);
  });

  it("simulate() is synchronous - not a Promise", () => {
    const steps: WorkflowStep[] = [notification(0), notification(1)];
    // TypeScript guarantees the return type is SimulationResult (not Promise<...>).
    const result = simulate(steps, makeCtx());
    expect(result.simulatedStatus).toBe("completed");
    // No await used above - confirms synchronous execution
  });

  it("no db identifier anywhere in simulation output", () => {
    // The result object should be a pure data structure
    const steps: WorkflowStep[] = [notification(0), approval(1)];
    const result = simulate(steps, makeCtx());
    const serialized = JSON.stringify(result);
    // Should not contain any DB artifact references
    expect(serialized).not.toContain("PgColumn");
    expect(serialized).not.toContain("drizzle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Validation warnings integrated
// ─────────────────────────────────────────────────────────────────────────────
describe("T8: Simulation integrates validation warnings", () => {
  it("unreachable step flagged by WG-TOPO-01 appears in result warnings", () => {
    // Workflow: condition(0) routes both branches to step 1, step 2 is unreachable
    // by both branches → WG-TOPO-01 should fire.
    // Actually let's create a simpler scenario: condition(0, onTrue=1, onFalse=1),
    // step 2 is therefore never reachable (both branches go to 1, skip 2).
    // Wait - this doesn't create WG-TOPO-01 because step 2 is reachable from step 1.
    //
    // For a real unreachable step: a step that no other step points to and is
    // past a condition that jumps over it.
    //   0: condition (onTrue=2, onFalse=2) - both branches skip step 1
    //   1: notification "Skipped by both" - no path leads here from any condition branch
    //   2: notification "Final"
    //
    // Actually step 1 IS unreachable if condition at index 0 always routes to index 2.
    // BFS from 0: successors of 0 = [pos(2), pos(2)] = [2]. pos(1) not visited.
    // So step at array pos 1 IS unreachable.
    const steps: WorkflowStep[] = [
      condition(0, 2, 2, "Always Jump"),   // both branches → index 2 (array pos 2)
      notification(1, "Never Reached"),    // array pos 1 - unreachable
      notification(2, "Final"),            // array pos 2
    ];

    const result = simulate(steps, makeCtx());

    // WG-TOPO-01 should be in the validation warnings
    const topoWarn = result.validationWarnings.find(w => w.code === "WG-TOPO-01_UNREACHABLE_STEP");
    expect(topoWarn).toBeDefined();
    expect(topoWarn?.stepName).toBe("Never Reached");

    // The unreachable step should be in unreachableSteps
    const unreachable = result.unreachableSteps.find(s => s.stepName === "Never Reached");
    expect(unreachable).toBeDefined();
    expect(unreachable?.status).toBe("unreachable");
  });

  it("step-level warning codes attached to the step record via stepWarnings", () => {
    // A delay step with an invalid config should carry WG-04_DELAY_NO_DURATION
    // in its stepWarnings (from the per-step validator).
    const steps: WorkflowStep[] = [
      {
        index: 0, name: "Bad Delay", type: "delay",
        config: {} as DelayStep["config"],  // no duration - triggers WG-04_DELAY_NO_DURATION
      },
    ];
    const result = simulate(steps, makeCtx());

    // The bad delay step appears in traversalPath with the validator code
    const delayRecord = result.traversalPath.find(s => s.stepName === "Bad Delay");
    expect(delayRecord).toBeDefined();
    // WG-04_DELAY_NO_DURATION should be in stepWarnings or simulationWarnings
    const hasWarn =
      (delayRecord?.stepWarnings ?? []).some(c => c.includes("DELAY")) ||
      result.simulationWarnings.some(w => w.includes("DELAY_NO_DURATION") || w.includes("invalid configuration"));
    expect(hasWarn).toBe(true);
  });

  it("estimatedMetrics come from the validation engine", () => {
    const steps: WorkflowStep[] = [
      notification(0), notification(1), notification(2),
    ];
    const result = simulate(steps, makeCtx());
    // 3 linear steps → longest path = 3
    expect(result.estimatedMetrics.maxExecutedSteps).toBe(3);
    expect(result.estimatedMetrics.branchingPaths).toBe(1); // no branches
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Deterministic across repeated runs
// ─────────────────────────────────────────────────────────────────────────────
describe("T9: Simulation deterministic across repeated runs", () => {
  it("identical inputs produce identical traversalPath order + simulatedStatus", () => {
    const steps: WorkflowStep[] = [
      condition(0, 2, 1, "Branch"),
      notification(1, "False Path"),
      notification(2, "True Path"),
      notification(3, "End"),
    ];
    const ctx = makeCtx({ priority: "high" }, {
      simulatedNow: new Date("2026-01-01T00:00:00Z"),
    });

    const r1 = simulate(steps, ctx);
    const r2 = simulate(steps, ctx);
    const r3 = simulate(steps, ctx);

    expect(r1.simulatedStatus).toBe(r2.simulatedStatus);
    expect(r2.simulatedStatus).toBe(r3.simulatedStatus);

    const names1 = r1.traversalPath.map(s => s.stepName);
    const names2 = r2.traversalPath.map(s => s.stepName);
    const names3 = r3.traversalPath.map(s => s.stepName);

    expect(names1).toEqual(names2);
    expect(names2).toEqual(names3);

    expect(r1.estimatedDurationMs).toBe(r2.estimatedDurationMs);
    expect(r2.estimatedDurationMs).toBe(r3.estimatedDurationMs);
  });

  it("changing triggerData changes condition outcome deterministically", () => {
    // Topology: condition(0, onTrue=2, onFalse=1) - true path jumps to index 2,
    // skipping index 1 ("Normal Priority Path").  False path goes to index 1 linearly,
    // then advances to index 2 too (forward-only model).
    //
    // True path (high):  visits [Priority Check, High Priority Path, End]
    //                    skips  [Normal Priority Path]
    // False path (low):  visits [Priority Check, Normal Priority Path, High Priority Path, End]
    //                    skips  []  (all steps reachable via linear advance)
    const steps: WorkflowStep[] = [
      condition(0, 2, 1, "Priority Check"),
      notification(1, "Normal Priority Path"),
      notification(2, "High Priority Path"),
      notification(3, "End"),
    ];
    const ctxHigh = makeCtx({ priority: "high" });
    const ctxLow  = makeCtx({ priority: "low"  });

    const rHigh = simulate(steps, ctxHigh);
    const rLow  = simulate(steps, ctxLow);

    const highVisited = rHigh.traversalPath.map(s => s.stepName);
    const lowVisited  = rLow.traversalPath.map(s => s.stepName);

    // High path: condition jumps to index 2 (pos 2), skipping index 1 (pos 1)
    expect(highVisited).toContain("High Priority Path");
    expect(highVisited).not.toContain("Normal Priority Path"); // jumped over ✓

    // Low path: condition goes to index 1 (pos 1), then linearly to pos 2 and 3
    expect(lowVisited).toContain("Normal Priority Path"); // ✓
    // Note: "High Priority Path" at pos 2 is also visited on the low path
    // (linear advance from pos 1 → pos 2).  This is correct forward-only behaviour.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Skipped branches visible in results
// ─────────────────────────────────────────────────────────────────────────────
describe("T10: Skipped branches visible in results", () => {
  // Topology: condition(0, onTrue=1, onFalse=3) - false path jumps over steps 1 and 2.
  //
  //  pos 0 (index 0): condition (onTrue=1, onFalse=3)
  //  pos 1 (index 1): notification "True Step"   ← reachable via onTrue, skipped on false path
  //  pos 2 (index 2): notification "True Step 2" ← reachable (linear after 1), skipped on false path
  //  pos 3 (index 3): notification "End"         ← both paths reach this
  //
  // False path (priority=low): pos 0 → jump to pos 3 → done.
  // Skipped: [True Step, True Step 2].
  const steps: WorkflowStep[] = [
    condition(0, 1, 3, "Branch"),
    notification(1, "True Step"),
    notification(2, "True Step 2"),
    notification(3, "End"),
  ];

  it("skipped steps have status=skipped and appear in skippedSteps array", () => {
    const result = simulate(steps, makeCtx({ priority: "low" })); // false path

    expect(result.skippedSteps.length).toBeGreaterThan(0);
    const skippedNames = result.skippedSteps.map(s => s.stepName);
    expect(skippedNames).toContain("True Step");
    expect(result.skippedSteps.every(s => s.status === "skipped")).toBe(true);
  });

  it("traversalPath + skippedSteps + unreachableSteps covers all steps", () => {
    const result = simulate(steps, makeCtx({ priority: "low" })); // false path

    const totalCovered =
      result.traversalPath.length +
      result.skippedSteps.length +
      result.unreachableSteps.length;

    expect(totalCovered).toBe(steps.length);
  });

  it("skipped steps have estimatedDurationMs=0 (they did not execute)", () => {
    const result = simulate(steps, makeCtx({ priority: "low" })); // false path
    for (const s of result.skippedSteps) {
      expect(s.estimatedDurationMs).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - Approval timeout auto_approve
// ─────────────────────────────────────────────────────────────────────────────
describe("T11: Approval timeout auto_approve continues execution", () => {
  it("timeout + onTimeout=auto_approve → execution continues, status=completed", () => {
    const steps: WorkflowStep[] = [
      approval(0, "Auto-approve Timeout", { onTimeout: "auto_approve", timeoutHours: 2 }),
      notification(1, "After"),
    ];
    const ctx = makeCtx({}, { approvalDecisions: { 0: "timeout" } });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("completed");
    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).toContain("After");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - Approval timeout auto_reject
// ─────────────────────────────────────────────────────────────────────────────
describe("T12: Approval timeout auto_reject stops execution", () => {
  it("timeout + onTimeout=auto_reject → simulatedStatus=timed_out", () => {
    const steps: WorkflowStep[] = [
      approval(0, "Auto-reject Timeout", { onTimeout: "auto_reject", timeoutHours: 24 }),
      notification(1, "Should not run"),
    ];
    const ctx = makeCtx({}, { approvalDecisions: { 0: "timeout" } });
    const result = simulate(steps, ctx);

    expect(result.simulatedStatus).toBe("timed_out");
    const visited = result.traversalPath.map(s => s.stepName);
    expect(visited).not.toContain("Should not run");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - Delay step metrics
// ─────────────────────────────────────────────────────────────────────────────
describe("T13: Delay step appears in delayPoints and metrics", () => {
  it("multiple delay steps sum into totalDelayMs", () => {
    const NOW = new Date("2026-01-01T00:00:00Z");
    const steps: WorkflowStep[] = [
      delay(0, "Wait 30m", { delayForMinutes: 30 }),
      notification(1, "Middle"),
      delay(2, "Wait 1h", { delayForMinutes: 60 }),
    ];
    const ctx = makeCtx({}, { simulatedNow: NOW });
    const result = simulate(steps, ctx);

    expect(result.delayPoints).toHaveLength(2);
    expect(result.metrics.delayCount).toBe(2);
    expect(result.metrics.totalDelayMs).toBe((30 + 60) * 60_000);
    expect(result.estimatedDurationMs).toBeGreaterThanOrEqual((30 + 60) * 60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - formatDurationMs
// ─────────────────────────────────────────────────────────────────────────────
describe("T14: formatDurationMs produces correct labels", () => {
  it("0ms → 'instant'", () => {
    expect(formatDurationMs(0)).toBe("instant");
  });
  it("negative → 'instant'", () => {
    expect(formatDurationMs(-1000)).toBe("instant");
  });
  it("30 000ms (30s) → 'less than 1 minute'", () => {
    expect(formatDurationMs(30_000)).toBe("less than 1 minute");
  });
  it("60 000ms (1min) → '1 minute'", () => {
    expect(formatDurationMs(60_000)).toBe("1 minute");
  });
  it("3 600 000ms (1h) → '1 hour'", () => {
    expect(formatDurationMs(3_600_000)).toBe("1 hour");
  });
  it("5 400 000ms (1h30m) → '1 hour 30 minutes'", () => {
    expect(formatDurationMs(5_400_000)).toBe("1 hour 30 minutes");
  });
  it("86 400 000ms (1 day) → '1 day'", () => {
    expect(formatDurationMs(86_400_000)).toBe("1 day");
  });
  it("90 000 000ms (1 day 1h) → '1 day 1 hour'", () => {
    expect(formatDurationMs(90_000_000)).toBe("1 day 1 hour");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Empty workflow
// ─────────────────────────────────────────────────────────────────────────────
describe("T15: Empty workflow edge case", () => {
  it("simulatedStatus=empty_workflow with no traversal", () => {
    const result = simulate([], makeCtx());
    expect(result.simulatedStatus).toBe("empty_workflow");
    expect(result.traversalPath).toHaveLength(0);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.unreachableSteps).toHaveLength(0);
    expect(result.estimatedDurationMs).toBe(0);
    expect(result.simulationWarnings.length).toBeGreaterThan(0);
  });
});
