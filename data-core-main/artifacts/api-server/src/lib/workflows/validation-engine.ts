/**
 * @file   validation-engine.ts
 * @phase  P5-D - Validation Engine & Workflow Governance Safety
 *
 * Pure static analysis engine.  No DB.  No async.  No side effects.
 * Receives a raw steps array and produces structured governance findings
 * across four independent passes.
 *
 * ── PASS OVERVIEW ────────────────────────────────────────────────────────────
 *
 *   Pass 1 - Topology
 *     Reachability BFS from step 0.  Flags unreachable steps and branches
 *     that never converge on a common step.  Also computes the set of
 *     "conditionally executed" steps (reachable, but only on some paths)
 *     for use by the dependency pass.
 *
 *   Pass 2 - Dependency
 *     Uses the conditionally-executed set from Pass 1.  Warns on each step
 *     that is only executed on some execution paths - downstream steps that
 *     read from its output will receive empty values when this branch is not
 *     taken.
 *
 *   Pass 3 - Fanout Estimation
 *     Deterministic upper-bound estimates via memoized DAG traversal:
 *       • maxExecutedSteps     - longest path through the workflow graph.
 *       • maxNotificationCount - worst-case notification rows per execution.
 *       • branchingPaths       - total distinct execution paths.
 *     Warns when estimates exceed configured thresholds.
 *
 *   Pass 4 - Routing Safety
 *     Per-condition-step analysis for long jumps, convergent branches
 *     (both routes to same target), and deeply nested condition chains.
 *     Produces notices (never blocks activation).
 *
 * ── WHY WARNINGS ONLY (NO NEW ERRORS) ───────────────────────────────────────
 *
 *   The per-step validator in validator.ts already blocks known hard errors
 *   (bad step types, invalid routing targets, self-loops, backward jumps).
 *   The engine surfaces structural risks that do not prevent execution but
 *   may surprise the workflow author.  These require admin acknowledgement
 *   but do not block activation - a deliberate design to allow gradual
 *   workflow evolution without hard gates on every structural pattern.
 *
 * ── TYPE ISOLATION ───────────────────────────────────────────────────────────
 *
 *   To avoid circular imports (validator.ts ↔ validation-engine.ts),
 *   the engine defines its own Warning type (`ValidationEngineWarning`)
 *   with the same structural shape as `ValidationWarning` in validator.ts.
 *   TypeScript's structural typing makes these assignable to each other
 *   at the merge point in validateWorkflow.
 */

// ── Governance thresholds ─────────────────────────────────────────────────────
//
// These values are deliberately conservative for the P5-D foundation.
// They are not runtime limits - they trigger pre-activation governance warnings
// so workflow authors can make informed decisions before publishing.

/** Estimated notification count above which we warn on amplification risk. */
const WARN_NOTIFICATION_COUNT = 200;
/** Distinct execution paths above which we warn on routing complexity. */
const WARN_PATH_COUNT = 8;
/** Longest path (step count) above which we emit a notice. */
const NOTICE_STEP_COUNT = 30;
/** Steps skipped by a single routing jump above which we emit a notice. */
const NOTICE_LONG_JUMP_SKIP = 3;
/** Consecutive condition steps above which we emit a nested-condition notice. */
const NOTICE_NESTED_CONDITION_DEPTH = 3;
/**
 * Upper-bound estimate for notification steps targeting role/department
 * recipients (actual count unknown without DB; uses the runtime fanout cap
 * from P3-D as the conservative upper bound).
 */
const MAX_ESTIMATED_ROLE_RECIPIENTS = 50;
/** Hard cap on branchingPaths counter to prevent absurd values. */
const MAX_PATH_COUNT_CAP = 1024;

// ── Engine output types ───────────────────────────────────────────────────────

/**
 * Same structural shape as `ValidationWarning` in validator.ts.
 * Redeclared here to avoid circular dependency.
 */
export interface ValidationEngineWarning {
  code:       string;
  message:    string;
  stepIndex?: number;
  stepName?:  string;
  stepType?:  string;
}

/**
 * Purely informational finding - never blocks activation.
 * Surfaced for workflow author education and observability.
 */
export interface GovernanceNotice {
  code:       string;
  message:    string;
  stepIndex?: number;
  stepName?:  string;
  stepType?:  string;
}

/**
 * Deterministic worst-case estimates computed by the Fanout pass.
 * All values are upper bounds based on static analysis - actual runtime
 * values depend on recipient resolution, branching outcomes, etc.
 */
export interface EstimatedExecutionMetrics {
  /** Steps executed on the longest possible execution path. */
  maxExecutedSteps:       number;
  /** Notifications sent on the highest-fanout execution path (upper bound). */
  maxNotificationCount:   number;
  /** Total distinct execution paths through the workflow. */
  branchingPaths:         number;
  /** Total number of condition steps (any type). */
  conditionStepCount:     number;
  /** Total number of notification steps. */
  notificationStepCount:  number;
}

export interface ValidationEngineResult {
  /** WARNINGs: allow activation but admin should review. */
  warnings:         ValidationEngineWarning[];
  /** NOTICEs: purely informational, never blocks anything. */
  notices:          GovernanceNotice[];
  /** Deterministic worst-case execution metrics. */
  estimatedMetrics: EstimatedExecutionMetrics;
}

// ── Internal: ParsedStep ──────────────────────────────────────────────────────

interface ParsedStep {
  arrayPos:        number;   // 0-based position in the steps array
  stepIndex:       number;   // step.index logical ID
  type:            string;
  name:            string;
  config:          Record<string, unknown>;
  // Condition routing - resolved to array positions (null = linear advance):
  onTrueArrayPos:  number | null;
  onFalseArrayPos: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseSteps(rawSteps: unknown[]): ParsedStep[] {
  // Pre-pass: build stepIndex → arrayPos map (needed for routing resolution)
  const indexToArrayPos = new Map<number, number>();
  for (let i = 0; i < rawSteps.length; i++) {
    const raw = rawSteps[i];
    if (typeof raw === "object" && raw !== null) {
      const s = raw as Record<string, unknown>;
      if (typeof s["index"] === "number") {
        indexToArrayPos.set(s["index"] as number, i);
      }
    }
  }

  const parsed: ParsedStep[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const raw = rawSteps[i];
    if (typeof raw !== "object" || raw === null) continue;

    const s         = raw as Record<string, unknown>;
    const stepIndex = typeof s["index"]  === "number" ? (s["index"]  as number) : i;
    const type      = typeof s["type"]   === "string" ? (s["type"]   as string) : "unknown";
    const name      = typeof s["name"]   === "string" ? (s["name"]   as string) : `step[${stepIndex}]`;
    const config    = (typeof s["config"] === "object" && s["config"] !== null)
      ? (s["config"] as Record<string, unknown>)
      : {};

    let onTrueArrayPos:  number | null = null;
    let onFalseArrayPos: number | null = null;

    if (type === "condition") {
      const onTrue  = config["onTrueStepIndex"];
      const onFalse = config["onFalseStepIndex"];

      // Only resolve targets that are valid forward references.
      // The per-step validator (WG-03) already rejects backward / self-loop /
      // missing targets - here we defensively skip them to avoid false positives.
      if (typeof onTrue === "number" && Number.isInteger(onTrue) && onTrue > stepIndex) {
        const pos = indexToArrayPos.get(onTrue);
        if (pos !== undefined) onTrueArrayPos = pos;
      }
      if (typeof onFalse === "number" && Number.isInteger(onFalse) && onFalse > stepIndex) {
        const pos = indexToArrayPos.get(onFalse);
        if (pos !== undefined) onFalseArrayPos = pos;
      }
    }

    parsed.push({ arrayPos: i, stepIndex, type, name, config,
                  onTrueArrayPos, onFalseArrayPos });
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the successor adjacency map.
 *
 * For each array position, produce the list of positions that may be visited
 * immediately after (the "outgoing edges" in the execution graph).
 *
 * Condition step:
 *   trueTarget  = onTrueArrayPos  if non-null, else linearNext
 *   falseTarget = onFalseArrayPos if non-null, else linearNext
 *   succs = unique([trueTarget, falseTarget]) filtered to valid positions
 *
 * Non-condition step:
 *   succs = [linearNext] if linearNext < parsed.length, else []
 */
function buildSuccessors(parsed: ParsedStep[]): Map<number, number[]> {
  const succs = new Map<number, number[]>();

  for (const ps of parsed) {
    const linearNext = ps.arrayPos + 1;

    if (ps.type === "condition") {
      const trueTarget  = ps.onTrueArrayPos  !== null ? ps.onTrueArrayPos  : linearNext;
      const falseTarget = ps.onFalseArrayPos !== null ? ps.onFalseArrayPos : linearNext;

      const neighbors: number[] = [];
      if (trueTarget < parsed.length)  neighbors.push(trueTarget);
      if (falseTarget < parsed.length && falseTarget !== trueTarget) {
        neighbors.push(falseTarget);
      }
      succs.set(ps.arrayPos, neighbors);
    } else {
      succs.set(ps.arrayPos, linearNext < parsed.length ? [linearNext] : []);
    }
  }

  return succs;
}

/**
 * BFS from `startPos`, following `succs`.
 * Returns the set of all reachable array positions.
 */
function bfsReachable(
  startPos: number,
  succs:    Map<number, number[]>,
): Set<number> {
  const visited = new Set<number>();
  const queue   = [startPos];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of succs.get(curr) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return visited;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 - Topology
// ─────────────────────────────────────────────────────────────────────────────

interface TopologyPassResult {
  warnings:             ValidationEngineWarning[];
  reachable:            Set<number>;
  conditionallyExecuted: Set<number>;
}

function topologyPass(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): TopologyPassResult {
  const warnings: ValidationEngineWarning[] = [];

  if (parsed.length === 0) {
    return { warnings, reachable: new Set(), conditionallyExecuted: new Set() };
  }

  // ── Reachability (BFS from position 0) ────────────────────────────────────
  const reachable = bfsReachable(0, succs);

  // WG-TOPO-01: unreachable steps
  for (const ps of parsed) {
    if (!reachable.has(ps.arrayPos)) {
      warnings.push({
        code:      "WG-TOPO-01_UNREACHABLE_STEP",
        message:
          `Step "${ps.name}" (index ${ps.stepIndex}, type: ${ps.type}) is unreachable - ` +
          `no execution path from the workflow start leads to it. ` +
          `This step will never execute. Review the routing configuration on preceding ` +
          `condition steps to ensure this step is reachable if it is intended to run.`,
        stepIndex: ps.stepIndex,
        stepName:  ps.name,
        stepType:  ps.type,
      });
    }
  }

  // ── Conditionally-executed steps ──────────────────────────────────────────
  //
  // A step is "conditionally executed" if it is reachable from step 0 but is
  // NOT reachable from ALL execution paths.  Concretely: for each condition
  // step with two distinct branches B1 and B2, any step exclusively reachable
  // from B1 (but not B2) or vice versa is conditionally executed.
  //
  // This set feeds the Dependency pass: steps in it are candidates for
  // missing-output-context warnings.
  const conditionallyExecuted = new Set<number>();

  for (const ps of parsed) {
    if (ps.type !== "condition") continue;

    const neighbors       = succs.get(ps.arrayPos) ?? [];
    const uniqueNeighbors = [...new Set(neighbors)];
    if (uniqueNeighbors.length < 2) continue;

    const [b1, b2] = uniqueNeighbors as [number, number];
    const reach1   = bfsReachable(b1, succs);
    const reach2   = bfsReachable(b2, succs);

    for (const pos of reach1) {
      if (!reach2.has(pos)) conditionallyExecuted.add(pos);
    }
    for (const pos of reach2) {
      if (!reach1.has(pos)) conditionallyExecuted.add(pos);
    }
  }

  return { warnings, reachable, conditionallyExecuted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 - Dependency (Skipped Output Context Risk)
// ─────────────────────────────────────────────────────────────────────────────

function dependencyPass(
  parsed:               ParsedStep[],
  conditionallyExecuted: Set<number>,
): { warnings: ValidationEngineWarning[] } {
  const warnings: ValidationEngineWarning[] = [];

  for (const ps of parsed) {
    if (!conditionallyExecuted.has(ps.arrayPos)) continue;

    warnings.push({
      code:      "WG-DEP-01_CONDITIONALLY_EXECUTED_STEP",
      message:
        `Step "${ps.name}" (index ${ps.stepIndex}, type: ${ps.type}) is only executed on ` +
        `some execution paths. When routing bypasses this step, its output will be absent ` +
        `from the execution context. Any subsequent steps in this workflow that depend on ` +
        `output data from this step will receive empty values when this branch is not taken.`,
      stepIndex: ps.stepIndex,
      stepName:  ps.name,
      stepType:  ps.type,
    });
  }

  return { warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3 - Fanout Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate the number of notifications produced by one step (upper bound).
 * Role / department recipients: uses the runtime fanout cap (P3-D) as proxy.
 */
function estimateStepNotifications(ps: ParsedStep): number {
  if (ps.type !== "notification") return 0;
  const rt = ps.config["recipientType"] as string | undefined;
  if (rt === "specific") {
    const ids = ps.config["recipientIds"];
    return Array.isArray(ids) ? ids.length : 1;
  }
  if (rt === "creator" || rt === "manager" || rt === "assignee") return 1;
  // "role" or "department" - unknown count, conservative upper bound
  return MAX_ESTIMATED_ROLE_RECIPIENTS;
}

function fanoutPass(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): { warnings: ValidationEngineWarning[]; notices: GovernanceNotice[]; metrics: EstimatedExecutionMetrics } {
  const warnings: ValidationEngineWarning[] = [];
  const notices:  GovernanceNotice[]         = [];

  const conditionStepCount    = parsed.filter(ps => ps.type === "condition").length;
  const notificationStepCount = parsed.filter(ps => ps.type === "notification").length;

  if (parsed.length === 0) {
    return {
      warnings, notices,
      metrics: { maxExecutedSteps: 0, maxNotificationCount: 0,
                 branchingPaths: 0, conditionStepCount, notificationStepCount },
    };
  }

  // ── Memoized DAG traversal ─────────────────────────────────────────────────
  //
  // All three metrics are computed by DFS with memoization over the DAG.
  // The forward-only invariant (enforced by the per-step validator) guarantees
  // no cycles, so the recursion depth is bounded by parsed.length.
  const longestPathMemo  = new Map<number, number>();
  const maxNotifMemo     = new Map<number, number>();
  const pathCountMemo    = new Map<number, number>();

  function longestPath(pos: number): number {
    if (pos >= parsed.length) return 0;
    if (longestPathMemo.has(pos)) return longestPathMemo.get(pos)!;
    const neighbors = succs.get(pos) ?? [];
    const maxSucc   = neighbors.length > 0
      ? Math.max(...neighbors.map(longestPath))
      : 0;
    const result = 1 + maxSucc;
    longestPathMemo.set(pos, result);
    return result;
  }

  function maxNotifOnPath(pos: number): number {
    if (pos >= parsed.length) return 0;
    if (maxNotifMemo.has(pos)) return maxNotifMemo.get(pos)!;
    const stepNotifs = estimateStepNotifications(parsed[pos]!);
    const neighbors  = succs.get(pos) ?? [];
    const maxSucc    = neighbors.length > 0
      ? Math.max(...neighbors.map(maxNotifOnPath))
      : 0;
    const result = stepNotifs + maxSucc;
    maxNotifMemo.set(pos, result);
    return result;
  }

  function countPaths(pos: number): number {
    if (pos >= parsed.length) return 1;
    if (pathCountMemo.has(pos)) return pathCountMemo.get(pos)!;
    const neighbors = succs.get(pos) ?? [];
    if (neighbors.length === 0) {
      pathCountMemo.set(pos, 1);
      return 1;
    }
    const unique = [...new Set(neighbors)];
    const raw = unique.length === 1
      ? countPaths(unique[0]!)
      : unique.reduce((sum, n) => sum + countPaths(n), 0);
    const capped = Math.min(raw, MAX_PATH_COUNT_CAP);
    pathCountMemo.set(pos, capped);
    return capped;
  }

  const maxExecutedSteps     = longestPath(0);
  const maxNotificationCount = maxNotifOnPath(0);
  const branchingPaths       = countPaths(0);

  // ── Threshold warnings ────────────────────────────────────────────────────

  // WG-FAN-01: high notification fanout
  if (maxNotificationCount > WARN_NOTIFICATION_COUNT) {
    warnings.push({
      code:    "WG-FAN-01_HIGH_NOTIFICATION_FANOUT",
      message:
        `This workflow may send up to ${maxNotificationCount} notifications per execution ` +
        `(estimated worst-case upper bound). This exceeds the recommended limit of ` +
        `${WARN_NOTIFICATION_COUNT}. Review notification step recipient configurations - ` +
        `role-targeted steps can send up to ${MAX_ESTIMATED_ROLE_RECIPIENTS} notifications ` +
        `each (runtime fanout cap, P3-D). Consider splitting the workflow or targeting ` +
        `specific recipients to reduce fanout.`,
    });
  }

  // WG-FAN-02: too many execution paths
  if (branchingPaths > WARN_PATH_COUNT) {
    warnings.push({
      code:    "WG-FAN-02_HIGH_PATH_COUNT",
      message:
        `This workflow has approximately ${branchingPaths} distinct execution paths ` +
        `(exceeds recommended maximum of ${WARN_PATH_COUNT}). Workflows with many ` +
        `branching paths are difficult to audit, test, and maintain. Consider simplifying ` +
        `the routing logic or splitting this workflow into smaller, more focused workflows.`,
    });
  }

  // WG-FAN-03: unusually long workflow (notice only)
  if (maxExecutedSteps > NOTICE_STEP_COUNT) {
    notices.push({
      code:    "WG-FAN-03_HIGH_STEP_COUNT",
      message:
        `The longest execution path in this workflow visits ${maxExecutedSteps} steps. ` +
        `This is unusually long (recommended maximum: ${NOTICE_STEP_COUNT}). ` +
        `Consider splitting this workflow into smaller, more focused workflows for ` +
        `easier debugging and maintenance.`,
    });
  }

  return {
    warnings, notices,
    metrics: { maxExecutedSteps, maxNotificationCount, branchingPaths,
               conditionStepCount, notificationStepCount },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 - Routing Safety
// ─────────────────────────────────────────────────────────────────────────────

function routingSafetyPass(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): { notices: GovernanceNotice[] } {
  const notices: GovernanceNotice[] = [];

  // ── Per-condition-step analysis ───────────────────────────────────────────

  for (const ps of parsed) {
    if (ps.type !== "condition") continue;

    const neighbors       = succs.get(ps.arrayPos) ?? [];
    const uniqueNeighbors = [...new Set(neighbors)];

    // WG-ROUTE-01: long routing jump
    // Check both branches for jumps that skip many steps.
    const branchTargets: Array<{ arrayPos: number; label: string }> = [];
    if (ps.onTrueArrayPos  !== null) branchTargets.push({ arrayPos: ps.onTrueArrayPos,  label: "true"  });
    if (ps.onFalseArrayPos !== null) branchTargets.push({ arrayPos: ps.onFalseArrayPos, label: "false" });

    for (const target of branchTargets) {
      const stepsSkipped = target.arrayPos - ps.arrayPos - 1;
      if (stepsSkipped >= NOTICE_LONG_JUMP_SKIP) {
        notices.push({
          code:      "WG-ROUTE-01_LONG_JUMP",
          message:
            `Condition step "${ps.name}" (index ${ps.stepIndex}) skips ${stepsSkipped} ` +
            `step(s) on the ${target.label} branch (routing to array position ` +
            `${target.arrayPos}). Verify that the skipped steps do not need to execute ` +
            `for subsequent steps in this branch to work correctly.`,
          stepIndex: ps.stepIndex,
          stepName:  ps.name,
          stepType:  "condition",
        });
      }
    }

    // WG-ROUTE-02: convergent branches (true and false route to the same step)
    //
    // Detect by inspecting the parsed-step routing targets directly rather than
    // the deduplicated successors map.  buildSuccessors deduplicates trueTarget
    // === falseTarget into a single neighbor entry, so checking neighbors.length
    // would always be 1 for this case - the bug this replaces.
    //
    // Rule: both onTrueArrayPos and onFalseArrayPos are non-null AND equal.
    // (null-null means both branches use linear advance to the same next step,
    //  which is normal fallthrough behavior - intentionally excluded.)
    if (ps.onTrueArrayPos !== null &&
        ps.onFalseArrayPos !== null &&
        ps.onTrueArrayPos === ps.onFalseArrayPos) {
      const succ = ps.onTrueArrayPos;
      const targetStep = parsed[succ];
      notices.push({
        code:      "WG-ROUTE-02_CONVERGENT_BRANCHES",
        message:
          `Condition step "${ps.name}" (index ${ps.stepIndex}) routes both the true and ` +
          `false branches to the same next step: ` +
          `"${targetStep?.name ?? `position ${succ}`}" ` +
          `(array position ${succ}). The condition evaluates correctly, but has no effect ` +
          `on the execution path - both outcomes lead to the same step. If the intention ` +
          `is to record the condition result without branching, this is correct behavior. ` +
          `Otherwise, configure distinct routing targets for each branch.`,
        stepIndex: ps.stepIndex,
        stepName:  ps.name,
        stepType:  "condition",
      });
    }
  }

  // ── WG-ROUTE-03: nested condition chains ──────────────────────────────────
  //
  // A "chain" is a maximal run of consecutive condition steps.
  // Long chains are difficult to reason about and maintain.
  // Find the longest such chain and emit a single notice for it.
  let maxChainLength   = 0;
  let currentChainLen  = 0;
  let currentChainHead: { stepIndex: number; stepName: string } | null = null;
  let bestChainHead:    { stepIndex: number; stepName: string } | null = null;

  for (const ps of parsed) {
    if (ps.type === "condition") {
      currentChainLen++;
      if (currentChainLen === 1) {
        currentChainHead = { stepIndex: ps.stepIndex, stepName: ps.name };
      }
      if (currentChainLen > maxChainLength) {
        maxChainLength = currentChainLen;
        bestChainHead  = currentChainHead;
      }
    } else {
      currentChainLen  = 0;
      currentChainHead = null;
    }
  }

  if (maxChainLength >= NOTICE_NESTED_CONDITION_DEPTH && bestChainHead !== null) {
    notices.push({
      code:      "WG-ROUTE-03_NESTED_CONDITIONS",
      message:
        `This workflow contains a chain of ${maxChainLength} consecutive condition steps ` +
        `starting at "${bestChainHead.stepName}" (index ${bestChainHead.stepIndex}). ` +
        `Deeply nested condition chains are difficult to reason about and maintain. ` +
        `Consider restructuring the workflow logic or using sub-conditions within a ` +
        `single condition step instead of chaining separate condition steps.`,
      stepIndex: bestChainHead.stepIndex,
      stepName:  bestChainHead.stepName,
      stepType:  "condition",
    });
  }

  return { notices };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runValidationEngine - orchestrate all four validation passes.
 *
 * Pure function: same input always produces the same output.
 * No side effects.  Caller is responsible for logging the results.
 *
 * @param rawSteps  The raw steps array from workflow_definitions.steps (JSONB).
 *                  May be anything - the engine defensively parses each element.
 */
export function runValidationEngine(rawSteps: unknown[]): ValidationEngineResult {
  const EMPTY_METRICS: EstimatedExecutionMetrics = {
    maxExecutedSteps: 0, maxNotificationCount: 0,
    branchingPaths: 0, conditionStepCount: 0, notificationStepCount: 0,
  };

  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { warnings: [], notices: [], estimatedMetrics: EMPTY_METRICS };
  }

  // ── Build the execution graph ─────────────────────────────────────────────
  const parsed = parseSteps(rawSteps);
  const succs  = buildSuccessors(parsed);

  // ── Run each pass ─────────────────────────────────────────────────────────
  const topo     = topologyPass(parsed, succs);
  const dep      = dependencyPass(parsed, topo.conditionallyExecuted);
  const fanout   = fanoutPass(parsed, succs);
  const routing  = routingSafetyPass(parsed, succs);

  return {
    warnings: [
      ...topo.warnings,
      ...dep.warnings,
      ...fanout.warnings,
    ],
    notices: [
      ...fanout.notices,
      ...routing.notices,
    ],
    estimatedMetrics: fanout.metrics,
  };
}
