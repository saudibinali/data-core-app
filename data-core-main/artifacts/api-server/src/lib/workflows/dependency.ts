/**
 * @file   lib/workflows/dependency.ts
 * @phase  P8-B - Advanced Workflow Analytics & Dependency Intelligence Foundations
 *
 * Pure static dependency intelligence engine.
 * No DB, no async, no side effects, no runtime execution dependencies.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   analyzeDependencies(rawSteps, context?) → WorkflowDependencyResult
 *
 *   Internally:
 *     1. extractWorkflowTopology()   - get base topology graph (from topology.ts)
 *     2. buildMapsFromGraph()        - succs + preds by stepIndex from edge list
 *     3. topoSortFromGraph()         - Kahn's BFS topological order by stepIndex
 *     4. detectConvergenceNodes()    - in-degree ≥ 2 in the directed graph
 *     5. detectDivergenceNodes()     - out-degree ≥ 2 (= branchingNodes)
 *     6. computeNodeSummaries()      - per-node upstream/downstream counts + degrees
 *     7. scoreBottlenecks()          - fan-in + type weight + downstream-hub scoring
 *     8. detectSynchronizationCandidates() - convergence points with approval/delay preds
 *     9. computeDelaysOnLongestPath() - DP: delay step count on the longest path
 *    10. computeExecutionPressure()  - 5 normalized metrics → 0-100 composite score
 *    11. assessDependencyRisk()      - rule-based risk with frailty indicators
 *    12. Emit 4 structured observability events via logger
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates workflow definitions.
 *   Never invokes runtime execution, scheduler, executor, or DB.
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   dependency.ts → topology.ts  (extractWorkflowTopology, computeTopologyAnalytics)
 *   dependency.ts → logger.ts    (structured observability events only)
 */

import { logger }                                      from "../logger";
import { extractWorkflowTopology, computeTopologyAnalytics } from "./topology";
import type { WorkflowTopologyGraph, TopologyAnalytics }     from "./topology";

// ── Scoring constants ─────────────────────────────────────────────────────────

/** Weight applied to each direct predecessor (fan-in). */
const FAN_IN_WEIGHT          = 2.5;
/** Bonus score for approval steps (human wait risk). */
const APPROVAL_BONUS         = 5.0;
/** Bonus score for delay steps (time accumulation risk). */
const DELAY_BONUS            = 3.0;
/** Weight applied to downstream reachable count. */
const DOWNSTREAM_WEIGHT      = 0.4;
/** Extra score for convergence nodes (multiple in-paths). */
const CONVERGENCE_BONUS      = 2.0;
/** Minimum score to classify a node as a bottleneck. */
const BOTTLENECK_THRESHOLD   = 6.0;
/** Max nodes for BFS upstream/downstream count to avoid O(n²) for huge graphs. */
const MAX_BFS_CAP            = 100;
/** Path count above which fanout pressure reaches 1.0. */
const FANOUT_PRESSURE_MAX    = 32;

// ── Risk thresholds ───────────────────────────────────────────────────────────

const BOTTLENECK_HIGH        = 3;
const CONVERGENCE_HIGH       = 5;
const CONVERGENCE_MODERATE   = 2;
const COMPLEXITY_CRITICAL    = 75;
const COMPLEXITY_HIGH        = 50;
const COMPLEXITY_MODERATE    = 25;

// ── Public types ──────────────────────────────────────────────────────────────

/** Per-node structural summary for dependency analysis. */
export interface WorkflowNodeDependencySummary {
  stepIndex:       number;
  stepName:        string;
  stepType:        string;
  /** Number of direct predecessor nodes. */
  inDegree:        number;
  /** Number of direct successor nodes. */
  outDegree:       number;
  /** Total nodes that can reach this node via directed paths. */
  upstreamCount:   number;
  /** Total nodes reachable from this node via directed paths. */
  downstreamCount: number;
}

/** A node where ≥ 2 structurally distinct paths converge. */
export interface WorkflowConvergenceNode {
  stepIndex: number;
  stepName:  string;
  stepType:  string;
  /** Number of distinct direct predecessors. */
  inDegree:  number;
}

/** A node classified as a structural bottleneck by score threshold. */
export interface WorkflowBottleneckNode {
  stepIndex: number;
  stepName:  string;
  stepType:  string;
  /** Composite bottleneck score (fan-in + type weights + downstream hub weight). */
  score:     number;
  /** Named reasons this node was classified as a bottleneck. */
  reasons:   string[];
}

/** Full dependency graph derived from the topology. */
export interface WorkflowDependencyGraph {
  /** Per-node structural summary (all nodes). */
  nodeSummaries:            WorkflowNodeDependencySummary[];
  /** Nodes where ≥ 2 execution paths converge (in-degree ≥ 2). */
  convergenceNodes:         WorkflowConvergenceNode[];
  /** stepIndex(es) of nodes with ≥ 2 distinct outgoing edges (divergence points). */
  divergenceNodes:          number[];
  /** Nodes classified as structural bottlenecks by composite score. */
  bottleneckNodes:          WorkflowBottleneckNode[];
  /** stepIndex(es) of condition steps (potential divergence points). */
  conditionalNodes:         number[];
  /**
   * Convergence nodes that also have at least one approval or delay step
   * as a direct predecessor - points where multiple blocking paths synchronize.
   */
  synchronizationCandidates: number[];
}

/** Five normalized execution-pressure metrics (all values 0.0-1.0 except compositeScore). */
export interface ExecutionPressureEstimate {
  /** Normalized path-explosion pressure (terminalPathCount / FANOUT_PRESSURE_MAX). */
  estimatedFanoutPressure:    number;
  /** Normalized approval bottleneck pressure (weighted approval fan-in). */
  approvalWaitPressure:       number;
  /** Delay steps on the longest path / longest path length. */
  delayAccumulationPressure:  number;
  /** convergenceNodes.length / nodeCount - fraction of nodes under convergence pressure. */
  dependencyCriticality:      number;
  /** Composite score 0-100: weighted sum of the four metrics above. */
  operationalComplexityScore: number;
}

export type DependencyRiskLevel = "low" | "moderate" | "high" | "critical";
export type BottleneckRiskLevel = "none" | "low" | "moderate" | "high";
export type ConvergenceComplexityLevel = "none" | "low" | "moderate" | "high";

/** A single named dependency risk reason. */
export interface DependencyRiskReason {
  code:    string;
  message: string;
}

/** Risk classification based on dependency-intelligence metrics. */
export interface DependencyRiskAssessment {
  level:                        DependencyRiskLevel;
  bottleneckRisk:               BottleneckRiskLevel;
  convergenceComplexity:        ConvergenceComplexityLevel;
  /** Named frailty indicators present in this workflow. */
  operationalFragilityIndicators: string[];
  reasons:                      DependencyRiskReason[];
}

/** Optional context for observability events. */
export interface DependencyContext {
  workflowId?:      number;
  workspaceId?:     number;
  workflowVersion?: number;
}

/** Full result returned by analyzeDependencies. */
export interface WorkflowDependencyResult {
  dependencyGraph: WorkflowDependencyGraph;
  pressure:        ExecutionPressureEstimate;
  risk:            DependencyRiskAssessment;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: build maps from the topology graph's edge list
// ─────────────────────────────────────────────────────────────────────────────

interface GraphMaps {
  succs: Map<number, number[]>;
  preds: Map<number, number[]>;
}

function buildMapsFromGraph(graph: WorkflowTopologyGraph): GraphMaps {
  const succs = new Map<number, number[]>();
  const preds = new Map<number, number[]>();

  for (const node of graph.nodes) {
    succs.set(node.stepIndex, []);
    preds.set(node.stepIndex, []);
  }

  for (const edge of graph.edges) {
    succs.get(edge.fromIndex)?.push(edge.toIndex);
    if (!preds.has(edge.toIndex)) preds.set(edge.toIndex, []);
    preds.get(edge.toIndex)!.push(edge.fromIndex);
  }

  return { succs, preds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: topological sort by stepIndex (Kahn's BFS)
// ─────────────────────────────────────────────────────────────────────────────

function topoSortFromGraph(
  graph: WorkflowTopologyGraph,
  maps:  GraphMaps,
): number[] {
  const { succs, preds } = maps;
  const arrayPosOf       = new Map<number, number>(
    graph.nodes.map(n => [n.stepIndex, n.arrayPos]),
  );

  const inDeg = new Map<number, number>();
  for (const node of graph.nodes) {
    inDeg.set(node.stepIndex, (preds.get(node.stepIndex) ?? []).length);
  }

  // Seed with zero in-degree nodes, sorted by arrayPos for stable ordering
  const queue = graph.nodes
    .filter(n => (inDeg.get(n.stepIndex) ?? 0) === 0)
    .sort((a, b) => a.arrayPos - b.arrayPos)
    .map(n => n.stepIndex);

  const order: number[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    order.push(curr);
    for (const next of succs.get(curr) ?? []) {
      const d = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, d);
      if (d === 0) {
        // Insert in arrayPos order (insertion sort for small sizes)
        const pos = arrayPosOf.get(next) ?? Infinity;
        let i = queue.length;
        while (i > 0 && (arrayPosOf.get(queue[i - 1]!) ?? 0) > pos) i--;
        queue.splice(i, 0, next);
      }
    }
  }
  return order;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: BFS forward/backward from a stepIndex
// ─────────────────────────────────────────────────────────────────────────────

function bfsCount(
  startSi: number,
  adjMap:  Map<number, number[]>,
): number {
  const visited = new Set<number>();
  const q       = [startSi];
  while (q.length > 0 && visited.size < MAX_BFS_CAP) {
    const curr = q.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of adjMap.get(curr) ?? []) {
      if (!visited.has(next)) q.push(next);
    }
  }
  // Exclude the start node itself from the count
  visited.delete(startSi);
  return visited.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: delay steps on the longest path (DP, reverse topo order)
// ─────────────────────────────────────────────────────────────────────────────

function computeDelaysOnLongestPath(
  graph:     WorkflowTopologyGraph,
  maps:      GraphMaps,
  topoOrder: number[],
): number {
  if (graph.nodes.length === 0) return 0;

  const delaySet = new Set<number>(graph.delayNodes);
  const dp       = new Map<number, number>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const si       = topoOrder[i]!;
    const succsArr = maps.succs.get(si) ?? [];
    const selfVal  = delaySet.has(si) ? 1 : 0;

    if (succsArr.length === 0) {
      dp.set(si, selfVal);
    } else {
      let maxSucc = 0;
      for (const next of succsArr) maxSucc = Math.max(maxSucc, dp.get(next) ?? 0);
      dp.set(si, selfVal + maxSucc);
    }
  }

  // Result from entry point
  const entry = graph.entryPoints[0];
  return entry !== undefined ? (dp.get(entry) ?? 0) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: extractDependencyGraph
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the dependency graph from an already-extracted topology graph.
 * Pure - no DB, no async, no side effects.
 */
export function extractDependencyGraph(
  graph:     WorkflowTopologyGraph,
  analytics: TopologyAnalytics,
): WorkflowDependencyGraph {
  if (graph.nodes.length === 0) {
    return {
      nodeSummaries:             [],
      convergenceNodes:          [],
      divergenceNodes:           [],
      bottleneckNodes:           [],
      conditionalNodes:          [],
      synchronizationCandidates: [],
    };
  }

  const maps      = buildMapsFromGraph(graph);
  const { succs, preds } = maps;

  const approvalSet  = new Set<number>(graph.approvalNodes);
  const delaySet     = new Set<number>(graph.delayNodes);

  // ── Per-node summaries ───────────────────────────────────────────────────
  const nodeSummaries: WorkflowNodeDependencySummary[] = graph.nodes.map(n => ({
    stepIndex:       n.stepIndex,
    stepName:        n.stepName,
    stepType:        n.stepType,
    inDegree:        (preds.get(n.stepIndex) ?? []).length,
    outDegree:       (succs.get(n.stepIndex) ?? []).length,
    upstreamCount:   bfsCount(n.stepIndex, preds),
    downstreamCount: bfsCount(n.stepIndex, succs),
  }));

  const summaryMap = new Map<number, WorkflowNodeDependencySummary>(
    nodeSummaries.map(s => [s.stepIndex, s]),
  );

  // ── Convergence nodes: in-degree ≥ 2 ────────────────────────────────────
  const convergenceNodes: WorkflowConvergenceNode[] = [];
  const convergenceSet   = new Set<number>();

  for (const node of graph.nodes) {
    const predsArr = preds.get(node.stepIndex) ?? [];
    if (predsArr.length >= 2) {
      convergenceNodes.push({
        stepIndex: node.stepIndex,
        stepName:  node.stepName,
        stepType:  node.stepType,
        inDegree:  predsArr.length,
      });
      convergenceSet.add(node.stepIndex);
    }
  }

  // ── Divergence nodes: out-degree ≥ 2 (= branchingNodes in topology) ─────
  const divergenceNodes: number[] = [...graph.branchingNodes];

  // ── Conditional nodes ────────────────────────────────────────────────────
  const conditionalNodes: number[] = graph.nodes
    .filter(n => n.stepType === "condition")
    .map(n => n.stepIndex);

  // ── Bottleneck scoring ────────────────────────────────────────────────────
  const bottleneckNodes: WorkflowBottleneckNode[] = [];

  for (const node of graph.nodes) {
    const summary = summaryMap.get(node.stepIndex)!;
    const isApproval    = approvalSet.has(node.stepIndex);
    const isDelay       = delaySet.has(node.stepIndex);
    const isConvergence = convergenceSet.has(node.stepIndex);

    const reasons: string[] = [];
    let score = 0;

    if (summary.inDegree >= 2) {
      score += summary.inDegree * FAN_IN_WEIGHT;
      reasons.push(`high fan-in (${summary.inDegree} predecessors)`);
    }
    if (isApproval) {
      score += APPROVAL_BONUS;
      reasons.push("approval step - requires human action");
    }
    if (isDelay) {
      score += DELAY_BONUS;
      reasons.push("delay step - introduces time accumulation");
    }
    if (summary.downstreamCount >= 3) {
      score += summary.downstreamCount * DOWNSTREAM_WEIGHT;
      reasons.push(`downstream hub (${summary.downstreamCount} dependents)`);
    }
    if (isConvergence) {
      score += CONVERGENCE_BONUS;
      reasons.push("convergence point - multiple paths merge here");
    }

    if (score >= BOTTLENECK_THRESHOLD) {
      bottleneckNodes.push({
        stepIndex: node.stepIndex,
        stepName:  node.stepName,
        stepType:  node.stepType,
        score:     Math.round(score * 10) / 10,
        reasons,
      });
    }
  }

  // Sort bottlenecks by score descending
  bottleneckNodes.sort((a, b) => b.score - a.score);

  // ── Synchronization candidates: convergence + approval/delay predecessor ──
  const synchronizationCandidates: number[] = [];

  for (const cn of convergenceNodes) {
    const predsArr = preds.get(cn.stepIndex) ?? [];
    const hasBlockingPred = predsArr.some(
      pred => approvalSet.has(pred) || delaySet.has(pred),
    );
    if (hasBlockingPred) synchronizationCandidates.push(cn.stepIndex);
  }

  return {
    nodeSummaries,
    convergenceNodes,
    divergenceNodes,
    bottleneckNodes,
    conditionalNodes,
    synchronizationCandidates,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: computeExecutionPressure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute five normalized execution-pressure metrics.
 * All values are deterministic for identical inputs.
 */
export function computeExecutionPressure(
  graph:     WorkflowTopologyGraph,
  depGraph:  WorkflowDependencyGraph,
  analytics: TopologyAnalytics,
): ExecutionPressureEstimate {
  const nodeCount = analytics.nodeCount;

  if (nodeCount === 0) {
    return {
      estimatedFanoutPressure:    0,
      approvalWaitPressure:       0,
      delayAccumulationPressure:  0,
      dependencyCriticality:      0,
      operationalComplexityScore: 0,
    };
  }

  // ── estimatedFanoutPressure ─────────────────────────────────────────────
  // Based on terminalPathCount relative to the critical threshold (32).
  const estimatedFanoutPressure = Math.min(
    analytics.terminalPathCount / FANOUT_PRESSURE_MAX,
    1.0,
  );

  // ── approvalWaitPressure ─────────────────────────────────────────────────
  // Weighted by fan-in of approval nodes - high-fan-in approvals are worse.
  let approvalWeightedSum = 0;
  const summaryMap = new Map<number, WorkflowNodeDependencySummary>(
    depGraph.nodeSummaries.map(s => [s.stepIndex, s]),
  );
  for (const si of graph.approvalNodes) {
    const s = summaryMap.get(si);
    approvalWeightedSum += 1 + (s?.inDegree ?? 0);
  }
  // Normalizer: if every node were an approval with max theoretical fan-in of 2
  const approvalNormalizer = nodeCount * 3;
  const approvalWaitPressure = Math.min(approvalWeightedSum / approvalNormalizer, 1.0);

  // ── delayAccumulationPressure ────────────────────────────────────────────
  // Delay steps on the longest path / longest path length
  const maps      = buildMapsFromGraph(graph);
  const topoOrder = topoSortFromGraph(graph, maps);
  const delaysOnLongest      = computeDelaysOnLongestPath(graph, maps, topoOrder);
  const delayAccumulationPressure = analytics.longestPathEstimate > 0
    ? Math.min(delaysOnLongest / analytics.longestPathEstimate, 1.0)
    : 0;

  // ── dependencyCriticality ────────────────────────────────────────────────
  // Fraction of nodes under convergence pressure
  const dependencyCriticality = Math.min(
    depGraph.convergenceNodes.length / nodeCount,
    1.0,
  );

  // ── operationalComplexityScore ───────────────────────────────────────────
  // Weighted composite 0-100
  const operationalComplexityScore = Math.min(
    Math.round(
      estimatedFanoutPressure   * 30 +
      approvalWaitPressure      * 25 +
      delayAccumulationPressure * 20 +
      dependencyCriticality     * 25,
    ),
    100,
  );

  return {
    estimatedFanoutPressure:    Math.round(estimatedFanoutPressure    * 1000) / 1000,
    approvalWaitPressure:       Math.round(approvalWaitPressure       * 1000) / 1000,
    delayAccumulationPressure:  Math.round(delayAccumulationPressure  * 1000) / 1000,
    dependencyCriticality:      Math.round(dependencyCriticality      * 1000) / 1000,
    operationalComplexityScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: assessDependencyRisk
// ─────────────────────────────────────────────────────────────────────────────

const DEP_LEVEL_RANK: Record<DependencyRiskLevel, number> = {
  low: 0, moderate: 1, high: 2, critical: 3,
};

/**
 * Classify dependency risk based on the dependency graph and pressure metrics.
 * Pure rule-based - deterministic for identical inputs.
 */
export function assessDependencyRisk(
  graph:    WorkflowTopologyGraph,
  depGraph: WorkflowDependencyGraph,
  pressure: ExecutionPressureEstimate,
): DependencyRiskAssessment {
  const reasons:    DependencyRiskReason[] = [];
  const levels:     DependencyRiskLevel[]  = [];

  function add(level: DependencyRiskLevel, code: string, message: string) {
    reasons.push({ code, message });
    levels.push(level);
  }

  // ── Bottleneck risk ──────────────────────────────────────────────────────
  let bottleneckRisk: BottleneckRiskLevel = "none";
  if (depGraph.bottleneckNodes.length >= BOTTLENECK_HIGH) {
    bottleneckRisk = "high";
    add("high", "DEP-BOTTLENECK-HIGH",
      `${depGraph.bottleneckNodes.length} structural bottlenecks detected - ` +
      `workflow throughput may be severely constrained at multiple points.`);
  } else if (depGraph.bottleneckNodes.length >= 1) {
    bottleneckRisk = "moderate";
    add("moderate", "DEP-BOTTLENECK-MOD",
      `${depGraph.bottleneckNodes.length} bottleneck node(s) detected - ` +
      `consider redistributing dependencies around: ` +
      `${depGraph.bottleneckNodes.map(b => b.stepName).join(", ")}.`);
  }

  // ── Convergence complexity ───────────────────────────────────────────────
  let convergenceComplexity: ConvergenceComplexityLevel = "none";
  if (depGraph.convergenceNodes.length >= CONVERGENCE_HIGH) {
    convergenceComplexity = "high";
    add("high", "DEP-CONVERGENCE-HIGH",
      `${depGraph.convergenceNodes.length} convergence points - extreme branch-merge complexity. ` +
      `Execution-context correctness is hard to audit at this level.`);
  } else if (depGraph.convergenceNodes.length >= CONVERGENCE_MODERATE) {
    convergenceComplexity = "moderate";
    add("moderate", "DEP-CONVERGENCE-MOD",
      `${depGraph.convergenceNodes.length} convergence points - moderate branch-merge complexity.`);
  } else if (depGraph.convergenceNodes.length >= 1) {
    convergenceComplexity = "low";
  }

  // ── Fanout pressure ──────────────────────────────────────────────────────
  if (pressure.estimatedFanoutPressure >= 1.0) {
    add("critical", "DEP-FANOUT-CRITICAL",
      `Path count hit the analysis cap (${pressure.operationalComplexityScore}/100 complexity) - ` +
      `workflow has exponential branching risk.`);
  } else if (pressure.estimatedFanoutPressure >= 0.5) {
    add("high", "DEP-FANOUT-HIGH",
      `Fanout pressure ${(pressure.estimatedFanoutPressure * 100).toFixed(0)}% - ` +
      `high execution-path explosion risk.`);
  } else if (pressure.estimatedFanoutPressure >= 0.25) {
    add("moderate", "DEP-FANOUT-MOD",
      `Fanout pressure ${(pressure.estimatedFanoutPressure * 100).toFixed(0)}% - moderate.`);
  }

  // ── Approval wait pressure ───────────────────────────────────────────────
  if (pressure.approvalWaitPressure >= 0.5) {
    add("high", "DEP-APPROVAL-WAIT-HIGH",
      `Approval wait pressure ${(pressure.approvalWaitPressure * 100).toFixed(0)}% - ` +
      `workflow is heavily gated on human decisions.`);
  } else if (pressure.approvalWaitPressure >= 0.2) {
    add("moderate", "DEP-APPROVAL-WAIT-MOD",
      `Approval wait pressure ${(pressure.approvalWaitPressure * 100).toFixed(0)}% - ` +
      `significant human-gating overhead.`);
  }

  // ── Delay accumulation pressure ──────────────────────────────────────────
  if (pressure.delayAccumulationPressure >= 0.5) {
    add("high", "DEP-DELAY-ACCUM-HIGH",
      `Delay accumulation pressure ${(pressure.delayAccumulationPressure * 100).toFixed(0)}% - ` +
      `the critical path has heavy time-delay concentration.`);
  } else if (pressure.delayAccumulationPressure >= 0.25) {
    add("moderate", "DEP-DELAY-ACCUM-MOD",
      `Delay accumulation pressure ${(pressure.delayAccumulationPressure * 100).toFixed(0)}%.`);
  }

  // ── Composite complexity score ────────────────────────────────────────────
  if (pressure.operationalComplexityScore >= COMPLEXITY_CRITICAL) {
    add("critical", "DEP-COMPLEXITY-CRITICAL",
      `Operational complexity score ${pressure.operationalComplexityScore}/100 - ` +
      `critical operational risk. Significant simplification recommended.`);
  } else if (pressure.operationalComplexityScore >= COMPLEXITY_HIGH) {
    add("high", "DEP-COMPLEXITY-HIGH",
      `Operational complexity score ${pressure.operationalComplexityScore}/100 - high.`);
  } else if (pressure.operationalComplexityScore >= COMPLEXITY_MODERATE) {
    add("moderate", "DEP-COMPLEXITY-MOD",
      `Operational complexity score ${pressure.operationalComplexityScore}/100 - moderate.`);
  }

  // ── Synchronization candidates risk ──────────────────────────────────────
  if (depGraph.synchronizationCandidates.length >= 2) {
    add("moderate", "DEP-SYNC-PRESSURE",
      `${depGraph.synchronizationCandidates.length} synchronization candidate(s) - ` +
      `multiple approval/delay paths converging may create execution stalls.`);
  }

  // ── Determine overall level ───────────────────────────────────────────────
  let overall: DependencyRiskLevel = "low";
  for (const l of levels) {
    if (DEP_LEVEL_RANK[l] > DEP_LEVEL_RANK[overall]) overall = l;
  }

  // ── Operational frailty indicators ────────────────────────────────────────
  const operationalFragilityIndicators: string[] = [];

  if (graph.approvalNodes.some(si => {
    const s = depGraph.nodeSummaries.find(n => n.stepIndex === si);
    return (s?.inDegree ?? 0) >= 2;
  })) {
    operationalFragilityIndicators.push("approval_choke_point");
  }

  const maps      = buildMapsFromGraph(graph);
  const topoOrder = topoSortFromGraph(graph, maps);
  if (computeDelaysOnLongestPath(graph, maps, topoOrder) >= 2) {
    operationalFragilityIndicators.push("delay_critical_path");
  }

  if (depGraph.convergenceNodes.length >= 3) {
    operationalFragilityIndicators.push("convergence_pressure");
  }

  if (pressure.estimatedFanoutPressure >= 0.25) {
    operationalFragilityIndicators.push("fanout_explosion");
  }

  if (depGraph.bottleneckNodes.length >= 2) {
    operationalFragilityIndicators.push("bottleneck_concentration");
  }

  return {
    level: overall,
    bottleneckRisk,
    convergenceComplexity,
    operationalFragilityIndicators,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: analyzeDependencies  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full dependency analysis pipeline.
 * Extracts the dependency graph, computes execution pressure, assesses risk,
 * and emits four structured observability log events.
 *
 * Builds on top of the P8-A topology engine - no step parsing duplication.
 *
 * @param rawSteps  The workflow steps array (may be unknown[] from JSONB)
 * @param context   Optional identifiers for observability events
 */
export function analyzeDependencies(
  rawSteps: unknown[],
  context:  DependencyContext = {},
): WorkflowDependencyResult {
  const topoGraph  = extractWorkflowTopology(rawSteps);
  const analytics  = computeTopologyAnalytics(topoGraph, rawSteps);

  const dependencyGraph = extractDependencyGraph(topoGraph, analytics);
  const pressure        = computeExecutionPressure(topoGraph, dependencyGraph, analytics);
  const risk            = assessDependencyRisk(topoGraph, dependencyGraph, pressure);

  // ── Observability: workflow_dependency_graph_extracted ────────────────────
  logger.info(
    {
      action:            "workflow_dependency_graph_extracted",
      workflowId:        context.workflowId      ?? null,
      workflowVersion:   context.workflowVersion ?? null,
      workspaceId:       context.workspaceId     ?? null,
      nodeCount:         analytics.nodeCount,
      convergenceCount:  dependencyGraph.convergenceNodes.length,
      bottleneckCount:   dependencyGraph.bottleneckNodes.length,
      divergenceCount:   dependencyGraph.divergenceNodes.length,
      complexityScore:   pressure.operationalComplexityScore,
      riskLevel:         risk.level,
    },
    "[governance] P8-B: Workflow dependency graph extracted",
  );

  // ── Observability: workflow_convergence_detected ──────────────────────────
  if (dependencyGraph.convergenceNodes.length > 0) {
    logger.info(
      {
        action:           "workflow_convergence_detected",
        workflowId:       context.workflowId      ?? null,
        workflowVersion:  context.workflowVersion ?? null,
        workspaceId:      context.workspaceId     ?? null,
        convergenceCount: dependencyGraph.convergenceNodes.length,
        branchDepth:      analytics.maxBranchDepth,
        nodeCount:        analytics.nodeCount,
        complexityScore:  pressure.operationalComplexityScore,
        riskLevel:        risk.level,
      },
      "[governance] P8-B: Workflow convergence detected",
    );
  }

  // ── Observability: workflow_bottleneck_detected ───────────────────────────
  if (dependencyGraph.bottleneckNodes.length > 0) {
    logger.info(
      {
        action:          "workflow_bottleneck_detected",
        workflowId:      context.workflowId      ?? null,
        workflowVersion: context.workflowVersion ?? null,
        workspaceId:     context.workspaceId     ?? null,
        bottleneckCount: dependencyGraph.bottleneckNodes.length,
        topBottleneck:   dependencyGraph.bottleneckNodes[0]?.stepName ?? null,
        topScore:        dependencyGraph.bottleneckNodes[0]?.score    ?? null,
        complexityScore: pressure.operationalComplexityScore,
        riskLevel:       risk.level,
      },
      "[governance] P8-B: Workflow bottleneck detected",
    );
  }

  // ── Observability: workflow_execution_pressure_estimated ──────────────────
  logger.info(
    {
      action:                    "workflow_execution_pressure_estimated",
      workflowId:                context.workflowId      ?? null,
      workflowVersion:           context.workflowVersion ?? null,
      workspaceId:               context.workspaceId     ?? null,
      estimatedFanoutPressure:   pressure.estimatedFanoutPressure,
      approvalWaitPressure:      pressure.approvalWaitPressure,
      delayAccumulationPressure: pressure.delayAccumulationPressure,
      dependencyCriticality:     pressure.dependencyCriticality,
      complexityScore:           pressure.operationalComplexityScore,
      riskLevel:                 risk.level,
    },
    "[governance] P8-B: Workflow execution pressure estimated",
  );

  return { dependencyGraph, pressure, risk };
}
