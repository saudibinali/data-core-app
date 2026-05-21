/**
 * @file   lib/workflows/workload-partition.ts
 * @phase  P9-B - Workload Partitioning & Execution Containment Foundations
 *
 * Pure deterministic workload containment advisory engine.
 * No DB, no async, no throttling, no scheduler mutations, no side effects.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   evaluateWorkloadContainment(input, context?) → TenantWorkloadPartition
 *
 *   Internally:
 *     1. computePartitionPressureScore()  - weighted 0-100 pressure score
 *     2. classifyExecutionPressure()      - normal / elevated / high / critical
 *     3. computeContainmentStatus()       - contained / at_risk / pressured / saturated
 *     4. computeSchedulerWeight()         - advisory fairness weight 0.25-1.00
 *     5. detectNoisyBehavior()            - 4-category noisy-tenant detection
 *     6. classifyAdvisoryPressure()       - governance advisory → advisory pressure level
 *     7. Emit 4 structured observability events
 *
 * ── INPUTS (WorkloadContainmentInput) ───────────────────────────────────────
 *
 *   workspaceId              - authenticated workspace (from TenantIsolationContext)
 *   activeExecutionCount     - current workflow_executions with status='running'
 *   delayedExecutionCount    - current workflow_executions with status='waiting_delay'
 *   hotspotConcentrationRatio? - P8-E hotspotConcentration.concentrationRatio (0-1)
 *   urgentOrCriticalCount?   - P8-E hotspotConcentration.urgentOrCriticalCount
 *   avgRuntimeWeightedComplexity? - P8-C average rWC across workspace workflows (0-100)
 *   maxRuntimeWeightedComplexity? - P8-C maximum rWC in the workspace (0-100)
 *   advisoryLevel?           - P8-F GovernanceAdvisoryLevel
 *   totalActiveSignals?      - P8-F totalSignals
 *   platformActiveExecutions? - total active executions across ALL workspaces (dominance check)
 *   platformDelayedBacklog?  - total delayed executions across ALL workspaces
 *   schedulerBatchSize?      - scheduler BATCH_SIZE (default 10, from P6-A scheduler.ts)
 *
 * ── PRESSURE SCORING MODEL ───────────────────────────────────────────────────
 *
 *   total = activeScore + delayedScore + hotspotScore + complexityScore + advisoryScore
 *
 *   activeScore     (0-40)  - active execution pressure
 *   delayedScore    (0-25)  - delayed backlog pressure
 *   hotspotScore    (0-20)  - governance hotspot concentration (P8-E)
 *   complexityScore (0-10)  - runtime-weighted complexity (P8-C)
 *   advisoryScore   (0-5)   - advisory escalation severity (P8-F)
 *
 *   total is a non-negative integer 0-100.
 *
 * ── CLASSIFICATION THRESHOLDS ────────────────────────────────────────────────
 *
 *   executionPressureLevel:
 *     0-25   → "normal"
 *     26-50  → "elevated"
 *     51-75  → "high"
 *     76-100 → "critical"
 *
 *   containmentStatus:
 *     "normal"   → "contained"
 *     "elevated" → "at_risk"
 *     "high"     → "pressured"
 *     "critical" → "saturated"
 *
 *   schedulerWeight (advisory fairness):
 *     "contained"  → 1.00
 *     "at_risk"    → 0.75
 *     "pressured"  → 0.50
 *     "saturated"  → 0.25   (never 0 - no starvation guarantee)
 *
 * ── NOISY TENANT DETECTION ───────────────────────────────────────────────────
 *
 *   EXECUTION_MONOPOLY      - tenant holds >50% of platform active executions
 *   SCHEDULER_BACKLOG_FLOOD - delayed backlog > schedulerBatchSize × 5
 *   ADVISORY_STORM          - totalSignals > 10 with advisory ∈ {urgent, critical}
 *   CHRONIC_HOTSPOT_FLOOD   - urgentOrCritical ≥ 3 AND concentration > 0.50
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   • ADVISORY-ONLY: never throttles, pauses, or mutates scheduler behavior
 *   • READ-ONLY: never mutates input, DB, or execution state
 *   • DETERMINISTIC: identical inputs → identical output (given same evaluationTime)
 *   • NO STARVATION: schedulerWeight never below 0.25 regardless of pressure
 *   • FAIL-CLOSED: negative/invalid counts treated as 0 (no silent NaN propagation)
 *   • JSON-SAFE: all output is plain JSON-serializable (no class instances)
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - pressure and containment enums
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionPressureLevel = "normal" | "elevated" | "high" | "critical";
export type ContainmentStatus      = "contained" | "at_risk" | "pressured" | "saturated";
export type AdvisoryPressureLevel  = "none" | "low" | "medium" | "high" | "critical";
export type NoisyBehaviorCategory  =
  | "EXECUTION_MONOPOLY"
  | "SCHEDULER_BACKLOG_FLOOD"
  | "ADVISORY_STORM"
  | "CHRONIC_HOTSPOT_FLOOD";

// Maps from P8-F GovernanceAdvisoryLevel
export type GovernanceAdvisoryLevel =
  | "informational" | "advisory" | "elevated" | "urgent" | "critical";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - pressure score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized 5-component workload pressure score (total 0-100).
 *
 * activeExecutionScore  (0-40) - dominates: running executions burn CPU/DB now
 * delayedBacklogScore   (0-25) - secondary: delayed queue depth
 * hotspotDensityScore   (0-20) - P8-E: % of workflows at dominant risk
 * complexityScore       (0-10) - P8-C: max runtimeWeightedComplexity
 * advisoryScore         (0-5)  - P8-F: governance advisory escalation
 */
export interface PartitionPressureScore {
  /** Sum of all components, clamped to [0, 100]. */
  total:                number;
  /** Active execution contribution (0-40). */
  activeExecutionScore: number;
  /** Delayed backlog contribution (0-25). */
  delayedBacklogScore:  number;
  /** P8-E hotspot concentration contribution (0-20). */
  hotspotDensityScore:  number;
  /** P8-C runtimeWeightedComplexity contribution (0-10). */
  complexityScore:      number;
  /** P8-F advisory level contribution (0-5). */
  advisoryScore:        number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - main partition model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete workload containment model for a single workspace tenant.
 *
 * Produced by evaluateWorkloadContainment().
 * Advisory-only - never implies automatic throttling or scheduler mutation.
 */
export interface TenantWorkloadPartition {
  /** Workspace DB primary key. */
  workspaceId:            number;
  /** Canonical partition identifier. Format: "part:<workspaceId>". */
  partitionId:            string;
  /** 5-component pressure score (0-100). */
  pressureScore:          PartitionPressureScore;
  /** Classification of overall execution pressure. */
  executionPressureLevel: ExecutionPressureLevel;
  /** Number of currently running workflow executions in this workspace. */
  activeExecutionCount:   number;
  /** Number of executions waiting in the scheduler delayed queue. */
  delayedExecutionCount:  number;
  /** Governance advisory pressure mapped from P8-F advisoryLevel. */
  advisoryPressureLevel:  AdvisoryPressureLevel;
  /**
   * Advisory scheduler fairness weight (0.25-1.00).
   *   1.00 - contained    (normal pressure, full scheduler share)
   *   0.75 - at_risk      (elevated pressure, slightly reduced share)
   *   0.50 - pressured    (high pressure, reduced share)
   *   0.25 - saturated    (critical pressure, minimum guaranteed share)
   * NEVER 0: ensures no tenant starvation even under advisory saturation.
   */
  schedulerWeight:        number;
  /** Containment status derived from executionPressureLevel. */
  containmentStatus:      ContainmentStatus;
  /** True if any noisy-tenant behavior category was detected. */
  noisyBehaviorDetected:  boolean;
  /** Human-readable descriptions of detected noisy-tenant behavior. */
  noisyBehaviorReasons:   string[];
  /** Structured noisy behavior category codes. */
  noisyBehaviorCodes:     NoisyBehaviorCategory[];
  /** ISO 8601 timestamp when this partition was evaluated. */
  evaluatedAt:            string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - input
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkloadContainmentInput {
  workspaceId:                    number;
  /** Running workflow executions in this workspace right now. */
  activeExecutionCount:           number;
  /** Executions in status='waiting_delay' in this workspace. */
  delayedExecutionCount:          number;
  /**
   * From P8-E WorkspaceHotspotConcentration.concentrationRatio (0-1).
   * % of workspace workflows at dominant risk level.
   */
  hotspotConcentrationRatio?:     number;
  /**
   * From P8-E WorkspaceHotspotConcentration.urgentOrCriticalCount.
   * Number of workflows at urgent or critical operational priority.
   */
  urgentOrCriticalWorkflowCount?: number;
  /**
   * From P8-C: average runtimeWeightedComplexity across all active workflows
   * in this workspace (0-100).
   */
  avgRuntimeWeightedComplexity?:  number;
  /**
   * From P8-C: maximum runtimeWeightedComplexity across all active workflows
   * in this workspace (0-100). Used for worst-case complexity score.
   */
  maxRuntimeWeightedComplexity?:  number;
  /**
   * From P8-F: GovernanceAdvisoryLevel for the workspace.
   * Maps to advisoryScore contribution.
   */
  advisoryLevel?:                 GovernanceAdvisoryLevel;
  /**
   * From P8-F: total active governance signals for this workspace.
   * Used in noisy-tenant advisory storm detection.
   */
  totalActiveSignals?:            number;
  /**
   * Total running executions across ALL workspaces on this platform instance.
   * Used for EXECUTION_MONOPOLY noisy-tenant detection.
   * If omitted, monopoly detection is skipped.
   */
  platformActiveExecutions?:      number;
  /**
   * Total delayed backlog across ALL workspaces on this platform instance.
   * Used for platform-wide scheduler saturation assessment.
   */
  platformDelayedBacklog?:        number;
  /**
   * Scheduler BATCH_SIZE (P6-A). Default 10.
   * Used for SCHEDULER_BACKLOG_FLOOD threshold: backlog > batchSize × 5.
   */
  schedulerBatchSize?:            number;
}

export interface WorkloadContainmentContext {
  /** ISO 8601 timestamp for evaluatedAt. Defaults to new Date(). Tests override. */
  evaluationTime?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS - scoring thresholds
// ─────────────────────────────────────────────────────────────────────────────

/** Active execution count at which activeExecutionScore reaches 40 (max). */
const MAX_SAFE_ACTIVE_EXECUTIONS = 50;

/** Delayed execution count at which delayedBacklogScore reaches 25 (max). */
const MAX_SAFE_DELAYED_EXECUTIONS = 30;

/** Monopoly threshold: tenant holds this fraction of platform active executions. */
const MONOPOLY_THRESHOLD = 0.50;

/** Scheduler flood multiplier: backlog > BATCH_SIZE × this triggers flood. */
const SCHEDULER_FLOOD_MULTIPLIER = 5;

/** Advisory storm: total signals above this threshold + high/critical advisory. */
const ADVISORY_STORM_SIGNAL_THRESHOLD = 10;

/** Chronic hotspot flood: urgentOrCritical count at or above this. */
const CHRONIC_HOTSPOT_MIN_COUNT = 3;

/** Chronic hotspot flood: concentration ratio above this. */
const CHRONIC_HOTSPOT_CONCENTRATION_THRESHOLD = 0.50;

/** Default scheduler batch size (from P6-A scheduler.ts). */
const DEFAULT_SCHEDULER_BATCH_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates workload containment for a single workspace tenant.
 *
 * Pure, deterministic, advisory-only.
 * Never throttles, pauses executions, or mutates scheduler state.
 *
 * Emits 4 structured observability events via logger.
 */
export function evaluateWorkloadContainment(
  input:    WorkloadContainmentInput,
  context?: WorkloadContainmentContext,
): TenantWorkloadPartition {
  const evaluatedAt    = (context?.evaluationTime ?? new Date()).toISOString();
  const partitionId    = makePartitionId(input.workspaceId);
  const batchSize      = Math.max(1, input.schedulerBatchSize ?? DEFAULT_SCHEDULER_BATCH_SIZE);

  // Sanitize counts - negative values treated as 0 (no NaN propagation)
  const active  = Math.max(0, Math.floor(input.activeExecutionCount  || 0));
  const delayed = Math.max(0, Math.floor(input.delayedExecutionCount || 0));

  // ── 1. Compute pressure score ──────────────────────────────────────────────
  const pressureScore = computePartitionPressureScore({
    active,
    delayed,
    hotspotConcentrationRatio:    input.hotspotConcentrationRatio,
    maxRuntimeWeightedComplexity: input.maxRuntimeWeightedComplexity,
    advisoryLevel:                input.advisoryLevel,
  });

  // ── 2. Classify pressure level ────────────────────────────────────────────
  const executionPressureLevel = classifyExecutionPressure(pressureScore.total);

  // ── 3. Compute containment status ─────────────────────────────────────────
  const containmentStatus = computeContainmentStatus(executionPressureLevel);

  // ── 4. Compute scheduler weight ───────────────────────────────────────────
  const schedulerWeight = computeSchedulerWeight(containmentStatus);

  // ── 5. Map advisory pressure level ────────────────────────────────────────
  const advisoryPressureLevel = classifyAdvisoryPressure(input.advisoryLevel);

  // ── 6. Noisy-tenant detection ─────────────────────────────────────────────
  const noisy = detectNoisyBehavior({
    workspaceId:                    input.workspaceId,
    active,
    delayed,
    advisoryLevel:                  input.advisoryLevel,
    totalActiveSignals:             input.totalActiveSignals,
    urgentOrCriticalWorkflowCount:  input.urgentOrCriticalWorkflowCount,
    hotspotConcentrationRatio:      input.hotspotConcentrationRatio,
    platformActiveExecutions:       input.platformActiveExecutions,
    batchSize,
  });

  // ── 7. Emit observability events ──────────────────────────────────────────
  _emitEvents(
    input.workspaceId,
    partitionId,
    pressureScore,
    executionPressureLevel,
    schedulerWeight,
    containmentStatus,
    noisy,
    input,
    evaluatedAt,
  );

  return {
    workspaceId:            input.workspaceId,
    partitionId,
    pressureScore,
    executionPressureLevel,
    activeExecutionCount:   active,
    delayedExecutionCount:  delayed,
    advisoryPressureLevel,
    schedulerWeight,
    containmentStatus,
    noisyBehaviorDetected:  noisy.detected,
    noisyBehaviorReasons:   noisy.reasons,
    noisyBehaviorCodes:     noisy.codes,
    evaluatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESSURE SCORING
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreInput {
  active:                       number;
  delayed:                      number;
  hotspotConcentrationRatio?:   number;
  maxRuntimeWeightedComplexity?: number;
  advisoryLevel?:               GovernanceAdvisoryLevel;
}

/**
 * Computes the 5-component partition pressure score.
 *
 * Components and weights:
 *   activeExecutionScore  - min(active / 50, 1.0) × 40
 *   delayedBacklogScore   - min(delayed / 30, 1.0) × 25
 *   hotspotDensityScore   - concentrationRatio × 20 (default 0 if absent)
 *   complexityScore       - maxRWC / 100 × 10 (default 0 if absent)
 *   advisoryScore         - mapped from GovernanceAdvisoryLevel (0-5)
 *
 * All components are floored to integers. Total is clamped to [0, 100].
 */
export function computePartitionPressureScore(input: ScoreInput): PartitionPressureScore {
  const activeExecutionScore = Math.floor(
    Math.min(input.active / MAX_SAFE_ACTIVE_EXECUTIONS, 1.0) * 40,
  );

  const delayedBacklogScore = Math.floor(
    Math.min(input.delayed / MAX_SAFE_DELAYED_EXECUTIONS, 1.0) * 25,
  );

  const hotspotRatio = Math.max(0, Math.min(1, input.hotspotConcentrationRatio ?? 0));
  const hotspotDensityScore = Math.floor(hotspotRatio * 20);

  const maxRWC = Math.max(0, Math.min(100, input.maxRuntimeWeightedComplexity ?? 0));
  const complexityScore = Math.floor((maxRWC / 100) * 10);

  const advisoryScore = _advisoryToScore(input.advisoryLevel);

  const total = Math.min(
    100,
    activeExecutionScore + delayedBacklogScore + hotspotDensityScore +
    complexityScore + advisoryScore,
  );

  return {
    total,
    activeExecutionScore,
    delayedBacklogScore,
    hotspotDensityScore,
    complexityScore,
    advisoryScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the execution pressure level from a 0-100 total score.
 *
 *   0-25   → "normal"
 *   26-50  → "elevated"
 *   51-75  → "high"
 *   76-100 → "critical"
 */
export function classifyExecutionPressure(totalScore: number): ExecutionPressureLevel {
  if (totalScore >= 76) return "critical";
  if (totalScore >= 51) return "high";
  if (totalScore >= 26) return "elevated";
  return "normal";
}

/**
 * Maps executionPressureLevel to containmentStatus.
 *
 *   normal   → "contained"
 *   elevated → "at_risk"
 *   high     → "pressured"
 *   critical → "saturated"
 */
export function computeContainmentStatus(level: ExecutionPressureLevel): ContainmentStatus {
  switch (level) {
    case "normal":   return "contained";
    case "elevated": return "at_risk";
    case "high":     return "pressured";
    case "critical": return "saturated";
  }
}

/**
 * Computes advisory scheduler fairness weight from containmentStatus.
 *
 * No tenant starvation guarantee: weight never below 0.25.
 *
 *   contained  → 1.00  (full scheduler share)
 *   at_risk    → 0.75  (slightly reduced)
 *   pressured  → 0.50  (half share advisory)
 *   saturated  → 0.25  (minimum guaranteed share)
 *
 * ADVISORY-ONLY: this weight is returned for governance console display
 * and future scheduler fairness infrastructure. It does NOT currently
 * modify the actual P6-A scheduler behavior.
 */
export function computeSchedulerWeight(status: ContainmentStatus): number {
  switch (status) {
    case "contained":  return 1.00;
    case "at_risk":    return 0.75;
    case "pressured":  return 0.50;
    case "saturated":  return 0.25;
  }
}

/**
 * Maps P8-F GovernanceAdvisoryLevel to AdvisoryPressureLevel.
 *
 *   informational → "none"
 *   advisory      → "low"
 *   elevated      → "medium"
 *   urgent        → "high"
 *   critical      → "critical"
 *   undefined     → "none"
 */
export function classifyAdvisoryPressure(
  level?: GovernanceAdvisoryLevel,
): AdvisoryPressureLevel {
  switch (level) {
    case "critical":      return "critical";
    case "urgent":        return "high";
    case "elevated":      return "medium";
    case "advisory":      return "low";
    case "informational": return "none";
    default:              return "none";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOISY TENANT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

interface NoisyDetectionInput {
  workspaceId:                     number;
  active:                          number;
  delayed:                         number;
  advisoryLevel?:                  GovernanceAdvisoryLevel;
  totalActiveSignals?:             number;
  urgentOrCriticalWorkflowCount?:  number;
  hotspotConcentrationRatio?:      number;
  platformActiveExecutions?:       number;
  batchSize:                       number;
}

interface NoisyBehaviorResult {
  detected: boolean;
  codes:    NoisyBehaviorCategory[];
  reasons:  string[];
}

/**
 * Detects 4 categories of noisy-tenant behavior.
 * Pure, non-throwing, advisory-only.
 *
 * EXECUTION_MONOPOLY:
 *   Tenant holds > MONOPOLY_THRESHOLD (50%) of platform active executions.
 *   Requires platformActiveExecutions to be provided. Skipped if absent.
 *   Risk: other tenants starved of the shared execution pipeline.
 *
 * SCHEDULER_BACKLOG_FLOOD:
 *   Tenant's delayed backlog > schedulerBatchSize × SCHEDULER_FLOOD_MULTIPLIER (×5).
 *   With BATCH_SIZE=10 (P6-A default), triggers at 50+ delayed executions.
 *   Risk: scheduler requires multiple full cycles just for this one workspace.
 *
 * ADVISORY_STORM:
 *   totalActiveSignals > ADVISORY_STORM_SIGNAL_THRESHOLD (10) AND
 *   advisoryLevel ∈ {urgent, critical}.
 *   Risk: workspace is generating more governance signals than it can resolve.
 *
 * CHRONIC_HOTSPOT_FLOOD:
 *   urgentOrCriticalWorkflowCount ≥ CHRONIC_HOTSPOT_MIN_COUNT (3) AND
 *   hotspotConcentrationRatio > CHRONIC_HOTSPOT_CONCENTRATION_THRESHOLD (0.50).
 *   Risk: >50% of workspace workflows are at urgent/critical risk with 3+
 *   individual workflows confirmed at that level - systemic degradation.
 */
export function detectNoisyBehavior(input: NoisyDetectionInput): NoisyBehaviorResult {
  const codes:   NoisyBehaviorCategory[] = [];
  const reasons: string[]                = [];

  // ── EXECUTION_MONOPOLY ────────────────────────────────────────────────────
  if (
    input.platformActiveExecutions !== undefined &&
    input.platformActiveExecutions !== null &&
    input.platformActiveExecutions > 0 &&
    input.active > 0
  ) {
    const dominanceFraction = input.active / input.platformActiveExecutions;
    if (dominanceFraction > MONOPOLY_THRESHOLD) {
      codes.push("EXECUTION_MONOPOLY");
      reasons.push(
        `Workspace ${input.workspaceId} holds ${Math.round(dominanceFraction * 100)}% ` +
        `of platform active executions (${input.active}/${input.platformActiveExecutions}). ` +
        `Threshold: >${Math.round(MONOPOLY_THRESHOLD * 100)}%.`,
      );
    }
  }

  // ── SCHEDULER_BACKLOG_FLOOD ───────────────────────────────────────────────
  const backlogThreshold = input.batchSize * SCHEDULER_FLOOD_MULTIPLIER;
  if (input.delayed > backlogThreshold) {
    codes.push("SCHEDULER_BACKLOG_FLOOD");
    reasons.push(
      `Workspace ${input.workspaceId} has ${input.delayed} delayed executions, ` +
      `exceeding scheduler flood threshold of ${backlogThreshold} ` +
      `(schedulerBatchSize=${input.batchSize} × ${SCHEDULER_FLOOD_MULTIPLIER}). ` +
      `At least ${Math.ceil(input.delayed / input.batchSize)} scheduler cycles needed to clear this workspace alone.`,
    );
  }

  // ── ADVISORY_STORM ────────────────────────────────────────────────────────
  const signalCount    = input.totalActiveSignals ?? 0;
  const isHighAdvisory = input.advisoryLevel === "urgent" || input.advisoryLevel === "critical";
  if (signalCount > ADVISORY_STORM_SIGNAL_THRESHOLD && isHighAdvisory) {
    codes.push("ADVISORY_STORM");
    reasons.push(
      `Workspace ${input.workspaceId} has ${signalCount} active governance signals ` +
      `(threshold: >${ADVISORY_STORM_SIGNAL_THRESHOLD}) with advisory level "${input.advisoryLevel}". ` +
      `Governance alert volume exceeds the operational response capacity.`,
    );
  }

  // ── CHRONIC_HOTSPOT_FLOOD ─────────────────────────────────────────────────
  const urgentCriticalCount   = input.urgentOrCriticalWorkflowCount ?? 0;
  const concentrationRatio    = input.hotspotConcentrationRatio     ?? 0;
  if (
    urgentCriticalCount >= CHRONIC_HOTSPOT_MIN_COUNT &&
    concentrationRatio > CHRONIC_HOTSPOT_CONCENTRATION_THRESHOLD
  ) {
    codes.push("CHRONIC_HOTSPOT_FLOOD");
    reasons.push(
      `Workspace ${input.workspaceId} has ${urgentCriticalCount} workflows at urgent/critical priority ` +
      `(threshold: ≥${CHRONIC_HOTSPOT_MIN_COUNT}) with a hotspot concentration ratio of ` +
      `${Math.round(concentrationRatio * 100)}% (threshold: >${Math.round(CHRONIC_HOTSPOT_CONCENTRATION_THRESHOLD * 100)}%). ` +
      `Systemic governance degradation detected.`,
    );
  }

  return {
    detected: codes.length > 0,
    codes,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the canonical partition ID for a workspace. */
export function makePartitionId(workspaceId: number): string {
  return `part:${workspaceId}`;
}

/** Maps GovernanceAdvisoryLevel to a 0-5 integer score contribution. */
function _advisoryToScore(level?: GovernanceAdvisoryLevel): number {
  switch (level) {
    case "critical":      return 5;
    case "urgent":        return 4;
    case "elevated":      return 3;
    case "advisory":      return 2;
    case "informational": return 1;
    default:              return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY - 4 structured events
// ─────────────────────────────────────────────────────────────────────────────

function _emitEvents(
  workspaceId:            number,
  partitionId:            string,
  pressureScore:          PartitionPressureScore,
  executionPressureLevel: ExecutionPressureLevel,
  schedulerWeight:        number,
  containmentStatus:      ContainmentStatus,
  noisy:                  NoisyBehaviorResult,
  input:                  WorkloadContainmentInput,
  evaluatedAt:            string,
): void {
  const base = {
    workspaceId,
    partitionId,
    executionPressureLevel,
    schedulerWeight,
    containmentStatus,
  };

  // ── A) tenant_partition_pressure_evaluated ─────────────────────────────────
  logger.info(
    {
      event:                    "tenant_partition_pressure_evaluated",
      ...base,
      pressureTotal:            pressureScore.total,
      activeExecutionScore:     pressureScore.activeExecutionScore,
      delayedBacklogScore:      pressureScore.delayedBacklogScore,
      hotspotDensityScore:      pressureScore.hotspotDensityScore,
      complexityScore:          pressureScore.complexityScore,
      advisoryScore:            pressureScore.advisoryScore,
      activeExecutionCount:     input.activeExecutionCount,
      delayedExecutionCount:    input.delayedExecutionCount,
      action:                   "evaluated",
      evaluatedAt,
    },
    "[workload] P9-B: tenant_partition_pressure_evaluated",
  );

  // ── B) tenant_noisy_behavior_detected (conditional) ────────────────────────
  if (noisy.detected) {
    logger.info(
      {
        event:                    "tenant_noisy_behavior_detected",
        ...base,
        noisyBehaviorCodes:       noisy.codes,
        noisyBehaviorReasonCount: noisy.reasons.length,
        noisyBehaviorReasons:     noisy.reasons,
        action:                   "advisory",
      },
      "[workload] P9-B: tenant_noisy_behavior_detected",
    );
  }

  // ── C) scheduler_fairness_risk_detected (conditional) ─────────────────────
  if (containmentStatus !== "contained") {
    logger.info(
      {
        event:                    "scheduler_fairness_risk_detected",
        ...base,
        fairnessRisk:             containmentStatus === "saturated" ? "critical"
                                : containmentStatus === "pressured"  ? "high"
                                : "moderate",
        platformActiveExecutions: input.platformActiveExecutions ?? null,
        platformDelayedBacklog:   input.platformDelayedBacklog   ?? null,
        schedulerBatchSize:       input.schedulerBatchSize        ?? DEFAULT_SCHEDULER_BATCH_SIZE,
        action:                   "advisory",
      },
      "[workload] P9-B: scheduler_fairness_risk_detected",
    );
  }

  // ── D) tenant_execution_containment_assessed (always) ─────────────────────
  logger.info(
    {
      event:                    "tenant_execution_containment_assessed",
      ...base,
      noisyBehaviorDetected:    noisy.detected,
      noisyBehaviorCodeCount:   noisy.codes.length,
      advisoryPressureLevel:    classifyAdvisoryPressure(input.advisoryLevel),
      totalActiveSignals:       input.totalActiveSignals ?? null,
      hotspotConcentrationRatio: input.hotspotConcentrationRatio ?? null,
      action:                   "advisory",
      evaluatedAt,
    },
    "[workload] P9-B: tenant_execution_containment_assessed",
  );
}
