/**
 * @file   lib/workflows/recovery-recommendations.ts
 * @phase  P10-C - Recovery Recommendations & Reliability Advisory Intelligence Foundations
 *
 * Pure deterministic recovery advisory engine.
 * No DB, no async, no remediation, no scheduler mutations, no autonomous recovery.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Converts historical reliability governance (P10-B) into operator-guided
 *   recovery advisory intelligence via three pure functions:
 *
 *   generateRecoveryRecommendations(context, history)
 *     → RecoveryRecommendation[]     (per-incident advisory guidance)
 *
 *   buildWorkspaceTrend(workspaceId, incidents, snapshots)
 *     → WorkspaceTrend               (per-workspace historical pattern analysis)
 *
 *   buildPlatformTrendReport(incidents, snapshots, now)
 *     → ReliabilityTrendReport       (platform-wide trend summary)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:         engine never writes to DB, never mutates scheduler state
 *   NO EXECUTION:      recommendations are guidance only - never dispatched automatically
 *   FAIL-CLOSED:       ambiguous history → conservative (lower confidence) output
 *   DETERMINISTIC:     same inputs → same recommendations, every time
 *   ADVISORY-ONLY:     suggestedActions describe operator steps, not automated actions
 *   APPEND-ONLY AUDIT: engine never mutates input arrays or incident objects
 */

import { logger } from "../logger";
import type { DegradationStatus, FailurePropagationRisk } from "./reliability-domains";
import type { IncidentStatus } from "./reliability-history";
import { DEGRADATION_INDEX, PROPAGATION_INDEX } from "./reliability-history";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eight deterministic recommendation types covering all incident patterns.
 */
export type RecoveryRecommendationType =
  | "monitor_closely"
  | "investigate_scheduler_pressure"
  | "isolate_noisy_tenant"
  | "review_fairness_policies"
  | "investigate_advisory_storm"
  | "containment_boundary_review"
  | "escalation_watch"
  | "recovery_stability_watch";

/**
 * Recommendation severity - maps to degradation severity of the underlying signal.
 */
export type RecommendationSeverity = "low" | "moderate" | "high" | "critical";

/**
 * Advisory confidence level.
 * Derived from signal count, historical consistency, and incident recurrence.
 *
 *   low      - single signal, first occurrence, limited history
 *   moderate - 2 signals or 1 prior similar incident
 *   high     - 3+ signals or 2+ prior similar incidents
 *   strong   - chronic recurrence (4+ prior incidents) or multi-signal agreement
 */
export type RecommendationConfidence = "low" | "moderate" | "high" | "strong";

/**
 * Recurrence interval classification - how often has this workspace had incidents?
 */
export type RecurrenceInterval = "none" | "rare" | "occasional" | "frequent" | "chronic";

/**
 * A single deterministic recovery recommendation for a workspace incident.
 * Pure value object - immutable once generated.
 */
export interface RecoveryRecommendation {
  /** Unique recommendation identifier. Format: "rec:<workspaceId>-<ms>-<seq>" */
  recommendationId:   string;
  workspaceId:        number;
  incidentId:         string;
  recommendationType: RecoveryRecommendationType;
  severity:           RecommendationSeverity;
  /** Human-readable explanation of why this recommendation was generated. */
  rationale:          string;
  /** Ordered list of specific operator actions to investigate or mitigate. */
  suggestedActions:   string[];
  confidenceLevel:    RecommendationConfidence;
  /** Evidence signals that contributed to this recommendation. */
  relatedSignals:     string[];
  generatedAt:        string;  // ISO 8601
}

/**
 * Summarizes the current incident state - input to generateRecoveryRecommendations().
 * Derived from a DB incident row + optional snapshot context.
 */
export interface RecommendationContext {
  incidentId:          string;
  workspaceId:         number;
  highestSeverity:     DegradationStatus;
  peakPropagationRisk: FailurePropagationRisk;
  incidentStatus:      IncidentStatus;
  /** Number of advisory storm events detected during this incident. */
  advisoryStormCount:  number;
  /** Number of escalation transitions within this incident. */
  escalationCount:     number;
  /** Number of recovery transitions within this incident. */
  recoveryCount:       number;
  /** Incident duration in minutes (null if still active). */
  durationMinutes:     number | null;
  /** Total snapshots captured during this incident. */
  snapshotCount:       number;
  /** Peak blast radius score observed in this incident's snapshots. */
  maxBlastRadiusScore: number;
  startedAt:           string;
}

/**
 * Historical incident summary for a workspace - input to generateRecoveryRecommendations().
 * Derived by analysing all prior incidents for the same workspace.
 */
export interface WorkspaceIncidentHistory {
  /** Total prior incidents (excluding the current one). */
  totalPriorIncidents:        number;
  /** Prior incidents that had at least one advisory storm event. */
  priorWithAdvisoryStorms:    number;
  /** Prior incidents where peakPropagationRisk was "cascading". */
  priorWithCascadingRisk:     number;
  /** Prior incidents with escalationCount >= 2. */
  priorWithHighEscalations:   number;
  /** Average durationMinutes across all resolved prior incidents. Null if none resolved. */
  avgDurationMinutesResolved: number | null;
  /** How often this workspace has incidents, classified for confidence scoring. */
  recurrenceInterval:         RecurrenceInterval;
}

// ── Trend analysis types ─────────────────────────────────────────────────────

/**
 * Per-workspace trend summary derived from historical incident + snapshot data.
 */
export interface WorkspaceTrend {
  workspaceId:             number;
  /** Total incidents in the analysis window. */
  totalIncidents:          number;
  /** Incidents currently open (active or recovering). */
  openIncidents:           number;
  /** Mean time to recovery (minutes) across resolved incidents. Null if none resolved. */
  mttrMinutes:             number | null;
  /** Average incident duration (minutes) across all resolved incidents. */
  avgDurationMinutes:      number | null;
  /**
   * Escalation frequency within incidents.
   *   none     - no escalation events
   *   low      - avg < 1 escalation per incident
   *   moderate - avg 1-2
   *   high     - avg > 2
   *   chronic  - totalIncidents >= 3 AND avg > 2
   */
  escalationFrequency:     "none" | "low" | "moderate" | "high" | "chronic";
  /** True when >1 incident had advisory storm events. */
  advisoryStormRecurrence: boolean;
  /** True when >1 incident had cascading propagation risk. */
  cascadingRiskRecurrence: boolean;
  /**
   * True when workspace has had >= 3 incidents in the analysis window.
   * Indicates chronic instability.
   */
  isChronicallyDegraded:   boolean;
  /** ISO timestamp of the most recent incident start. */
  lastIncidentAt:          string | null;
  /** Number of incidents started in the last 30 days. */
  incidentCount30d:        number;
  recurrenceInterval:      RecurrenceInterval;
}

/** Platform-wide trend summary across all workspaces. */
export interface PlatformTrendSummary {
  totalActiveIncidents:     number;
  totalOpenIncidents:       number;
  chronicallyDegradedCount: number;
  highEscalationCount:      number;
  cascadingRecurrenceCount: number;
  /** Mean MTTR across all workspaces with at least one resolved incident. */
  avgMttrMinutes:           number | null;
  /**
   * Platform health trajectory.
   *   improving - open incident count decreased vs prior half of window
   *   degrading - open incident count increased vs prior half of window
   *   stable    - no significant change
   */
  platformHealthTrend:      "improving" | "stable" | "degrading";
}

/** Full platform trend report returned by GET /platform/reliability/trends. */
export interface ReliabilityTrendReport {
  generatedAt:          string;
  /** Analysis window in days. */
  windowDays:           number;
  workspaceCount:       number;
  analyzedIncidents:    number;
  trends:               WorkspaceTrend[];
  platformSummary:      PlatformTrendSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Incidents in this window are considered "recent" for incidentCount30d. */
const THIRTY_DAYS_MS = 30 * 24 * 3_600_000;

/** Blast radius threshold above which scheduler pressure is considered significant. */
const BLAST_RADIUS_PRESSURE_THRESHOLD = 50;

/** Number of prior incidents required to classify a workspace as "chronically degraded". */
const CHRONIC_DEGRADATION_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

let _recSeq = 0;

export function makeRecommendationId(workspaceId: number): string {
  _recSeq += 1;
  return `rec:${workspaceId}-${Date.now()}-${_recSeq}`;
}

export function resetRecommendationSeq(): void {
  _recSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes recommendation confidence from signal evidence and historical context.
 *
 * Rules (applied in order, highest wins):
 *   strong   - recurrenceInterval=chronic OR priorMatchCount >= 3
 *   high     - priorMatchCount >= 2 OR (signalCount >= 3 AND totalPrior >= 1)
 *   moderate - priorMatchCount >= 1 OR signalCount >= 2
 *   low      - fallback (first occurrence, single signal)
 *
 * Ceiling: if totalPriorIncidents === 0 → max confidence = "moderate"
 *   (insufficient history to claim high/strong confidence).
 */
export function computeConfidence(
  signalCount:    number,
  priorMatchCount: number,
  history:        WorkspaceIncidentHistory,
): RecommendationConfidence {
  const noPriorHistory = history.totalPriorIncidents === 0;

  if (!noPriorHistory) {
    if (history.recurrenceInterval === "chronic" || priorMatchCount >= 3) return "strong";
    if (priorMatchCount >= 2 || (signalCount >= 3 && history.totalPriorIncidents >= 1)) return "high";
    if (priorMatchCount >= 1 || signalCount >= 2) return "moderate";
  }

  // No prior history - cap at moderate
  if (signalCount >= 2) return "moderate";
  return "low";
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY MAPPING
// ─────────────────────────────────────────────────────────────────────────────

function degradationToSeverity(status: DegradationStatus): RecommendationSeverity {
  switch (status) {
    case "critical":          return "critical";
    case "containment_risk":  return "critical";
    case "severely_degraded": return "high";
    case "degraded":          return "moderate";
    case "healthy":           return "low";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE RECOMMENDATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates deterministic recovery recommendations for a single incident.
 *
 * Rules applied (up to 8, one per type):
 *
 *   R1: monitor_closely          - always generated for active/recovering incidents
 *   R2: investigate_scheduler_pressure - maxBlastRadiusScore > 50
 *   R3: isolate_noisy_tenant     - spreading/cascading propagation + severe degradation
 *   R4: review_fairness_policies - escalations during high-severity incident
 *   R5: investigate_advisory_storm  - advisoryStormCount > 0
 *   R6: containment_boundary_review - cascading risk or containment_risk severity
 *   R7: escalation_watch         - multiple escalations in incident
 *   R8: recovery_stability_watch - incident is in recovering state
 *
 * Output ordering: by severity (critical → high → moderate → low), then by type.
 * Duplicates: each type appears at most once per call.
 * Pure: no side effects, no DB, no async.
 */
export function generateRecoveryRecommendations(
  ctx:     RecommendationContext,
  history: WorkspaceIncidentHistory,
  now:     Date = new Date(),
): RecoveryRecommendation[] {
  const recs: RecoveryRecommendation[] = [];
  const genAt = now.toISOString();

  function add(
    type:           RecoveryRecommendationType,
    severity:       RecommendationSeverity,
    rationale:      string,
    actions:        string[],
    confidence:     RecommendationConfidence,
    relatedSignals: string[],
  ): void {
    recs.push({
      recommendationId: makeRecommendationId(ctx.workspaceId),
      workspaceId:      ctx.workspaceId,
      incidentId:       ctx.incidentId,
      recommendationType: type,
      severity,
      rationale,
      suggestedActions:   actions,
      confidenceLevel:    confidence,
      relatedSignals,
      generatedAt:        genAt,
    });
  }

  // ── R1: monitor_closely (always generated for open incidents) ─────────────
  if (ctx.incidentStatus === "active" || ctx.incidentStatus === "recovering") {
    const confidence = computeConfidence(1, history.totalPriorIncidents, history);
    add(
      "monitor_closely",
      degradationToSeverity(ctx.highestSeverity),
      `Workspace has an ${ctx.incidentStatus} reliability incident at ${ctx.highestSeverity} severity. ` +
        `Incident has ${ctx.snapshotCount} capture(s) observed so far.`,
      [
        "Continue monitoring degradation status at every capture cycle.",
        "Verify no new subsystems are affected.",
        "Do not reduce monitoring cadence until 3 consecutive healthy captures observed.",
      ],
      confidence,
      [`incidentId:${ctx.incidentId}`, `status:${ctx.incidentStatus}`, `severity:${ctx.highestSeverity}`],
    );
    emitRecoveryRecommendationGeneratedEvent({
      workspaceId: ctx.workspaceId, incidentId: ctx.incidentId,
      recommendationType: "monitor_closely", confidenceLevel: confidence,
      propagationRisk: ctx.peakPropagationRisk, action: "recommendation_generated",
    });
  }

  // ── R2: investigate_scheduler_pressure ────────────────────────────────────
  if (ctx.maxBlastRadiusScore > BLAST_RADIUS_PRESSURE_THRESHOLD) {
    const isHigh   = ctx.maxBlastRadiusScore > 80;
    const severity = isHigh ? "high" : "moderate";
    const signals  = [`blastRadiusScore:${ctx.maxBlastRadiusScore}`];
    const confidence = computeConfidence(
      isHigh ? 3 : 2,
      history.totalPriorIncidents,
      history,
    );
    add(
      "investigate_scheduler_pressure",
      severity,
      `Peak blast radius score of ${ctx.maxBlastRadiusScore}/100 indicates elevated workload pressure ` +
        `on the scheduler for this workspace.`,
      [
        "Review the active execution count and backlog depth for this workspace.",
        "Check if backlog growth is correlated with degradation onset.",
        "Consider whether workload capacity is appropriate for current demand.",
        "Review scheduler weight - if low, it may be under-served.",
      ],
      confidence,
      signals,
    );
  }

  // ── R3: isolate_noisy_tenant ──────────────────────────────────────────────
  const isSpreading  = PROPAGATION_INDEX[ctx.peakPropagationRisk] >= PROPAGATION_INDEX["spreading"];
  const isSevereEnough = DEGRADATION_INDEX[ctx.highestSeverity]  >= DEGRADATION_INDEX["severely_degraded"];
  if (isSpreading && isSevereEnough) {
    const isCascading = ctx.peakPropagationRisk === "cascading";
    const severity    = isCascading ? "critical" : "high";
    const confidence  = computeConfidence(
      isCascading ? 3 : 2,
      history.priorWithCascadingRisk,
      history,
    );
    add(
      "isolate_noisy_tenant",
      severity,
      `Propagation risk is "${ctx.peakPropagationRisk}" with ${ctx.highestSeverity} degradation. ` +
        `Failure may be crossing workspace boundaries.`,
      [
        "Investigate cross-workspace execution contamination for this workspace.",
        "Review resource consumption patterns - look for burst execution spikes.",
        "Apply or tighten a fairness policy if one is not already active.",
        "Verify isolation mechanisms are preventing blast radius expansion.",
      ],
      confidence,
      [`propagationRisk:${ctx.peakPropagationRisk}`, `highestSeverity:${ctx.highestSeverity}`],
    );
  }

  // ── R4: review_fairness_policies ─────────────────────────────────────────
  const isHighSeverityEscalation =
    ctx.escalationCount > 0 &&
    DEGRADATION_INDEX[ctx.highestSeverity] >= DEGRADATION_INDEX["containment_risk"];
  if (isHighSeverityEscalation) {
    const confidence = computeConfidence(
      2,
      history.priorWithHighEscalations,
      history,
    );
    add(
      "review_fairness_policies",
      "high",
      `${ctx.escalationCount} escalation event(s) occurred during a ${ctx.highestSeverity} severity incident. ` +
        `Policy misconfiguration may be amplifying degradation.`,
      [
        "Review active fairness policy weights for this workspace.",
        "Verify enforcement mode is not in a conflict state.",
        "Check policy expiry timestamps - an expiring policy may have reduced protection.",
        "Compare scheduler weight before and after incident onset.",
      ],
      confidence,
      [`escalationCount:${ctx.escalationCount}`, `highestSeverity:${ctx.highestSeverity}`],
    );
  }

  // ── R5: investigate_advisory_storm ────────────────────────────────────────
  if (ctx.advisoryStormCount > 0) {
    const isHighStorm = ctx.advisoryStormCount > 2;
    const severity    = isHighStorm ? "high" : "moderate";
    const confidence  = computeConfidence(
      isHighStorm ? 3 : 2,
      history.priorWithAdvisoryStorms,
      history,
    );
    add(
      "investigate_advisory_storm",
      severity,
      `${ctx.advisoryStormCount} advisory storm event(s) detected during this incident. ` +
        `Advisory storms indicate simultaneous multi-signal pressure accumulation.`,
      [
        "Identify which execution patterns triggered the advisory threshold.",
        "Review pressure score composition at storm moments.",
        "Check for correlated advisory storms across other workspaces.",
        "Review advisory weight thresholds - may need recalibration.",
      ],
      confidence,
      [`advisoryStormCount:${ctx.advisoryStormCount}`, `incidentId:${ctx.incidentId}`],
    );
    emitReliabilityTrendDetectedEvent({
      workspaceId: ctx.workspaceId, incidentId: ctx.incidentId,
      patternType: "advisory_storm_recurrence",
      occurrenceCount: history.priorWithAdvisoryStorms + 1,
      action: "trend_detected",
    });
  }

  // ── R6: containment_boundary_review ──────────────────────────────────────
  const isCascadingRisk =
    ctx.peakPropagationRisk === "cascading" ||
    ctx.highestSeverity === "containment_risk" ||
    ctx.highestSeverity === "critical";
  if (isCascadingRisk) {
    const isBoth      = ctx.peakPropagationRisk === "cascading" && ctx.highestSeverity === "critical";
    const severity    = isBoth ? "critical" : "high";
    const confidence  = computeConfidence(
      isBoth ? 3 : 2,
      history.priorWithCascadingRisk,
      history,
    );
    add(
      "containment_boundary_review",
      severity,
      `Containment boundaries were challenged: propagation="${ctx.peakPropagationRisk}", ` +
        `severity="${ctx.highestSeverity}". Risk of blast radius expansion is elevated.`,
      [
        "Review containment boundary thresholds - verify they reflect current platform capacity.",
        "Investigate what caused blast radius expansion beyond expected limits.",
        "Verify isolation mechanisms are functioning at the infrastructure level.",
        "Document containment boundary events for post-incident analysis.",
      ],
      confidence,
      [`peakPropagationRisk:${ctx.peakPropagationRisk}`, `highestSeverity:${ctx.highestSeverity}`],
    );
    if (history.priorWithCascadingRisk > 0) {
      emitIncidentRecurrenceDetectedEvent({
        workspaceId: ctx.workspaceId, incidentId: ctx.incidentId,
        patternType: "cascading_risk_recurrence",
        priorOccurrences: history.priorWithCascadingRisk,
        action: "recurrence_detected",
      });
    }
  }

  // ── R7: escalation_watch ──────────────────────────────────────────────────
  if (ctx.escalationCount >= 2) {
    const confidence = computeConfidence(
      ctx.escalationCount >= 3 ? 3 : 2,
      history.priorWithHighEscalations,
      history,
    );
    add(
      "escalation_watch",
      "high",
      `${ctx.escalationCount} escalation transitions detected within this incident. ` +
        `Repeated escalation indicates workspace instability, not a single spike.`,
      [
        "Monitor workspace closely at next 5 capture cycles.",
        "Review conditions active during each escalation moment.",
        "Identify any recurring trigger patterns (time-of-day, batch jobs, etc.).",
        "Consider pre-emptive fairness policy application if escalation pattern repeats.",
      ],
      confidence,
      [`escalationCount:${ctx.escalationCount}`, `incidentId:${ctx.incidentId}`],
    );
    emitRecoveryPatternClassifiedEvent({
      workspaceId: ctx.workspaceId, incidentId: ctx.incidentId,
      patternType: "repeated_escalation",
      escalationCount: ctx.escalationCount,
      action: "pattern_classified",
    });
  }

  // ── R8: recovery_stability_watch ─────────────────────────────────────────
  if (ctx.incidentStatus === "recovering") {
    const isFrequent  = ["frequent", "chronic"].includes(history.recurrenceInterval);
    const confidence  = computeConfidence(
      isFrequent ? 3 : 1,
      history.totalPriorIncidents,
      history,
    );
    add(
      "recovery_stability_watch",
      "moderate",
      `Workspace is in recovering state. ` +
        (history.totalPriorIncidents > 0
          ? `This workspace has had ${history.totalPriorIncidents} prior incident(s) - ` +
            `recovery stability should not be assumed prematurely.`
          : `Verify root cause is addressed before declaring stability.`),
      [
        "Verify the root cause of degradation has been identified and addressed.",
        "Do not reduce monitoring cadence - maintain full observation for 3+ captures.",
        "Watch for re-escalation: recovering → active transitions indicate unresolved root cause.",
        "Document recovery confirmation evidence before clearing incident.",
      ],
      confidence,
      [`status:recovering`, `priorIncidents:${history.totalPriorIncidents}`],
    );
  }

  // ── Sort: critical → high → moderate → low ────────────────────────────────
  const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
    critical: 0, high: 1, moderate: 2, low: 3,
  };
  recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────────
// TREND ANALYSIS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input type for trend analysis - a summarised DB incident row.
 * Avoids needing to hydrate full IncidentTimeline objects from DB.
 */
export interface IncidentSummary {
  incidentId:          string;
  workspaceId:         number;
  startedAt:           string;
  resolvedAt:          string | null;
  highestSeverity:     DegradationStatus;
  peakPropagationRisk: FailurePropagationRisk;
  incidentStatus:      IncidentStatus;
  advisoryStormCount:  number;
  snapshotCount:       number;
  /** escalationMoments.length - stored or computed. */
  escalationCount:     number;
  durationMinutes:     number | null;
}

/**
 * Classifies how often a workspace has incidents given a count in a time window.
 */
export function classifyRecurrenceInterval(totalIncidents: number): RecurrenceInterval {
  if (totalIncidents === 0) return "none";
  if (totalIncidents === 1) return "rare";
  if (totalIncidents === 2) return "occasional";
  if (totalIncidents <= 4) return "frequent";
  return "chronic";
}

/**
 * Builds a WorkspaceTrend from all incidents and snapshot data for one workspace.
 * Pure: no DB, no async.
 */
export function buildWorkspaceTrend(
  workspaceId: number,
  incidents:   ReadonlyArray<IncidentSummary>,
  now:         Date = new Date(),
): WorkspaceTrend {
  const resolved       = incidents.filter(i => i.incidentStatus === "resolved");
  const open           = incidents.filter(i => i.incidentStatus === "active" || i.incidentStatus === "recovering");
  const thirtyDaysAgo  = now.getTime() - THIRTY_DAYS_MS;
  const recent30d      = incidents.filter(i => new Date(i.startedAt).getTime() >= thirtyDaysAgo);

  // MTTR / avg duration
  const durations      = resolved.map(i => i.durationMinutes).filter((d): d is number => d !== null);
  const mttrMinutes    = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  // Escalation frequency
  const totalEscalations     = incidents.reduce((s, i) => s + i.escalationCount, 0);
  const avgEscalationsPerInc = incidents.length > 0 ? totalEscalations / incidents.length : 0;
  let escalationFrequency: WorkspaceTrend["escalationFrequency"];
  if (incidents.length === 0 || totalEscalations === 0) {
    escalationFrequency = "none";
  } else if (incidents.length >= CHRONIC_DEGRADATION_THRESHOLD && avgEscalationsPerInc > 2) {
    escalationFrequency = "chronic";
  } else if (avgEscalationsPerInc > 2) {
    escalationFrequency = "high";
  } else if (avgEscalationsPerInc >= 1) {
    escalationFrequency = "moderate";
  } else {
    escalationFrequency = "low";
  }

  // Recurrences
  const advisoryStormRecurrence = incidents.filter(i => i.advisoryStormCount > 0).length > 1;
  const cascadingRiskRecurrence = incidents.filter(i => i.peakPropagationRisk === "cascading").length > 1;
  const isChronicallyDegraded   = incidents.length >= CHRONIC_DEGRADATION_THRESHOLD;

  // Last incident
  const sortedByStart = [...incidents].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const lastIncidentAt = sortedByStart[0]?.startedAt ?? null;

  const recurrenceInterval = classifyRecurrenceInterval(incidents.length);

  emitReliabilityTrendDetectedEvent({
    workspaceId,
    incidentId:      "",
    patternType:     isChronicallyDegraded ? "chronic_degradation" : "trend_computed",
    occurrenceCount: incidents.length,
    action:          "workspace_trend_built",
  });

  return {
    workspaceId,
    totalIncidents:          incidents.length,
    openIncidents:           open.length,
    mttrMinutes,
    avgDurationMinutes:      mttrMinutes,
    escalationFrequency,
    advisoryStormRecurrence,
    cascadingRiskRecurrence,
    isChronicallyDegraded,
    lastIncidentAt,
    incidentCount30d:        recent30d.length,
    recurrenceInterval,
  };
}

/**
 * Builds a platform-wide reliability trend report from all incident summaries.
 * Pure: no DB, no async.
 */
export function buildPlatformTrendReport(
  incidents:  ReadonlyArray<IncidentSummary>,
  windowDays: number,
  now:        Date = new Date(),
): ReliabilityTrendReport {
  const genAt = now.toISOString();

  // Group by workspace
  const byWorkspace = new Map<number, IncidentSummary[]>();
  for (const inc of incidents) {
    const g = byWorkspace.get(inc.workspaceId) ?? [];
    g.push(inc);
    byWorkspace.set(inc.workspaceId, g);
  }

  const trends = [...byWorkspace.entries()].map(([wsId, wsIncidents]) =>
    buildWorkspaceTrend(wsId, wsIncidents, now),
  );

  // Platform summary
  const totalActiveIncidents     = trends.reduce((s, t) => s + (t.openIncidents > 0 ? 1 : 0), 0);
  const totalOpenIncidents       = trends.reduce((s, t) => s + t.openIncidents, 0);
  const chronicallyDegradedCount = trends.filter(t => t.isChronicallyDegraded).length;
  const highEscalationCount      = trends.filter(
    t => t.escalationFrequency === "high" || t.escalationFrequency === "chronic",
  ).length;
  const cascadingRecurrenceCount = trends.filter(t => t.cascadingRiskRecurrence).length;

  const mttrs    = trends.map(t => t.mttrMinutes).filter((m): m is number => m !== null);
  const avgMttrMinutes = mttrs.length > 0
    ? Math.round(mttrs.reduce((s, m) => s + m, 0) / mttrs.length)
    : null;

  // Platform health trend: compare incident density in first vs second half of window
  const halfMs      = (windowDays * 24 * 3_600_000) / 2;
  const midpoint    = new Date(now.getTime() - halfMs);
  const recentHalf  = incidents.filter(i => new Date(i.startedAt) >= midpoint).length;
  const earlierHalf = incidents.filter(i => new Date(i.startedAt) < midpoint).length;
  let platformHealthTrend: PlatformTrendSummary["platformHealthTrend"];
  if (recentHalf < earlierHalf * 0.8)      platformHealthTrend = "improving";
  else if (recentHalf > earlierHalf * 1.2) platformHealthTrend = "degrading";
  else                                     platformHealthTrend = "stable";

  return {
    generatedAt:       genAt,
    windowDays,
    workspaceCount:    byWorkspace.size,
    analyzedIncidents: incidents.length,
    trends,
    platformSummary: {
      totalActiveIncidents,
      totalOpenIncidents,
      chronicallyDegradedCount,
      highEscalationCount,
      cascadingRecurrenceCount,
      avgMttrMinutes,
      platformHealthTrend,
    },
  };
}

/**
 * Builds a WorkspaceIncidentHistory from a list of prior resolved incident summaries
 * for the same workspace.
 * Pure utility - used by route handlers to construct history before calling
 * generateRecoveryRecommendations().
 */
export function buildWorkspaceIncidentHistory(
  priorIncidents: ReadonlyArray<IncidentSummary>,
): WorkspaceIncidentHistory {
  const resolved = priorIncidents.filter(i => i.incidentStatus === "resolved");
  const durations = resolved.map(i => i.durationMinutes).filter((d): d is number => d !== null);
  const avgDurationMinutesResolved = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  return {
    totalPriorIncidents:        priorIncidents.length,
    priorWithAdvisoryStorms:    priorIncidents.filter(i => i.advisoryStormCount > 0).length,
    priorWithCascadingRisk:     priorIncidents.filter(i => i.peakPropagationRisk === "cascading").length,
    priorWithHighEscalations:   priorIncidents.filter(i => i.escalationCount >= 2).length,
    avgDurationMinutesResolved,
    recurrenceInterval:         classifyRecurrenceInterval(priorIncidents.length),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface RecoveryRecommendationGeneratedPayload {
  workspaceId:        number;
  incidentId:         string;
  recommendationType: RecoveryRecommendationType;
  confidenceLevel:    RecommendationConfidence;
  propagationRisk:    FailurePropagationRisk;
  action:             string;
}

interface ReliabilityTrendDetectedPayload {
  workspaceId:     number;
  incidentId:      string;
  patternType:     string;
  occurrenceCount: number;
  action:          string;
}

interface IncidentRecurrenceDetectedPayload {
  workspaceId:      number;
  incidentId:       string;
  patternType:      string;
  priorOccurrences: number;
  action:           string;
}

interface RecoveryPatternClassifiedPayload {
  workspaceId:     number;
  incidentId:      string;
  patternType:     string;
  escalationCount: number;
  action:          string;
}

export function emitRecoveryRecommendationGeneratedEvent(p: RecoveryRecommendationGeneratedPayload): void {
  logger.info(
    { event: "recovery_recommendation_generated", ...p },
    "[recovery-recommendations] P10-C: recovery_recommendation_generated",
  );
}

export function emitReliabilityTrendDetectedEvent(p: ReliabilityTrendDetectedPayload): void {
  logger.info(
    { event: "reliability_trend_detected", ...p },
    "[recovery-recommendations] P10-C: reliability_trend_detected",
  );
}

export function emitIncidentRecurrenceDetectedEvent(p: IncidentRecurrenceDetectedPayload): void {
  logger.info(
    { event: "incident_recurrence_detected", ...p },
    "[recovery-recommendations] P10-C: incident_recurrence_detected",
  );
}

export function emitRecoveryPatternClassifiedEvent(p: RecoveryPatternClassifiedPayload): void {
  logger.info(
    { event: "recovery_pattern_classified", ...p },
    "[recovery-recommendations] P10-C: recovery_pattern_classified",
  );
}
