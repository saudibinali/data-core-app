/**
 * @file   lib/workflows/tenant-governance.ts
 * @phase  P9-C - Tenant Governance APIs & Operational Visibility Foundations
 *
 * Pure deterministic tenant governance visibility engine.
 * No DB, no async, no mutations, no cross-tenant leakage.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   buildTenantGovernanceView(input, context?) → TenantGovernanceView
 *
 *   Internally composes:
 *     1. computePartitionPressureSummary()   - from P9-B TenantWorkloadPartition
 *     2. computeSchedulerFairnessStatus()    - advisory scheduler fairness
 *     3. classifyIsolationHealth()           - P9-A risk → health status
 *     4. computeHotspotSummary()             - P8-E concentration → summary
 *     5. computeAdvisorySummary()            - P8-F signals → summary
 *     6. deriveOperationalPriority()         - top workflow priority
 *     7. Scope guard: partition.workspaceId must match isoContext.workspaceId
 *     8. Emits tenant_governance_view_generated observability event
 *
 * ── INPUTS (TenantGovernanceViewInput) ──────────────────────────────────────
 *
 *   isoContext              - P9-A TenantIsolationContext (validated workspace)
 *   partition               - P9-B TenantWorkloadPartition (execution pressure)
 *   isolationRisk           - P9-A TenantIsolationRiskAssessment (risk dims)
 *   hotspotConcentration?   - P8-E WorkspaceHotspotConcentration (optional)
 *   topOperationalPriority? - P8-E highest OperationalPriority (optional)
 *   governanceSignals?      - P8-F GovernanceSignalResult (optional)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:          never mutates input, DB, or scheduler state
 *   TENANT-SCOPED:      scope guard fails closed on workspaceId mismatch
 *   DETERMINISTIC:      same inputs → same output
 *   NO CROSS-TENANT:    output only contains own workspace data
 *   JSON-SAFE:          all output is plain JSON-serializable
 *   FAIL-CLOSED:        scope ambiguity throws TenantIsolationViolation
 */

import { logger } from "../logger";
import {
  type TenantIsolationContext,
  type TenantIsolationRiskAssessment,
  type TenantRiskLevel,
  TenantIsolationViolation,
} from "./tenant-isolation";
import {
  type TenantWorkloadPartition,
  type PartitionPressureScore,
  type ExecutionPressureLevel,
  type ContainmentStatus,
  type AdvisoryPressureLevel,
  type NoisyBehaviorCategory,
  computeSchedulerWeight,
} from "./workload-partition";
import type { WorkspaceHotspotConcentration, OperationalPriority } from "./comparative-intelligence";
import type { GovernanceSignalResult, GovernanceAdvisoryLevel, GovernanceSignal } from "./governance-signals";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - governance view components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Isolation health status - derived from P9-A TenantIsolationRiskAssessment.
 *
 *   "healthy"  → overallRisk = "low"      (all isolation checks pass)
 *   "warning"  → overallRisk = "moderate" (minor anomalies detected)
 *   "elevated" → overallRisk = "high"     (boundary risks present)
 *   "critical" → overallRisk = "critical" (active isolation breach indicators)
 */
export type IsolationHealthStatus = "healthy" | "warning" | "elevated" | "critical";

/**
 * Scheduler fairness level - derived from TenantWorkloadPartition.schedulerWeight.
 *
 *   "fair"         → weight = 1.00 (contained)
 *   "reduced"      → weight = 0.75 (at_risk)
 *   "constrained"  → weight = 0.50 (pressured)
 *   "at_minimum"   → weight = 0.25 (saturated - starvation floor, never below)
 */
export type FairnessLevel = "fair" | "reduced" | "constrained" | "at_minimum";

/** Hotspot severity - derived from P8-E concentration ratio + urgent/critical count. */
export type HotspotLevel = "none" | "low" | "moderate" | "high" | "critical";

/** Starvation risk - derived from containmentStatus. */
export type StarvationRisk = "none" | "low" | "moderate" | "high";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - governance sub-models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scheduler fairness advisory status for a workspace.
 *
 * Advisory-only: these values describe the recommended fairness posture.
 * They do NOT modify the P6-A scheduler's actual behavior.
 */
export interface SchedulerFairnessStatus {
  /** Advisory scheduler weight (0.25-1.00). Minimum 0.25 - no starvation. */
  schedulerWeight:       number;
  /** Fairness level derived from scheduler weight. */
  fairnessLevel:         FairnessLevel;
  /** True if any noisy-tenant behavior was detected in the partition evaluation. */
  noisyBehaviorDetected: boolean;
  /** Detected noisy behavior category codes from P9-B. */
  noisyBehaviorCodes:    NoisyBehaviorCategory[];
  /** Starvation risk for OTHER tenants (caused by this workspace's pressure). */
  starvationRisk:        StarvationRisk;
}

/**
 * Execution pressure summary - derived from P9-B TenantWorkloadPartition.
 * Flattens the partition model for governance view embedding.
 */
export interface PartitionPressureSummary {
  /** Total pressure score (0-100). */
  total:                   number;
  /** Execution pressure classification. */
  executionPressureLevel:  ExecutionPressureLevel;
  /** Currently running workflow executions. */
  activeExecutionCount:    number;
  /** Executions waiting in the delayed queue. */
  delayedExecutionCount:   number;
  /** Workload containment status. */
  containmentStatus:       ContainmentStatus;
  /** Full 5-component score breakdown. */
  pressureComponents:      PartitionPressureScore;
}

/**
 * Governance hotspot summary - derived from P8-E WorkspaceHotspotConcentration.
 * Classifies concentration into a single HotspotLevel for dashboard display.
 */
export interface HotspotSummary {
  /** Workflows at dominant risk level (comparativeRiskScore ≥ 70). */
  dominantWorkflowCount:   number;
  /** Fraction of workspace workflows at dominant risk (0-1). */
  concentrationRatio:      number;
  /** Workflows at urgent or critical operational priority. */
  urgentOrCriticalCount:   number;
  /** comparativeRiskScore of the highest-ranked workflow (0 = no workflows). */
  topRiskScore:            number;
  /** Hotspot severity classification. */
  hotspotLevel:            HotspotLevel;
}

/**
 * Advisory summary - derived from P8-F GovernanceSignalResult.
 * Surfaces governance advisory level + signal severity distribution.
 */
export interface AdvisorySummary {
  /** Overall governance advisory level for the workspace. */
  advisoryLevel:           GovernanceAdvisoryLevel;
  /** Maps advisoryLevel into the P9-B advisory pressure model. */
  advisoryPressureLevel:   AdvisoryPressureLevel;
  /** Total governance signals emitted. */
  totalSignals:            number;
  /** Signals with severity = "critical". */
  criticalSignalCount:     number;
  /** Signals with severity = "high". */
  highSignalCount:         number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - main governance view
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete tenant governance view for a single workspace.
 *
 * Composed from: P9-A isolation context + P9-A risk assessment +
 * P9-B workload partition + P8-E hotspot + P8-F governance signals.
 *
 * Audit-ready: deterministic, JSON-serializable, tenant-scoped.
 */
export interface TenantGovernanceView {
  /** Workspace DB primary key. */
  workspaceId:             number;
  /** Canonical tenant boundary ID from P9-A context ("ws:<workspaceId>"). */
  tenantBoundaryId:        string;
  /** Per-request scope ID from P9-A context (for log correlation). */
  requestScopeId:          string;
  /** Partition pressure summary from P9-B. */
  partitionPressure:       PartitionPressureSummary;
  /** Scheduler fairness advisory status. */
  schedulerFairnessStatus: SchedulerFairnessStatus;
  /** Top workflow operational priority from P8-E (default: "informational"). */
  operationalPriority:     OperationalPriority;
  /** Governance hotspot summary from P8-E. */
  hotspotSummary:          HotspotSummary;
  /** Advisory summary from P8-F. */
  advisorySummary:         AdvisorySummary;
  /** Isolation health status derived from P9-A risk assessment. */
  isolationHealth:         IsolationHealthStatus;
  /** Workload containment status from P9-B. */
  containmentStatus:       ContainmentStatus;
  /** ISO 8601 timestamp when this view was generated. */
  generatedAt:             string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - input
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantGovernanceViewInput {
  /** P9-A validated isolation context (must match partition.workspaceId). */
  isoContext:              TenantIsolationContext;
  /** P9-B workload partition for this workspace. */
  partition:               TenantWorkloadPartition;
  /** P9-A isolation risk assessment. */
  isolationRisk:           TenantIsolationRiskAssessment;
  /** P8-E hotspot concentration (optional - defaults to zero hotspot). */
  hotspotConcentration?:   WorkspaceHotspotConcentration;
  /**
   * Highest OperationalPriority across workspace workflows (from P8-E).
   * If absent and hotspotConcentration provided, derived from urgentOrCriticalCount.
   */
  topOperationalPriority?: OperationalPriority;
  /** P8-F governance signal result (optional - defaults to informational). */
  governanceSignals?:      GovernanceSignalResult;
}

export interface TenantGovernanceViewContext {
  /** Override for generated timestamp. Defaults to new Date(). Tests override. */
  generationTime?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a complete TenantGovernanceView from pre-computed engine outputs.
 *
 * Pure, deterministic, advisory-only.
 * Fails closed if partition.workspaceId ≠ isoContext.workspaceId.
 * Emits tenant_governance_view_generated observability event.
 *
 * @throws {TenantIsolationViolation} CROSS_WORKSPACE_ACCESS - scope mismatch
 */
export function buildTenantGovernanceView(
  input:    TenantGovernanceViewInput,
  context?: TenantGovernanceViewContext,
): TenantGovernanceView {
  const generatedAt = (context?.generationTime ?? new Date()).toISOString();

  // ── Scope guard: fail closed on workspaceId mismatch ──────────────────────
  if (input.partition.workspaceId !== input.isoContext.workspaceId) {
    logger.warn(
      {
        event:                    "tenant_governance_scope_violation",
        workspaceId:              input.isoContext.workspaceId,
        partitionWorkspaceId:     input.partition.workspaceId,
        requestScopeId:           input.isoContext.requestScopeId,
        action:                   "block",
      },
      "[governance] P9-C: Governance scope violation - workspaceId mismatch",
    );
    throw new TenantIsolationViolation(
      "CROSS_WORKSPACE_ACCESS",
      `Governance view scope violation: partition workspaceId ` +
      `${input.partition.workspaceId} does not match isolation context ` +
      `workspaceId ${input.isoContext.workspaceId}`,
      input.isoContext,
    );
  }

  // ── Compose sub-models ────────────────────────────────────────────────────
  const partitionPressure       = computePartitionPressureSummary(input.partition);
  const schedulerFairnessStatus = computeSchedulerFairnessStatus(input.partition);
  const isolationHealth         = classifyIsolationHealth(input.isolationRisk.overallRisk);
  const hotspotSummary          = computeHotspotSummary(input.hotspotConcentration);
  const advisorySummary         = computeAdvisorySummary(input.governanceSignals);
  const operationalPriority     = deriveOperationalPriority(
    input.hotspotConcentration,
    input.topOperationalPriority,
    input.governanceSignals,
  );

  const view: TenantGovernanceView = {
    workspaceId:             input.isoContext.workspaceId,
    tenantBoundaryId:        input.isoContext.tenantBoundaryId,
    requestScopeId:          input.isoContext.requestScopeId,
    partitionPressure,
    schedulerFairnessStatus,
    operationalPriority,
    hotspotSummary,
    advisorySummary,
    isolationHealth,
    containmentStatus:       input.partition.containmentStatus,
    generatedAt,
  };

  // ── Emit observability event ──────────────────────────────────────────────
  logger.info(
    {
      event:                    "tenant_governance_view_generated",
      workspaceId:              view.workspaceId,
      requestScopeId:           view.requestScopeId,
      partitionPressureScore:   partitionPressure.total,
      isolationHealth:          isolationHealth,
      fairnessStatus:           schedulerFairnessStatus.fairnessLevel,
      containmentStatus:        view.containmentStatus,
      operationalPriority:      view.operationalPriority,
      hotspotLevel:             hotspotSummary.hotspotLevel,
      advisoryLevel:            advisorySummary.advisoryLevel,
      action:                   "generated",
      generatedAt,
    },
    "[governance] P9-C: tenant_governance_view_generated",
  );

  return view;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODEL BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a PartitionPressureSummary from a TenantWorkloadPartition.
 * Pure projection - no computation, just field mapping.
 */
export function computePartitionPressureSummary(
  partition: TenantWorkloadPartition,
): PartitionPressureSummary {
  return {
    total:                   partition.pressureScore.total,
    executionPressureLevel:  partition.executionPressureLevel,
    activeExecutionCount:    partition.activeExecutionCount,
    delayedExecutionCount:   partition.delayedExecutionCount,
    containmentStatus:       partition.containmentStatus,
    pressureComponents:      { ...partition.pressureScore },
  };
}

/**
 * Computes SchedulerFairnessStatus from a TenantWorkloadPartition.
 *
 * fairnessLevel:
 *   schedulerWeight = 1.00 → "fair"
 *   schedulerWeight = 0.75 → "reduced"
 *   schedulerWeight = 0.50 → "constrained"
 *   schedulerWeight = 0.25 → "at_minimum"
 *
 * starvationRisk (caused by this workspace on OTHER tenants):
 *   contained  → "none"
 *   at_risk    → "low"
 *   pressured  → "moderate"
 *   saturated  → "high"
 */
export function computeSchedulerFairnessStatus(
  partition: TenantWorkloadPartition,
): SchedulerFairnessStatus {
  const fairnessLevel = _weightToFairnessLevel(partition.schedulerWeight);
  const starvationRisk: StarvationRisk = (
    partition.containmentStatus === "contained"  ? "none"     :
    partition.containmentStatus === "at_risk"    ? "low"      :
    partition.containmentStatus === "pressured"  ? "moderate" : "high"
  );
  return {
    schedulerWeight:       partition.schedulerWeight,
    fairnessLevel,
    noisyBehaviorDetected: partition.noisyBehaviorDetected,
    noisyBehaviorCodes:    [...partition.noisyBehaviorCodes],
    starvationRisk,
  };
}

/**
 * Maps P9-A TenantRiskLevel to IsolationHealthStatus.
 *
 *   "low"      → "healthy"
 *   "moderate" → "warning"
 *   "high"     → "elevated"
 *   "critical" → "critical"
 */
export function classifyIsolationHealth(riskLevel: TenantRiskLevel): IsolationHealthStatus {
  switch (riskLevel) {
    case "critical": return "critical";
    case "high":     return "elevated";
    case "moderate": return "warning";
    case "low":      return "healthy";
  }
}

/**
 * Builds a HotspotSummary from a WorkspaceHotspotConcentration.
 *
 * If hotspotConcentration is absent (P8-E not run), returns safe zero defaults.
 *
 * hotspotLevel is the max severity across two independent dimensions:
 *   Concentration dimension (concentrationRatio):
 *     < 0.10 → "none"
 *     < 0.30 → "low"
 *     < 0.50 → "moderate"
 *     < 0.70 → "high"
 *     ≥ 0.70 → "critical"
 *
 *   Urgency dimension (urgentOrCriticalCount):
 *     0     → "none"
 *     1     → "low"
 *     2     → "moderate"
 *     3-4   → "high"
 *     5+    → "critical"
 */
export function computeHotspotSummary(
  hotspot?: WorkspaceHotspotConcentration,
): HotspotSummary {
  if (!hotspot) {
    return {
      dominantWorkflowCount:  0,
      concentrationRatio:     0,
      urgentOrCriticalCount:  0,
      topRiskScore:           0,
      hotspotLevel:           "none",
    };
  }

  const hotspotLevel = classifyHotspotLevel(
    hotspot.concentrationRatio,
    hotspot.urgentOrCriticalCount,
  );

  return {
    dominantWorkflowCount: hotspot.dominantWorkflowCount,
    concentrationRatio:    hotspot.concentrationRatio,
    urgentOrCriticalCount: hotspot.urgentOrCriticalCount,
    topRiskScore:          hotspot.topRiskScore,
    hotspotLevel,
  };
}

/**
 * Builds an AdvisorySummary from a GovernanceSignalResult.
 *
 * If signals are absent (P8-F not run), returns informational defaults.
 * criticalSignalCount and highSignalCount are computed from the signals array.
 */
export function computeAdvisorySummary(
  result?: GovernanceSignalResult,
): AdvisorySummary {
  if (!result) {
    return {
      advisoryLevel:        "informational",
      advisoryPressureLevel: "none",
      totalSignals:          0,
      criticalSignalCount:   0,
      highSignalCount:       0,
    };
  }

  const criticalCount = result.signals.filter(
    (s: GovernanceSignal) => s.severity === "critical",
  ).length;
  const highCount = result.signals.filter(
    (s: GovernanceSignal) => s.severity === "high",
  ).length;

  return {
    advisoryLevel:          result.advisoryLevel,
    advisoryPressureLevel:  _advisoryLevelToPressure(result.advisoryLevel),
    totalSignals:           result.totalSignals,
    criticalSignalCount:    criticalCount,
    highSignalCount:        highCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies hotspot severity from two independent dimensions.
 * Returns the more severe of the two dimension levels.
 */
export function classifyHotspotLevel(
  concentrationRatio:   number,
  urgentOrCriticalCount: number,
): HotspotLevel {
  const concentrationLevel: HotspotLevel =
    concentrationRatio >= 0.70 ? "critical" :
    concentrationRatio >= 0.50 ? "high"     :
    concentrationRatio >= 0.30 ? "moderate" :
    concentrationRatio >= 0.10 ? "low"      : "none";

  const urgencyLevel: HotspotLevel =
    urgentOrCriticalCount >= 5 ? "critical" :
    urgentOrCriticalCount >= 3 ? "high"     :
    urgentOrCriticalCount >= 2 ? "moderate" :
    urgentOrCriticalCount >= 1 ? "low"      : "none";

  return _maxHotspotLevel(concentrationLevel, urgencyLevel);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the top OperationalPriority for the governance view.
 *
 * Priority order (sources checked in this order):
 *   1. Explicit topOperationalPriority input (from P8-E caller)
 *   2. Inferred from hotspotConcentration.urgentOrCriticalCount
 *   3. Inferred from governance signal advisory level
 *   4. Default: "informational"
 */
export function deriveOperationalPriority(
  hotspot?:               WorkspaceHotspotConcentration,
  supplied?:              OperationalPriority,
  signals?:               GovernanceSignalResult,
): OperationalPriority {
  if (supplied) return supplied;

  if (hotspot) {
    if (hotspot.urgentOrCriticalCount >= 3) return "critical";
    if (hotspot.urgentOrCriticalCount >= 1) return "urgent";
    if (hotspot.dominantWorkflowCount  >= 1) return "elevated";
  }

  if (signals) {
    if (signals.advisoryLevel === "critical") return "critical";
    if (signals.advisoryLevel === "urgent")   return "urgent";
    if (signals.advisoryLevel === "elevated") return "elevated";
    if (signals.advisoryLevel === "advisory") return "watch";
  }

  return "informational";
}

function _weightToFairnessLevel(weight: number): FairnessLevel {
  if (weight >= 1.0) return "fair";
  if (weight >= 0.75) return "reduced";     // 0.75
  if (weight >= 0.50) return "constrained"; // 0.50
  return "at_minimum";                      // 0.25
}

const HOTSPOT_SEVERITY_ORDER: HotspotLevel[] = ["none", "low", "moderate", "high", "critical"];

function _maxHotspotLevel(a: HotspotLevel, b: HotspotLevel): HotspotLevel {
  return HOTSPOT_SEVERITY_ORDER.indexOf(a) >= HOTSPOT_SEVERITY_ORDER.indexOf(b) ? a : b;
}

function _advisoryLevelToPressure(level: GovernanceAdvisoryLevel): AdvisoryPressureLevel {
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
// ROUTE-LEVEL OBSERVABILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
//
// These are called from route handlers (not the engine) since they carry
// per-request context (requestScopeId from isoContext) and are tied to
// specific API endpoints.
//
// Each function logs a structured event and returns void.
// The 3 events (partition_overview, fairness_visibility, isolation_health)
// are route-level companions to the engine-level tenant_governance_view_generated.

export function emitPartitionOverviewEvent(
  workspaceId:          number,
  requestScopeId:       string,
  pressureTotal:        number,
  isolationHealth:      IsolationHealthStatus,
  fairnessStatus:       FairnessLevel,
  containmentStatus:    ContainmentStatus,
): void {
  logger.info(
    {
      event:                "tenant_partition_overview_requested",
      workspaceId,
      requestScopeId,
      partitionPressureScore: pressureTotal,
      isolationHealth,
      fairnessStatus,
      containmentStatus,
      action:               "viewed",
    },
    "[governance] P9-C: tenant_partition_overview_requested",
  );
}

export function emitFairnessVisibilityEvent(
  workspaceId:          number,
  requestScopeId:       string,
  pressureTotal:        number,
  isolationHealth:      IsolationHealthStatus,
  fairnessStatus:       FairnessLevel,
  containmentStatus:    ContainmentStatus,
): void {
  logger.info(
    {
      event:                "tenant_fairness_visibility_accessed",
      workspaceId,
      requestScopeId,
      partitionPressureScore: pressureTotal,
      isolationHealth,
      fairnessStatus,
      containmentStatus,
      action:               "viewed",
    },
    "[governance] P9-C: tenant_fairness_visibility_accessed",
  );
}

export function emitIsolationHealthEvent(
  workspaceId:          number,
  requestScopeId:       string,
  pressureTotal:        number,
  isolationHealth:      IsolationHealthStatus,
  fairnessStatus:       FairnessLevel,
  containmentStatus:    ContainmentStatus,
): void {
  logger.info(
    {
      event:                "tenant_isolation_health_evaluated",
      workspaceId,
      requestScopeId,
      partitionPressureScore: pressureTotal,
      isolationHealth,
      fairnessStatus,
      containmentStatus,
      action:               "evaluated",
    },
    "[governance] P9-C: tenant_isolation_health_evaluated",
  );
}
