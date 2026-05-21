/**
 * @file   lib/workflows/topology.ts
 * @phase  P8-A - Workflow Topology Intelligence & Structural Analytics Foundations
 *
 * Pure static topology intelligence engine.
 * No DB, no async, no side effects, no runtime execution dependencies.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   analyzeTopology(rawSteps, context?) → WorkflowTopologyResult
 *
 *   Internally:
 *     1. parseSteps          - normalize raw step JSONB into ParsedStep[]
 *     2. buildSuccessorMap   - directed adjacency map (arrayPos → arrayPos[])
 *     3. buildEdges          - labelled edge list (linear / true_branch / false_branch)
 *     4. bfsReachable        - BFS from arrayPos=0 → reachable set
 *     5. findIsolatedSubgraphs - connected components disconnected from main
 *     6. extractWorkflowTopology - assemble WorkflowTopologyGraph
 *     7. topoSort            - Kahn's BFS topological order (DAG)
 *     8. computeMaxBranchDepth - DP: longest consecutive condition chain
 *     9. computeLongestPath  - DP: max node count on any path
 *    10. computeTerminalPathCount - DP: distinct execution paths (capped)
 *    11. computeConditionallyExecutedCount - nodes on some but not all paths
 *    12. computeTopologyAnalytics - aggregate analytics struct
 *    13. assessTopologyRisk  - rule-based risk classification
 *    14. Emit 4 structured observability events via logger
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates workflow definitions.
 *   Never invokes runtime execution, scheduler, executor, or DB.
 *   The safety guarantee is STRUCTURAL - enforced by the import graph.
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   topology.ts → logger.ts  (structured observability events only)
 *   topology.ts → (no other local imports)
 */

import { logger } from "../logger";

// ── Risk thresholds ───────────────────────────────────────────────────────────
//
// Conservative thresholds aligned with the validation engine's governance caps.
// Not runtime limits - purely structural classification.

/** Steps above which we emit a high complexity warning. */
const RISK_HIGH_NODE_COUNT          = 20;
/** Steps above which we emit a critical complexity warning. */
const RISK_CRITICAL_NODE_COUNT      = 40;
/** Consecutive condition depth above which we warn. */
const RISK_HIGH_BRANCH_DEPTH        = 4;
/** Consecutive condition depth above which we escalate to critical. */
const RISK_CRITICAL_BRANCH_DEPTH    = 7;
/** Distinct terminal paths above which we warn. */
const RISK_HIGH_BRANCHING_PATHS     = 8;
/** Distinct terminal paths above which we escalate to critical. */
const RISK_CRITICAL_BRANCHING_PATHS = 32;
/** Approval nodes / total nodes above which we warn on overload. */
const RISK_HIGH_APPROVAL_DENSITY    = 0.5;
/** Delay nodes / total nodes above which we warn on delay chains. */
const RISK_HIGH_DELAY_DENSITY       = 0.4;
/** Hard cap on path counter to prevent absurd values. */
const MAX_PATH_COUNT_CAP            = 1024;

// ── Public types ──────────────────────────────────────────────────────────────

/** A single step represented as a topology node. */
export interface TopologyNode {
  /** Logical step.index from the workflow definition. */
  stepIndex: number;
  stepName:  string;
  stepType:  string;
  /** 0-based position in the steps array. */
  arrayPos:  number;
}

/** How an edge between two nodes is traversed. */
export type TopologyEdgeLabel = "linear" | "true_branch" | "false_branch";

/** A directed edge in the topology graph. */
export interface TopologyEdge {
  /** stepIndex of the source node. */
  fromIndex: number;
  /** stepIndex of the target node. */
  toIndex:   number;
  label:     TopologyEdgeLabel;
}

/** Full directed graph representation of a workflow definition. */
export interface WorkflowTopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** stepIndex(es) that can start the workflow (always [steps[0].stepIndex] when non-empty). */
  entryPoints:      number[];
  /** stepIndex(es) of nodes with no outgoing edges and reachable from entry. */
  terminalNodes:    number[];
  /** stepIndex(es) of condition steps with ≥ 2 distinct outgoing targets. */
  branchingNodes:   number[];
  /** stepIndex(es) of approval steps. */
  approvalNodes:    number[];
  /** stepIndex(es) of delay steps. */
  delayNodes:       number[];
  /** stepIndex(es) not reachable from the entry node. */
  unreachableNodes: number[];
  /**
   * Connected components (by stepIndex) that are disconnected from the main
   * component (the one containing entryPoints[0]).
   * Isolated subgraphs can never execute regardless of routing.
   */
  isolatedSubgraphs: number[][];
}

/** Structural complexity analytics derived from the topology graph. */
export interface TopologyAnalytics {
  nodeCount:                  number;
  edgeCount:                  number;
  /** Longest consecutive run of condition steps on any path from entry. */
  maxBranchDepth:             number;
  /** Maximum step count on any path from entry to any terminal node. */
  longestPathEstimate:        number;
  /**
   * Average outgoing-edge count per branching node.
   * 1.0 when no branching nodes exist (linear flow).
   */
  branchingFactor:            number;
  /** approvalNodes / nodeCount - 0 when no nodes. */
  approvalDensity:            number;
  /** delayNodes / nodeCount - 0 when no nodes. */
  delayDensity:               number;
  /** Estimated distinct execution paths from entry to terminal (capped at 1024). */
  terminalPathCount:          number;
  unreachableCount:           number;
  isolatedSubgraphCount:      number;
  /** Reachable nodes that are NOT executed on every possible path. */
  conditionallyExecutedCount: number;
}

export type TopologyRiskLevel = "low" | "moderate" | "high" | "critical";

/** A single risk finding with a stable code and human-readable message. */
export interface TopologyRiskReason {
  code:    string;
  message: string;
}

/** Risk classification for the overall workflow topology. */
export interface TopologyRiskAssessment {
  level:           TopologyRiskLevel;
  reasons:         TopologyRiskReason[];
  /** Codes of the highest-severity contributing drivers. */
  dominantDrivers: string[];
}

/** Context passed to analyzeTopology for observability events. */
export interface TopologyContext {
  workflowId?:      number;
  workspaceId?:     number;
  workflowVersion?: number;
}

/** The full result returned by analyzeTopology. */
export interface WorkflowTopologyResult {
  graph:     WorkflowTopologyGraph;
  analytics: TopologyAnalytics;
  risk:      TopologyRiskAssessment;
}

// ── Internal: ParsedStep ──────────────────────────────────────────────────────

interface ParsedStep {
  arrayPos:        number;
  stepIndex:       number;
  type:            string;
  name:            string;
  /** Resolved array position for the "true" branch target. null = advance linearly. */
  onTrueArrayPos:  number | null;
  /** Resolved array position for the "false" branch target. null = advance linearly. */
  onFalseArrayPos: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseSteps(rawSteps: unknown[]): ParsedStep[] {
  // Pre-pass: build stepIndex → arrayPos map for routing resolution.
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
      // Only resolve valid forward references (matches validation engine semantics).
      if (typeof onTrue === "number" && Number.isInteger(onTrue) && onTrue > stepIndex) {
        const pos = indexToArrayPos.get(onTrue);
        if (pos !== undefined) onTrueArrayPos = pos;
      }
      if (typeof onFalse === "number" && Number.isInteger(onFalse) && onFalse > stepIndex) {
        const pos = indexToArrayPos.get(onFalse);
        if (pos !== undefined) onFalseArrayPos = pos;
      }
    }

    parsed.push({ arrayPos: i, stepIndex, type, name, onTrueArrayPos, onFalseArrayPos });
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the directed successor adjacency map (arrayPos → arrayPos[]).
 *
 * Condition step:
 *   trueTarget  = onTrueArrayPos  ?? linearNext
 *   falseTarget = onFalseArrayPos ?? linearNext
 *   neighbors = deduplicated [trueTarget, falseTarget] (filtered to valid positions)
 *
 * Non-condition step:
 *   neighbors = [linearNext] if < parsed.length, else []
 */
function buildSuccessorMap(parsed: ParsedStep[]): Map<number, number[]> {
  const succs = new Map<number, number[]>();

  for (const ps of parsed) {
    const linearNext = ps.arrayPos + 1;

    if (ps.type === "condition") {
      const trueTarget  = ps.onTrueArrayPos  !== null ? ps.onTrueArrayPos  : linearNext;
      const falseTarget = ps.onFalseArrayPos !== null ? ps.onFalseArrayPos : linearNext;

      const neighbors: number[] = [];
      if (trueTarget < parsed.length)  neighbors.push(trueTarget);
      if (falseTarget < parsed.length && falseTarget !== trueTarget) neighbors.push(falseTarget);
      succs.set(ps.arrayPos, neighbors);
    } else {
      succs.set(ps.arrayPos, linearNext < parsed.length ? [linearNext] : []);
    }
  }

  return succs;
}

/**
 * Build the labelled edge list.
 * Labels:
 *   "linear"       - non-condition step advancing to its successor
 *   "true_branch"  - condition step's "true" routing target
 *   "false_branch" - condition step's "false" routing target (only when distinct from true)
 */
function buildEdges(
  parsed:          ParsedStep[],
  posToStepIndex:  Map<number, number>,
): TopologyEdge[] {
  const edges: TopologyEdge[] = [];

  for (const ps of parsed) {
    const linearNext = ps.arrayPos + 1;
    const fromIndex  = ps.stepIndex;

    if (ps.type === "condition") {
      const trueTarget  = ps.onTrueArrayPos  !== null ? ps.onTrueArrayPos  : linearNext;
      const falseTarget = ps.onFalseArrayPos !== null ? ps.onFalseArrayPos : linearNext;

      if (trueTarget < parsed.length) {
        edges.push({ fromIndex, toIndex: posToStepIndex.get(trueTarget)!, label: "true_branch" });
      }
      if (falseTarget < parsed.length && falseTarget !== trueTarget) {
        edges.push({ fromIndex, toIndex: posToStepIndex.get(falseTarget)!, label: "false_branch" });
      }
    } else {
      if (linearNext < parsed.length) {
        edges.push({ fromIndex, toIndex: posToStepIndex.get(linearNext)!, label: "linear" });
      }
    }
  }

  return edges;
}

/** BFS from startPos following the successor map. Returns all reachable positions. */
function bfsReachable(startPos: number, succs: Map<number, number[]>): Set<number> {
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

/**
 * Build predecessor map (arrayPos → arrayPos[]) from the successor map.
 */
function buildPredMap(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): Map<number, number[]> {
  const preds = new Map<number, number[]>();
  for (const ps of parsed) preds.set(ps.arrayPos, []);
  for (const ps of parsed) {
    for (const next of succs.get(ps.arrayPos) ?? []) {
      if (!preds.has(next)) preds.set(next, []);
      preds.get(next)!.push(ps.arrayPos);
    }
  }
  return preds;
}

/**
 * Kahn's BFS topological sort of the DAG.
 * Returns array positions in topological order (entry first).
 * Works on the full graph including any disconnected components.
 */
function topoSort(parsed: ParsedStep[], succs: Map<number, number[]>): number[] {
  const preds = buildPredMap(parsed, succs);
  const inDeg = new Map<number, number>();
  for (const ps of parsed) inDeg.set(ps.arrayPos, (preds.get(ps.arrayPos) ?? []).length);

  const queue = parsed
    .filter(ps => (inDeg.get(ps.arrayPos) ?? 0) === 0)
    .map(ps => ps.arrayPos);

  const order: number[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    order.push(curr);
    for (const next of succs.get(curr) ?? []) {
      const newDeg = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }
  return order;
}

// ─────────────────────────────────────────────────────────────────────────────
// Isolated subgraph detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find connected components that are disconnected from the main component
 * (the one containing arrayPos=0).
 *
 * Uses an undirected view of the graph (both edge directions).
 * Returns each isolated component as an array of stepIndex values.
 */
function findIsolatedSubgraphs(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): number[][] {
  if (parsed.length === 0) return [];

  const posToStepIndex = new Map<number, number>(parsed.map(ps => [ps.arrayPos, ps.stepIndex]));

  // Build undirected adjacency
  const undirected = new Map<number, Set<number>>();
  for (const ps of parsed) {
    if (!undirected.has(ps.arrayPos)) undirected.set(ps.arrayPos, new Set());
  }
  for (const ps of parsed) {
    for (const next of succs.get(ps.arrayPos) ?? []) {
      undirected.get(ps.arrayPos)!.add(next);
      if (!undirected.has(next)) undirected.set(next, new Set());
      undirected.get(next)!.add(ps.arrayPos);
    }
  }

  const visited = new Set<number>();
  const components: Set<number>[] = [];

  for (const ps of parsed) {
    if (visited.has(ps.arrayPos)) continue;
    const component = new Set<number>();
    const q         = [ps.arrayPos];
    while (q.length > 0) {
      const curr = q.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      component.add(curr);
      for (const nb of undirected.get(curr) ?? new Set()) {
        if (!visited.has(nb)) q.push(nb);
      }
    }
    components.push(component);
  }

  // The main component is the one containing arrayPos=0
  const isolated: number[][] = [];
  for (const component of components) {
    if (component.has(0)) continue;
    isolated.push([...component].map(pos => posToStepIndex.get(pos) ?? pos));
  }

  return isolated;
}

// ─────────────────────────────────────────────────────────────────────────────
// DP analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * maxBranchDepth: longest consecutive chain of condition steps on any path.
 *
 * DP (topological order):
 *   dp[pos] = if type === "condition":
 *               1 + max(dp[pred] for pred where pred.type === "condition")
 *               (i.e., 1 if no condition predecessors)
 *             else: 0
 */
function computeMaxBranchDepth(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): number {
  if (parsed.length === 0) return 0;

  const posToType  = new Map<number, string>(parsed.map(ps => [ps.arrayPos, ps.type]));
  const preds      = buildPredMap(parsed, succs);
  const order      = topoSort(parsed, succs);
  const dp         = new Map<number, number>();

  for (const pos of order) {
    if (posToType.get(pos) !== "condition") {
      dp.set(pos, 0);
      continue;
    }
    let maxPredChain = 0;
    for (const pred of preds.get(pos) ?? []) {
      if (posToType.get(pred) === "condition") {
        maxPredChain = Math.max(maxPredChain, dp.get(pred) ?? 0);
      }
    }
    dp.set(pos, 1 + maxPredChain);
  }

  let max = 0;
  for (const v of dp.values()) max = Math.max(max, v);
  return max;
}

/**
 * longestPathEstimate: max node count on any path from entry (arrayPos=0) to any terminal.
 *
 * DP (reverse topological order):
 *   dp[pos] = 1 + max(dp[succ] for succ in succs[pos])
 *   terminal (no successors): dp[pos] = 1
 */
function computeLongestPath(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): number {
  if (parsed.length === 0) return 0;

  const order = topoSort(parsed, succs);
  const dp    = new Map<number, number>();

  // Process in reverse topological order
  for (let i = order.length - 1; i >= 0; i--) {
    const pos       = order[i]!;
    const neighbors = succs.get(pos) ?? [];
    if (neighbors.length === 0) {
      dp.set(pos, 1);
    } else {
      let maxSucc = 0;
      for (const next of neighbors) maxSucc = Math.max(maxSucc, dp.get(next) ?? 0);
      dp.set(pos, 1 + maxSucc);
    }
  }

  return dp.get(0) ?? (parsed.length > 0 ? 1 : 0);
}

/**
 * terminalPathCount: distinct paths from entry to any terminal node.
 * Capped at MAX_PATH_COUNT_CAP.
 *
 * DP (reverse topological order):
 *   dp[pos] = sum(dp[succ] for succ in succs[pos])
 *   terminal: dp[pos] = 1
 */
function computeTerminalPathCount(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): number {
  if (parsed.length === 0) return 0;

  const order = topoSort(parsed, succs);
  const dp    = new Map<number, number>();

  for (let i = order.length - 1; i >= 0; i--) {
    const pos       = order[i]!;
    const neighbors = succs.get(pos) ?? [];
    if (neighbors.length === 0) {
      dp.set(pos, 1);
    } else {
      let total = 0;
      for (const next of neighbors) {
        total += dp.get(next) ?? 0;
        if (total >= MAX_PATH_COUNT_CAP) { total = MAX_PATH_COUNT_CAP; break; }
      }
      dp.set(pos, Math.min(total, MAX_PATH_COUNT_CAP));
    }
  }

  return dp.get(0) ?? 0;
}

/**
 * conditionallyExecutedCount: reachable nodes executed on SOME but not ALL paths.
 *
 * For each condition step with ≥ 2 distinct successors B1 and B2:
 *   Any node exclusively reachable from B1 (not from B2) or vice versa
 *   is conditionally executed.
 */
function computeConditionallyExecutedCount(
  parsed: ParsedStep[],
  succs:  Map<number, number[]>,
): number {
  const conditionallyExecuted = new Set<number>();

  for (const ps of parsed) {
    if (ps.type !== "condition") continue;
    const neighbors       = succs.get(ps.arrayPos) ?? [];
    const uniqueNeighbors = [...new Set(neighbors)];
    if (uniqueNeighbors.length < 2) continue;

    const [b1, b2] = uniqueNeighbors as [number, number];
    const reach1   = bfsReachable(b1, succs);
    const reach2   = bfsReachable(b2, succs);

    for (const pos of reach1) { if (!reach2.has(pos)) conditionallyExecuted.add(pos); }
    for (const pos of reach2) { if (!reach1.has(pos)) conditionallyExecuted.add(pos); }
  }

  return conditionallyExecuted.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: extractWorkflowTopology
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the topology graph from a raw workflow steps array.
 * Pure - no DB, no async, no side effects.
 */
export function extractWorkflowTopology(rawSteps: unknown[]): WorkflowTopologyGraph {
  const parsed         = parseSteps(rawSteps);
  const posToStepIndex = new Map<number, number>(parsed.map(ps => [ps.arrayPos, ps.stepIndex]));
  const succs          = buildSuccessorMap(parsed);
  const edges          = buildEdges(parsed, posToStepIndex);

  const reachablePos   = parsed.length > 0 ? bfsReachable(0, succs) : new Set<number>();

  const nodes: TopologyNode[] = parsed.map(ps => ({
    stepIndex: ps.stepIndex,
    stepName:  ps.name,
    stepType:  ps.type,
    arrayPos:  ps.arrayPos,
  }));

  const entryPoints: number[] = parsed.length > 0 ? [parsed[0]!.stepIndex] : [];

  const terminalNodes: number[] = parsed
    .filter(ps => reachablePos.has(ps.arrayPos) && (succs.get(ps.arrayPos) ?? []).length === 0)
    .map(ps => ps.stepIndex);

  const branchingNodes: number[] = parsed
    .filter(ps => ps.type === "condition" && [...new Set(succs.get(ps.arrayPos) ?? [])].length >= 2)
    .map(ps => ps.stepIndex);

  const approvalNodes: number[] = parsed
    .filter(ps => ps.type === "approval")
    .map(ps => ps.stepIndex);

  const delayNodes: number[] = parsed
    .filter(ps => ps.type === "delay")
    .map(ps => ps.stepIndex);

  const unreachableNodes: number[] = parsed
    .filter(ps => !reachablePos.has(ps.arrayPos))
    .map(ps => ps.stepIndex);

  const isolatedSubgraphs = findIsolatedSubgraphs(parsed, succs);

  return {
    nodes, edges, entryPoints, terminalNodes,
    branchingNodes, approvalNodes, delayNodes,
    unreachableNodes, isolatedSubgraphs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: computeTopologyAnalytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute structural complexity analytics from the topology graph.
 * Pure - deterministic for identical inputs.
 */
export function computeTopologyAnalytics(
  graph:    WorkflowTopologyGraph,
  rawSteps: unknown[],
): TopologyAnalytics {
  const parsed = parseSteps(rawSteps);
  const succs  = buildSuccessorMap(parsed);

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  const maxBranchDepth      = computeMaxBranchDepth(parsed, succs);
  const longestPathEstimate = computeLongestPath(parsed, succs);
  const terminalPathCount   = computeTerminalPathCount(parsed, succs);
  const conditionallyExecutedCount = computeConditionallyExecutedCount(parsed, succs);

  const branchingFactor = graph.branchingNodes.length > 0
    ? (() => {
        const posToArrayPos = new Map<number, number>(
          parsed.map(ps => [ps.stepIndex, ps.arrayPos]),
        );
        const totalOut = graph.branchingNodes.reduce((sum, si) => {
          const pos = posToArrayPos.get(si);
          if (pos === undefined) return sum;
          return sum + [...new Set(succs.get(pos) ?? [])].length;
        }, 0);
        return totalOut / graph.branchingNodes.length;
      })()
    : (nodeCount > 0 ? 1.0 : 0.0);

  const approvalDensity = nodeCount > 0 ? graph.approvalNodes.length / nodeCount : 0;
  const delayDensity    = nodeCount > 0 ? graph.delayNodes.length    / nodeCount : 0;

  return {
    nodeCount, edgeCount, maxBranchDepth, longestPathEstimate,
    branchingFactor, approvalDensity, delayDensity, terminalPathCount,
    unreachableCount:           graph.unreachableNodes.length,
    isolatedSubgraphCount:      graph.isolatedSubgraphs.length,
    conditionallyExecutedCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: assessTopologyRisk
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<TopologyRiskLevel, number> = {
  low: 0, moderate: 1, high: 2, critical: 3,
};

function maxLevel(a: TopologyRiskLevel, b: TopologyRiskLevel): TopologyRiskLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Classify topology risk based on structural analytics.
 * Pure rule-based - no ML, no AI, no external dependencies.
 */
export function assessTopologyRisk(
  graph:     WorkflowTopologyGraph,
  analytics: TopologyAnalytics,
): TopologyRiskAssessment {
  const reasons:  TopologyRiskReason[] = [];
  const levels:   TopologyRiskLevel[]  = [];

  function add(level: TopologyRiskLevel, code: string, message: string) {
    reasons.push({ code, message });
    levels.push(level);
  }

  // ── Node count (overall complexity) ────────────────────────────────────────
  if (analytics.nodeCount >= RISK_CRITICAL_NODE_COUNT) {
    add("critical", "TOPO-SIZE-CRITICAL",
      `Workflow has ${analytics.nodeCount} steps - very high structural complexity. ` +
      `Large workflows are difficult to maintain and debug.`);
  } else if (analytics.nodeCount >= RISK_HIGH_NODE_COUNT) {
    add("high", "TOPO-SIZE-HIGH",
      `Workflow has ${analytics.nodeCount} steps - high structural complexity.`);
  }

  // ── Consecutive condition chain depth ──────────────────────────────────────
  if (analytics.maxBranchDepth >= RISK_CRITICAL_BRANCH_DEPTH) {
    add("critical", "TOPO-NEST-CRITICAL",
      `Condition nesting depth ${analytics.maxBranchDepth} - extreme condition chain. ` +
      `Deeply nested conditions are hard to reason about and audit.`);
  } else if (analytics.maxBranchDepth >= RISK_HIGH_BRANCH_DEPTH) {
    add("high", "TOPO-NEST-HIGH",
      `Condition nesting depth ${analytics.maxBranchDepth} - deep condition chain detected.`);
  } else if (analytics.maxBranchDepth >= 2) {
    add("moderate", "TOPO-NEST-MOD",
      `Condition nesting depth ${analytics.maxBranchDepth} - moderate branching complexity.`);
  }

  // ── Distinct execution paths ────────────────────────────────────────────────
  if (analytics.terminalPathCount >= RISK_CRITICAL_BRANCHING_PATHS) {
    add("critical", "TOPO-PATHS-CRITICAL",
      `~${analytics.terminalPathCount} distinct execution paths - exponential branching risk. ` +
      `Consider consolidating branches to reduce path explosion.`);
  } else if (analytics.terminalPathCount >= RISK_HIGH_BRANCHING_PATHS) {
    add("high", "TOPO-PATHS-HIGH",
      `~${analytics.terminalPathCount} distinct execution paths - high routing complexity.`);
  } else if (analytics.terminalPathCount >= 4) {
    add("moderate", "TOPO-PATHS-MOD",
      `~${analytics.terminalPathCount} distinct execution paths - moderate routing complexity.`);
  }

  // ── Approval density ───────────────────────────────────────────────────────
  if (analytics.approvalDensity > 0) {
    if (analytics.approvalDensity >= RISK_HIGH_APPROVAL_DENSITY) {
      add("high", "TOPO-APPROVAL-OVERLOAD",
        `Approval density ${(analytics.approvalDensity * 100).toFixed(0)}% - approval overload risk. ` +
        `${graph.approvalNodes.length} of ${analytics.nodeCount} steps require human approval.`);
    } else if (analytics.approvalDensity >= 0.3) {
      add("moderate", "TOPO-APPROVAL-MOD",
        `Approval density ${(analytics.approvalDensity * 100).toFixed(0)}% - significant approval overhead.`);
    }
  }

  // ── Delay density ──────────────────────────────────────────────────────────
  if (analytics.delayDensity > 0) {
    if (analytics.delayDensity >= RISK_HIGH_DELAY_DENSITY) {
      add("high", "TOPO-DELAY-HIGH",
        `Delay density ${(analytics.delayDensity * 100).toFixed(0)}% - long delay chain risk. ` +
        `${graph.delayNodes.length} of ${analytics.nodeCount} steps introduce time delays.`);
    } else if (analytics.delayDensity >= 0.25) {
      add("moderate", "TOPO-DELAY-MOD",
        `Delay density ${(analytics.delayDensity * 100).toFixed(0)}% - significant delay overhead.`);
    }
  }

  // ── Unreachable / dead nodes ────────────────────────────────────────────────
  if (analytics.unreachableCount >= 3) {
    add("high", "TOPO-DEAD-HIGH",
      `${analytics.unreachableCount} unreachable steps - significant dead structure. ` +
      `These steps will never execute regardless of branching outcomes.`);
  } else if (analytics.unreachableCount >= 1) {
    add("moderate", "TOPO-DEAD-MOD",
      `${analytics.unreachableCount} unreachable step(s) - dead structure detected.`);
  }

  // ── Isolated subgraphs ─────────────────────────────────────────────────────
  if (analytics.isolatedSubgraphCount >= 1) {
    add("high", "TOPO-ISOLATED",
      `${analytics.isolatedSubgraphCount} isolated subgraph(s) - steps disconnected from the main execution flow. ` +
      `These can never execute.`);
  }

  // ── Fanout explosion ───────────────────────────────────────────────────────
  if (analytics.branchingFactor > 2) {
    add("moderate", "TOPO-FANOUT-MOD",
      `Average branching factor ${analytics.branchingFactor.toFixed(1)} - potential fanout explosion.`);
  }

  // ── Determine overall risk level ───────────────────────────────────────────
  let overall: TopologyRiskLevel = "low";
  for (const l of levels) overall = maxLevel(overall, l);

  // Dominant drivers: reasons at the highest severity level
  const dominantDrivers: string[] = reasons
    .filter((_, i) => levels[i] === overall && LEVEL_RANK[overall] >= LEVEL_RANK["moderate"])
    .map(r => r.code);

  return { level: overall, reasons, dominantDrivers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: analyzeTopology  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full topology analysis pipeline.
 * Extracts the graph, computes analytics, assesses risk, and emits four
 * structured observability log events.
 *
 * Pure in the sense that it never mutates the workflow definition, never
 * writes to the DB, and never triggers runtime execution.
 *
 * @param rawSteps  The workflow steps array (may be unknown[] from JSONB)
 * @param context   Optional identifiers for observability events
 */
export function analyzeTopology(
  rawSteps: unknown[],
  context:  TopologyContext = {},
): WorkflowTopologyResult {
  const graph     = extractWorkflowTopology(rawSteps);
  const analytics = computeTopologyAnalytics(graph, rawSteps);
  const risk      = assessTopologyRisk(graph, analytics);

  // ── Observability: workflow_topology_extracted ─────────────────────────────
  logger.info(
    {
      action:           "workflow_topology_extracted",
      workflowId:       context.workflowId      ?? null,
      workflowVersion:  context.workflowVersion ?? null,
      workspaceId:      context.workspaceId     ?? null,
      nodeCount:        analytics.nodeCount,
      edgeCount:        analytics.edgeCount,
      branchDepth:      analytics.maxBranchDepth,
      unreachableCount: analytics.unreachableCount,
      riskLevel:        risk.level,
    },
    "[governance] P8-A: Workflow topology extracted",
  );

  // ── Observability: workflow_topology_risk_assessed (high/critical only) ────
  if (LEVEL_RANK[risk.level] >= LEVEL_RANK["moderate"]) {
    logger.info(
      {
        action:          "workflow_topology_risk_assessed",
        workflowId:      context.workflowId      ?? null,
        workflowVersion: context.workflowVersion ?? null,
        workspaceId:     context.workspaceId     ?? null,
        riskLevel:       risk.level,
        branchDepth:     analytics.maxBranchDepth,
        nodeCount:       analytics.nodeCount,
        terminalPaths:   analytics.terminalPathCount,
        dominantDrivers: risk.dominantDrivers,
      },
      "[governance] P8-A: Workflow topology risk assessed",
    );
  }

  // ── Observability: workflow_dead_structure_detected ────────────────────────
  if (analytics.unreachableCount > 0 || analytics.isolatedSubgraphCount > 0) {
    logger.info(
      {
        action:               "workflow_dead_structure_detected",
        workflowId:           context.workflowId  ?? null,
        workspaceId:          context.workspaceId ?? null,
        unreachableCount:     analytics.unreachableCount,
        isolatedSubgraphCount: analytics.isolatedSubgraphCount,
        nodeCount:            analytics.nodeCount,
        riskLevel:            risk.level,
      },
      "[governance] P8-A: Workflow dead structure detected",
    );
  }

  // ── Observability: workflow_branching_pressure_detected ───────────────────
  if (
    analytics.maxBranchDepth  >= RISK_HIGH_BRANCH_DEPTH ||
    analytics.terminalPathCount >= RISK_HIGH_BRANCHING_PATHS
  ) {
    logger.info(
      {
        action:            "workflow_branching_pressure_detected",
        workflowId:        context.workflowId  ?? null,
        workspaceId:       context.workspaceId ?? null,
        branchDepth:       analytics.maxBranchDepth,
        terminalPathCount: analytics.terminalPathCount,
        branchingFactor:   analytics.branchingFactor,
        riskLevel:         risk.level,
      },
      "[governance] P8-A: Workflow branching pressure detected",
    );
  }

  return { graph, analytics, risk };
}
