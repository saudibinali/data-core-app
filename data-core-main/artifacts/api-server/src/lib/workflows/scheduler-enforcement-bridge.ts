/**
 * @file   lib/workflows/scheduler-enforcement-bridge.ts
 * @phase  P9-F - Adaptive Scheduling Research Foundations & Safe Enforcement Bridge
 *
 * Pure deterministic enforcement bridge engine.
 * No DB, no async, no automatic throttling, no self-adjusting scheduler.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Bridges the gap between the read-only fairness intelligence (P9-B/D) and
 *   the governance policy system (P9-E) by computing an effective scheduler
 *   weight per workspace that accounts for active fairness policies.
 *
 *   resolveEffectiveSchedulerWeight(policies, wsId, advisoryWeight, options?)
 *     → EnforcementResolutionResult
 *
 *   buildAdaptiveResearchSnapshot(bridges, partitions, workspaceNames?)
 *     → AdaptiveResearchSnapshot
 *
 *   computeResearchMetrics(bridge, partition, workspaceName?)
 *     → ResearchMetric
 *
 *   detectPolicyResolutionConflict(policies, wsId, resolutionTime?)
 *     → PolicyResolutionConflict | null
 *
 * ── SCHEDULER WEIGHT RESOLUTION SEMANTICS ───────────────────────────────────
 *
 *   The "advisory weight" from P9-B is what the scheduler WOULD use without any
 *   policy intervention. The "effective weight" is what the scheduler SHOULD use
 *   after taking active P9-E policies into account.
 *
 *   Resolution priority (highest to lowest):
 *
 *   1. CONFLICT guard  - if multiple non-expired active policies exist for the
 *      same workspace (defensive; P9-E should prevent this), fail-closed to
 *      SCHEDULER_WEIGHT_FLOOR. Mode: advisory_only.
 *
 *   2. STALE check     - if the only "active" policies are expired, treat as
 *      no-policy. Mode: advisory_only.
 *
 *   3. ACTIVE POLICY   - exactly one non-expired active policy exists:
 *      effectiveWeight = max(policy.targetSchedulerWeight, SCHEDULER_WEIGHT_FLOOR)
 *      Mode: operator_confirmed (or research_shadow if requested).
 *
 *   4. NO POLICY       - no active policy. effectiveWeight = advisoryWeight.
 *      Mode: advisory_only.
 *
 * ── ENFORCEMENT MODES ────────────────────────────────────────────────────────
 *
 *   "advisory_only"
 *     No policy influence. effectiveWeight = P9-B advisoryWeight.
 *     Default state for all workspaces without active policies.
 *
 *   "operator_confirmed"
 *     Active operator-approved policy in effect.
 *     effectiveWeight = policy.targetSchedulerWeight (floor-guaranteed).
 *     The advisory weight is still preserved in bridge.advisorySchedulerWeight.
 *
 *   "research_shadow"
 *     Explicit opt-in mode for passive research observation.
 *     A policy exists but the effective weight is NOT changed from advisory.
 *     Used for comparing what the policy would do without enforcing it.
 *     effectiveWeight = advisoryWeight (shadow; policy weight in resolutionNotes).
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   STARVATION FLOOR:     effectiveSchedulerWeight never below 0.25.
 *   FAIL-CLOSED CONFLICT: ambiguity → SCHEDULER_WEIGHT_FLOOR + advisory_only.
 *   HUMAN-GATED:          this engine reads P9-E policies; it never creates them.
 *   NO SELF-ADJUSTMENT:   no weight is ever changed without a P9-E policy record.
 *   IMMUTABLE:            engine functions never mutate input arrays or policies.
 *   DETERMINISTIC:        same inputs → same outputs; no randomness or time-based drift.
 */

import { logger } from "../logger";
import {
  SCHEDULER_WEIGHT_FLOOR,
  isPolicyExpired,
  type SchedulerFairnessPolicy,
  type FairnessPolicyStatus,
} from "./fairness-policy";
import type { TenantWorkloadPartition, ContainmentStatus } from "./workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the effective scheduler weight is being applied.
 *
 *   "advisory_only"      - effectiveWeight = P9-B advisory (no policy in effect)
 *   "operator_confirmed" - effectiveWeight = policy.targetSchedulerWeight (approved)
 *   "research_shadow"    - policy exists, but effective weight is NOT changed;
 *                           used for passive observation only
 */
export type EnforcementMode = "advisory_only" | "operator_confirmed" | "research_shadow";

/**
 * Outcome of the enforcement resolution for a single workspace.
 *
 *   "resolved"          - exactly one live active policy applied
 *   "no_active_policy"  - no active policy; advisory weight used
 *   "conflict"          - multiple non-expired active policies (defensive)
 *   "stale"             - active-status policies exist but all are expired
 *   "floor_applied"     - policy target was below floor (defensive floor enforcement)
 */
export type EnforcementStatus =
  | "resolved"
  | "no_active_policy"
  | "conflict"
  | "stale"
  | "floor_applied";

/**
 * The enforcement bridge for a single workspace at a point in time.
 *
 * Pure value object - no class methods. JSON-safe. All timestamps ISO 8601.
 */
export interface SchedulerEnforcementBridge {
  /** Workspace DB primary key. */
  workspaceId:              number;
  /**
   * The effective scheduler weight AFTER policy and floor resolution.
   * This is what the scheduler SHOULD use for this workspace.
   * Always ≥ SCHEDULER_WEIGHT_FLOOR (0.25).
   */
  effectiveSchedulerWeight: number;
  /**
   * The P9-B advisory weight BEFORE policy influence.
   * Preserved for research comparison (delta = effective - advisory).
   */
  advisorySchedulerWeight:  number;
  /**
   * policyId of the active policy driving the effective weight.
   * null if effectiveWeight comes from advisory (no active policy).
   */
  sourcePolicyId:           string | null;
  /**
   * How the effective weight is being applied.
   * See EnforcementMode for semantics.
   */
  enforcementMode:          EnforcementMode;
  /**
   * Outcome of the resolution process.
   * See EnforcementStatus for semantics.
   */
  enforcementStatus:        EnforcementStatus;
  /** ISO 8601 timestamp when this bridge was resolved. */
  appliedAt:                string;
  /**
   * The previousSchedulerWeight from the source policy.
   * Non-null only when a policy is active (sourcePolicyId != null).
   * This is the weight to revert to if the policy is rolled back.
   */
  rollbackReference:        string | null;
  /**
   * Advisory notes about the resolution process.
   * Populated for stale, conflict, floor-applied, and shadow cases.
   */
  resolutionNotes:          string[];
}

/** Input to resolveEffectiveSchedulerWeight(). */
export interface EnforcementResolutionInput {
  /**
   * All known SchedulerFairnessPolicy records (any workspace, any status).
   * The resolver filters to the relevant workspace and status internally.
   */
  policies:        ReadonlyArray<SchedulerFairnessPolicy>;
  workspaceId:     number;
  /** P9-B advisory weight from evaluateWorkloadContainment(). */
  advisoryWeight:  number;
  /** Override resolution timestamp (tests). Defaults to new Date(). */
  resolutionTime?: Date;
  /**
   * Requested enforcement mode. Affects whether a found policy is applied
   * or observed in shadow mode. Defaults to "operator_confirmed" if a
   * live policy exists, "advisory_only" otherwise.
   */
  requestedMode?:  EnforcementMode;
}

/** Full result of resolveEffectiveSchedulerWeight(). */
export interface EnforcementResolutionResult {
  bridge:              SchedulerEnforcementBridge;
  /** Non-expired active policies found for this workspace (0 or 1 normally). */
  livePoliciesFound:   number;
  /** Active-status policies that were expired at resolution time. */
  stalePoliciesFound:  number;
  /** True if multiple non-expired active policies were detected (defensive). */
  conflictDetected:    boolean;
}

/** Conflict record when multiple non-expired active policies are found. */
export interface PolicyResolutionConflict {
  workspaceId:          number;
  conflictingPolicyIds: string[];
  conflictingWeights:   number[];
  detectedAt:           string;
}

/**
 * Per-workspace research instrumentation record.
 * Aggregated into AdaptiveResearchSnapshot.
 */
export interface ResearchMetric {
  workspaceId:           number;
  workspaceName:         string;
  /** P9-B advisory weight before any policy influence. */
  advisoryWeight:        number;
  /** Effective weight after bridge resolution. */
  effectiveWeight:       number;
  /**
   * effectiveWeight - advisoryWeight.
   * Negative = workspace was reduced below advisory.
   * Positive = workspace was raised above advisory (unusual).
   * Zero     = no policy influence.
   */
  weightDelta:           number;
  sourcePolicyId:        string | null;
  enforcementMode:       EnforcementMode;
  enforcementStatus:     EnforcementStatus;
  /** P9-B containmentStatus at snapshot time. */
  containmentStatus:     ContainmentStatus;
  /** P9-B pressureScore.total at snapshot time. */
  pressureScore:         number;
  noisyBehaviorDetected: boolean;
  /** P9-B delayedExecutionCount - backlog depth at snapshot time. */
  backlogDepth:          number;
  recordedAt:            string;
}

/**
 * Platform-wide adaptive research snapshot.
 * Aggregates enforcement bridges across all workspaces.
 */
export interface AdaptiveResearchSnapshot {
  totalWorkspaces:              number;
  workspacesWithActivePolicies: number;
  workspacesInAdvisoryMode:     number;
  workspacesInEnforcementMode:  number;
  workspacesInResearchMode:     number;
  /** Mean effectiveSchedulerWeight across all workspaces. Rounded to 4dp. */
  averageEffectiveWeight:       number;
  /** Mean advisorySchedulerWeight across all workspaces. Rounded to 4dp. */
  averageAdvisoryWeight:        number;
  /**
   * Distribution of weightDelta (effective vs advisory):
   *   reduced   - workspace weight was reduced by policy
   *   unchanged - no policy influence or research_shadow
   *   increased - workspace weight was raised by policy
   */
  weightDeltaDistribution: {
    reduced:   number;
    unchanged: number;
    increased: number;
  };
  /** Workspaces where the starvation floor override fired (defensive). */
  floorAppliedCount:  number;
  /** Workspaces with multi-policy conflict detected (should be 0 normally). */
  conflictCount:      number;
  /** Workspaces with stale active policies. */
  staleCount:         number;
  researchMetrics:    ResearchMetric[];
  requestScopeId:     string;
  generatedAt:        string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Re-export for callers that import only this module. */
export { SCHEDULER_WEIGHT_FLOOR };

/** Maximum allowed effective weight (mirrors P9-E). */
export const SCHEDULER_WEIGHT_CEILING = 1.00;

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE ID
// ─────────────────────────────────────────────────────────────────────────────

let _bridgeSeq = 0;

/** Generates a per-resolution correlation ID. Format: "eb:<ms>-<seq>" */
export function makeEnforcementBridgeId(): string {
  _bridgeSeq += 1;
  return `eb:${Date.now()}-${_bridgeSeq}`;
}

/** Resets bridge sequence counter. Use only in tests. */
export function resetBridgeSeq(): void {
  _bridgeSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects if multiple non-expired active policies exist for a workspace.
 *
 * This should never happen (P9-E conflict prevention), but we check
 * defensively at resolution time. Returns null if no conflict.
 */
export function detectPolicyResolutionConflict(
  policies:        ReadonlyArray<SchedulerFairnessPolicy>,
  workspaceId:     number,
  resolutionTime?: Date,
): PolicyResolutionConflict | null {
  const now = resolutionTime ?? new Date();

  const livePolicies = policies.filter(
    p =>
      p.workspaceId === workspaceId &&
      p.policyStatus === "active" &&
      !isPolicyExpired(p, now),
  );

  if (livePolicies.length <= 1) return null;

  return {
    workspaceId,
    conflictingPolicyIds: livePolicies.map(p => p.policyId),
    conflictingWeights:   livePolicies.map(p => p.targetSchedulerWeight),
    detectedAt:           now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECTIVE WEIGHT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the effective scheduler weight for a single workspace.
 *
 * This is the core P9-F function - it bridges P9-B advisory weights and
 * P9-E governance policies into a single actionable effective weight.
 *
 * Resolution algorithm:
 *   1. Partition policies into live (non-expired active) and stale (expired active)
 *   2. CONFLICT: multiple live → fail-closed to floor, mode=advisory_only
 *   3. STALE:    no live, some stale → advisory weight, mode=advisory_only
 *   4. NO POLICY: no live, no stale → advisory weight, mode=advisory_only
 *   5. RESOLVED:  exactly one live → effective = max(target, floor)
 *      If requestedMode = "research_shadow" → effective = advisoryWeight (observe only)
 *
 * Always guarantees: effectiveSchedulerWeight ≥ SCHEDULER_WEIGHT_FLOOR (0.25).
 */
export function resolveEffectiveSchedulerWeight(
  input: EnforcementResolutionInput,
): EnforcementResolutionResult {
  const { policies, workspaceId, advisoryWeight, resolutionTime, requestedMode } = input;
  const now     = resolutionTime ?? new Date();
  const appliedAt = now.toISOString();

  // Guard: advisory weight floor
  const safeAdvisory = Math.max(advisoryWeight, SCHEDULER_WEIGHT_FLOOR);

  // Partition policies for this workspace by live/stale
  const workspacePolicies = policies.filter(
    p => p.workspaceId === workspaceId && p.policyStatus === "active",
  );
  const livePolicies  = workspacePolicies.filter(p => !isPolicyExpired(p, now));
  const stalePolicies = workspacePolicies.filter(p => isPolicyExpired(p, now));

  const livePoliciesFound  = livePolicies.length;
  const stalePoliciesFound = stalePolicies.length;

  // ── CASE 1: CONFLICT (multiple non-expired active policies) ──────────────
  if (livePoliciesFound > 1) {
    const conflict = detectPolicyResolutionConflict(policies, workspaceId, now);
    const notes    = [
      `CONFLICT: ${livePoliciesFound} non-expired active policies detected for workspace ${workspaceId}.`,
      `Conflicting policyIds: ${livePolicies.map(p => p.policyId).join(", ")}.`,
      `Fail-closed to starvation floor (${SCHEDULER_WEIGHT_FLOOR}). Investigate and rollback duplicates.`,
    ];

    emitPolicyResolutionConflictEvent({
      workspaceId,
      sourcePolicyId:           null,
      effectiveSchedulerWeight: SCHEDULER_WEIGHT_FLOOR,
      enforcementMode:          "advisory_only",
      enforcementStatus:        "conflict",
      action:                   "conflict_detected",
    });

    if (conflict) {
      emitPolicyResolutionConflictEvent({
        workspaceId,
        sourcePolicyId:           null,
        effectiveSchedulerWeight: SCHEDULER_WEIGHT_FLOOR,
        enforcementMode:          "advisory_only",
        enforcementStatus:        "conflict",
        action:                   "conflict_emitted",
      });
    }

    return {
      bridge: {
        workspaceId,
        effectiveSchedulerWeight: SCHEDULER_WEIGHT_FLOOR,
        advisorySchedulerWeight:  safeAdvisory,
        sourcePolicyId:           null,
        enforcementMode:          "advisory_only",
        enforcementStatus:        "conflict",
        appliedAt,
        rollbackReference:        null,
        resolutionNotes:          notes,
      },
      livePoliciesFound,
      stalePoliciesFound,
      conflictDetected: true,
    };
  }

  // ── CASE 2: STALE (all active policies are expired) ───────────────────────
  if (livePoliciesFound === 0 && stalePoliciesFound > 0) {
    const stalePolicyId = stalePolicies[0]?.policyId ?? null;
    const notes = [
      `STALE: ${stalePoliciesFound} active policy record(s) found but all are past expiresAt.`,
      `Stale policy: ${stalePolicyId}. Using advisory weight.`,
      `Run GET /platform/governance/fairness/policies to auto-expire stale rows.`,
    ];

    return {
      bridge: {
        workspaceId,
        effectiveSchedulerWeight: safeAdvisory,
        advisorySchedulerWeight:  safeAdvisory,
        sourcePolicyId:           null,
        enforcementMode:          "advisory_only",
        enforcementStatus:        "stale",
        appliedAt,
        rollbackReference:        null,
        resolutionNotes:          notes,
      },
      livePoliciesFound:  0,
      stalePoliciesFound,
      conflictDetected:   false,
    };
  }

  // ── CASE 3: NO ACTIVE POLICY ──────────────────────────────────────────────
  if (livePoliciesFound === 0) {
    return {
      bridge: {
        workspaceId,
        effectiveSchedulerWeight: safeAdvisory,
        advisorySchedulerWeight:  safeAdvisory,
        sourcePolicyId:           null,
        enforcementMode:          "advisory_only",
        enforcementStatus:        "no_active_policy",
        appliedAt,
        rollbackReference:        null,
        resolutionNotes:          [],
      },
      livePoliciesFound:  0,
      stalePoliciesFound: 0,
      conflictDetected:   false,
    };
  }

  // ── CASE 4: EXACTLY ONE LIVE ACTIVE POLICY ───────────────────────────────
  const livePolicy    = livePolicies[0]!;
  const policyTarget  = livePolicy.targetSchedulerWeight;
  const notes: string[] = [];

  // Floor enforcement (defensive - P9-E should already prevent below-floor)
  let enforcementStatus: EnforcementStatus = "resolved";
  let effectiveWeight = policyTarget;
  if (policyTarget < SCHEDULER_WEIGHT_FLOOR) {
    effectiveWeight = SCHEDULER_WEIGHT_FLOOR;
    enforcementStatus = "floor_applied";
    notes.push(
      `FLOOR_APPLIED: policy ${livePolicy.policyId} targetWeight ${policyTarget} ` +
      `was below starvation floor ${SCHEDULER_WEIGHT_FLOOR}. Floor enforced.`,
    );
  }

  // Research shadow mode - observe without applying
  const isShadow = requestedMode === "research_shadow";
  const enforcementMode: EnforcementMode = isShadow
    ? "research_shadow"
    : "operator_confirmed";

  if (isShadow) {
    notes.push(
      `RESEARCH_SHADOW: policy ${livePolicy.policyId} found (target: ${policyTarget}) ` +
      `but effective weight remains advisory (${safeAdvisory}) for shadow observation.`,
    );
  }

  const finalEffective = isShadow ? safeAdvisory : effectiveWeight;
  const rollbackRef    = String(livePolicy.previousSchedulerWeight);

  emitEnforcementBridgeResolvedEvent({
    workspaceId,
    sourcePolicyId:           livePolicy.policyId,
    effectiveSchedulerWeight: finalEffective,
    enforcementMode,
    enforcementStatus,
    action:                   "bridge_resolved",
  });

  return {
    bridge: {
      workspaceId,
      effectiveSchedulerWeight: finalEffective,
      advisorySchedulerWeight:  safeAdvisory,
      sourcePolicyId:           livePolicy.policyId,
      enforcementMode,
      enforcementStatus,
      appliedAt,
      rollbackReference:        rollbackRef,
      resolutionNotes:          notes,
    },
    livePoliciesFound:  1,
    stalePoliciesFound,
    conflictDetected:   false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a ResearchMetric for a single workspace by combining its
 * enforcement bridge with its current P9-B partition data.
 *
 * Pure: no DB, no async, no mutations.
 */
export function computeResearchMetrics(
  bridge:        SchedulerEnforcementBridge,
  partition:     TenantWorkloadPartition,
  workspaceName?: string,
  recordTime?:   Date,
): ResearchMetric {
  const now       = recordTime ?? new Date();
  const weightDelta = round4(bridge.effectiveSchedulerWeight - bridge.advisorySchedulerWeight);

  const metric: ResearchMetric = {
    workspaceId:           bridge.workspaceId,
    workspaceName:         workspaceName ?? `workspace:${bridge.workspaceId}`,
    advisoryWeight:        bridge.advisorySchedulerWeight,
    effectiveWeight:       bridge.effectiveSchedulerWeight,
    weightDelta,
    sourcePolicyId:        bridge.sourcePolicyId,
    enforcementMode:       bridge.enforcementMode,
    enforcementStatus:     bridge.enforcementStatus,
    containmentStatus:     partition.containmentStatus,
    pressureScore:         partition.pressureScore.total,
    noisyBehaviorDetected: partition.noisyBehaviorDetected,
    backlogDepth:          partition.delayedExecutionCount,
    recordedAt:            now.toISOString(),
  };

  emitResearchMetricRecordedEvent({
    workspaceId:             bridge.workspaceId,
    sourcePolicyId:          bridge.sourcePolicyId,
    effectiveSchedulerWeight: bridge.effectiveSchedulerWeight,
    enforcementMode:          bridge.enforcementMode,
    enforcementStatus:        bridge.enforcementStatus,
    action:                   "metric_recorded",
  });

  return metric;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE RESEARCH SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a platform-wide AdaptiveResearchSnapshot from a list of
 * pre-computed enforcement bridges and their corresponding partitions.
 *
 * Call resolveEffectiveSchedulerWeight() per workspace first, then pass
 * the bridges here for aggregation.
 *
 * Pure: no DB, no async, no mutations.
 */
export function buildAdaptiveResearchSnapshot(
  bridges:         ReadonlyArray<SchedulerEnforcementBridge>,
  partitions:      ReadonlyArray<TenantWorkloadPartition>,
  workspaceNames?: Record<number, string>,
  requestScopeId?: string,
  generationTime?: Date,
): AdaptiveResearchSnapshot {
  const now       = generationTime ?? new Date();
  const scopeId   = requestScopeId ?? makeEnforcementBridgeId();
  const total     = bridges.length;

  // Build a lookup of partition by workspaceId
  const partitionMap = new Map(partitions.map(p => [p.workspaceId, p]));

  // Compute research metrics for each bridge
  const researchMetrics: ResearchMetric[] = bridges.map(bridge => {
    const partition = partitionMap.get(bridge.workspaceId);
    if (!partition) {
      // Defensive: return a minimal metric if partition is missing
      return {
        workspaceId:           bridge.workspaceId,
        workspaceName:         workspaceNames?.[bridge.workspaceId] ?? `workspace:${bridge.workspaceId}`,
        advisoryWeight:        bridge.advisorySchedulerWeight,
        effectiveWeight:       bridge.effectiveSchedulerWeight,
        weightDelta:           round4(bridge.effectiveSchedulerWeight - bridge.advisorySchedulerWeight),
        sourcePolicyId:        bridge.sourcePolicyId,
        enforcementMode:       bridge.enforcementMode,
        enforcementStatus:     bridge.enforcementStatus,
        containmentStatus:     "contained" as ContainmentStatus,
        pressureScore:         0,
        noisyBehaviorDetected: false,
        backlogDepth:          0,
        recordedAt:            now.toISOString(),
      };
    }
    return computeResearchMetrics(bridge, partition, workspaceNames?.[bridge.workspaceId], now);
  });

  // Aggregation counters
  let withActivePolicies   = 0;
  let inAdvisoryMode       = 0;
  let inEnforcementMode    = 0;
  let inResearchMode       = 0;
  let floorAppliedCount    = 0;
  let conflictCount        = 0;
  let staleCount           = 0;
  let sumEffective         = 0;
  let sumAdvisory          = 0;
  let deltaReduced         = 0;
  let deltaUnchanged       = 0;
  let deltaIncreased       = 0;

  for (const bridge of bridges) {
    if (bridge.sourcePolicyId !== null) withActivePolicies++;
    if (bridge.enforcementMode === "advisory_only")       inAdvisoryMode++;
    if (bridge.enforcementMode === "operator_confirmed")  inEnforcementMode++;
    if (bridge.enforcementMode === "research_shadow")     inResearchMode++;
    if (bridge.enforcementStatus === "floor_applied")     floorAppliedCount++;
    if (bridge.enforcementStatus === "conflict")          conflictCount++;
    if (bridge.enforcementStatus === "stale")             staleCount++;

    sumEffective += bridge.effectiveSchedulerWeight;
    sumAdvisory  += bridge.advisorySchedulerWeight;

    const delta = bridge.effectiveSchedulerWeight - bridge.advisorySchedulerWeight;
    if (delta < -0.001)       deltaReduced++;
    else if (delta > 0.001)   deltaIncreased++;
    else                      deltaUnchanged++;
  }

  const avgEffective = total > 0 ? round4(sumEffective / total) : 0;
  const avgAdvisory  = total > 0 ? round4(sumAdvisory  / total) : 0;

  const snapshot: AdaptiveResearchSnapshot = {
    totalWorkspaces:              total,
    workspacesWithActivePolicies: withActivePolicies,
    workspacesInAdvisoryMode:     inAdvisoryMode,
    workspacesInEnforcementMode:  inEnforcementMode,
    workspacesInResearchMode:     inResearchMode,
    averageEffectiveWeight:       avgEffective,
    averageAdvisoryWeight:        avgAdvisory,
    weightDeltaDistribution: {
      reduced:   deltaReduced,
      unchanged: deltaUnchanged,
      increased: deltaIncreased,
    },
    floorAppliedCount,
    conflictCount,
    staleCount,
    researchMetrics,
    requestScopeId: scopeId,
    generatedAt:    now.toISOString(),
  };

  emitEffectiveWeightAppliedEvent({
    workspaceId:              0,        // platform-level event, not workspace-scoped
    sourcePolicyId:           null,
    effectiveSchedulerWeight: avgEffective,
    enforcementMode:          inEnforcementMode > 0 ? "operator_confirmed" : "advisory_only",
    enforcementStatus:        conflictCount > 0 ? "conflict" : "resolved",
    action:                   "snapshot_generated",
  });

  return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface BridgeEventPayload {
  workspaceId:              number;
  sourcePolicyId:           string | null;
  effectiveSchedulerWeight: number;
  enforcementMode:          EnforcementMode;
  enforcementStatus:        EnforcementStatus;
  action:                   string;
}

export function emitEnforcementBridgeResolvedEvent(payload: BridgeEventPayload): void {
  logger.info(
    { event: "scheduler_enforcement_bridge_resolved", ...payload },
    "[enforcement-bridge] P9-F: scheduler_enforcement_bridge_resolved",
  );
}

export function emitEffectiveWeightAppliedEvent(payload: BridgeEventPayload): void {
  logger.info(
    { event: "scheduler_effective_weight_applied", ...payload },
    "[enforcement-bridge] P9-F: scheduler_effective_weight_applied",
  );
}

export function emitPolicyResolutionConflictEvent(payload: BridgeEventPayload): void {
  logger.info(
    { event: "scheduler_policy_resolution_conflict", ...payload },
    "[enforcement-bridge] P9-F: scheduler_policy_resolution_conflict",
  );
}

export function emitResearchMetricRecordedEvent(payload: BridgeEventPayload): void {
  logger.info(
    { event: "scheduler_research_metric_recorded", ...payload },
    "[enforcement-bridge] P9-F: scheduler_research_metric_recorded",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
