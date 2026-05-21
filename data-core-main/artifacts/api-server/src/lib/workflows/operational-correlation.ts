/**
 * @file   lib/workflows/operational-correlation.ts
 * @phase  P8-C - Runtime-Weighted Operational Intelligence & Historical Correlation Foundations
 *
 * Pure historical-correlation intelligence engine.
 * No DB, no async, no side effects, no live runtime coupling.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   computeOperationalCorrelation(depResult, analytics, historical, context?)
 *     → WorkflowOperationalCorrelationResult
 *
 *   Internally:
 *     1. normalizeHistorical()       - map raw counts to 0-1 pressure signals
 *     2. computeCorrelationMetrics() - 5 deterministic pressure derivations
 *     3. computeRuntimeWeightedComplexity() - static × historical blend → 0-100
 *     4. classifyCorrelation()       - structural vs operational 2×2 matrix
 *     5. detectHotspots()            - 7 named chronic operational hotspot checks
 *     6. computeFragilityIndex()     - structural + runtime + chronicity → level
 *     7. Emit 4 structured observability events via logger
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates governance history, workflow definitions, or DB.
 *   Never triggers workflow execution, never invokes scheduler.
 *   Pure historical-correlation intelligence - no live runtime coupling.
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   operational-correlation.ts → dependency.ts  (types only: WorkflowDependencyResult)
 *   operational-correlation.ts → topology.ts    (types only: TopologyAnalytics)
 *   operational-correlation.ts → logger.ts      (structured observability events)
 */

import { logger }                                           from "../logger";
import type { WorkflowDependencyResult }                    from "./dependency";
import type { TopologyAnalytics }                           from "./topology";

// ── Normalization constants ───────────────────────────────────────────────────

/** Raw approval backlog count above which normalized pressure reaches 1.0. */
const MAX_APPROVAL_BACKLOG_REF = 50;
/** Raw delay backlog count above which normalized pressure reaches 1.0. */
const MAX_DELAY_BACKLOG_REF    = 50;
/** Raw stuck-execution count above which normalized pressure reaches 1.0. */
const MAX_STUCK_REF            = 20;

/** Amplifier applied to approval backlog × approval density. */
const APPROVAL_AMPLIFIER = 3.0;
/** Amplifier applied to delay backlog × delay density. */
const DELAY_AMPLIFIER    = 3.0;

// ── Runtime-weighted complexity weights (must sum to 100 when pressures = 1.0) ──
const W_STRUCTURAL   = 0.40;   // base structural complexity (40 points max)
const W_ERROR        = 25;     // historical error pressure  (25 points max)
const W_APPROVAL_LAT = 20;     // approval latency pressure  (20 points max)
const W_DELAY_DUR    = 10;     // delay duration pressure    (10 points max)
const W_FAILURE      = 5;      // execution failure pressure  (5 points max)

// ── Correlation classification thresholds ────────────────────────────────────
const STRUCTURAL_HIGH_THRESHOLD = 50;   // operationalComplexityScore
const RUNTIME_HIGH_THRESHOLD    = 50;   // runtimeWeightedComplexity

// ── Hotspot detection thresholds ─────────────────────────────────────────────
const HOTSPOT_BACKLOG_NORM      = 0.30;
const HOTSPOT_APPROVAL_DENSITY  = 0.15;
const HOTSPOT_DELAY_DENSITY     = 0.15;
const HOTSPOT_ERROR_RATE        = 0.10;
const HOTSPOT_STUCK_NORM        = 0.20;
const HOTSPOT_STORM_FREQUENCY   = 0.10;
const HOTSPOT_CHRONIC_CODES_MIN = 2;
const HOTSPOT_BACKLOG_PRESSURE  = 0.20;

// ── Fragility index thresholds ────────────────────────────────────────────────
const FRAGILITY_CRITICAL = 75;
const FRAGILITY_HIGH     = 50;
const FRAGILITY_MODERATE = 25;

// ── Operational confidence thresholds ────────────────────────────────────────
const CONFIDENCE_HIGH_SNAPSHOTS     = 100;
const CONFIDENCE_MODERATE_SNAPSHOTS = 10;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Aggregated historical operational data for a workspace.
 * Computed from governance_snapshots / governance_snapshot_rollups by the
 * caller (route handler) and passed to the pure correlation engine.
 */
export interface HistoricalOperationalData {
  /** Total snapshots included in the aggregation window. */
  snapshotCount:      number;
  /** Arithmetic mean of workflowErrorRate (0.0-1.0). */
  avgErrorRate:       number;
  /** Arithmetic mean of approvalBacklogCount (raw execution count). */
  avgApprovalBacklog: number;
  /** Arithmetic mean of delayBacklogCount (raw execution count). */
  avgDelayBacklog:    number;
  /** Arithmetic mean of stuckCount at capture time. */
  avgStuckCount:      number;
  /** Fraction of snapshots with stormSeverity != 'none' (0.0-1.0). */
  stormFrequency:     number;
  /** GOV-* codes appearing in > 50% of source snapshots. */
  chronicAlertCodes:  string[];
  /** Worst severity seen across the aggregation window. */
  dominantSeverity:   "healthy" | "warning" | "degraded" | "critical";
}

/** Named classification of the structural vs operational risk profile. */
export type CorrelationClassification =
  | "structurally_simple_operationally_stable"
  | "structurally_complex_operationally_stable"
  | "structurally_simple_operationally_fragile"
  | "structurally_and_operationally_complex";

/** Core correlation metrics output. */
export interface WorkflowOperationalCorrelation {
  /**
   * Static structural complexity score from P8-B (0-100).
   * Same as pressure.operationalComplexityScore from the dependency engine.
   */
  structuralComplexity:       number;
  /** Historical mean error rate from governance snapshots (0.0-1.0). */
  historicalErrorPressure:    number;
  /**
   * Combined normalized approval + delay backlog pressure (0.0-1.0).
   * Purely historical - workspace-level, not workflow-specific.
   */
  historicalBacklogPressure:  number;
  /**
   * Approval backlog × approval density amplification (0.0-1.0).
   * Zero if the workflow has no approval steps regardless of workspace backlog.
   */
  approvalLatencyPressure:    number;
  /**
   * Delay backlog × delay density amplification (0.0-1.0).
   * Zero if the workflow has no delay steps regardless of workspace backlog.
   */
  delayDurationPressure:      number;
  /**
   * Composite failure pressure = (errorRate × 0.7 + normalizedStuck × 0.3) (0.0-1.0).
   */
  executionFailurePressure:   number;
  /** Named chronic operational hotspot categories detected for this workflow. */
  chronicOperationalHotspots: string[];
  /**
   * Runtime-weighted complexity score (0-100, integer).
   * Blends static structural complexity with historical operational signals.
   * Falls back to structuralComplexity when snapshotCount = 0.
   */
  runtimeWeightedComplexity:  number;
  /** Structural vs operational risk profile classification. */
  correlationClassification:  CorrelationClassification;
}

export type FragilityLevel = "low" | "moderate" | "high" | "critical";
export type OperationalConfidence = "low" | "moderate" | "high";

/** Composite operational fragility index. */
export interface OperationalFragilityIndex {
  level:                 FragilityLevel;
  /** Structural fragility (0.0-1.0) - structuralComplexity / 100. */
  structuralFragility:   number;
  /** Runtime fragility (0.0-1.0) - mean of historicalErrorPressure, approvalLatencyPressure, delayDurationPressure. */
  runtimeFragility:      number;
  /**
   * Chronicity indicator (0.0-1.0) - reflects how persistent the operational issues are
   * based on dominantSeverity + chronicAlertCodes count + stormFrequency.
   */
  chronicity:            number;
  /**
   * Confidence level based on snapshotCount.
   * "low" < 10 snapshots, "moderate" < 100, "high" ≥ 100.
   */
  operationalConfidence: OperationalConfidence;
  /** Named frailty indicator codes active for this workflow. */
  indicators:            string[];
}

/** Optional context for observability events. */
export interface CorrelationContext {
  workflowId?:      number;
  workspaceId?:     number;
  workflowVersion?: number;
}

/** Full result returned by computeOperationalCorrelation. */
export interface WorkflowOperationalCorrelationResult {
  correlation:    WorkflowOperationalCorrelation;
  fragilityIndex: OperationalFragilityIndex;
}

// ── Zero historical data sentinel ─────────────────────────────────────────────

export const ZERO_HISTORICAL: HistoricalOperationalData = {
  snapshotCount:      0,
  avgErrorRate:       0,
  avgApprovalBacklog: 0,
  avgDelayBacklog:    0,
  avgStuckCount:      0,
  stormFrequency:     0,
  chronicAlertCodes:  [],
  dominantSeverity:   "healthy",
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: normalize raw historical counts to 0-1 pressure signals
// ─────────────────────────────────────────────────────────────────────────────

interface NormalizedHistorical {
  errorRate:        number;   // 0-1 (already normalized)
  approvalBacklog:  number;   // 0-1
  delayBacklog:     number;   // 0-1
  stuckCount:       number;   // 0-1
  stormFrequency:   number;   // 0-1 (already normalized)
}

function normalizeHistorical(h: HistoricalOperationalData): NormalizedHistorical {
  return {
    errorRate:       clamp(h.avgErrorRate,       0, 1),
    approvalBacklog: clamp(h.avgApprovalBacklog / MAX_APPROVAL_BACKLOG_REF, 0, 1),
    delayBacklog:    clamp(h.avgDelayBacklog    / MAX_DELAY_BACKLOG_REF,    0, 1),
    stuckCount:      clamp(h.avgStuckCount      / MAX_STUCK_REF,            0, 1),
    stormFrequency:  clamp(h.stormFrequency,     0, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: compute the five pressure metrics
// ─────────────────────────────────────────────────────────────────────────────

interface CorrelationPressures {
  historicalErrorPressure:   number;
  historicalBacklogPressure: number;
  approvalLatencyPressure:   number;
  delayDurationPressure:     number;
  executionFailurePressure:  number;
}

function computePressures(
  norm:      NormalizedHistorical,
  analytics: TopologyAnalytics,
): CorrelationPressures {
  const historicalErrorPressure = norm.errorRate;

  const historicalBacklogPressure = clamp(
    (norm.approvalBacklog + norm.delayBacklog) / 2,
    0, 1,
  );

  // Approval latency: workspace backlog amplified by workflow's approval density.
  // If the workflow has no approval steps, latency pressure is zero regardless of workspace state.
  const approvalLatencyPressure = clamp(
    norm.approvalBacklog * analytics.approvalDensity * APPROVAL_AMPLIFIER,
    0, 1,
  );

  // Delay duration: workspace delay backlog amplified by workflow's delay density.
  const delayDurationPressure = clamp(
    norm.delayBacklog * analytics.delayDensity * DELAY_AMPLIFIER,
    0, 1,
  );

  // Execution failure: error rate (70%) + stuck executions (30%)
  const executionFailurePressure = clamp(
    norm.errorRate * 0.7 + norm.stuckCount * 0.3,
    0, 1,
  );

  return {
    historicalErrorPressure,
    historicalBacklogPressure,
    approvalLatencyPressure,
    delayDurationPressure,
    executionFailurePressure,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: runtime-weighted complexity score
// ─────────────────────────────────────────────────────────────────────────────

function computeRuntimeWeightedComplexity(
  structuralComplexity: number,
  pressures:            CorrelationPressures,
  hasHistory:           boolean,
): number {
  if (!hasHistory) return structuralComplexity;

  const score =
    structuralComplexity             * W_STRUCTURAL   +
    pressures.historicalErrorPressure   * W_ERROR        +
    pressures.approvalLatencyPressure   * W_APPROVAL_LAT +
    pressures.delayDurationPressure     * W_DELAY_DUR    +
    pressures.executionFailurePressure  * W_FAILURE;

  return Math.min(Math.round(score), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: structural vs operational classification (2×2 matrix)
// ─────────────────────────────────────────────────────────────────────────────

function classifyCorrelation(
  structuralComplexity:      number,
  runtimeWeightedComplexity: number,
): CorrelationClassification {
  const structurallyComplex = structuralComplexity      >= STRUCTURAL_HIGH_THRESHOLD;
  const operationallyComplex = runtimeWeightedComplexity >= RUNTIME_HIGH_THRESHOLD;

  if (structurallyComplex && operationallyComplex)  return "structurally_and_operationally_complex";
  if (structurallyComplex && !operationallyComplex) return "structurally_complex_operationally_stable";
  if (!structurallyComplex && operationallyComplex) return "structurally_simple_operationally_fragile";
  return "structurally_simple_operationally_stable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: chronic operational hotspot detection
// ─────────────────────────────────────────────────────────────────────────────

function detectHotspots(
  norm:      NormalizedHistorical,
  analytics: TopologyAnalytics,
  depResult: WorkflowDependencyResult,
  pressures: CorrelationPressures,
  h:         HistoricalOperationalData,
): string[] {
  if (h.snapshotCount === 0) return [];

  const hotspots: string[] = [];

  // 1. Approval backlog concentration - workspace backlog + workflow has approval steps
  if (norm.approvalBacklog > HOTSPOT_BACKLOG_NORM && analytics.approvalDensity > HOTSPOT_APPROVAL_DENSITY) {
    hotspots.push("approval_backlog_concentration");
  }

  // 2. Delay duration concentration - workspace delay backlog + workflow has delay steps
  if (norm.delayBacklog > HOTSPOT_BACKLOG_NORM && analytics.delayDensity > HOTSPOT_DELAY_DENSITY) {
    hotspots.push("delay_duration_concentration");
  }

  // 3. Execution failure corridor - error rate + structural bottlenecks create a failure zone
  if (norm.errorRate > HOTSPOT_ERROR_RATE && depResult.dependencyGraph.bottleneckNodes.length > 0) {
    hotspots.push("execution_failure_corridor");
  }

  // 4. Chronic stuck pressure - stuck executions + convergence nodes (state-merge points)
  if (norm.stuckCount > HOTSPOT_STUCK_NORM && depResult.dependencyGraph.convergenceNodes.length > 0) {
    hotspots.push("chronic_stuck_pressure");
  }

  // 5. Storm history risk - repeated alert storms + workflow has elevated structural risk
  if (norm.stormFrequency > HOTSPOT_STORM_FREQUENCY && depResult.risk.level !== "low") {
    hotspots.push("storm_history_risk");
  }

  // 6. Chronic alert escalation - many GOV-* codes appearing persistently
  if (h.chronicAlertCodes.length >= HOTSPOT_CHRONIC_CODES_MIN) {
    hotspots.push("chronic_alert_escalation");
  }

  // 7. Convergence under load - convergence points + historically elevated backlog
  if (
    depResult.dependencyGraph.convergenceNodes.length > 0 &&
    pressures.historicalBacklogPressure > HOTSPOT_BACKLOG_PRESSURE
  ) {
    hotspots.push("convergence_under_load");
  }

  return hotspots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: operational fragility index computation
// ─────────────────────────────────────────────────────────────────────────────

function computeFragilityIndexInternal(
  structuralComplexity:     number,
  runtimeWeightedComplexity: number,
  pressures:                CorrelationPressures,
  h:                        HistoricalOperationalData,
  hotspots:                 string[],
): OperationalFragilityIndex {
  const structuralFragility = Math.round(clamp(structuralComplexity / 100, 0, 1) * 1000) / 1000;

  const runtimeFragility = Math.round(
    clamp(
      (pressures.historicalErrorPressure + pressures.approvalLatencyPressure + pressures.delayDurationPressure) / 3,
      0, 1,
    ) * 1000,
  ) / 1000;

  // Chronicity: how persistent are the operational issues?
  let chronicity = 0;
  if (h.snapshotCount > 0) {
    const severityScore =
      h.dominantSeverity === "critical" ? 1.0 :
      h.dominantSeverity === "degraded" ? 0.7 :
      h.dominantSeverity === "warning"  ? 0.4 : 0.1;

    const chronicCodeFactor = clamp(h.chronicAlertCodes.length / 5, 0, 1);
    chronicity = Math.round(
      clamp(severityScore * 0.5 + chronicCodeFactor * 0.3 + h.stormFrequency * 0.2, 0, 1) * 1000,
    ) / 1000;
  }

  // Operational confidence: how much historical data do we have?
  const operationalConfidence: OperationalConfidence =
    h.snapshotCount >= CONFIDENCE_HIGH_SNAPSHOTS     ? "high" :
    h.snapshotCount >= CONFIDENCE_MODERATE_SNAPSHOTS ? "moderate" :
    "low";

  // Fragility level: based on runtimeWeightedComplexity (blend of static + history)
  const level: FragilityLevel =
    runtimeWeightedComplexity >= FRAGILITY_CRITICAL ? "critical" :
    runtimeWeightedComplexity >= FRAGILITY_HIGH     ? "high"     :
    runtimeWeightedComplexity >= FRAGILITY_MODERATE ? "moderate" :
    "low";

  // Named frailty indicators
  const indicators: string[] = [];
  if (structuralFragility > 0.5)                 indicators.push("structural_complexity_elevated");
  if (runtimeFragility > 0.5)                    indicators.push("runtime_pressure_elevated");
  if (chronicity > 0.5)                          indicators.push("chronic_degradation_detected");
  if (operationalConfidence === "low")            indicators.push("insufficient_history_low_confidence");
  if (hotspots.includes("approval_backlog_concentration")) indicators.push("approval_throughput_risk");
  if (hotspots.includes("execution_failure_corridor"))     indicators.push("failure_corridor_risk");
  if (hotspots.includes("chronic_stuck_pressure"))         indicators.push("convergence_stall_risk");

  return {
    level,
    structuralFragility,
    runtimeFragility,
    chronicity,
    operationalConfidence,
    indicators,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: computeOperationalCorrelation  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full historical-correlation pipeline.
 *
 * Correlates static dependency-intelligence results (P8-B) with aggregated
 * historical governance data to produce runtime-weighted operational scores
 * and a composite fragility index.
 *
 * Pure - no DB, no async, no side effects.
 * Emits four structured observability events via logger.
 *
 * @param depResult  P8-B dependency analysis result
 * @param analytics  P8-A topology analytics
 * @param historical Aggregated governance snapshot data (from caller/route)
 * @param context    Optional identifiers for observability events
 */
export function computeOperationalCorrelation(
  depResult: WorkflowDependencyResult,
  analytics: TopologyAnalytics,
  historical: HistoricalOperationalData,
  context:   CorrelationContext = {},
): WorkflowOperationalCorrelationResult {
  const hasHistory             = historical.snapshotCount > 0;
  const structuralComplexity   = depResult.pressure.operationalComplexityScore;
  const norm                   = normalizeHistorical(historical);
  const pressures              = computePressures(norm, analytics);

  const runtimeWeightedComplexity = computeRuntimeWeightedComplexity(
    structuralComplexity,
    pressures,
    hasHistory,
  );

  const correlationClassification = classifyCorrelation(
    structuralComplexity,
    runtimeWeightedComplexity,
  );

  const chronicOperationalHotspots = detectHotspots(norm, analytics, depResult, pressures, historical);

  const fragilityIndex = computeFragilityIndexInternal(
    structuralComplexity,
    runtimeWeightedComplexity,
    pressures,
    historical,
    chronicOperationalHotspots,
  );

  const correlation: WorkflowOperationalCorrelation = {
    structuralComplexity,
    historicalErrorPressure:   Math.round(pressures.historicalErrorPressure   * 1000) / 1000,
    historicalBacklogPressure: Math.round(pressures.historicalBacklogPressure * 1000) / 1000,
    approvalLatencyPressure:   Math.round(pressures.approvalLatencyPressure   * 1000) / 1000,
    delayDurationPressure:     Math.round(pressures.delayDurationPressure     * 1000) / 1000,
    executionFailurePressure:  Math.round(pressures.executionFailurePressure  * 1000) / 1000,
    chronicOperationalHotspots,
    runtimeWeightedComplexity,
    correlationClassification,
  };

  // ── Observability: workflow_operational_correlation_computed ──────────────
  logger.info(
    {
      action:                    "workflow_operational_correlation_computed",
      workflowId:                context.workflowId      ?? null,
      workflowVersion:           context.workflowVersion ?? null,
      workspaceId:               context.workspaceId     ?? null,
      runtimeWeightedComplexity,
      fragilityLevel:            fragilityIndex.level,
      hotspotCount:              chronicOperationalHotspots.length,
      structuralComplexity,
      snapshotCount:             historical.snapshotCount,
      correlationClassification,
    },
    "[governance] P8-C: Workflow operational correlation computed",
  );

  // ── Observability: workflow_runtime_bottleneck_detected ───────────────────
  if (depResult.dependencyGraph.bottleneckNodes.length > 0 && hasHistory) {
    logger.info(
      {
        action:                   "workflow_runtime_bottleneck_detected",
        workflowId:               context.workflowId      ?? null,
        workflowVersion:          context.workflowVersion ?? null,
        workspaceId:              context.workspaceId     ?? null,
        runtimeWeightedComplexity,
        fragilityLevel:           fragilityIndex.level,
        hotspotCount:             chronicOperationalHotspots.length,
        bottleneckCount:          depResult.dependencyGraph.bottleneckNodes.length,
        topBottleneck:            depResult.dependencyGraph.bottleneckNodes[0]?.stepName ?? null,
        executionFailurePressure: correlation.executionFailurePressure,
      },
      "[governance] P8-C: Workflow runtime bottleneck detected",
    );
  }

  // ── Observability: workflow_chronic_hotspot_detected ──────────────────────
  if (chronicOperationalHotspots.length > 0) {
    logger.info(
      {
        action:                   "workflow_chronic_hotspot_detected",
        workflowId:               context.workflowId      ?? null,
        workflowVersion:          context.workflowVersion ?? null,
        workspaceId:              context.workspaceId     ?? null,
        runtimeWeightedComplexity,
        fragilityLevel:           fragilityIndex.level,
        hotspotCount:             chronicOperationalHotspots.length,
        hotspots:                 chronicOperationalHotspots,
      },
      "[governance] P8-C: Workflow chronic hotspot detected",
    );
  }

  // ── Observability: workflow_fragility_index_computed ─────────────────────
  logger.info(
    {
      action:                   "workflow_fragility_index_computed",
      workflowId:               context.workflowId      ?? null,
      workflowVersion:          context.workflowVersion ?? null,
      workspaceId:              context.workspaceId     ?? null,
      runtimeWeightedComplexity,
      fragilityLevel:           fragilityIndex.level,
      hotspotCount:             chronicOperationalHotspots.length,
      structuralFragility:      fragilityIndex.structuralFragility,
      runtimeFragility:         fragilityIndex.runtimeFragility,
      chronicity:               fragilityIndex.chronicity,
      operationalConfidence:    fragilityIndex.operationalConfidence,
    },
    "[governance] P8-C: Workflow fragility index computed",
  );

  return { correlation, fragilityIndex };
}
