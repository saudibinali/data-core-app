/**
 * @file        workflows/steps/condition.ts
 * @purpose     Evaluate a condition group and signal deterministic routing.
 *
 * ── P5-C: Condition Routing & Safe Branch Traversal ─────────────────────────
 *
 * executeConditionStep evaluates step.config.conditions against the merged
 * execution data and returns:
 *
 *   output.matched             - boolean: whether conditions evaluated to true.
 *   output.selectedNextStepIndex - the step.index that was selected for routing
 *                                  (null if routing was not configured for the
 *                                  matched branch).
 *
 * When onTrueStepIndex / onFalseStepIndex is non-null for the matched branch,
 * the result also carries `nextStepIndex` - the routing signal consumed by
 * runStepLoop in executor.ts.  The executor validates the target and jumps.
 *
 * When both routing targets are null (audit-only condition step), nextStepIndex
 * is absent from the result and the executor continues linearly.
 *
 * ── Safety contract ──────────────────────────────────────────────────────────
 * This handler NEVER validates routing targets.  All routing safety rules
 * (forward-only, target must exist, no self-loop) are enforced exclusively
 * by runStepLoop in executor.ts so the enforcement lives in one place.
 */

import { evaluateConditions } from "../conditions";
import type { ConditionStep, ExecutionContext, StepResult } from "../types";

export async function executeConditionStep(
  step: ConditionStep,
  ctx: ExecutionContext,
): Promise<StepResult> {
  const data = { ...ctx.triggerData, ...ctx.resolvedData };

  // Evaluate the condition group against the merged trigger + resolved data.
  const matched = evaluateConditions(step.config.conditions, data);

  // Select the routing target for the matched branch.
  // null  → no routing configured; executor will advance linearly.
  // number → executor will validate and jump to this step.index.
  const selectedNextStepIndex: number | null = matched
    ? step.config.onTrueStepIndex
    : step.config.onFalseStepIndex;

  const result: StepResult = {
    success: true,
    output: {
      // P5-C: surface the evaluation result and selected route in step output
      // so diagnostics / audit timelines can display the branching decision.
      matched,
      selectedNextStepIndex,
      // Legacy field kept for backward compatibility with any code that reads
      // step output by name (pre-P5-C callers expected nextSteps: number[]).
      // Deprecated: remove in Phase 7 when legacy readers are updated.
      nextSteps: selectedNextStepIndex !== null ? [selectedNextStepIndex] : [],
    },
  };

  // Only set nextStepIndex when a routing target was actually configured.
  // Absence of this field tells runStepLoop to continue linearly - it must
  // NOT default to 0 or any other value on undefined.
  if (selectedNextStepIndex !== null) {
    result.nextStepIndex = selectedNextStepIndex;
  }

  return result;
}
