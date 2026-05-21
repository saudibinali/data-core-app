/**
 * @file   lib/workflows/platform-governance.ts
 * @phase  P9-D - Platform Workload Control Plane & Super-Admin Operational Visibility
 *
 * Pure deterministic platform governance aggregation engine.
 * No DB, no async, no mutations, no per-tenant isolation violations.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   buildPlatformGovernanceOverview(input) → PlatformGovernanceOverview
 *
 *   Aggregates an array of per-workspace TenantWorkloadPartitions into a
 *   platform-wide operational governance view:
 *
 *     1. computeContainmentDistribution()   - counts by containmentStatus
 *     2. computeAdvisoryDistribution()      - counts by advisoryPressureLevel
 *     3. classifyPlatformFairnessHealth()   - platform-wide health classification
 *     4. computeSchedulerPressureSummary()  - aggregate execution pressure stats
 *     5. computeTopPressureWorkspaces()     - top-N by pressureScore DESC
 *     6. detectNoisyTenants()               - all workspaces with noisy behavior
 *     7. Emits platform_governance_overview_generated event
 *
 * ── INPUTS (PlatformGovernanceInput) ─────────────────────────────────────────
 *
 *   workspaceCount     - total workspace count from DB (may differ from partitions)
 *   partitions         - array of TenantWorkloadPartition (one per workspace)
 *   workspaceNames?    - map workspaceId → name for display
 *   requestScopeId     - platform-scoped per-request correlation ID
 *   generationTime?    - override for deterministic timestamps (tests)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:          never mutates input partitions or any sub-array
 *   ADVISORY-ONLY:      no scheduler state change, no throttling, no writes
 *   DETERMINISTIC:      same inputs + same time → same output
 *   BOUNDED PAYLOADS:   topPressureWorkspaces limited to TOP_WORKSPACE_LIMIT
 *   JSON-SAFE:          all output is plain JSON-serializable
 *   NO SENSITIVE DATA:  workspaceName only - no tokens, passwords, configs
 *   SUPER-ADMIN ONLY:   routes enforce requireSuperAdmin; engine is unguarded
 */

import { logger } from "../logger";
import type {
  TenantWorkloadPartition,
  ContainmentStatus,
  ExecutionPressureLevel,
  AdvisoryPressureLevel,
  NoisyBehaviorCategory,
} from "./workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default maximum number of workspaces in topPressureWorkspaces. */
export const TOP_WORKSPACE_LIMIT = 10;

/**
 * Pressure score threshold above which a workspace is counted in pressureDensity.
 * Corresponds to the boundary between "normal" and "elevated" pressure levels.
 */
export const ELEVATED_PRESSURE_THRESHOLD = 30;

/** Fraction of partitions that are pressured+saturated to reach "critical" fairness. */
export const FAIRNESS_CRITICAL_PRESSURE_FRACTION = 0.50;

/** Fraction of partitions that are pressured+saturated to reach "degraded" fairness. */
export const FAIRNESS_DEGRADED_PRESSURE_FRACTION = 0.25;

/** Fraction of partitions that are pressured+saturated to reach "stressed" fairness. */
export const FAIRNESS_STRESSED_PRESSURE_FRACTION = 0.10;

/** Saturated partition count that triggers "critical" fairness regardless of other dims. */
export const FAIRNESS_CRITICAL_SATURATED_COUNT = 3;

/** Saturated partition count that triggers "degraded" fairness. */
export const FAIRNESS_DEGRADED_SATURATED_COUNT = 1;

/** Noisy tenant fraction to reach "critical" fairness. */
export const FAIRNESS_CRITICAL_NOISY_FRACTION = 0.50;

/** Noisy tenant fraction to reach "degraded" fairness. */
export const FAIRNESS_DEGRADED_NOISY_FRACTION = 0.25;

/** Noisy tenant fraction to reach "stressed" fairness. */
export const FAIRNESS_STRESSED_NOISY_FRACTION = 0.10;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - platform health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform-wide scheduler fairness health classification.
 *
 * Derived from three independent dimensions (max severity wins):
 *   1. saturated partition count
 *   2. pressured+saturated fraction of all partitions
 *   3. noisy tenant fraction of all workspaces
 *
 *   "healthy"  → no significant pressure, no saturated partitions
 *   "stressed" → minor cross-workspace pressure building
 *   "degraded" → ≥1 saturated OR 25%+ pressured OR 25%+ noisy tenants
 *   "critical" → ≥3 saturated OR 50%+ pressured OR 50%+ noisy tenants
 */
export type PlatformFairnessHealth = "healthy" | "stressed" | "degraded" | "critical";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - distribution models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count of workspaces at each ContainmentStatus level.
 * Provides a quick distribution overview of workload containment health.
 */
export interface ContainmentDistribution {
  /** Workspaces in "contained" status (normal pressure). */
  contained: number;
  /** Workspaces in "at_risk" status (elevated pressure). */
  at_risk:   number;
  /** Workspaces in "pressured" status (high pressure). */
  pressured: number;
  /** Workspaces in "saturated" status (critical pressure - starvation floor active). */
  saturated: number;
  /** Total workspaces evaluated (sum of all status counts). */
  total:     number;
}

/**
 * Count of workspaces at each AdvisoryPressureLevel.
 * Reflects the P8-F governance advisory distribution across the platform.
 */
export interface AdvisoryDistribution {
  /** Workspaces with no governance advisory signals. */
  none:     number;
  /** Workspaces with low advisory pressure. */
  low:      number;
  /** Workspaces with medium advisory pressure. */
  medium:   number;
  /** Workspaces with high advisory pressure. */
  high:     number;
  /** Workspaces at critical advisory pressure. */
  critical: number;
  /** Total workspaces evaluated (sum of all level counts). */
  total:    number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - scheduler pressure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform-wide scheduler execution pressure statistics.
 *
 * Aggregates active/delayed counts and pressure scores across all workspaces.
 * Used by the super-admin governance console to assess global scheduler health.
 */
export interface SchedulerPressureSummary {
  /** Sum of all workspace active execution counts. */
  totalActiveExecutions:   number;
  /** Sum of all workspace delayed execution counts. */
  totalDelayedExecutions:  number;
  /** Mean partition pressure score across all workspaces (rounded to 2 dp). */
  avgPressureScore:        number;
  /** Highest pressure score across all workspaces. */
  maxPressureScore:        number;
  /**
   * Fraction of workspaces with pressureScore > ELEVATED_PRESSURE_THRESHOLD (0-1).
   * 0 = all workspaces are normal; 1 = all workspaces are at elevated+ pressure.
   */
  pressureDensity:         number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - workspace-level entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single workspace's operational summary for the top-pressure listing.
 * Omits sensitive internals; safe for super-admin dashboards.
 */
export interface TopPressureWorkspace {
  workspaceId:             number;
  workspaceName:           string;
  pressureScore:           number;
  containmentStatus:       ContainmentStatus;
  noisyBehaviorDetected:   boolean;
  noisyBehaviorCodes:      NoisyBehaviorCategory[];
  activeExecutionCount:    number;
  delayedExecutionCount:   number;
}

/**
 * A workspace identified as a noisy tenant.
 * Exposes only operationally relevant governance fields.
 * No internal config, credentials, or sensitive tenant data.
 */
export interface NoisyTenantRecord {
  workspaceId:             number;
  workspaceName:           string;
  /** Detected noisy behavior category codes (at least one). */
  noisyCategories:         NoisyBehaviorCategory[];
  pressureScore:           number;
  containmentStatus:       ContainmentStatus;
  activeExecutionCount:    number;
  delayedExecutionCount:   number;
}

/**
 * A workspace's full workload entry for the paginated workloads listing.
 * All fields safe for super-admin display.
 */
export interface PlatformWorkloadEntry {
  workspaceId:             number;
  workspaceName:           string;
  partitionId:             string;
  pressureScore:           number;
  executionPressureLevel:  ExecutionPressureLevel;
  containmentStatus:       ContainmentStatus;
  activeExecutionCount:    number;
  delayedExecutionCount:   number;
  noisyBehaviorDetected:   boolean;
  noisyBehaviorCodes:      NoisyBehaviorCategory[];
  schedulerWeight:         number;
  evaluatedAt:             string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - main platform overview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform-wide governance overview.
 *
 * The top-level model returned by GET /platform/governance/overview.
 * Aggregates all workspace partitions into a single operational snapshot.
 *
 * Advisory-only: never implies scheduler mutation or automated throttling.
 * Audit-safe: no sensitive tenant internals exposed.
 */
export interface PlatformGovernanceOverview {
  /** Total number of workspaces on the platform (from DB, may include empty). */
  totalWorkspaces:          number;
  /** Workspaces with any active or delayed execution (activeCount + delayedCount > 0). */
  activePartitionCount:     number;
  /** Platform-wide scheduler fairness health classification. */
  fairnessHealth:           PlatformFairnessHealth;
  /** Count of workspaces with any detected noisy-tenant behavior. */
  noisyTenantCount:         number;
  /** Aggregate execution pressure statistics. */
  schedulerPressureSummary: SchedulerPressureSummary;
  /** Partition count by containmentStatus. */
  containmentDistribution:  ContainmentDistribution;
  /** Partition count by advisoryPressureLevel. */
  advisoryDistribution:     AdvisoryDistribution;
  /** Up to TOP_WORKSPACE_LIMIT workspaces with highest pressure, sorted DESC. */
  topPressureWorkspaces:    TopPressureWorkspace[];
  /** Platform-scoped per-request correlation ID (format: "psc:<ms>-<seq>"). */
  requestScopeId:           string;
  /** ISO 8601 timestamp when this overview was generated. */
  generatedAt:              string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - input
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformGovernanceInput {
  /** Total workspace count from DB (may include workspaces with no partitions). */
  workspaceCount:   number;
  /** One TenantWorkloadPartition per workspace. Must be read-only. */
  partitions:       ReadonlyArray<TenantWorkloadPartition>;
  /** Optional display name map: workspaceId → workspace name. */
  workspaceNames?:  Readonly<Record<number, string>>;
  /** Platform-scoped per-request correlation ID. Use makePlatformScopeId(). */
  requestScopeId:   string;
  /** Override generation timestamp (tests). Defaults to new Date(). */
  generationTime?:  Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

let _platformScopeSeq = 0;

/**
 * Generates a per-request platform scope ID for observability correlation.
 * Format: "psc:<ms>-<seq>"
 *
 * Platform-level counterpart to makeRequestScopeId() in tenant-isolation.ts.
 * Does not include workspaceId - platform requests are not workspace-scoped.
 */
export function makePlatformScopeId(): string {
  _platformScopeSeq += 1;
  return `psc:${Date.now()}-${_platformScopeSeq}`;
}

/** Resets the platform scope sequence counter. Use only in tests. */
export function resetPlatformScopeSeq(): void {
  _platformScopeSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a PlatformGovernanceOverview from pre-computed workspace partitions.
 *
 * Pure, deterministic, advisory-only.
 * Emits platform_governance_overview_generated observability event.
 *
 * @param input - workspace count, partitions array, optional name map, scope ID
 */
export function buildPlatformGovernanceOverview(
  input: PlatformGovernanceInput,
): PlatformGovernanceOverview {
  const generatedAt      = (input.generationTime ?? new Date()).toISOString();
  const names            = input.workspaceNames ?? {};
  const { partitions, requestScopeId, workspaceCount } = input;

  const containmentDistribution  = computeContainmentDistribution(partitions);
  const advisoryDistribution     = computeAdvisoryDistribution(partitions);
  const schedulerPressureSummary = computeSchedulerPressureSummary(partitions);

  const noisyTenants    = detectNoisyTenants(partitions, names);
  const noisyTenantCount = noisyTenants.length;

  const fairnessHealth  = classifyPlatformFairnessHealth(
    containmentDistribution,
    noisyTenantCount,
    partitions.length,
  );

  const topPressureWorkspaces = computeTopPressureWorkspaces(
    partitions,
    names,
    TOP_WORKSPACE_LIMIT,
  );

  const activePartitionCount = partitions.filter(
    p => p.activeExecutionCount > 0 || p.delayedExecutionCount > 0,
  ).length;

  const overview: PlatformGovernanceOverview = {
    totalWorkspaces:          workspaceCount,
    activePartitionCount,
    fairnessHealth,
    noisyTenantCount,
    schedulerPressureSummary,
    containmentDistribution,
    advisoryDistribution,
    topPressureWorkspaces,
    requestScopeId,
    generatedAt,
  };

  emitPlatformGovernanceOverviewEvent(
    requestScopeId,
    workspaceCount,
    fairnessHealth,
    noisyTenantCount,
    containmentDistribution,
    generatedAt,
  );

  return overview;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counts partitions by containmentStatus.
 * Pure projection - no mutation of input partitions.
 */
export function computeContainmentDistribution(
  partitions: ReadonlyArray<TenantWorkloadPartition>,
): ContainmentDistribution {
  let contained = 0;
  let at_risk   = 0;
  let pressured = 0;
  let saturated = 0;

  for (const p of partitions) {
    switch (p.containmentStatus) {
      case "contained": contained++; break;
      case "at_risk":   at_risk++;   break;
      case "pressured": pressured++; break;
      case "saturated": saturated++; break;
    }
  }

  return { contained, at_risk, pressured, saturated, total: partitions.length };
}

/**
 * Counts partitions by advisoryPressureLevel.
 * Pure projection - no mutation of input.
 */
export function computeAdvisoryDistribution(
  partitions: ReadonlyArray<TenantWorkloadPartition>,
): AdvisoryDistribution {
  let none     = 0;
  let low      = 0;
  let medium   = 0;
  let high     = 0;
  let critical = 0;

  for (const p of partitions) {
    switch (p.advisoryPressureLevel) {
      case "none":     none++;     break;
      case "low":      low++;      break;
      case "medium":   medium++;   break;
      case "high":     high++;     break;
      case "critical": critical++; break;
    }
  }

  return { none, low, medium, high, critical, total: partitions.length };
}

/**
 * Classifies platform-wide scheduler fairness health from three dimensions:
 *   1. saturated partition count
 *   2. pressured+saturated fraction
 *   3. noisy tenant fraction
 *
 * Returns the maximum severity level across all three dimensions.
 * Empty platform (0 partitions) → "healthy".
 */
export function classifyPlatformFairnessHealth(
  distribution:    ContainmentDistribution,
  noisyCount:      number,
  totalPartitions: number,
): PlatformFairnessHealth {
  if (totalPartitions === 0) return "healthy";

  const saturated             = distribution.saturated;
  const pressuredAndAbove     = distribution.pressured + distribution.saturated;
  const pressuredFraction     = pressuredAndAbove / totalPartitions;
  const noisyFraction         = noisyCount / totalPartitions;

  // Dimension 1 - saturated count
  const saturatedDim: PlatformFairnessHealth =
    saturated >= FAIRNESS_CRITICAL_SATURATED_COUNT ? "critical" :
    saturated >= FAIRNESS_DEGRADED_SATURATED_COUNT ? "degraded" : "healthy";

  // Dimension 2 - pressured+saturated fraction
  const pressureDim: PlatformFairnessHealth =
    pressuredFraction >= FAIRNESS_CRITICAL_PRESSURE_FRACTION ? "critical" :
    pressuredFraction >= FAIRNESS_DEGRADED_PRESSURE_FRACTION ? "degraded"  :
    pressuredFraction >= FAIRNESS_STRESSED_PRESSURE_FRACTION ? "stressed"  : "healthy";

  // Dimension 3 - noisy tenant fraction
  const noisyDim: PlatformFairnessHealth =
    noisyFraction >= FAIRNESS_CRITICAL_NOISY_FRACTION ? "critical" :
    noisyFraction >= FAIRNESS_DEGRADED_NOISY_FRACTION ? "degraded" :
    noisyFraction >= FAIRNESS_STRESSED_NOISY_FRACTION ? "stressed" : "healthy";

  return _maxFairnessHealth(saturatedDim, pressureDim, noisyDim);
}

/**
 * Computes aggregate scheduler pressure statistics across all partitions.
 * Returns zero values if partitions is empty.
 */
export function computeSchedulerPressureSummary(
  partitions: ReadonlyArray<TenantWorkloadPartition>,
): SchedulerPressureSummary {
  if (partitions.length === 0) {
    return {
      totalActiveExecutions:  0,
      totalDelayedExecutions: 0,
      avgPressureScore:       0,
      maxPressureScore:       0,
      pressureDensity:        0,
    };
  }

  let totalActive  = 0;
  let totalDelayed = 0;
  let totalScore   = 0;
  let maxScore     = 0;
  let elevatedCount = 0;

  for (const p of partitions) {
    totalActive  += p.activeExecutionCount;
    totalDelayed += p.delayedExecutionCount;
    const score   = p.pressureScore.total;
    totalScore   += score;
    if (score > maxScore) maxScore = score;
    if (score > ELEVATED_PRESSURE_THRESHOLD) elevatedCount++;
  }

  return {
    totalActiveExecutions:  totalActive,
    totalDelayedExecutions: totalDelayed,
    avgPressureScore:       _round2(totalScore / partitions.length),
    maxPressureScore:       maxScore,
    pressureDensity:        _round4(elevatedCount / partitions.length),
  };
}

/**
 * Returns up to `limit` workspaces sorted by pressureScore DESC.
 * Ties broken by workspaceId ASC (deterministic ordering).
 *
 * Copies noisyBehaviorCodes arrays (no aliasing).
 */
export function computeTopPressureWorkspaces(
  partitions:     ReadonlyArray<TenantWorkloadPartition>,
  workspaceNames: Readonly<Record<number, string>>,
  limit:          number,
): TopPressureWorkspace[] {
  const sorted = [...partitions]
    .sort((a, b) => {
      const scoreDiff = b.pressureScore.total - a.pressureScore.total;
      return scoreDiff !== 0 ? scoreDiff : a.workspaceId - b.workspaceId;
    })
    .slice(0, Math.max(0, limit));

  return sorted.map(p => ({
    workspaceId:           p.workspaceId,
    workspaceName:         workspaceNames[p.workspaceId] ?? `workspace:${p.workspaceId}`,
    pressureScore:         p.pressureScore.total,
    containmentStatus:     p.containmentStatus,
    noisyBehaviorDetected: p.noisyBehaviorDetected,
    noisyBehaviorCodes:    [...p.noisyBehaviorCodes],
    activeExecutionCount:  p.activeExecutionCount,
    delayedExecutionCount: p.delayedExecutionCount,
  }));
}

/**
 * Returns all workspaces with detected noisy-tenant behavior, sorted by
 * pressureScore DESC (then workspaceId ASC for determinism).
 *
 * Only includes workspaces where noisyBehaviorDetected = true.
 * Copies noisyBehaviorCodes arrays (no aliasing).
 */
export function detectNoisyTenants(
  partitions:     ReadonlyArray<TenantWorkloadPartition>,
  workspaceNames: Readonly<Record<number, string>>,
): NoisyTenantRecord[] {
  return partitions
    .filter(p => p.noisyBehaviorDetected)
    .sort((a, b) => {
      const scoreDiff = b.pressureScore.total - a.pressureScore.total;
      return scoreDiff !== 0 ? scoreDiff : a.workspaceId - b.workspaceId;
    })
    .map(p => ({
      workspaceId:           p.workspaceId,
      workspaceName:         workspaceNames[p.workspaceId] ?? `workspace:${p.workspaceId}`,
      noisyCategories:       [...p.noisyBehaviorCodes],
      pressureScore:         p.pressureScore.total,
      containmentStatus:     p.containmentStatus,
      activeExecutionCount:  p.activeExecutionCount,
      delayedExecutionCount: p.delayedExecutionCount,
    }));
}

/**
 * Builds a full workload entry list for the /workloads endpoint.
 * Sorted by pressureScore DESC (then workspaceId ASC). No pagination - the
 * route handler slices based on page/limit after calling this function.
 *
 * Copies noisyBehaviorCodes arrays (no aliasing).
 */
export function buildPlatformWorkloadList(
  partitions:     ReadonlyArray<TenantWorkloadPartition>,
  workspaceNames: Readonly<Record<number, string>>,
): PlatformWorkloadEntry[] {
  return [...partitions]
    .sort((a, b) => {
      const scoreDiff = b.pressureScore.total - a.pressureScore.total;
      return scoreDiff !== 0 ? scoreDiff : a.workspaceId - b.workspaceId;
    })
    .map(p => ({
      workspaceId:             p.workspaceId,
      workspaceName:           workspaceNames[p.workspaceId] ?? `workspace:${p.workspaceId}`,
      partitionId:             p.partitionId,
      pressureScore:           p.pressureScore.total,
      executionPressureLevel:  p.executionPressureLevel,
      containmentStatus:       p.containmentStatus,
      activeExecutionCount:    p.activeExecutionCount,
      delayedExecutionCount:   p.delayedExecutionCount,
      noisyBehaviorDetected:   p.noisyBehaviorDetected,
      noisyBehaviorCodes:      [...p.noisyBehaviorCodes],
      schedulerWeight:         p.schedulerWeight,
      evaluatedAt:             p.evaluatedAt,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────
//
// Each function emits one structured log event and returns void.
// All events carry: requestScopeId, totalWorkspaces, fairnessHealth,
// noisyTenantCount, containmentDistribution, action.

export function emitPlatformGovernanceOverviewEvent(
  requestScopeId:           string,
  totalWorkspaces:          number,
  fairnessHealth:           PlatformFairnessHealth,
  noisyTenantCount:         number,
  containmentDistribution:  ContainmentDistribution,
  generatedAt:              string,
): void {
  logger.info(
    {
      event:                    "platform_governance_overview_generated",
      requestScopeId,
      totalWorkspaces,
      fairnessHealth,
      noisyTenantCount,
      containmentDistribution,
      action:                   "generated",
      generatedAt,
    },
    "[platform-governance] P9-D: platform_governance_overview_generated",
  );
}

export function emitPlatformFairnessHealthEvent(
  requestScopeId:           string,
  totalWorkspaces:          number,
  fairnessHealth:           PlatformFairnessHealth,
  noisyTenantCount:         number,
  containmentDistribution:  ContainmentDistribution,
): void {
  logger.info(
    {
      event:                    "platform_fairness_health_evaluated",
      requestScopeId,
      totalWorkspaces,
      fairnessHealth,
      noisyTenantCount,
      containmentDistribution,
      action:                   "evaluated",
    },
    "[platform-governance] P9-D: platform_fairness_health_evaluated",
  );
}

export function emitPlatformNoisyTenantEvent(
  requestScopeId:           string,
  totalWorkspaces:          number,
  fairnessHealth:           PlatformFairnessHealth,
  noisyTenantCount:         number,
  containmentDistribution:  ContainmentDistribution,
): void {
  logger.info(
    {
      event:                    "platform_noisy_tenant_detected",
      requestScopeId,
      totalWorkspaces,
      fairnessHealth,
      noisyTenantCount,
      containmentDistribution,
      action:                   "detected",
    },
    "[platform-governance] P9-D: platform_noisy_tenant_detected",
  );
}

export function emitPlatformSchedulerPressureEvent(
  requestScopeId:           string,
  totalWorkspaces:          number,
  fairnessHealth:           PlatformFairnessHealth,
  noisyTenantCount:         number,
  containmentDistribution:  ContainmentDistribution,
): void {
  logger.info(
    {
      event:                    "platform_scheduler_pressure_evaluated",
      requestScopeId,
      totalWorkspaces,
      fairnessHealth,
      noisyTenantCount,
      containmentDistribution,
      action:                   "evaluated",
    },
    "[platform-governance] P9-D: platform_scheduler_pressure_evaluated",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FAIRNESS_SEVERITY: Record<PlatformFairnessHealth, number> = {
  healthy:  0,
  stressed: 1,
  degraded: 2,
  critical: 3,
};

function _maxFairnessHealth(...levels: PlatformFairnessHealth[]): PlatformFairnessHealth {
  return levels.reduce((max, level) =>
    FAIRNESS_SEVERITY[level] > FAIRNESS_SEVERITY[max] ? level : max,
  "healthy" as PlatformFairnessHealth);
}

function _round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function _round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
