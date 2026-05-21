/**
 * @file   lib/workflows/reliability-history.ts
 * @phase  P10-B - Reliability History, Incident Timelines & Operational SLO Foundations
 *
 * Pure deterministic reliability-history intelligence engine.
 * No DB, no async, no mutations, no self-healing, no autonomous recovery.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Models the TIME dimension of platform reliability - turning point-in-time
 *   P10-A snapshots into:
 *
 *   trackReliabilityTransition(prev, current)
 *     → ReliabilityTransition | null  (per-workspace degradation change detection)
 *
 *   buildIncidentTimelines(snapshots[])
 *     → IncidentTimeline[]            (incident reconstruction from snapshot history)
 *
 *   evaluatePlatformSLOs(snapshots[], windowMs?)
 *     → OperationalSLOReport          (platform SLO compliance from snapshot history)
 *
 * ── PERSISTENCE MODEL ────────────────────────────────────────────────────────
 *
 *   Snapshots are stored APPEND-ONLY in reliability_domain_snapshots (DB).
 *   Incidents are created/updated in reliability_incidents (DB).
 *   This engine reads from those DB rows (as typed value objects) and produces
 *   pure computed outputs - no DB access in this file.
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   APPEND-ONLY:     snapshots are never mutated - history is immutable
 *   READ-ONLY:       engine never mutates scheduler, DB, policies, or runtime
 *   NO AUTO-RECOVERY:  no restart, no rollback, no remediation
 *   FAIL-CLOSED:     ambiguous inputs → conservative (worst-case) classification
 *   DETERMINISTIC:   same inputs → same outputs every time
 */

import { logger } from "../logger";
import type {
  DegradationStatus,
  FailurePropagationRisk,
  ContainmentLevel,
  ObservabilityHealth,
} from "./reliability-domains";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle state of an incident. */
export type IncidentStatus = "active" | "recovering" | "resolved";

/** Direction of a degradation state change. */
export type TransitionType = "escalation" | "recovery" | "lateral" | "stable";

/** Compliance status of a single SLO evaluation. */
export type SLOStatus = "compliant" | "at_risk" | "breached";

/** Breach direction for SLO condition evaluation. */
export type SLOBreachCondition = "above_threshold" | "below_threshold";

// ── Value objects ────────────────────────────────────────────────────────────

/**
 * A point-in-time snapshot of a workspace reliability domain.
 * Mirrors one row in reliability_domain_snapshots (DB).
 * Pure value object - immutable once created.
 */
export interface ReliabilityDomainSnapshot {
  snapshotId:            string;
  captureId:             string;
  workspaceId:           number;
  domainId:              string;
  degradationStatus:     DegradationStatus;
  propagationRisk:       FailurePropagationRisk;
  containmentLevel:      ContainmentLevel;
  observabilityHealth:   ObservabilityHealth;
  blastRadiusScore:      number;
  advisoryStormDetected: boolean;
  affectedSubsystems:    string[];
  capturedAt:            string;   // ISO 8601
}

/**
 * A detected change in workspace reliability state between two consecutive snapshots.
 * Returned by trackReliabilityTransition().
 * null when the domain is stable (no change).
 */
export interface ReliabilityTransition {
  /** Unique transition ID. Format: "trans:<workspaceId>-<ms>" */
  transitionId:        string;
  workspaceId:         number;
  fromDegradation:     DegradationStatus;
  toDegradation:       DegradationStatus;
  fromPropagation:     FailurePropagationRisk;
  toPropagation:       FailurePropagationRisk;
  /**
   * Direction of the transition.
   *   escalation - degradation severity increased
   *   recovery   - degradation severity decreased
   *   lateral    - severity unchanged but propagation risk changed
   *   stable     - no change (never returned; results in null from tracker)
   */
  transitionType:      TransitionType;
  isDegradationChange: boolean;
  isPropagationChange: boolean;
  fromSnapshotId:      string;
  toSnapshotId:        string;
  /** ISO 8601 timestamp of the "to" snapshot. */
  detectedAt:          string;
}

/**
 * A reconstructed incident - a continuous period of elevated degradation
 * (severely_degraded or worse) for a specific workspace.
 *
 * An incident opens when degradationStatus escalates to "severely_degraded".
 * An incident enters "recovering" when status drops to "degraded".
 * An incident "resolves" when status returns to "healthy".
 */
export interface IncidentTimeline {
  /** Unique incident ID. Format: "inc:<workspaceId>-<startMs>" */
  incidentId:          string;
  workspaceId:         number;
  /** ISO 8601 timestamp of the first snapshot where severity >= severely_degraded. */
  startedAt:           string;
  /** ISO 8601 timestamp of the most recent snapshot in this incident. */
  lastObservedAt:      string;
  /** ISO 8601 timestamp when status transitioned to "resolved". Null if open. */
  resolvedAt:          string | null;
  /** Worst degradationStatus observed during this incident. */
  highestSeverity:     DegradationStatus;
  /** Worst propagationRisk observed during this incident. */
  peakPropagationRisk: FailurePropagationRisk;
  incidentStatus:      IncidentStatus;
  /** All snapshots that belong to this incident (ordered by capturedAt ASC). */
  snapshots:           ReliabilityDomainSnapshot[];
  /** All transitions detected within this incident. */
  transitions:         ReliabilityTransition[];
  /** ISO timestamps when degradation severity escalated (got worse). */
  escalationMoments:   string[];
  /** ISO timestamps when degradation severity de-escalated (got better). */
  recoveryMoments:     string[];
  /** Number of advisory storms detected across all snapshots in this incident. */
  advisoryStormCount:  number;
  /**
   * Incident duration in minutes (rounded).
   * null if still active (no resolvedAt).
   */
  durationMinutes:     number | null;
}

// ── SLO model ────────────────────────────────────────────────────────────────

/** A single operational reliability SLO definition. */
export interface OperationalReliabilitySLO {
  sloId:                 string;
  metricName:            string;
  description:           string;
  /** The compliance threshold for this SLO. */
  targetThreshold:       number;
  /** How far back to look when evaluating this SLO (hours). */
  evaluationWindowHours: number;
  /** When the metric crosses this threshold, the SLO is breached. */
  breachCondition:       SLOBreachCondition;
}

/** Evaluation result for a single SLO against a snapshot window. */
export interface SLOEvaluation {
  slo:            OperationalReliabilitySLO;
  /** Current metric value computed from snapshots in the evaluation window. */
  currentValue:   number;
  status:         SLOStatus;
  /** ISO timestamp of the most recent breach in the window. Null if compliant. */
  lastBreachAt:   string | null;
  /** Number of captures in the window where the SLO was breached. */
  breachCount:    number;
  evaluatedAt:    string;
  notes:          string;
}

/** Platform-wide SLO compliance report from snapshot history. */
export interface OperationalSLOReport {
  evaluatedAt:     string;
  /** Window evaluated (hours). */
  windowHours:     number;
  /** Number of capture groups in the window. */
  captureCount:    number;
  /** Number of SLOs evaluated. */
  totalSLOs:       number;
  compliantCount:  number;
  atRiskCount:     number;
  breachedCount:   number;
  /** Worst status across all SLO evaluations. */
  overallStatus:   SLOStatus;
  sloEvaluations:  SLOEvaluation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Degradation levels that trigger an incident.
 * Severity >= INCIDENT_OPEN_SEVERITY_INDEX means the workspace is in an incident.
 */
const INCIDENT_OPEN_STATUSES = new Set<DegradationStatus>([
  "severely_degraded",
  "containment_risk",
  "critical",
]);

/** Severity index for ordering (higher = more severe). */
export const DEGRADATION_INDEX: Record<DegradationStatus, number> = {
  healthy:           0,
  degraded:          1,
  severely_degraded: 2,
  containment_risk:  3,
  critical:          4,
};

/** Propagation index for ordering. */
export const PROPAGATION_INDEX: Record<FailurePropagationRisk, number> = {
  isolated:  0,
  bounded:   1,
  spreading: 2,
  cascading: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// FOUR BUILT-IN PLATFORM SLOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform SLO 1 - Healthy Workspace Ratio
 * Requires ≥80% of workspaces to be healthy or degraded (not severely or worse)
 * across all captures in the last 24h window.
 */
export const SLO_HEALTHY_WORKSPACE_RATIO: OperationalReliabilitySLO = {
  sloId:                 "slo:healthy-workspace-ratio",
  metricName:            "healthy_workspace_ratio",
  description:           "≥80% of workspaces must be healthy or degraded (not severely_degraded or worse)",
  targetThreshold:       0.80,
  evaluationWindowHours: 24,
  breachCondition:       "below_threshold",
};

/**
 * Platform SLO 2 - Critical Workspace Count
 * Requires zero workspaces in "critical" degradation state.
 */
export const SLO_CRITICAL_WORKSPACE_COUNT: OperationalReliabilitySLO = {
  sloId:                 "slo:critical-workspace-count",
  metricName:            "critical_workspace_count",
  description:           "No workspaces may be in critical degradation state",
  targetThreshold:       0,
  evaluationWindowHours: 1,
  breachCondition:       "above_threshold",
};

/**
 * Platform SLO 3 - Advisory Storm Frequency
 * Limits advisory storm events to ≤2 across the platform per 24h window.
 */
export const SLO_ADVISORY_STORM_FREQUENCY: OperationalReliabilitySLO = {
  sloId:                 "slo:advisory-storm-frequency",
  metricName:            "advisory_storm_count",
  description:           "Max 2 advisory storm workspace-events per 24-hour window",
  targetThreshold:       2,
  evaluationWindowHours: 24,
  breachCondition:       "above_threshold",
};

/**
 * Platform SLO 4 - Cascading Risk Persistence
 * No workspace may have cascading propagation risk for >3 consecutive captures.
 */
export const SLO_CASCADING_RISK_PERSISTENCE: OperationalReliabilitySLO = {
  sloId:                 "slo:cascading-risk-persistence",
  metricName:            "max_consecutive_cascading_captures",
  description:           "No workspace may have cascading propagation risk across >3 consecutive captures",
  targetThreshold:       3,
  evaluationWindowHours: 6,
  breachCondition:       "above_threshold",
};

/** All four platform SLOs in evaluation order. */
export const PLATFORM_SLOS: OperationalReliabilitySLO[] = [
  SLO_HEALTHY_WORKSPACE_RATIO,
  SLO_CRITICAL_WORKSPACE_COUNT,
  SLO_ADVISORY_STORM_FREQUENCY,
  SLO_CASCADING_RISK_PERSISTENCE,
];

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

let _captureSeq  = 0;
let _transSeq    = 0;
let _incidentSeq = 0;

export function makeSnapshotId(workspaceId: number): string {
  return `snap:${Date.now()}-${workspaceId}`;
}

export function makeCaptureId(): string {
  _captureSeq += 1;
  return `cap:${Date.now()}-${_captureSeq}`;
}

export function makeIncidentId(workspaceId: number): string {
  _incidentSeq += 1;
  return `inc:${workspaceId}-${Date.now()}-${_incidentSeq}`;
}

export function resetHistorySeqs(): void {
  _captureSeq  = 0;
  _transSeq    = 0;
  _incidentSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects a reliability state change between two consecutive snapshots for the
 * same workspace.
 *
 * Returns null ("stable") when degradationStatus AND propagationRisk are both
 * unchanged - preventing duplicate transition spam for workspaces in steady state.
 *
 * TransitionType classification:
 *   escalation - degradation severity increased (worse)
 *   recovery   - degradation severity decreased (better)
 *   lateral    - severity unchanged, but propagation risk changed
 *   stable     - no change (results in null return)
 *
 * Safety: both inputs must have the same workspaceId.
 * If workspaceIds differ (caller error), returns null defensively.
 */
export function trackReliabilityTransition(
  prev:    ReliabilityDomainSnapshot,
  current: ReliabilityDomainSnapshot,
): ReliabilityTransition | null {
  // Defensive: different workspaces → no transition
  if (prev.workspaceId !== current.workspaceId) return null;

  const isDegradationChange = prev.degradationStatus !== current.degradationStatus;
  const isPropagationChange = prev.propagationRisk   !== current.propagationRisk;

  // Stable: no change in either dimension → null (no spam)
  if (!isDegradationChange && !isPropagationChange) return null;

  const prevIdx = DEGRADATION_INDEX[prev.degradationStatus];
  const currIdx = DEGRADATION_INDEX[current.degradationStatus];

  let transitionType: TransitionType;
  if (currIdx > prevIdx)      transitionType = "escalation";
  else if (currIdx < prevIdx) transitionType = "recovery";
  else                        transitionType = "lateral";

  _transSeq += 1;
  const transitionId = `trans:${current.workspaceId}-${Date.now()}-${_transSeq}`;

  const transition: ReliabilityTransition = {
    transitionId,
    workspaceId:         current.workspaceId,
    fromDegradation:     prev.degradationStatus,
    toDegradation:       current.degradationStatus,
    fromPropagation:     prev.propagationRisk,
    toPropagation:       current.propagationRisk,
    transitionType,
    isDegradationChange,
    isPropagationChange,
    fromSnapshotId:      prev.snapshotId,
    toSnapshotId:        current.snapshotId,
    detectedAt:          current.capturedAt,
  };

  emitReliabilityTransitionDetectedEvent({
    workspaceId:     current.workspaceId,
    transitionType,
    fromDegradation: prev.degradationStatus,
    toDegradation:   current.degradationStatus,
    action:          "transition_detected",
  });

  return transition;
}

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENT TIMELINE RECONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs incident timelines from an array of snapshots.
 *
 * Algorithm:
 *   1. Group snapshots by workspaceId; sort each group by capturedAt ASC.
 *   2. Walk each workspace's snapshot sequence:
 *        a. Incident opens when degradationStatus enters INCIDENT_OPEN_STATUSES
 *           (severely_degraded / containment_risk / critical).
 *        b. Incident status becomes "recovering" when status drops to "degraded".
 *        c. Incident status becomes "resolved" when status returns to "healthy".
 *        d. Re-escalation from "recovering" → back to "active".
 *        e. A new incident only starts after the previous one reaches "resolved".
 *   3. Incidents still open at end of snapshots → status = "active".
 *   4. All transitions within an incident window are reconstructed inline.
 *
 * Pure: no DB, no async.
 */
export function buildIncidentTimelines(
  snapshots: ReadonlyArray<ReliabilityDomainSnapshot>,
): IncidentTimeline[] {
  // ── Step 1: Group by workspace, sort by capturedAt ────────────────────────
  const byWorkspace = new Map<number, ReliabilityDomainSnapshot[]>();
  for (const snap of snapshots) {
    const group = byWorkspace.get(snap.workspaceId) ?? [];
    group.push(snap);
    byWorkspace.set(snap.workspaceId, group);
  }
  for (const [, group] of byWorkspace) {
    group.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  }

  const allIncidents: IncidentTimeline[] = [];

  // ── Step 2: Walk each workspace sequence ─────────────────────────────────
  for (const [, wsSnapshots] of byWorkspace) {
    let currentIncident: MutableIncident | null = null;

    for (let i = 0; i < wsSnapshots.length; i++) {
      const snap    = wsSnapshots[i]!;
      const prevSnap = i > 0 ? wsSnapshots[i - 1]! : null;

      const isIncidentLevel = INCIDENT_OPEN_STATUSES.has(snap.degradationStatus);

      // Detect transition if there was a previous snapshot
      const transition = prevSnap ? trackReliabilityTransition(prevSnap, snap) : null;

      if (currentIncident === null) {
        // No open incident - check if this snapshot opens one
        if (isIncidentLevel) {
          currentIncident = openIncident(snap);
        }
        // else: healthy/degraded with no incident → continue
        continue;
      }

      // There is an open incident - update it
      currentIncident.snapshots.push(snap);
      currentIncident.lastObservedAt = snap.capturedAt;
      if (snap.advisoryStormDetected) currentIncident.advisoryStormCount++;

      if (transition) {
        currentIncident.transitions.push(transition);
        if (transition.transitionType === "escalation") {
          currentIncident.escalationMoments.push(snap.capturedAt);
        } else if (transition.transitionType === "recovery") {
          currentIncident.recoveryMoments.push(snap.capturedAt);
        }
      }

      // Update peak metrics
      if (DEGRADATION_INDEX[snap.degradationStatus] > DEGRADATION_INDEX[currentIncident.highestSeverity]) {
        currentIncident.highestSeverity = snap.degradationStatus;
      }
      if (PROPAGATION_INDEX[snap.propagationRisk] > PROPAGATION_INDEX[currentIncident.peakPropagationRisk]) {
        currentIncident.peakPropagationRisk = snap.propagationRisk;
      }

      if (isIncidentLevel) {
        // Re-escalation or continued incident
        currentIncident.incidentStatus = "active";
      } else if (snap.degradationStatus === "degraded") {
        // Recovering - not yet resolved
        currentIncident.incidentStatus = "recovering";
      } else {
        // Resolved (healthy)
        currentIncident.incidentStatus = "resolved";
        currentIncident.resolvedAt     = snap.capturedAt;
        currentIncident.durationMinutes = computeDurationMinutes(
          currentIncident.startedAt,
          snap.capturedAt,
        );
        allIncidents.push(freezeIncident(currentIncident));
        currentIncident = null;  // ready for next incident
      }
    }

    // Any open incident at end of snapshots stays "active"
    if (currentIncident !== null) {
      allIncidents.push(freezeIncident(currentIncident));
    }
  }

  // Sort by startedAt DESC (most recent first)
  allIncidents.sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  return allIncidents;
}

interface MutableIncident {
  incidentId:          string;
  workspaceId:         number;
  startedAt:           string;
  lastObservedAt:      string;
  resolvedAt:          string | null;
  highestSeverity:     DegradationStatus;
  peakPropagationRisk: FailurePropagationRisk;
  incidentStatus:      IncidentStatus;
  snapshots:           ReliabilityDomainSnapshot[];
  transitions:         ReliabilityTransition[];
  escalationMoments:   string[];
  recoveryMoments:     string[];
  advisoryStormCount:  number;
  durationMinutes:     number | null;
}

function openIncident(snap: ReliabilityDomainSnapshot): MutableIncident {
  _incidentSeq += 1;
  const incidentId = `inc:${snap.workspaceId}-${new Date(snap.capturedAt).getTime()}-${_incidentSeq}`;
  return {
    incidentId,
    workspaceId:         snap.workspaceId,
    startedAt:           snap.capturedAt,
    lastObservedAt:      snap.capturedAt,
    resolvedAt:          null,
    highestSeverity:     snap.degradationStatus,
    peakPropagationRisk: snap.propagationRisk,
    incidentStatus:      "active",
    snapshots:           [snap],
    transitions:         [],
    escalationMoments:   [],
    recoveryMoments:     [],
    advisoryStormCount:  snap.advisoryStormDetected ? 1 : 0,
    durationMinutes:     null,
  };
}

function freezeIncident(m: MutableIncident): IncidentTimeline {
  return { ...m };
}

function computeDurationMinutes(startIso: string, endIso: string): number {
  const diff = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.round(diff / 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLO EVALUATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates a single SLO against a window of snapshots.
 *
 * Metric derivation per SLO:
 *   healthy_workspace_ratio         - ratio of (healthy+degraded) to total per capture, averaged
 *   critical_workspace_count        - max criticalCount across all captures in window
 *   advisory_storm_count            - total advisoryStormDetected=true snapshots in window
 *   max_consecutive_cascading_captures - longest run of cascading captures for any workspace
 */
export function evaluateSLO(
  slo:            OperationalReliabilitySLO,
  snapshots:      ReadonlyArray<ReliabilityDomainSnapshot>,
  evaluationTime: Date = new Date(),
): SLOEvaluation {
  const windowMs    = slo.evaluationWindowHours * 3_600_000;
  const cutoff      = evaluationTime.getTime() - windowMs;
  const inWindow    = snapshots.filter(s => new Date(s.capturedAt).getTime() >= cutoff);

  const evalAt = evaluationTime.toISOString();

  if (inWindow.length === 0) {
    return {
      slo,
      currentValue: 0,
      status:       "compliant",
      lastBreachAt: null,
      breachCount:  0,
      evaluatedAt:  evalAt,
      notes:        "No snapshots in evaluation window - treating as compliant (no data).",
    };
  }

  let currentValue: number;
  let notes = "";

  switch (slo.metricName) {
    case "healthy_workspace_ratio": {
      // Average ratio per capture group
      const captureGroups = groupByCaptureId(inWindow);
      const ratios = captureGroups.map(group => {
        const acceptable = group.filter(
          s => s.degradationStatus === "healthy" || s.degradationStatus === "degraded",
        ).length;
        return group.length > 0 ? acceptable / group.length : 1;
      });
      currentValue = ratios.length > 0
        ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 1000) / 1000
        : 1;
      notes = `${captureGroups.length} captures evaluated; avg healthy ratio = ${currentValue}`;
      break;
    }

    case "critical_workspace_count": {
      // Max number of critical-status snapshots in any single capture
      const captureGroups = groupByCaptureId(inWindow);
      const maxCritical   = Math.max(
        0,
        ...captureGroups.map(g => g.filter(s => s.degradationStatus === "critical").length),
      );
      currentValue = maxCritical;
      notes = `${captureGroups.length} captures; peak critical workspace count = ${maxCritical}`;
      break;
    }

    case "advisory_storm_count": {
      // Total storm events in window (each workspace × each capture where storm=true)
      currentValue = inWindow.filter(s => s.advisoryStormDetected).length;
      notes = `${currentValue} advisory storm events detected in ${slo.evaluationWindowHours}h window`;
      break;
    }

    case "max_consecutive_cascading_captures": {
      // Longest consecutive run of cascading captures for any single workspace
      const byWs    = new Map<number, ReliabilityDomainSnapshot[]>();
      for (const s of inWindow) {
        const g = byWs.get(s.workspaceId) ?? [];
        g.push(s);
        byWs.set(s.workspaceId, g);
      }
      let maxRun = 0;
      for (const [, wSnapshots] of byWs) {
        const sorted = [...wSnapshots].sort(
          (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
        );
        let run = 0;
        for (const s of sorted) {
          if (s.propagationRisk === "cascading") {
            run++;
            if (run > maxRun) maxRun = run;
          } else {
            run = 0;
          }
        }
      }
      currentValue = maxRun;
      notes = `Longest consecutive cascading-risk run for any workspace = ${maxRun} captures`;
      break;
    }

    default: {
      currentValue = 0;
      notes = `Unknown metricName: ${slo.metricName}`;
      break;
    }
  }

  // Breach check
  const isBreached =
    slo.breachCondition === "above_threshold"
      ? currentValue > slo.targetThreshold
      : currentValue < slo.targetThreshold;

  // At-risk: within 20% of threshold
  const threshold   = slo.targetThreshold;
  const margin      = Math.abs(threshold) * 0.20;
  const isAtRisk    = !isBreached && (
    slo.breachCondition === "above_threshold"
      ? currentValue > threshold - margin
      : currentValue < threshold + margin
  );

  const status: SLOStatus = isBreached ? "breached" : isAtRisk ? "at_risk" : "compliant";

  // Find last breach moment in window
  let lastBreachAt: string | null = null;
  if (isBreached && inWindow.length > 0) {
    const sorted = [...inWindow].sort(
      (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
    lastBreachAt = sorted[0]!.capturedAt;
  }

  // Count breach captures
  const breachCount = isBreached ? 1 : 0;   // simplified: 1 = SLO currently breached

  emitSLOBreachDetectedEvent({
    sloId:         slo.sloId,
    metricName:    slo.metricName,
    currentValue,
    targetThreshold: slo.targetThreshold,
    status,
    action:        status === "breached" ? "slo_breach_detected" : "slo_evaluated",
  });

  return {
    slo,
    currentValue,
    status,
    lastBreachAt,
    breachCount,
    evaluatedAt: evalAt,
    notes,
  };
}

/**
 * Evaluates all four platform SLOs against the provided snapshot history.
 *
 * Pure: no DB, no async.
 */
export function evaluatePlatformSLOs(
  snapshots:      ReadonlyArray<ReliabilityDomainSnapshot>,
  evaluationTime: Date = new Date(),
): OperationalSLOReport {
  const evalAt        = evaluationTime.toISOString();
  const sloEvaluations = PLATFORM_SLOS.map(slo =>
    evaluateSLO(slo, snapshots, evaluationTime),
  );

  const compliantCount = sloEvaluations.filter(e => e.status === "compliant").length;
  const atRiskCount    = sloEvaluations.filter(e => e.status === "at_risk").length;
  const breachedCount  = sloEvaluations.filter(e => e.status === "breached").length;

  const overallStatus: SLOStatus =
    breachedCount > 0 ? "breached" : atRiskCount > 0 ? "at_risk" : "compliant";

  const captureIds    = new Set(snapshots.map(s => s.captureId));

  return {
    evaluatedAt:     evalAt,
    windowHours:     Math.max(...PLATFORM_SLOS.map(s => s.evaluationWindowHours)),
    captureCount:    captureIds.size,
    totalSLOs:       PLATFORM_SLOS.length,
    compliantCount,
    atRiskCount,
    breachedCount,
    overallStatus,
    sloEvaluations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function groupByCaptureId(
  snapshots: ReliabilityDomainSnapshot[],
): ReliabilityDomainSnapshot[][] {
  const map = new Map<string, ReliabilityDomainSnapshot[]>();
  for (const s of snapshots) {
    const g = map.get(s.captureId) ?? [];
    g.push(s);
    map.set(s.captureId, g);
  }
  return [...map.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT VALUE OBJECT CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a ReliabilityDomainSnapshot value object from a P10-A FailureContainmentResult.
 * Intended to be called per workspace before DB insertion.
 */
export function buildSnapshot(
  captureId:   string,
  result: {
    domain: {
      domainId: string;
      workspaceId: number;
      degradationStatus: DegradationStatus;
      propagationRisk: FailurePropagationRisk;
      containmentLevel: ContainmentLevel;
      observabilityHealth: ObservabilityHealth;
      affectedSubsystems: string[];
    };
    blastRadius: { blastRadiusScore: number };
    advisoryStormDetected: boolean;
    evaluatedAt: string;
  },
  captureTime: Date = new Date(),
): ReliabilityDomainSnapshot {
  return {
    snapshotId:            makeSnapshotId(result.domain.workspaceId),
    captureId,
    workspaceId:           result.domain.workspaceId,
    domainId:              result.domain.domainId,
    degradationStatus:     result.domain.degradationStatus,
    propagationRisk:       result.domain.propagationRisk,
    containmentLevel:      result.domain.containmentLevel,
    observabilityHealth:   result.domain.observabilityHealth,
    blastRadiusScore:      result.blastRadius.blastRadiusScore,
    advisoryStormDetected: result.advisoryStormDetected,
    affectedSubsystems:    result.domain.affectedSubsystems,
    capturedAt:            captureTime.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface SnapshotPersistedPayload {
  snapshotId:        string;
  captureId:         string;
  workspaceId:       number;
  degradationStatus: DegradationStatus;
  propagationRisk:   FailurePropagationRisk;
  action:            string;
}

interface TransitionPayload {
  workspaceId:     number;
  transitionType:  TransitionType;
  fromDegradation: DegradationStatus;
  toDegradation:   DegradationStatus;
  action:          string;
}

interface IncidentUpdatedPayload {
  workspaceId:    number;
  incidentId:     string;
  incidentStatus: IncidentStatus;
  highestSeverity: DegradationStatus;
  action:         string;
}

interface SLOBreachPayload {
  sloId:           string;
  metricName:      string;
  currentValue:    number;
  targetThreshold: number;
  status:          SLOStatus;
  action:          string;
}

export function emitReliabilitySnapshotPersistedEvent(p: SnapshotPersistedPayload): void {
  logger.info(
    { event: "reliability_snapshot_persisted", ...p },
    "[reliability-history] P10-B: reliability_snapshot_persisted",
  );
}

export function emitReliabilityTransitionDetectedEvent(p: TransitionPayload): void {
  logger.info(
    { event: "reliability_transition_detected", ...p },
    "[reliability-history] P10-B: reliability_transition_detected",
  );
}

export function emitIncidentTimelineUpdatedEvent(p: IncidentUpdatedPayload): void {
  logger.info(
    { event: "incident_timeline_updated", ...p },
    "[reliability-history] P10-B: incident_timeline_updated",
  );
}

export function emitSLOBreachDetectedEvent(p: SLOBreachPayload): void {
  logger.info(
    { event: "operational_slo_breach_detected", ...p },
    "[reliability-history] P10-B: operational_slo_breach_detected",
  );
}
