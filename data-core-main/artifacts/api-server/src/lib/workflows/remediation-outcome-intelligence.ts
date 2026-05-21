/**
 * @file   lib/workflows/remediation-outcome-intelligence.ts
 * @phase  P10-F - Remediation Outcome Intelligence & Resilience Effectiveness
 *                 Analytics Foundations
 *
 * Pure deterministic remediation analytics engine.
 * READ-ONLY: no DB writes, no policy mutation, no scheduler changes, no AI.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Computes historical remediation effectiveness intelligence from execution
 *   attempt records produced by P10-E:
 *
 *   computeOutcomeProfile(workspaceId, executionType, records)
 *     → RemediationOutcomeProfile    (per-workspace per-type analytics)
 *
 *   computeOperatorProfile(operatorId, records)
 *     → OperatorRemediationProfile   (per-operator analytics)
 *
 *   evaluateRemediationOutcomes(records)
 *     → RemediationOutcomeProfile[]  (all profiles from a record set)
 *
 *   scoreEffectiveness(metrics)
 *     → RemediationEffectivenessScore
 *
 *   computeMttrTrend(records)
 *     → MttrTrend                    (improving / stable / degrading)
 *
 *   detectChronicRecurrence(records, windowDays)
 *     → ChronicRecurrenceResult
 *
 *   computeRollbackFrequency(records)     → number (0.0-1.0)
 *   computeSuccessRate(records)           → number (0.0-1.0)
 *   computeAbandonmentRate(records)       → number (0.0-1.0)
 *   computeAverageRecoveryDuration(records) → number (milliseconds, or -1 if no data)
 *   buildPlatformEffectivenessSummary(records) → PlatformEffectivenessSummary
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:       engine never writes to DB, never mutates input records
 *   NO AUTO-ADJUST:  analytics never trigger policy or scheduler changes
 *   NO AI:           all scoring is deterministic threshold-based math
 *   NO RANKING:      operator profiles surface metrics only - no ranking system
 *   FAIL-CLOSED:     empty record sets return zero/neutral analytics
 *   DETERMINISTIC:   same inputs → same outputs every time
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTED TYPES (referenced from P10-E)
// ─────────────────────────────────────────────────────────────────────────────

export type RemediationExecutionType =
  | "scheduler_configuration_review"
  | "fairness_weight_adjustment"
  | "containment_boundary_reconfiguration"
  | "advisory_threshold_tuning"
  | "workload_pressure_investigation"
  | "recovery_validation_execution"
  | "escalation_stabilization"
  | "operational_intervention";

export type RemediationExecutionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "rolled_back"
  | "abandoned";

export type RemediationRollbackStatus =
  | "not_applicable"
  | "pending"
  | "completed"
  | "failed";

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slim projection of an execution attempt row used by the analytics engine.
 * Route handlers map DB rows to this type before calling engine functions.
 */
export interface ExecutionRecord {
  executionId:     string;
  workspaceId:     number;
  executionType:   RemediationExecutionType;
  initiatedBy:     string;
  confirmedBy:     string | null;
  executionStatus: RemediationExecutionStatus;
  rollbackStatus:  RemediationRollbackStatus;
  createdAt:       Date;
  confirmedAt:     Date | null;
  executedAt:      Date | null;
  completedAt:     Date | null;
  rolledBackAt:    Date | null;
  abandonedAt:     Date | null;
}

/**
 * Five-tier effectiveness score.
 * Derived deterministically from quantitative metrics.
 * Never used for enforcement, ranking, or automatic policy changes.
 */
export type RemediationEffectivenessScore =
  | "ineffective"
  | "unstable"
  | "acceptable"
  | "effective"
  | "highly_effective";

/**
 * Direction of MTTR (Mean Time To Recover) trend over a record set.
 */
export type MttrTrend = "improving" | "stable" | "degrading" | "insufficient_data";

/**
 * Per-workspace per-type outcome analytics profile.
 * Computed entirely from execution attempt records - never persisted separately.
 */
export interface RemediationOutcomeProfile {
  profileId:                 string;  // "<workspaceId>:<executionType>"
  workspaceId:               number;
  executionType:             RemediationExecutionType;
  totalExecutions:           number;
  successfulExecutions:      number;
  rolledBackExecutions:      number;
  abandonedExecutions:       number;
  /** 0.0-1.0 fraction of non-abandoned executions that completed */
  successRate:               number;
  /** 0.0-1.0 fraction of total executions that were rolled back */
  rollbackFrequency:         number;
  /** 0.0-1.0 fraction of total executions that were abandoned */
  abandonmentRate:           number;
  /** Average milliseconds from confirmedAt → completedAt (completed only). -1 if no data. */
  averageRecoveryDuration:   number;
  /** Whether execution patterns suggest chronic failure recurrence */
  chronicFailureRecurrence:  boolean;
  mttrTrend:                 MttrTrend;
  effectivenessScore:        RemediationEffectivenessScore;
  lastEvaluatedAt:           string;  // ISO 8601
}

/**
 * Per-operator analytics profile.
 * Surfaces metrics only - no ranking, no enforcement use.
 */
export interface OperatorRemediationProfile {
  operatorId:                  string;
  initiatedExecutions:         number;
  confirmedExecutions:         number;
  completedExecutions:         number;
  rolledBackExecutions:        number;
  abandonedExecutions:         number;
  /** 0.0-1.0 fraction of initiated that were completed */
  completionRate:              number;
  /** 0.0-1.0 fraction of initiated that were rolled back */
  rollbackFrequency:           number;
  /** 0.0-1.0: completedExecutions / (completedExecutions + rolledBackExecutions) */
  executionStabilityScore:     number;
  lastActivityAt:              string | null;  // ISO 8601 of most recent execution
}

/**
 * MTTR trend analysis result.
 */
export interface MttrTrend_Result {
  trend:          MttrTrend;
  firstHalfAvgMs: number;  // average recovery duration, older half of records
  secondHalfAvgMs: number; // average recovery duration, newer half of records
  improvementPct: number;  // positive = shorter recovery time (improvement)
  sampleSize:     number;
}

/**
 * Chronic recurrence detection result.
 */
export interface ChronicRecurrenceResult {
  isChronicRecurrent: boolean;
  recurrenceRate:     number;  // executions per day in the window
  windowDays:         number;
  executionsInWindow: number;
}

/**
 * Input to scoreEffectiveness().
 */
export interface EffectivenessMetrics {
  successRate:            number;  // 0.0-1.0
  rollbackFrequency:      number;  // 0.0-1.0
  abandonmentRate:        number;  // 0.0-1.0
  chronicRecurrence:      boolean;
}

/**
 * Platform-wide effectiveness summary across all workspaces and execution types.
 */
export interface PlatformEffectivenessSummary {
  totalExecutions:       number;
  successfulExecutions:  number;
  rolledBackExecutions:  number;
  abandonedExecutions:   number;
  overallSuccessRate:    number;
  overallRollbackRate:   number;
  platformEffectiveness: RemediationEffectivenessScore;
  byExecutionType:       Record<string, {
    total:        number;
    successRate:  number;
    rollbackRate: number;
    score:        RemediationEffectivenessScore;
  }>;
  evaluatedAt:           string;  // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fraction of non-abandoned executions that completed successfully.
 * Non-abandoned = completed + rolled_back (pending/confirmed/executing excluded
 * as they have not yet reached a terminal outcome).
 */
export function computeSuccessRate(records: ReadonlyArray<ExecutionRecord>): number {
  const terminal = records.filter(
    r => r.executionStatus === "completed" || r.executionStatus === "rolled_back",
  );
  if (terminal.length === 0) return 0;
  const completed = terminal.filter(r => r.executionStatus === "completed").length;
  return completed / terminal.length;
}

/**
 * Fraction of total executions that were rolled back.
 * Denominator: all records regardless of status.
 */
export function computeRollbackFrequency(records: ReadonlyArray<ExecutionRecord>): number {
  if (records.length === 0) return 0;
  const rolledBack = records.filter(r => r.executionStatus === "rolled_back").length;
  return rolledBack / records.length;
}

/**
 * Fraction of total executions that were abandoned before completion.
 */
export function computeAbandonmentRate(records: ReadonlyArray<ExecutionRecord>): number {
  if (records.length === 0) return 0;
  const abandoned = records.filter(r => r.executionStatus === "abandoned").length;
  return abandoned / records.length;
}

/**
 * Average recovery duration (milliseconds) from confirmedAt → completedAt.
 * Only counts completed executions that have both timestamps.
 * Returns -1 if no qualifying records exist.
 */
export function computeAverageRecoveryDuration(
  records: ReadonlyArray<ExecutionRecord>,
): number {
  const qualifying = records.filter(
    r =>
      r.executionStatus === "completed" &&
      r.confirmedAt !== null &&
      r.completedAt !== null,
  );
  if (qualifying.length === 0) return -1;
  const total = qualifying.reduce(
    (sum, r) => sum + (r.completedAt!.getTime() - r.confirmedAt!.getTime()),
    0,
  );
  return total / qualifying.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECTIVENESS SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic five-tier effectiveness score.
 *
 * Scoring thresholds (evaluated in order, first match wins):
 *
 *   ineffective:      successRate < 0.30  OR  rollbackFrequency > 0.60
 *   unstable:         successRate < 0.50  OR  rollbackFrequency > 0.40
 *                     OR  chronicRecurrence = true
 *   acceptable:       successRate >= 0.50 AND rollbackFrequency <= 0.40
 *   effective:        successRate >= 0.70 AND rollbackFrequency <= 0.25
 *                     AND abandonmentRate <= 0.15
 *   highly_effective: successRate >= 0.85 AND rollbackFrequency <= 0.10
 *                     AND abandonmentRate <= 0.10
 *
 * Pure: no DB, no async, no side effects.
 */
export function scoreEffectiveness(
  metrics: EffectivenessMetrics,
): RemediationEffectivenessScore {
  const { successRate, rollbackFrequency, abandonmentRate, chronicRecurrence } = metrics;

  if (successRate < 0.30 || rollbackFrequency > 0.60) {
    return "ineffective";
  }
  if (successRate < 0.50 || rollbackFrequency > 0.40 || chronicRecurrence) {
    return "unstable";
  }
  if (
    successRate >= 0.85 &&
    rollbackFrequency <= 0.10 &&
    abandonmentRate <= 0.10
  ) {
    return "highly_effective";
  }
  if (
    successRate >= 0.70 &&
    rollbackFrequency <= 0.25 &&
    abandonmentRate <= 0.15
  ) {
    return "effective";
  }
  return "acceptable";
}

// ─────────────────────────────────────────────────────────────────────────────
// MTTR TREND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes MTTR (Mean Time To Recover) trend by comparing the average recovery
 * duration of the older half vs the newer half of completed execution records.
 *
 * Requires at least 4 completed records with confirmedAt + completedAt.
 *
 * Trend semantics:
 *   improving  - newer half average < older half average (faster recovery)
 *   degrading  - newer half average > older half average (slower recovery)
 *   stable     - change is < 10% in either direction
 *   insufficient_data - fewer than 4 qualifying records
 *
 * Pure: no DB, no async, no side effects.
 */
export function computeMttrTrend(
  records: ReadonlyArray<ExecutionRecord>,
): MttrTrend_Result {
  const qualifying = records
    .filter(
      r =>
        r.executionStatus === "completed" &&
        r.confirmedAt !== null &&
        r.completedAt !== null,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (qualifying.length < 4) {
    return {
      trend:           "insufficient_data",
      firstHalfAvgMs:  0,
      secondHalfAvgMs: 0,
      improvementPct:  0,
      sampleSize:      qualifying.length,
    };
  }

  const mid     = Math.floor(qualifying.length / 2);
  const first   = qualifying.slice(0, mid);
  const second  = qualifying.slice(mid);

  const avg = (recs: typeof qualifying) =>
    recs.reduce(
      (sum, r) => sum + (r.completedAt!.getTime() - r.confirmedAt!.getTime()),
      0,
    ) / recs.length;

  const firstAvg  = avg(first);
  const secondAvg = avg(second);

  const changePct = firstAvg > 0
    ? ((firstAvg - secondAvg) / firstAvg) * 100
    : 0;

  let trend: MttrTrend;
  if (Math.abs(changePct) < 10) {
    trend = "stable";
  } else if (changePct > 0) {
    trend = "improving";  // secondAvg < firstAvg = shorter recovery = improving
  } else {
    trend = "degrading";
  }

  return {
    trend,
    firstHalfAvgMs:  Math.round(firstAvg),
    secondHalfAvgMs: Math.round(secondAvg),
    improvementPct:  Math.round(changePct * 10) / 10,
    sampleSize:      qualifying.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHRONIC RECURRENCE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether execution attempts for a given context are recurring
 * at a rate that suggests a chronic underlying issue.
 *
 * Chronic recurrence threshold: more than 3 executions in windowDays
 * that either rolled_back or were followed by another execution for the
 * same workspaceId + executionType.
 *
 * Recurrence rate: executions per day in the window.
 * Chronic threshold: recurrenceRate > 1.0 (more than 1 execution/day on average).
 *
 * Pure: no DB, no async, no side effects.
 */
export function detectChronicRecurrence(
  records:    ReadonlyArray<ExecutionRecord>,
  windowDays: number = 30,
): ChronicRecurrenceResult {
  const now           = new Date();
  const windowStart   = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow      = records.filter(r => r.createdAt >= windowStart);
  const recurrenceRate = windowDays > 0 ? inWindow.length / windowDays : 0;

  return {
    isChronicRecurrent: inWindow.length > 3 && recurrenceRate > 1.0,
    recurrenceRate:     Math.round(recurrenceRate * 100) / 100,
    windowDays,
    executionsInWindow: inWindow.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTCOME PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a RemediationOutcomeProfile from a filtered set of execution records
 * for a specific workspaceId + executionType combination.
 *
 * Pure: no DB, no async, no side effects.
 */
export function computeOutcomeProfile(
  workspaceId:   number,
  executionType: RemediationExecutionType,
  records:       ReadonlyArray<ExecutionRecord>,
  now:           Date = new Date(),
): RemediationOutcomeProfile {
  const successRate   = computeSuccessRate(records);
  const rollbackFreq  = computeRollbackFrequency(records);
  const abandonRate   = computeAbandonmentRate(records);
  const avgRecovery   = computeAverageRecoveryDuration(records);
  const recurrence    = detectChronicRecurrence(records);
  const mttr          = computeMttrTrend(records);
  const score         = scoreEffectiveness({
    successRate:       successRate,
    rollbackFrequency: rollbackFreq,
    abandonmentRate:   abandonRate,
    chronicRecurrence: recurrence.isChronicRecurrent,
  });

  return {
    profileId:                `${workspaceId}:${executionType}`,
    workspaceId,
    executionType,
    totalExecutions:          records.length,
    successfulExecutions:     records.filter(r => r.executionStatus === "completed").length,
    rolledBackExecutions:     records.filter(r => r.executionStatus === "rolled_back").length,
    abandonedExecutions:      records.filter(r => r.executionStatus === "abandoned").length,
    successRate:              Math.round(successRate * 1000) / 1000,
    rollbackFrequency:        Math.round(rollbackFreq * 1000) / 1000,
    abandonmentRate:          Math.round(abandonRate * 1000) / 1000,
    averageRecoveryDuration:  avgRecovery < 0 ? -1 : Math.round(avgRecovery),
    chronicFailureRecurrence: recurrence.isChronicRecurrent,
    mttrTrend:                mttr.trend,
    effectivenessScore:       score,
    lastEvaluatedAt:          now.toISOString(),
  };
}

/**
 * Evaluates outcome profiles for all distinct (workspaceId, executionType) pairs
 * present in the provided record set.
 *
 * Pure: no DB, no async, no side effects.
 */
export function evaluateRemediationOutcomes(
  records: ReadonlyArray<ExecutionRecord>,
  now:     Date = new Date(),
): RemediationOutcomeProfile[] {
  const groups = new Map<string, ExecutionRecord[]>();

  for (const r of records) {
    const key = `${r.workspaceId}:${r.executionType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(key, [r]);
    }
  }

  const profiles: RemediationOutcomeProfile[] = [];
  for (const [key, group] of groups) {
    const [wid, etype] = key.split(":") as [string, string];
    profiles.push(
      computeOutcomeProfile(
        parseInt(wid, 10),
        etype as RemediationExecutionType,
        group,
        now,
      ),
    );
  }

  return profiles.sort((a, b) => a.profileId.localeCompare(b.profileId));
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes an OperatorRemediationProfile for a specific operator (initiatedBy).
 * Considers all executions initiated by that operator.
 *
 * Pure: no DB, no async, no side effects.
 * No ranking produced - metrics only.
 */
export function computeOperatorProfile(
  operatorId: string,
  records:    ReadonlyArray<ExecutionRecord>,
): OperatorRemediationProfile {
  const mine = records.filter(r => r.initiatedBy === operatorId);

  const completed   = mine.filter(r => r.executionStatus === "completed").length;
  const rolledBack  = mine.filter(r => r.executionStatus === "rolled_back").length;
  const abandoned   = mine.filter(r => r.executionStatus === "abandoned").length;
  const confirmed   = mine.filter(r => r.confirmedBy !== null).length;
  const total       = mine.length;

  const completionRate  = total > 0 ? completed / total : 0;
  const rollbackFreq    = total > 0 ? rolledBack / total : 0;
  const stabilityDenom  = completed + rolledBack;
  const stability       = stabilityDenom > 0 ? completed / stabilityDenom : 0;

  const mostRecent = mine.reduce(
    (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
    null as Date | null,
  );

  return {
    operatorId,
    initiatedExecutions:     total,
    confirmedExecutions:     confirmed,
    completedExecutions:     completed,
    rolledBackExecutions:    rolledBack,
    abandonedExecutions:     abandoned,
    completionRate:          Math.round(completionRate * 1000) / 1000,
    rollbackFrequency:       Math.round(rollbackFreq * 1000) / 1000,
    executionStabilityScore: Math.round(stability * 1000) / 1000,
    lastActivityAt:          mostRecent ? mostRecent.toISOString() : null,
  };
}

/**
 * Evaluates operator profiles for all distinct operators (initiatedBy values)
 * present in the record set.
 *
 * Pure: no DB, no async, no side effects.
 */
export function evaluateOperatorProfiles(
  records: ReadonlyArray<ExecutionRecord>,
): OperatorRemediationProfile[] {
  const operators = new Set(records.map(r => r.initiatedBy));
  return [...operators]
    .map(op => computeOperatorProfile(op, records))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a platform-wide effectiveness summary from all execution records.
 *
 * Pure: no DB, no async, no side effects.
 */
export function buildPlatformEffectivenessSummary(
  records: ReadonlyArray<ExecutionRecord>,
  now:     Date = new Date(),
): PlatformEffectivenessSummary {
  const total       = records.length;
  const successful  = records.filter(r => r.executionStatus === "completed").length;
  const rolledBack  = records.filter(r => r.executionStatus === "rolled_back").length;
  const abandoned   = records.filter(r => r.executionStatus === "abandoned").length;

  const overallSuccessRate = computeSuccessRate(records);
  const overallRollbackRate = total > 0 ? rolledBack / total : 0;

  const platformScore = scoreEffectiveness({
    successRate:       overallSuccessRate,
    rollbackFrequency: overallRollbackRate,
    abandonmentRate:   total > 0 ? abandoned / total : 0,
    chronicRecurrence: false,
  });

  // Per execution type breakdown
  const typeMap = new Map<string, ExecutionRecord[]>();
  for (const r of records) {
    const existing = typeMap.get(r.executionType);
    if (existing) existing.push(r);
    else typeMap.set(r.executionType, [r]);
  }

  const byExecutionType: PlatformEffectivenessSummary["byExecutionType"] = {};
  for (const [type, group] of typeMap) {
    const sr = computeSuccessRate(group);
    const rr = group.length > 0
      ? group.filter(r => r.executionStatus === "rolled_back").length / group.length
      : 0;
    byExecutionType[type] = {
      total:       group.length,
      successRate: Math.round(sr * 1000) / 1000,
      rollbackRate: Math.round(rr * 1000) / 1000,
      score: scoreEffectiveness({
        successRate:       sr,
        rollbackFrequency: rr,
        abandonmentRate:   group.length > 0
          ? group.filter(r => r.executionStatus === "abandoned").length / group.length
          : 0,
        chronicRecurrence: false,
      }),
    };
  }

  return {
    totalExecutions:      total,
    successfulExecutions: successful,
    rolledBackExecutions: rolledBack,
    abandonedExecutions:  abandoned,
    overallSuccessRate:   Math.round(overallSuccessRate * 1000) / 1000,
    overallRollbackRate:  Math.round(overallRollbackRate * 1000) / 1000,
    platformEffectiveness: platformScore,
    byExecutionType,
    evaluatedAt:          now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface OutcomeEventPayload {
  workspaceId:       number;
  executionType:     string;
  effectivenessScore: string;
  rollbackFrequency: number;
  operatorId:        string;
  action:            string;
}

export function emitOutcomeProfileEvaluatedEvent(p: OutcomeEventPayload): void {
  logger.info(
    { event: "remediation_outcome_profile_evaluated", ...p },
    "[remediation-outcome] P10-F: remediation_outcome_profile_evaluated",
  );
}

export function emitEffectivenessScoredEvent(p: OutcomeEventPayload): void {
  logger.info(
    { event: "execution_effectiveness_scored", ...p },
    "[remediation-outcome] P10-F: execution_effectiveness_scored",
  );
}

export function emitRollbackTrendDetectedEvent(p: OutcomeEventPayload): void {
  logger.info(
    { event: "rollback_trend_detected", ...p },
    "[remediation-outcome] P10-F: rollback_trend_detected",
  );
}

export function emitOperatorEffectivenessUpdatedEvent(p: OutcomeEventPayload): void {
  logger.info(
    { event: "operator_effectiveness_updated", ...p },
    "[remediation-outcome] P10-F: operator_effectiveness_updated",
  );
}
