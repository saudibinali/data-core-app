/**
 * @file        workflows/context.ts
 * @purpose     Pure utility functions for ExecutionContext construction and
 *              step-output management (P4-A: Context Isolation).
 *
 * ── WHY THIS FILE EXISTS (WG-15 fix) ─────────────────────────────────────────
 *
 * The original executor merged ALL step outputs into a single mutable flat map:
 *
 *   ctx.resolvedData = { ...ctx.resolvedData, ...result.output }
 *
 * This caused silent context pollution between steps:
 *
 *   • Step N outputs { status: "skipped" }
 *     → Step N+2 reads ctx.resolvedData.status and gets "skipped" instead of
 *       the ticket status it expected from triggerData. No error is thrown.
 *
 *   • Notification step outputs { recipientIds: [1,2,3] }
 *     → Assignment step reads data.recipientIds - never intended for it.
 *
 *   • Condition step outputs { nextSteps: [4], conditionResult: true }
 *     → All subsequent steps see nextSteps in their data context, which is
 *       meaningless to them and could collide with their own config keys.
 *
 * ── SOLUTION: NAMESPACED STEP OUTPUTS ────────────────────────────────────────
 *
 * Each step stores its output under its own index key:
 *
 *   ctx.stepOutputs[step.index] = result.output
 *
 * This means:
 *   • Step 0's { status: "skipped" } lives at stepOutputs[0].status - isolated.
 *   • Step 3's { assigneeId: 7 } lives at stepOutputs[3].assigneeId - isolated.
 *   • No key from Step A can overwrite a key from Step B in a hidden way.
 *
 * ── BACKWARD COMPATIBILITY ────────────────────────────────────────────────────
 *
 * All 6 existing step handlers read ctx.resolvedData (flat map).
 * NONE of them are changed in Phase 4.
 *
 * buildResolvedData() recomputes the flat view from stepOutputs after each
 * step completes.  The executor stores the result back into ctx.resolvedData
 * so handlers continue to read it exactly as before.
 *
 * Merge order is deterministic (ascending step index), matching the old
 * linear-merge behavior: later steps can shadow earlier steps' keys.
 *
 * ── MIGRATION PATH ────────────────────────────────────────────────────────────
 *
 *   Phase 4 (now): stepOutputs namespaced; resolvedData recomputed from it.
 *                  Zero changes to step handlers. (this file)
 *   Phase 6:       Step handlers updated to read ctx.stepOutputs[i] directly
 *                  when they need a specific prior step's output. resolvedData
 *                  marked @deprecated.
 *   Phase 7:       resolvedData removed. Handlers use explicit stepOutputs refs.
 */

import type { ExecutionContext } from "./types";

/**
 * Builds the backward-compatible flat resolvedData map from the namespaced
 * stepOutputs record.
 *
 * Steps are merged in ascending index order so that:
 *   - Lower-indexed step outputs appear first in the merged result.
 *   - Higher-indexed step outputs shadow lower ones on key collision -
 *     matching the old linear-merge behavior where ctx.resolvedData was
 *     overwritten left-to-right as each step completed.
 *
 * Safety guarantees:
 *   - Empty stepOutputs → returns {} (no throw).
 *   - Undefined or null output for any step → treated as {} (no throw).
 *   - Steps with identical indices (impossible in a valid config, but defensive)
 *     → last-write-wins per the sort order.
 *
 * @param stepOutputs  Namespaced map of step.index → step output POJO.
 * @returns            Flat merged key-value map in step index order.
 */
export function buildResolvedData(
  stepOutputs: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
  return Object.entries(stepOutputs)
    .sort(([a], [b]) => Number(a) - Number(b))
    .reduce<Record<string, unknown>>(
      (acc, [, out]) => ({ ...acc, ...(out ?? {}) }),
      {},
    );
}

/**
 * Creates a fully initialized ExecutionContext for a new workflow execution.
 *
 * Key safety properties:
 *   - triggerData is deep-cloned via structuredClone so that mutations to
 *     nested objects inside step handlers cannot affect the original event
 *     payload or be observed by other concurrent executions.
 *   - stepOutputs starts empty - populated by the executor as steps complete.
 *   - resolvedData starts empty - recomputed by the executor after each step.
 *
 * @param triggerEvent   Event type string that caused this execution.
 * @param triggerData    Raw payload from the triggering event (will be cloned).
 * @param workspaceId    Tenant identifier for workspace isolation.
 * @param triggeredBy    Optional user ID of the actor who caused the event.
 */
export function createExecutionContext(
  triggerEvent: string,
  triggerData: Record<string, unknown>,
  workspaceId: number,
  triggeredBy?: number,
): ExecutionContext {
  return {
    triggerEvent,
    // P4-A: Deep clone so no step handler can mutate the original event payload
    // or cause cross-step pollution through shared nested object references.
    triggerData: structuredClone(triggerData),
    workspaceId,
    triggeredBy,
    // P4-A: Namespaced step outputs - each step writes to its own index slot.
    stepOutputs: {},
    // P4-A: Backward-compat flat view - recomputed from stepOutputs after each step.
    resolvedData: {},
  };
}
