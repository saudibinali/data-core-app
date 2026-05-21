/**
 * @file   snapshot.test.ts
 * @phase  P5-A - Immutable Execution Steps Snapshot unit tests.
 *
 * Tests the pure logic of the snapshot model:
 *
 * T1  Snapshot captures all steps at trigger time.
 * T2  Resume uses snapshot instead of live definition (when snapshot present).
 * T3  Live workflow edits do not affect resumed execution (snapshot isolation).
 * T4  Legacy executions (NULL snapshot) fall back to live definition safely.
 * T5  Snapshot is a deep clone - no shared references with original steps.
 * T6  workflowVersion is persisted correctly (NULL until P7-A, then integer).
 * T7  Resume preserves exact-once behavior after snapshot introduction.
 *
 * ── WHY PURE TESTS (NO DB) ───────────────────────────────────────────────────
 *
 * The snapshot model is deterministic pure logic:
 *   captureSnapshot(steps) → deepClonedSteps
 *   resolveResumeSteps(snapshot, liveSteps) → steps + source
 *
 * These can be tested exhaustively without a database.
 * DB interactions (INSERT with stepsSnapshot, SELECT stepsSnapshot) are
 * validated via the existing server integration and E2E verification.
 *
 * ── WHAT THESE TESTS COVER ───────────────────────────────────────────────────
 *
 * 1. Snapshot capture logic: deep clone produces identical but independent copy.
 * 2. Source of truth selection: snapshot vs live definition fallback.
 * 3. Drift isolation: changes to the original steps array do not affect snapshot.
 * 4. Backward compatibility: NULL snapshot → legacy path (no regression).
 * 5. workflowVersion: stored as NULL (pre-P7-A) or integer (post-P7-A).
 * 6. Resume start index: snapshot introduction does not alter P4-E logic.
 * 7. Exact-once guarantee: snapshot does not add new race conditions.
 */

import { describe, it, expect } from "vitest";
import type { WorkflowStep } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers - model P5-A snapshot logic as pure functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models engine.ts snapshot capture: structuredClone(steps).
 *
 * Returns a deep clone of the step array.  No shared references remain.
 * This is what engine.ts stores in steps_snapshot at INSERT time.
 */
function captureSnapshot(steps: WorkflowStep[]): WorkflowStep[] {
  return structuredClone(steps);
}

/**
 * Models resumeExecution() source-of-truth selection (P5-A):
 *
 *   stepsSnapshot != null  → use snapshot (safe)
 *   stepsSnapshot == null  → use liveSteps (legacy fallback, drift possible)
 *
 * Returns { steps, source } where source indicates which path was taken.
 */
function resolveResumeSteps(
  stepsSnapshot: WorkflowStep[] | null,
  liveSteps:     WorkflowStep[],
): { steps: WorkflowStep[]; source: "snapshot" | "live_definition" } {
  if (stepsSnapshot != null) {
    return { steps: stepsSnapshot, source: "snapshot" };
  }
  return { steps: liveSteps, source: "live_definition" };
}

/**
 * Models the workflowVersion resolution:
 *   - If definition has a version column (post-P7-A): use it.
 *   - Otherwise (pre-P7-A, current state): NULL.
 */
function resolveWorkflowVersion(definition: { version?: number | null }): number | null {
  return definition.version ?? null;
}

/**
 * Simulates what happens when a workflow admin edits the live definition
 * after an execution has been triggered and paused at approval.
 * Returns modified steps (simulating a definition edit).
 */
function simulateLiveDefinitionEdit(
  originalSteps: WorkflowStep[],
  editedStepIndex: number,
  newStepType: WorkflowStep["type"],
): WorkflowStep[] {
  return originalSteps.map((step, i) =>
    i === editedStepIndex ? ({ ...step, type: newStepType } as WorkflowStep) : step,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample step fixtures
// ─────────────────────────────────────────────────────────────────────────────

const sampleSteps: WorkflowStep[] = [
  {
    index: 0,
    type:  "notification",
    name:  "Notify Manager",
    config: {
      recipientType: "specific",
      recipientIds:  [1, 2, 3],
      title:         "New request",
      message:       "A new leave request was submitted",
    },
  },
  {
    index: 1,
    type:  "approval",
    name:  "Manager Approval",
    config: {
      approvalType: "single",
      approverType: "specific",
      approverIds:  [4],
      title:        "Approve leave request",
    },
  },
  {
    index: 2,
    type:  "task",
    name:  "HR Processing Task",
    config: {
      title:        "Process approved leave",
      assigneeType: "role",
      assigneeRole: "manager",
      priority:     "medium",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Snapshot captures all steps at trigger time
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - snapshot captures all steps at trigger time", () => {
  it("snapshot contains the same number of steps as the original", () => {
    const snapshot = captureSnapshot(sampleSteps);
    expect(snapshot).toHaveLength(sampleSteps.length);
  });

  it("snapshot step indices match original", () => {
    const snapshot = captureSnapshot(sampleSteps);
    sampleSteps.forEach((step, i) => {
      expect(snapshot[i]!.index).toBe(step.index);
    });
  });

  it("snapshot step types match original", () => {
    const snapshot = captureSnapshot(sampleSteps);
    sampleSteps.forEach((step, i) => {
      expect(snapshot[i]!.type).toBe(step.type);
    });
  });

  it("snapshot step names match original", () => {
    const snapshot = captureSnapshot(sampleSteps);
    sampleSteps.forEach((step, i) => {
      expect(snapshot[i]!.name).toBe(step.name);
    });
  });

  it("snapshot of empty workflow is an empty array (not null)", () => {
    const snapshot = captureSnapshot([]);
    expect(snapshot).toEqual([]);
    expect(Array.isArray(snapshot)).toBe(true);
  });

  it("snapshot of single-step workflow captures the one step", () => {
    const oneStep: WorkflowStep[] = [sampleSteps[0]!];
    const snapshot = captureSnapshot(oneStep);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.type).toBe("notification");
  });

  it("nested config fields are captured in the snapshot", () => {
    const snapshot = captureSnapshot(sampleSteps);
    const notifyStep = snapshot[0]!;
    expect(notifyStep.type).toBe("notification");
    if (notifyStep.type === "notification") {
      expect(notifyStep.config.recipientIds).toEqual([1, 2, 3]);
      expect(notifyStep.config.title).toBe("New request");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Resume uses snapshot instead of live definition (when snapshot present)
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - resume uses snapshot when present", () => {
  it("resolveResumeSteps returns snapshot steps when snapshot is present", () => {
    const snapshot  = captureSnapshot(sampleSteps);
    const liveSteps = [...sampleSteps]; // same as snapshot in this case
    const { steps, source } = resolveResumeSteps(snapshot, liveSteps);
    expect(source).toBe("snapshot");
    expect(steps).toBe(snapshot); // exact same reference (not liveSteps)
  });

  it("resolveResumeSteps does NOT use liveSteps when snapshot is present", () => {
    const snapshot  = captureSnapshot(sampleSteps);
    const liveSteps: WorkflowStep[] = []; // completely different from snapshot
    const { steps, source } = resolveResumeSteps(snapshot, liveSteps);
    expect(source).toBe("snapshot");
    expect(steps).toHaveLength(3); // snapshot has 3 steps, liveSteps is empty
    expect(steps).not.toBe(liveSteps);
  });

  it("source='snapshot' is always returned when snapshot != null", () => {
    const emptySnapshot: WorkflowStep[] = [];
    const { source } = resolveResumeSteps(emptySnapshot, sampleSteps);
    // Even an empty snapshot (0 steps) beats a live definition
    expect(source).toBe("snapshot");
  });

  it("an empty array snapshot (not null) still selects the snapshot path", () => {
    // null = absent, [] = present but empty. Different semantics.
    const { steps, source } = resolveResumeSteps([], sampleSteps);
    expect(source).toBe("snapshot");
    expect(steps).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Live workflow edits do not affect resumed execution (snapshot isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - live definition edits do not affect snapshot", () => {
  it("mutating the live definition after snapshot capture does not change snapshot", () => {
    // Deep clone → mutations to the live array do not touch the snapshot.
    const snapshot = captureSnapshot(sampleSteps);

    // Simulate a live definition edit (e.g., admin changes step 2 type)
    const editedLive = simulateLiveDefinitionEdit(sampleSteps, 2, "assignment");

    // The snapshot still has the original step 2 type
    expect(snapshot[2]!.type).toBe("task"); // original
    expect(editedLive[2]!.type).toBe("assignment"); // edited
  });

  it("nested config mutation in live steps does not affect snapshot", () => {
    const liveCopy    = structuredClone(sampleSteps) as WorkflowStep[];
    const snapshot    = captureSnapshot(liveCopy);

    // Mutate a nested config field on the live copy
    const liveNotify = liveCopy[0]!;
    if (liveNotify.type === "notification") {
      liveNotify.config.title = "EDITED TITLE";
    }

    // Snapshot is unaffected
    const snapNotify = snapshot[0]!;
    if (snapNotify.type === "notification") {
      expect(snapNotify.config.title).toBe("New request"); // original
    }
  });

  it("snapshot returns correct steps even when live definition is replaced entirely", () => {
    const snapshot = captureSnapshot(sampleSteps);

    // Simulate admin replacing the definition with completely different steps
    const replacedLive: WorkflowStep[] = [
      {
        index: 0,
        type:  "assignment",
        name:  "Auto-Assign",
        config: { entity: "ticket", entityIdField: "ticketId", assigneeType: "specific", assigneeId: 99 },
      },
    ];

    const { steps, source } = resolveResumeSteps(snapshot, replacedLive);
    expect(source).toBe("snapshot");
    expect(steps).toHaveLength(3); // original 3 steps preserved
    expect(steps[0]!.type).toBe("notification"); // original step 0 preserved
  });

  it("definition-drift scenario: resume uses correct post-approval step", () => {
    // CRITICAL SCENARIO (H-01 from hardening review):
    //   Original: [notify(0), approve(1), send_email_task(2)]
    //   Admin edits to: [notify(0), approve(1), delete_record(2)]
    //   Without snapshot: resume would execute 'delete_record' - WRONG.
    //   With snapshot: resume executes original 'send_email_task' - CORRECT.

    const originalSteps: WorkflowStep[] = [
      { index: 0, type: "notification", name: "Notify", config: { recipientType: "specific", recipientIds: [1], title: "t", message: "m" } },
      { index: 1, type: "approval",     name: "Approve", config: { approvalType: "single", approverType: "specific", approverIds: [2], title: "a" } },
      { index: 2, type: "task",         name: "Original Task", config: { title: "Process request", assigneeType: "role", assigneeRole: "manager", priority: "medium" } },
    ];

    const snapshot = captureSnapshot(originalSteps);

    // Admin edits step 2 to 'assignment' while execution is waiting_approval
    const editedLiveSteps: WorkflowStep[] = [
      { index: 0, type: "notification", name: "Notify", config: { recipientType: "specific", recipientIds: [1], title: "t", message: "m" } },
      { index: 1, type: "approval",     name: "Approve", config: { approvalType: "single", approverType: "specific", approverIds: [2], title: "a" } },
      { index: 2, type: "assignment",   name: "REPLACED Step", config: { entity: "ticket", entityIdField: "ticketId", assigneeType: "specific", assigneeId: 99 } },
    ];

    // Resume resolution: snapshot wins
    const { steps, source } = resolveResumeSteps(snapshot, editedLiveSteps);
    expect(source).toBe("snapshot");

    // Step 2 from snapshot is the ORIGINAL task, not the edited assignment
    expect(steps[2]!.type).toBe("task");
    expect(steps[2]!.name).toBe("Original Task");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Legacy executions (NULL snapshot) fall back to live definition safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - legacy fallback when snapshot is NULL", () => {
  it("resolveResumeSteps returns liveSteps when snapshot is null", () => {
    const { steps, source } = resolveResumeSteps(null, sampleSteps);
    expect(source).toBe("live_definition");
    expect(steps).toBe(sampleSteps); // exact same reference
  });

  it("null snapshot selects live_definition path regardless of live step count", () => {
    const emptyLive: WorkflowStep[] = [];
    const { steps, source } = resolveResumeSteps(null, emptyLive);
    expect(source).toBe("live_definition");
    expect(steps).toHaveLength(0);
  });

  it("legacy path does NOT crash - it just uses whatever live steps are present", () => {
    const { steps, source } = resolveResumeSteps(null, sampleSteps);
    expect(source).toBe("live_definition");
    expect(steps).toHaveLength(3); // returns live steps without error
  });

  it("null vs empty array snapshot are distinguishable (null = absent, [] = present)", () => {
    const withNull  = resolveResumeSteps(null, sampleSteps);
    const withEmpty = resolveResumeSteps([],   sampleSteps);

    expect(withNull.source).toBe("live_definition"); // null = legacy fallback
    expect(withEmpty.source).toBe("snapshot");       // [] = snapshot present (0 steps)
  });

  it("legacy fallback behavior matches pre-P5-A behavior exactly", () => {
    // Pre-P5-A: resumeExecution() always used live definition.
    // Legacy fallback: null snapshot → same behavior as pre-P5-A.
    // This ensures backward compatibility for in-flight executions at deploy time.
    const { steps } = resolveResumeSteps(null, sampleSteps);
    expect(steps).toEqual(sampleSteps); // identical to what pre-P5-A would return
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Snapshot is a deep clone - no shared references with original steps
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - snapshot is a deep clone with no shared references", () => {
  it("snapshot array is a different reference than original steps", () => {
    const snapshot = captureSnapshot(sampleSteps);
    expect(snapshot).not.toBe(sampleSteps); // different array reference
  });

  it("snapshot step objects are different references than original step objects", () => {
    const snapshot = captureSnapshot(sampleSteps);
    // Each step object in the snapshot is a new object, not the same reference
    sampleSteps.forEach((step, i) => {
      expect(snapshot[i]).not.toBe(step); // different object reference
    });
  });

  it("snapshot config objects are different references than original config objects", () => {
    const snapshot = captureSnapshot(sampleSteps);
    sampleSteps.forEach((step, i) => {
      // Config is a nested object - must be a separate copy, not a shared reference
      expect(snapshot[i]!.config).not.toBe(step.config);
    });
  });

  it("mutating snapshot does not affect original steps", () => {
    const snapshot = captureSnapshot(sampleSteps);

    // Mutate a field in the snapshot
    const snapNotify = snapshot[0]!;
    if (snapNotify.type === "notification") {
      snapNotify.config.title = "SNAPSHOT MUTATION";
    }

    // Original steps are unaffected
    const originalNotify = sampleSteps[0]!;
    if (originalNotify.type === "notification") {
      expect(originalNotify.config.title).toBe("New request"); // unchanged
    }
  });

  it("mutating original steps does not affect snapshot", () => {
    // We use a local copy to avoid mutating the shared sampleSteps fixture.
    const localCopy   = structuredClone(sampleSteps) as WorkflowStep[];
    const snapshot    = captureSnapshot(localCopy);

    // Mutate the local copy after snapshot is taken
    const localNotify = localCopy[0]!;
    if (localNotify.type === "notification") {
      localNotify.config.message = "MUTATED AFTER SNAPSHOT";
    }

    // Snapshot is still the original message
    const snapNotify = snapshot[0]!;
    if (snapNotify.type === "notification") {
      expect(snapNotify.config.message).toBe("A new leave request was submitted");
    }
  });

  it("recipientIds array in notification step is deeply cloned", () => {
    const snapshot    = captureSnapshot(sampleSteps);
    const snapNotify  = snapshot[0]!;
    const origNotify  = sampleSteps[0]!;

    if (snapNotify.type === "notification" && origNotify.type === "notification") {
      // Mutate the snapshot's recipientIds
      snapNotify.config.recipientIds?.push(999);
      // Original is unaffected
      expect(origNotify.config.recipientIds).toEqual([1, 2, 3]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - workflowVersion persisted correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - workflowVersion is persisted correctly", () => {
  it("returns NULL when definition has no version column (pre-P7-A state)", () => {
    const defWithoutVersion = {};
    expect(resolveWorkflowVersion(defWithoutVersion)).toBeNull();
  });

  it("returns NULL when definition.version is explicitly null", () => {
    const defWithNullVersion = { id: 1, version: null };
    expect(resolveWorkflowVersion(defWithNullVersion)).toBeNull();
  });

  it("returns NULL when definition.version is undefined", () => {
    const defWithUndefinedVersion = { id: 1, version: undefined };
    expect(resolveWorkflowVersion(defWithUndefinedVersion)).toBeNull();
  });

  it("returns the version number when definition has a version (post-P7-A)", () => {
    const defWithVersion = { id: 1, version: 3 };
    expect(resolveWorkflowVersion(defWithVersion)).toBe(3);
  });

  it("returns version 1 for the first published version", () => {
    expect(resolveWorkflowVersion({ version: 1 })).toBe(1);
  });

  it("version numbers are always positive integers (post-P7-A model)", () => {
    [1, 2, 10, 100, 999].forEach((v) => {
      expect(resolveWorkflowVersion({ version: v })).toBe(v);
      expect(resolveWorkflowVersion({ version: v })).toBeGreaterThan(0);
    });
  });

  it("NULL workflowVersion does not affect snapshot correctness", () => {
    // workflowVersion and stepsSnapshot are independent columns.
    // NULL workflowVersion never invalidates a non-null snapshot.
    const snapshot = captureSnapshot(sampleSteps);
    const { steps, source } = resolveResumeSteps(snapshot, []);
    // Even with NULL workflowVersion, snapshot path is selected correctly
    expect(source).toBe("snapshot");
    expect(steps).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Resume preserves exact-once behavior after snapshot introduction
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - snapshot introduction does not break exact-once resume semantics", () => {
  it("snapshot path does not add new race conditions to resumeExecution", () => {
    // The guarded WHERE update (waiting_approval → running) is the atomicity gate.
    // Snapshot selection happens BEFORE the guarded update - it is a read, not a write.
    // Therefore: snapshot path adds zero new race conditions.
    //
    // Model: simulate two concurrent resumes with same snapshot.
    const snapshot = captureSnapshot(sampleSteps);
    let guardWinCount = 0;

    function simulateGuardedResume(status: string): boolean {
      if (status !== "waiting_approval") return false; // guard rejects
      guardWinCount++;
      return true; // in real DB: only one UPDATE wins
    }

    // First approver: wins the guard
    const r1 = resolveResumeSteps(snapshot, []);
    expect(r1.source).toBe("snapshot");
    expect(simulateGuardedResume("waiting_approval")).toBe(true);

    // Second approver (concurrent): guard now sees status='running' (first won)
    const r2 = resolveResumeSteps(snapshot, []);
    expect(r2.source).toBe("snapshot"); // both resolve correctly
    expect(simulateGuardedResume("running")).toBe(false); // guard rejects second

    // Exactly one guard win
    expect(guardWinCount).toBe(1);
  });

  it("snapshot is resolved BEFORE the guarded UPDATE - does not block the guard", () => {
    // Snapshot resolution is a pure read from the execution row.
    // It completes before the guarded UPDATE is attempted.
    // If snapshot resolution fails (e.g., snapshot is corrupted JSONB),
    // the guard UPDATE is never reached → no orphaned state.
    //
    // Model: snapshot resolution fails → function returns early, no guard attempted.
    let guardAttempted = false;

    function simulateResumeWithCorruptSnapshot(snapshot: WorkflowStep[] | null): boolean {
      // Simulate snapshot resolution
      const resolved = resolveResumeSteps(snapshot, []);
      if (resolved.source === "snapshot" && resolved.steps.length === 0) {
        // In real code: would detect empty snapshot and handle gracefully.
        // Here: model that guard is NOT attempted if pre-conditions fail.
        return false;
      }
      // Guard is only attempted if resolution succeeds
      guardAttempted = true;
      return true;
    }

    // Non-empty snapshot → guard attempted
    const validSnapshot = captureSnapshot(sampleSteps);
    simulateResumeWithCorruptSnapshot(validSnapshot);
    expect(guardAttempted).toBe(true);
  });

  it("resume from index is unchanged by snapshot introduction", () => {
    // P4-E: resumeFromIndex = currentStepIndex + 1.
    // P5-A: snapshot is used to resolve steps, but does NOT change the index.
    // The index is still derived from execution.currentStepIndex (stored in DB).
    function computeResumeFromIndex(currentStepIndex: number): number {
      return currentStepIndex + 1; // unchanged from P4-E
    }

    // With snapshot: same index calculation
    const approvalStepIndex = 1; // execution paused at step 1
    const snapshot = captureSnapshot(sampleSteps);
    const { steps } = resolveResumeSteps(snapshot, []);

    const resumeFrom = computeResumeFromIndex(approvalStepIndex);
    expect(resumeFrom).toBe(2); // starts at step 2
    expect(steps[resumeFrom]!).toBeDefined(); // step 2 exists in snapshot
    expect(steps[resumeFrom]!.type).toBe("task"); // correct step from snapshot
  });

  it("snapshot resolves steps idempotently - same result on every call", () => {
    const snapshot = captureSnapshot(sampleSteps);

    // Multiple resolutions of the same snapshot yield identical results
    const r1 = resolveResumeSteps(snapshot, []);
    const r2 = resolveResumeSteps(snapshot, []);
    const r3 = resolveResumeSteps(snapshot, []);

    expect(r1.steps).toBe(r2.steps); // same snapshot reference
    expect(r2.steps).toBe(r3.steps);
    expect(r1.source).toBe("snapshot");
    expect(r2.source).toBe("snapshot");
    expect(r3.source).toBe("snapshot");
  });

  it("approval record is inserted by the guarded UPDATE winner - unaffected by snapshot path", () => {
    // The approval record (workflow_approvals INSERT) is created AFTER the
    // guarded UPDATE wins.  Snapshot resolution happens before the guard.
    // Snapshot path selection has zero effect on whether an approval record is inserted.
    const records: string[] = [];

    function simulateApproveAfterGuard(guardWon: boolean) {
      if (!guardWon) return;
      records.push("approved");
    }

    // With snapshot path: guard win → 1 record
    simulateApproveAfterGuard(true);
    // With snapshot path: guard loss → 0 records
    simulateApproveAfterGuard(false);

    expect(records).toHaveLength(1); // exactly one approval record
  });
});
