/**
 * @file   lib/workflows/reliability-domains.ts
 * @phase  P10-A - Reliability Domains & Failure Containment Foundations
 *
 * Pure deterministic reliability intelligence engine.
 * No DB, no async, no self-healing, no autonomous recovery.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Models each workspace as a set of six monitored subsystems and evaluates
 *   the health of each subsystem from live P9-B/E/F signals. The outputs are:
 *
 *   evaluateFailureContainment(input)
 *     → FailureContainmentResult   (per-workspace reliability assessment)
 *
 *   buildPlatformReliabilityOverview(results, scopeId?, time?)
 *     → PlatformReliabilityOverview  (platform-wide aggregate)
 *
 * ── SIX MONITORED SUBSYSTEMS ─────────────────────────────────────────────────
 *
 *   "scheduler"          - execution scheduling pressure (P9-B pressureScore)
 *   "advisory"           - governance advisory signals   (P9-B noisyBehavior)
 *   "policy_engine"      - fairness policy lifecycle     (P9-E activePolicies)
 *   "enforcement_bridge" - weight resolution bridge      (P9-F enforcementStatus)
 *   "workflow_runtime"   - execution backlog             (P9-B delayedCount)
 *   "tenant_isolation"   - workspace containment         (P9-B containmentStatus)
 *
 * ── DEGRADATION SEVERITY LADDER ──────────────────────────────────────────────
 *
 *   0 healthy             - nominal operation, no action needed
 *   1 degraded            - mild signal; monitor closely
 *   2 severely_degraded   - elevated risk; operator attention recommended
 *   3 containment_risk    - containment boundary under stress
 *   4 critical            - immediate intervention required
 *
 * ── PROPAGATION RISK LADDER ──────────────────────────────────────────────────
 *
 *   "isolated"   - failure limited to this subsystem only
 *   "bounded"    - failure could affect adjacent subsystems
 *   "spreading"  - cross-subsystem degradation in progress
 *   "cascading"  - platform-wide failure propagation possible
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:          engine never mutates scheduler, DB, policies, or runtime
 *   NO AUTO-RECOVERY:   no restart, no rollback, no remediation
 *   FAIL-CLOSED:        ambiguous inputs → highest safe severity classification
 *   DETERMINISTIC:      same inputs → same outputs every time
 *   TENANT-SAFE:        all signals are workspace-scoped; no cross-tenant leakage
 */

import { logger } from "../logger";
import type { ContainmentStatus, AdvisoryPressureLevel } from "./workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One of six subsystems monitored within each workspace reliability domain.
 */
export type DomainType =
  | "scheduler"
  | "advisory"
  | "policy_engine"
  | "enforcement_bridge"
  | "workflow_runtime"
  | "tenant_isolation";

/**
 * Severity of degradation for a domain or subsystem (5 levels).
 *
 *   healthy           - nominal; all containment boundaries holding
 *   degraded          - mild signal detected; continue monitoring
 *   severely_degraded - elevated risk; operator should review
 *   containment_risk  - boundary under stress; intervention recommended
 *   critical          - immediate operator action required
 */
export type DegradationStatus =
  | "healthy"
  | "degraded"
  | "severely_degraded"
  | "containment_risk"
  | "critical";

/**
 * How far a failure in this domain could propagate.
 *
 *   isolated  - constrained to one subsystem; no cross-system risk
 *   bounded   - could reach adjacent subsystems within the workspace
 *   spreading - cross-subsystem degradation is already visible
 *   cascading - platform-wide failure propagation is possible
 */
export type FailurePropagationRisk =
  | "isolated"
  | "bounded"
  | "spreading"
  | "cascading";

/**
 * How well the failure is contained within its domain.
 *
 *   contained - all boundaries holding; failure fully isolated
 *   partial   - some boundaries stressed but intact
 *   at_risk   - one or more boundaries under active stress
 *   breached  - at least one containment boundary has failed
 */
export type ContainmentLevel = "contained" | "partial" | "at_risk" | "breached";

/**
 * What operator action is appropriate given the current degradation.
 */
export type RecoveryClassification =
  | "no_action_needed"
  | "monitor_closely"
  | "operator_attention"
  | "immediate_intervention";

/**
 * Quality of observability for this domain.
 * Degrades under high pressure as signals may be unreliable.
 *
 *   full     - all signals available and trustworthy
 *   partial  - some signals missing or delayed
 *   impaired - signal quality is compromised
 *   blind    - observability itself has failed for this domain
 */
export type ObservabilityHealth = "full" | "partial" | "impaired" | "blind";

/** Scope of the blast radius if a failure propagates unchecked. */
export type BlastRadiusScope =
  | "workspace_only"
  | "tenant_group"
  | "platform_wide";

// ── Value objects ────────────────────────────────────────────────────────────

/**
 * A workspace reliability domain - the fundamental unit of failure containment.
 *
 * One domain is computed per workspace per evaluation. It captures the
 * overall health of all six monitored subsystems, classified to the
 * worst (most severe) subsystem state.
 */
export interface ReliabilityDomain {
  /** Globally unique domain ID. Format: "rd:<workspaceId>-<ms>-<seq>" */
  domainId:               string;
  /**
   * The dominant (most-degraded) subsystem type.
   * When multiple subsystems share the worst status, the first in the ordered
   * enum list wins (deterministic tiebreaker).
   */
  domainType:             DomainType;
  /** Workspace this domain belongs to. */
  workspaceId:            number;
  /**
   * All subsystems showing "degraded" or worse status.
   * Empty when all subsystems are healthy.
   */
  affectedSubsystems:     DomainType[];
  /** Worst containment level across all boundaries. */
  containmentLevel:       ContainmentLevel;
  /** Overall degradation status (worst across all 6 subsystems). */
  degradationStatus:      DegradationStatus;
  /** Recommended operator action based on overall degradation. */
  recoveryClassification: RecoveryClassification;
  /** Quality of the observability layer for this domain. */
  observabilityHealth:    ObservabilityHealth;
  /** Failure propagation risk derived from overall degradation. */
  propagationRisk:        FailurePropagationRisk;
  /** ISO 8601 evaluation timestamp. */
  evaluatedAt:            string;
}

/** Estimated blast radius of a workspace failure propagating unchecked. */
export interface BlastRadius {
  workspaceId:             number;
  estimatedImpactScope:    BlastRadiusScope;
  affectedSubsystemCount:  number;
  /** Normalized 0-100 blast radius severity score. */
  blastRadiusScore:        number;
  /** Subsystem contributing most to the blast radius. */
  dominantSubsystem:       DomainType;
}

/** A single failure containment boundary within a workspace domain. */
export interface ContainmentBoundary {
  /** Format: "cb:<workspaceId>-<boundaryType>" */
  boundaryId:   string;
  /** Type of isolation mechanism this boundary represents. */
  boundaryType:
    | "tenant_isolation"
    | "scheduler_limit"
    | "advisory_gate"
    | "policy_gate"
    | "runtime_gate";
  /** Current health of this boundary. */
  status:       "holding" | "stressed" | "at_risk" | "breached";
  /** Which subsystem this boundary protects. */
  subsystem:    DomainType;
  /** Operator-readable description of the boundary state. */
  notes:        string;
}

/** Per-subsystem degradation record with contributing signals. */
export interface SubsystemDegradationRecord {
  subsystem:         DomainType;
  degradationStatus: DegradationStatus;
  /** Human-readable signals that drove this degradation classification. */
  signals:           string[];
}

// ── Input / Output ───────────────────────────────────────────────────────────

/** Input to evaluateFailureContainment() - combines P9-B/E/F signals. */
export interface FailureContainmentInput {
  workspaceId:           number;
  workspaceName?:        string;
  // ── P9-B signals ────────────────────────────────────────────────────────
  /** pressureScore.total from P9-B evaluateWorkloadContainment() */
  pressureScore:         number;
  /** containmentStatus from P9-B TenantWorkloadPartition */
  containmentStatus:     ContainmentStatus;
  /** noisyBehaviorCodes from P9-B TenantWorkloadPartition */
  noisyBehaviorCodes:    string[];
  /** advisoryPressureLevel from P9-B TenantWorkloadPartition */
  advisoryPressureLevel: AdvisoryPressureLevel;
  /** P9-B delayedExecutionCount */
  backlogDepth:          number;
  /** P9-B activeExecutionCount */
  activeExecutionCount:  number;
  /** P9-B advisory schedulerWeight */
  advisoryWeight:        number;
  // ── P9-E signals ────────────────────────────────────────────────────────
  /** Number of P9-E active policies for this workspace */
  activePolicyCount:     number;
  // ── P9-F signals ────────────────────────────────────────────────────────
  /** P9-F EnforcementStatus for this workspace */
  enforcementStatus:     string;
  /** P9-F effectiveSchedulerWeight */
  effectiveWeight:       number;
  /** Whether a multi-policy conflict was detected by P9-F */
  conflictDetected:      boolean;
  /** Override evaluation timestamp (tests). Defaults to new Date(). */
  evaluationTime?:       Date;
}

/** Full per-workspace reliability assessment. */
export interface FailureContainmentResult {
  domain:                ReliabilityDomain;
  blastRadius:           BlastRadius;
  containmentBoundaries: ContainmentBoundary[];
  subsystemDegradation:  SubsystemDegradationRecord[];
  advisoryStormDetected: boolean;
  evaluatedAt:           string;
}

/** Platform-wide reliability aggregate. */
export interface PlatformReliabilityOverview {
  totalDomains:             number;
  healthyCount:             number;
  degradedCount:            number;
  severelyDegradedCount:    number;
  containmentRiskCount:     number;
  criticalCount:            number;
  /** Worst propagation risk across all workspace domains. */
  overallPropagationRisk:   FailurePropagationRisk;
  /** Worst containment level across all workspace domains. */
  worstContainmentLevel:    ContainmentLevel;
  /** Number of workspaces with an advisory storm detected. */
  advisoryStormCount:       number;
  /** Workspace IDs with cascading propagation risk. */
  cascadingRiskWorkspaces:  number[];
  reliabilityDomains:       ReliabilityDomain[];
  blastRadii:               BlastRadius[];
  requestScopeId:           string;
  evaluatedAt:              string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Pressure score at which scheduler degradation escalates to severely_degraded. */
export const RELIABILITY_PRESSURE_SEVERE_THRESHOLD = 40;
/** Pressure score at which scheduler degradation escalates to containment_risk. */
export const RELIABILITY_PRESSURE_RISK_THRESHOLD   = 60;
/** Pressure score at which scheduler degradation escalates to critical. */
export const RELIABILITY_PRESSURE_CRITICAL_THRESHOLD = 80;

/** Backlog depth that triggers severely_degraded workflow_runtime classification. */
export const RELIABILITY_BACKLOG_SEVERE_THRESHOLD   = 20;
/** Backlog depth that triggers critical workflow_runtime classification. */
export const RELIABILITY_BACKLOG_CRITICAL_THRESHOLD = 50;

/** Noisy behavior code count above which advisory domain is severely_degraded. */
export const RELIABILITY_NOISY_CODES_SEVERE = 2;
/** Noisy behavior code count above which advisory domain is critical. */
export const RELIABILITY_NOISY_CODES_CRITICAL = 3;

/** Active policy count above which policy_engine shows as degraded. */
export const RELIABILITY_ACTIVE_POLICY_DEGRADED_THRESHOLD = 0;

/** Ordered list used for deterministic tiebreaking in dominant subsystem selection. */
const DOMAIN_TYPE_ORDER: DomainType[] = [
  "tenant_isolation",
  "scheduler",
  "workflow_runtime",
  "advisory",
  "enforcement_bridge",
  "policy_engine",
];

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE ID
// ─────────────────────────────────────────────────────────────────────────────

let _domainSeq = 0;

export function makeReliabilityDomainId(workspaceId: number): string {
  _domainSeq += 1;
  return `rd:${workspaceId}-${Date.now()}-${_domainSeq}`;
}

export function resetDomainSeq(): void {
  _domainSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY ORDERING
// ─────────────────────────────────────────────────────────────────────────────

const DEGRADATION_SEVERITY: Record<DegradationStatus, number> = {
  healthy:           0,
  degraded:          1,
  severely_degraded: 2,
  containment_risk:  3,
  critical:          4,
};

export function worstDegradation(
  a: DegradationStatus,
  b: DegradationStatus,
): DegradationStatus {
  return DEGRADATION_SEVERITY[a] >= DEGRADATION_SEVERITY[b] ? a : b;
}

const PROPAGATION_SEVERITY: Record<FailurePropagationRisk, number> = {
  isolated:  0,
  bounded:   1,
  spreading: 2,
  cascading: 3,
};

export function worstPropagationRisk(
  a: FailurePropagationRisk,
  b: FailurePropagationRisk,
): FailurePropagationRisk {
  return PROPAGATION_SEVERITY[a] >= PROPAGATION_SEVERITY[b] ? a : b;
}

const CONTAINMENT_SEVERITY: Record<ContainmentLevel, number> = {
  contained: 0,
  partial:   1,
  at_risk:   2,
  breached:  3,
};

export function worstContainmentLevel(
  a: ContainmentLevel,
  b: ContainmentLevel,
): ContainmentLevel {
  return CONTAINMENT_SEVERITY[a] >= CONTAINMENT_SEVERITY[b] ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSYSTEM DEGRADATION CLASSIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the "scheduler" subsystem health from P9-B pressure signals.
 */
export function classifySchedulerDegradation(
  pressureScore:     number,
  containmentStatus: ContainmentStatus,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";

  if (pressureScore >= RELIABILITY_PRESSURE_CRITICAL_THRESHOLD || containmentStatus === "saturated") {
    status = "critical";
    signals.push(`pressureScore=${pressureScore} (≥${RELIABILITY_PRESSURE_CRITICAL_THRESHOLD}) or saturated`);
  } else if (pressureScore >= RELIABILITY_PRESSURE_RISK_THRESHOLD || containmentStatus === "pressured") {
    status = "containment_risk";
    signals.push(`pressureScore=${pressureScore} (≥${RELIABILITY_PRESSURE_RISK_THRESHOLD}) or pressured`);
  } else if (pressureScore >= RELIABILITY_PRESSURE_SEVERE_THRESHOLD || containmentStatus === "at_risk") {
    status = "severely_degraded";
    signals.push(`pressureScore=${pressureScore} (≥${RELIABILITY_PRESSURE_SEVERE_THRESHOLD}) or at_risk`);
  } else if (pressureScore > 0) {
    status = "degraded";
    signals.push(`pressureScore=${pressureScore} (non-zero)`);
  }

  return { subsystem: "scheduler", degradationStatus: status, signals };
}

/**
 * Classifies the "advisory" subsystem health from P9-B noisy behavior signals.
 */
export function classifyAdvisoryDegradation(
  noisyBehaviorCodes:    string[],
  advisoryPressureLevel: AdvisoryPressureLevel,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";
  const noisyCount = noisyBehaviorCodes.length;

  if (advisoryPressureLevel === "critical" && noisyCount >= RELIABILITY_NOISY_CODES_CRITICAL) {
    status = "critical";
    signals.push(`advisoryPressure=critical, noisyCodes=${noisyCount}`);
  } else if (advisoryPressureLevel === "high" || noisyCount >= RELIABILITY_NOISY_CODES_SEVERE) {
    status = "severely_degraded";
    signals.push(`advisoryPressure=${advisoryPressureLevel}, noisyCodes=${noisyCount}`);
  } else if (advisoryPressureLevel === "medium" || noisyCount >= 1) {
    status = "degraded";
    signals.push(`advisoryPressure=${advisoryPressureLevel}, noisyCodes=${noisyCount}`);
  } else if (advisoryPressureLevel === "low") {
    status = "degraded";
    signals.push(`advisoryPressure=low`);
  }

  return { subsystem: "advisory", degradationStatus: status, signals };
}

/**
 * Classifies the "policy_engine" subsystem from P9-E active policy signals.
 * An active policy means the workspace is under governance adjustment - monitored.
 * A conflict means P9-E containment has failed - containment_risk.
 */
export function classifyPolicyEngineDegradation(
  activePolicyCount: number,
  conflictDetected:  boolean,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";

  if (conflictDetected) {
    status = "containment_risk";
    signals.push("P9-F conflict detected: multiple active policies for workspace");
  } else if (activePolicyCount > 1) {
    // Multiple active policies should not exist (P9-E prevents this), but defensive
    status = "severely_degraded";
    signals.push(`activePolicyCount=${activePolicyCount} (>1; P9-E conflict prevention may have failed)`);
  } else if (activePolicyCount === 1) {
    status = "degraded";
    signals.push("activePolicyCount=1 (policy governance in effect; monitoring state)");
  }

  return { subsystem: "policy_engine", degradationStatus: status, signals };
}

/**
 * Classifies the "enforcement_bridge" subsystem from P9-F enforcement status.
 */
export function classifyEnforcementBridgeDegradation(
  enforcementStatus: string,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";

  if (enforcementStatus === "conflict") {
    status = "containment_risk";
    signals.push("P9-F: multi-policy conflict - fail-closed to starvation floor");
  } else if (enforcementStatus === "floor_applied") {
    status = "severely_degraded";
    signals.push("P9-F: defensive floor override fired - policy target was below minimum");
  } else if (enforcementStatus === "stale") {
    status = "degraded";
    signals.push("P9-F: active policy is stale (expired) - revert to advisory weight");
  } else if (enforcementStatus === "resolved") {
    status = "degraded";
    signals.push("P9-F: active policy in effect - workspace under weight adjustment");
  }
  // "no_active_policy" → healthy (default state)

  return { subsystem: "enforcement_bridge", degradationStatus: status, signals };
}

/**
 * Classifies the "workflow_runtime" subsystem from execution backlog signals.
 */
export function classifyWorkflowRuntimeDegradation(
  backlogDepth:        number,
  activeExecutionCount: number,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";

  if (backlogDepth >= RELIABILITY_BACKLOG_CRITICAL_THRESHOLD && activeExecutionCount > 20) {
    status = "critical";
    signals.push(`backlogDepth=${backlogDepth} (≥${RELIABILITY_BACKLOG_CRITICAL_THRESHOLD}), activeExecutions=${activeExecutionCount}`);
  } else if (backlogDepth >= RELIABILITY_BACKLOG_CRITICAL_THRESHOLD) {
    status = "containment_risk";
    signals.push(`backlogDepth=${backlogDepth} (≥${RELIABILITY_BACKLOG_CRITICAL_THRESHOLD})`);
  } else if (backlogDepth >= RELIABILITY_BACKLOG_SEVERE_THRESHOLD) {
    status = "severely_degraded";
    signals.push(`backlogDepth=${backlogDepth} (≥${RELIABILITY_BACKLOG_SEVERE_THRESHOLD})`);
  } else if (backlogDepth > 0) {
    status = "degraded";
    signals.push(`backlogDepth=${backlogDepth} (non-zero)`);
  }

  return { subsystem: "workflow_runtime", degradationStatus: status, signals };
}

/**
 * Classifies the "tenant_isolation" subsystem from P9-A/B containment signals.
 */
export function classifyTenantIsolationDegradation(
  containmentStatus: ContainmentStatus,
  conflictDetected:  boolean,
): SubsystemDegradationRecord {
  const signals: string[] = [];
  let status: DegradationStatus = "healthy";

  if (conflictDetected) {
    status = "containment_risk";
    signals.push("Policy conflict detected - isolation boundary under stress");
  } else if (containmentStatus === "saturated") {
    status = "critical";
    signals.push("containmentStatus=saturated - isolation boundary breached");
  } else if (containmentStatus === "pressured") {
    status = "severely_degraded";
    signals.push("containmentStatus=pressured - isolation boundary under high load");
  } else if (containmentStatus === "at_risk") {
    status = "degraded";
    signals.push("containmentStatus=at_risk - isolation boundary elevated pressure");
  }

  return { subsystem: "tenant_isolation", degradationStatus: status, signals };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVISORY STORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects an advisory storm - a simultaneous overload of advisory signals.
 *
 * An advisory storm amplifies degradation across the scheduler and advisory
 * subsystems, increasing the chance of cross-subsystem propagation.
 *
 * Storm conditions (any one triggers):
 *   A) noisyBehaviorCodes.length >= 3 (multiple concurrent noisy categories)
 *   B) advisoryPressureLevel is "high" or "critical" with ≥2 noisy codes
 *   C) activePolicyCount >= 2 (policy churn - P9-E governance under stress)
 */
export function detectAdvisoryStorm(
  noisyBehaviorCodes:    string[],
  advisoryPressureLevel: AdvisoryPressureLevel,
  activePolicyCount:     number,
): boolean {
  const noisyCount = noisyBehaviorCodes.length;
  const highPressure = advisoryPressureLevel === "high" || advisoryPressureLevel === "critical";
  return (
    noisyCount >= RELIABILITY_NOISY_CODES_CRITICAL ||
    (highPressure && noisyCount >= RELIABILITY_NOISY_CODES_SEVERE) ||
    activePolicyCount >= 2
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED CLASSIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function degradationToPropagationRisk(
  status: DegradationStatus,
): FailurePropagationRisk {
  switch (status) {
    case "healthy":           return "isolated";
    case "degraded":          return "bounded";
    case "severely_degraded": return "spreading";
    case "containment_risk":  return "cascading";
    case "critical":          return "cascading";
  }
}

export function degradationToContainmentLevel(
  status:           DegradationStatus,
  conflictDetected: boolean,
): ContainmentLevel {
  if (conflictDetected)             return "breached";
  switch (status) {
    case "healthy":           return "contained";
    case "degraded":          return "contained";
    case "severely_degraded": return "partial";
    case "containment_risk":  return "at_risk";
    case "critical":          return "at_risk";
  }
}

export function degradationToRecoveryClassification(
  status: DegradationStatus,
): RecoveryClassification {
  switch (status) {
    case "healthy":           return "no_action_needed";
    case "degraded":          return "monitor_closely";
    case "severely_degraded": return "monitor_closely";
    case "containment_risk":  return "operator_attention";
    case "critical":          return "immediate_intervention";
  }
}

export function degradationToObservabilityHealth(
  status: DegradationStatus,
): ObservabilityHealth {
  switch (status) {
    case "healthy":           return "full";
    case "degraded":          return "full";
    case "severely_degraded": return "partial";
    case "containment_risk":  return "impaired";
    case "critical":          return "blind";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLAST RADIUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the estimated blast radius if this workspace's failure propagates.
 *
 * Score formula (0-100, clamped):
 *   pressureScore * 0.40
 *   + noisyCodes.length * 10   (each noisy category = +10 points)
 *   + backlogDepth tier:  > 50 → +20, > 10 → +10, > 0 → +5
 *   + conflictDetected:  +20
 */
export function computeBlastRadius(
  input:              FailureContainmentInput,
  overallDegradation: DegradationStatus,
  affectedCount:      number,
): BlastRadius {
  const { workspaceId, pressureScore, noisyBehaviorCodes, backlogDepth, conflictDetected } = input;

  const backlogBonus = backlogDepth > 50 ? 20 : backlogDepth > 10 ? 10 : backlogDepth > 0 ? 5 : 0;
  const raw = pressureScore * 0.40
    + noisyBehaviorCodes.length * 10
    + backlogBonus
    + (conflictDetected ? 20 : 0);
  const score = Math.min(100, Math.max(0, Math.round(raw)));

  const estimatedImpactScope: BlastRadiusScope =
    score >= 60 || overallDegradation === "critical" || overallDegradation === "containment_risk"
      ? "platform_wide"
      : score >= 30
        ? "tenant_group"
        : "workspace_only";

  // Pick the dominant subsystem (worst degradation wins; DOMAIN_TYPE_ORDER for tiebreaking)
  let dominantSubsystem: DomainType = DOMAIN_TYPE_ORDER[0]!;
  if (input.containmentStatus === "saturated" || input.containmentStatus === "pressured") {
    dominantSubsystem = "tenant_isolation";
  } else if (pressureScore >= RELIABILITY_PRESSURE_RISK_THRESHOLD) {
    dominantSubsystem = "scheduler";
  } else if (backlogDepth >= RELIABILITY_BACKLOG_SEVERE_THRESHOLD) {
    dominantSubsystem = "workflow_runtime";
  } else if (noisyBehaviorCodes.length >= RELIABILITY_NOISY_CODES_SEVERE) {
    dominantSubsystem = "advisory";
  } else if (input.conflictDetected) {
    dominantSubsystem = "enforcement_bridge";
  }

  return {
    workspaceId,
    estimatedImpactScope,
    affectedSubsystemCount: affectedCount,
    blastRadiusScore:       score,
    dominantSubsystem,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINMENT BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates five containment boundaries for a workspace domain.
 * Each boundary represents a specific isolation mechanism.
 */
export function evaluateContainmentBoundaries(
  input: FailureContainmentInput,
): ContainmentBoundary[] {
  const { workspaceId, containmentStatus, enforcementStatus, noisyBehaviorCodes,
          activePolicyCount, conflictDetected, backlogDepth } = input;

  const boundaries: ContainmentBoundary[] = [];

  // ── 1. tenant_isolation boundary ─────────────────────────────────────────
  const isoStatus: ContainmentBoundary["status"] =
    conflictDetected || containmentStatus === "saturated"
      ? "breached"
      : containmentStatus === "pressured"
        ? "at_risk"
        : containmentStatus === "at_risk"
          ? "stressed"
          : "holding";

  boundaries.push({
    boundaryId:   `cb:${workspaceId}-tenant_isolation`,
    boundaryType: "tenant_isolation",
    status:       isoStatus,
    subsystem:    "tenant_isolation",
    notes:        `containmentStatus=${containmentStatus}${conflictDetected ? "; conflict detected" : ""}`,
  });

  // ── 2. scheduler_limit boundary ──────────────────────────────────────────
  const schedulerBoundaryStatus: ContainmentBoundary["status"] =
    input.effectiveWeight <= 0.25 && input.pressureScore >= RELIABILITY_PRESSURE_CRITICAL_THRESHOLD
      ? "at_risk"
      : input.effectiveWeight < input.advisoryWeight
        ? "stressed"
        : "holding";

  boundaries.push({
    boundaryId:   `cb:${workspaceId}-scheduler_limit`,
    boundaryType: "scheduler_limit",
    status:       schedulerBoundaryStatus,
    subsystem:    "scheduler",
    notes:        `effectiveWeight=${input.effectiveWeight}, advisoryWeight=${input.advisoryWeight}`,
  });

  // ── 3. advisory_gate boundary ─────────────────────────────────────────────
  const advisoryBoundaryStatus: ContainmentBoundary["status"] =
    noisyBehaviorCodes.length >= RELIABILITY_NOISY_CODES_CRITICAL
      ? "at_risk"
      : noisyBehaviorCodes.length >= RELIABILITY_NOISY_CODES_SEVERE
        ? "stressed"
        : "holding";

  boundaries.push({
    boundaryId:   `cb:${workspaceId}-advisory_gate`,
    boundaryType: "advisory_gate",
    status:       advisoryBoundaryStatus,
    subsystem:    "advisory",
    notes:        `noisyCodes=${noisyBehaviorCodes.length}, advisoryPressure=${input.advisoryPressureLevel}`,
  });

  // ── 4. policy_gate boundary ───────────────────────────────────────────────
  const policyBoundaryStatus: ContainmentBoundary["status"] =
    conflictDetected
      ? "breached"
      : enforcementStatus === "conflict"
        ? "at_risk"
        : activePolicyCount > 0
          ? "stressed"
          : "holding";

  boundaries.push({
    boundaryId:   `cb:${workspaceId}-policy_gate`,
    boundaryType: "policy_gate",
    status:       policyBoundaryStatus,
    subsystem:    "policy_engine",
    notes:        `activePolicies=${activePolicyCount}, enforcementStatus=${enforcementStatus}`,
  });

  // ── 5. runtime_gate boundary ─────────────────────────────────────────────
  const runtimeBoundaryStatus: ContainmentBoundary["status"] =
    backlogDepth >= RELIABILITY_BACKLOG_CRITICAL_THRESHOLD
      ? "at_risk"
      : backlogDepth >= RELIABILITY_BACKLOG_SEVERE_THRESHOLD
        ? "stressed"
        : "holding";

  boundaries.push({
    boundaryId:   `cb:${workspaceId}-runtime_gate`,
    boundaryType: "runtime_gate",
    status:       runtimeBoundaryStatus,
    subsystem:    "workflow_runtime",
    notes:        `backlogDepth=${backlogDepth}, activeExecutions=${input.activeExecutionCount}`,
  });

  return boundaries;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates failure containment for a single workspace.
 *
 * Steps:
 *   1. Classify each of the 6 subsystems independently (deterministic).
 *   2. Compute overall domain state from worst subsystem.
 *   3. Compute blast radius from input signals.
 *   4. Evaluate 5 containment boundaries.
 *   5. Detect advisory storm.
 *   6. Emit reliability_domain_evaluated + failure_containment_assessed events.
 *
 * Pure: no DB, no async, no mutations.
 */
export function evaluateFailureContainment(
  input: FailureContainmentInput,
): FailureContainmentResult {
  const now        = input.evaluationTime ?? new Date();
  const evalAt     = now.toISOString();
  const domainId   = makeReliabilityDomainId(input.workspaceId);

  // ── Step 1: Classify all 6 subsystems ────────────────────────────────────
  const schedulerRec  = classifySchedulerDegradation(input.pressureScore, input.containmentStatus);
  const advisoryRec   = classifyAdvisoryDegradation(input.noisyBehaviorCodes, input.advisoryPressureLevel);
  const policyRec     = classifyPolicyEngineDegradation(input.activePolicyCount, input.conflictDetected);
  const bridgeRec     = classifyEnforcementBridgeDegradation(input.enforcementStatus);
  const runtimeRec    = classifyWorkflowRuntimeDegradation(input.backlogDepth, input.activeExecutionCount);
  const isolationRec  = classifyTenantIsolationDegradation(input.containmentStatus, input.conflictDetected);

  const subsystemDegradation: SubsystemDegradationRecord[] = [
    schedulerRec, advisoryRec, policyRec, bridgeRec, runtimeRec, isolationRec,
  ];

  // ── Step 2: Compute overall domain state ─────────────────────────────────
  let overallDegradation: DegradationStatus = "healthy";
  for (const rec of subsystemDegradation) {
    overallDegradation = worstDegradation(overallDegradation, rec.degradationStatus);
  }

  // Affected subsystems: those with degraded or worse status
  const affectedSubsystems = subsystemDegradation
    .filter(r => DEGRADATION_SEVERITY[r.degradationStatus] >= DEGRADATION_SEVERITY["degraded"])
    .map(r => r.subsystem);

  // Dominant subsystem: worst degradation, tiebreak by DOMAIN_TYPE_ORDER
  const worstStatus = overallDegradation;
  let dominantType: DomainType = "scheduler";
  for (const dt of DOMAIN_TYPE_ORDER) {
    const rec = subsystemDegradation.find(r => r.subsystem === dt);
    if (rec && rec.degradationStatus === worstStatus) {
      dominantType = dt;
      break;
    }
  }

  const propagationRisk   = degradationToPropagationRisk(overallDegradation);
  const containmentLevel  = degradationToContainmentLevel(overallDegradation, input.conflictDetected);
  const recoveryClass     = degradationToRecoveryClassification(overallDegradation);
  const obsHealth         = degradationToObservabilityHealth(overallDegradation);

  const domain: ReliabilityDomain = {
    domainId,
    domainType:             dominantType,
    workspaceId:            input.workspaceId,
    affectedSubsystems,
    containmentLevel,
    degradationStatus:      overallDegradation,
    recoveryClassification: recoveryClass,
    observabilityHealth:    obsHealth,
    propagationRisk,
    evaluatedAt:            evalAt,
  };

  // ── Step 3: Blast radius ──────────────────────────────────────────────────
  const blastRadius = computeBlastRadius(input, overallDegradation, affectedSubsystems.length);

  // ── Step 4: Containment boundaries ───────────────────────────────────────
  const containmentBoundaries = evaluateContainmentBoundaries(input);

  // ── Step 5: Advisory storm ────────────────────────────────────────────────
  const advisoryStormDetected = detectAdvisoryStorm(
    input.noisyBehaviorCodes,
    input.advisoryPressureLevel,
    input.activePolicyCount,
  );

  // ── Step 6: Observability events ─────────────────────────────────────────
  emitReliabilityDomainEvaluatedEvent({
    domainId,
    degradationStatus:  overallDegradation,
    propagationRisk,
    containmentLevel,
    affectedSubsystems,
    action:             "domain_evaluated",
  });

  emitFailureContainmentAssessedEvent({
    domainId,
    degradationStatus:  overallDegradation,
    propagationRisk,
    containmentLevel,
    affectedSubsystems,
    action:             "containment_assessed",
  });

  if (propagationRisk === "spreading" || propagationRisk === "cascading") {
    emitFailurePropagationRiskDetectedEvent({
      domainId,
      degradationStatus:  overallDegradation,
      propagationRisk,
      containmentLevel,
      affectedSubsystems,
      action:             "propagation_risk_detected",
    });
  }

  emitRuntimeDegradationClassifiedEvent({
    domainId,
    degradationStatus:  overallDegradation,
    propagationRisk,
    containmentLevel,
    affectedSubsystems,
    action:             "degradation_classified",
  });

  return { domain, blastRadius, containmentBoundaries, subsystemDegradation, advisoryStormDetected, evaluatedAt: evalAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM RELIABILITY OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a platform-wide PlatformReliabilityOverview from per-workspace results.
 *
 * Pure aggregation: no DB, no async, no mutations.
 */
export function buildPlatformReliabilityOverview(
  results:        ReadonlyArray<FailureContainmentResult>,
  requestScopeId?: string,
  generationTime?: Date,
): PlatformReliabilityOverview {
  const now     = generationTime ?? new Date();
  const scopeId = requestScopeId ?? `rs:${Date.now()}`;

  let healthyCount           = 0;
  let degradedCount          = 0;
  let severelyDegradedCount  = 0;
  let containmentRiskCount   = 0;
  let criticalCount          = 0;
  let advisoryStormCount     = 0;
  let overallPropagation: FailurePropagationRisk = "isolated";
  let worstContainment: ContainmentLevel         = "contained";
  const cascadingWorkspaces: number[] = [];
  const reliabilityDomains: ReliabilityDomain[]  = [];
  const blastRadii: BlastRadius[]                = [];

  for (const result of results) {
    reliabilityDomains.push(result.domain);
    blastRadii.push(result.blastRadius);

    switch (result.domain.degradationStatus) {
      case "healthy":           healthyCount++;           break;
      case "degraded":          degradedCount++;          break;
      case "severely_degraded": severelyDegradedCount++;  break;
      case "containment_risk":  containmentRiskCount++;   break;
      case "critical":          criticalCount++;          break;
    }

    if (result.advisoryStormDetected) advisoryStormCount++;

    if (result.domain.propagationRisk === "cascading") {
      cascadingWorkspaces.push(result.domain.workspaceId);
    }

    overallPropagation = worstPropagationRisk(overallPropagation, result.domain.propagationRisk);
    worstContainment   = worstContainmentLevel(worstContainment, result.domain.containmentLevel);
  }

  return {
    totalDomains:             results.length,
    healthyCount,
    degradedCount,
    severelyDegradedCount,
    containmentRiskCount,
    criticalCount,
    overallPropagationRisk:   overallPropagation,
    worstContainmentLevel:    worstContainment,
    advisoryStormCount,
    cascadingRiskWorkspaces:  cascadingWorkspaces,
    reliabilityDomains,
    blastRadii,
    requestScopeId:           scopeId,
    evaluatedAt:              now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface ReliabilityEventPayload {
  domainId:          string;
  degradationStatus: DegradationStatus;
  propagationRisk:   FailurePropagationRisk;
  containmentLevel:  ContainmentLevel;
  affectedSubsystems: DomainType[];
  action:            string;
}

export function emitReliabilityDomainEvaluatedEvent(p: ReliabilityEventPayload): void {
  logger.info(
    { event: "reliability_domain_evaluated", ...p },
    "[reliability-domains] P10-A: reliability_domain_evaluated",
  );
}

export function emitFailureContainmentAssessedEvent(p: ReliabilityEventPayload): void {
  logger.info(
    { event: "failure_containment_assessed", ...p },
    "[reliability-domains] P10-A: failure_containment_assessed",
  );
}

export function emitFailurePropagationRiskDetectedEvent(p: ReliabilityEventPayload): void {
  logger.info(
    { event: "failure_propagation_risk_detected", ...p },
    "[reliability-domains] P10-A: failure_propagation_risk_detected",
  );
}

export function emitRuntimeDegradationClassifiedEvent(p: ReliabilityEventPayload): void {
  logger.info(
    { event: "runtime_degradation_classified", ...p },
    "[reliability-domains] P10-A: runtime_degradation_classified",
  );
}
