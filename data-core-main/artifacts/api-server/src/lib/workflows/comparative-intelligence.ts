/**
 * @file   lib/workflows/comparative-intelligence.ts
 * @phase  P8-E - Cross-Workflow Comparative Intelligence & Risk Ranking Foundations
 *
 * Pure deterministic comparative-intelligence engine.
 * No DB, no async, no ML, no side effects.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   computeComparativeIntelligence(input) → ComparativeIntelligenceResult
 *
 *   Internally:
 *     1. scoreWorkflow()                - compute comparativeRiskScore (0-100)
 *     2. rankWorkflows()                - sort DESC by score, tie-break by workflowId ASC
 *     3. classifyPriority()             - 5-level OperationalPriority per workflow
 *     4. computeHotspotConcentration()  - workspace-level hotspot analytics
 *     5. Emit 4 structured observability events via logger
 *
 * ── COMPARATIVE RISK SCORE FORMULA ───────────────────────────────────────────
 *
 *   base         = rWC × 0.35  +  projectedComplexity × 0.25   (max 60)
 *   trendBonus   = critically_degrading→20 | degrading→10 | stable→0 | improving→−5
 *   fragilityBonus = critical→15 | high→10 | moderate→5 | low→0
 *   hotspotBonus = min(hotspotCount × 1.0, 5)
 *   subtotal     = base + trendBonus + fragilityBonus + hotspotBonus
 *   confidenceMultiplier = high→1.0 | moderate→0.90 | low→0.80
 *   score        = clamp(round(subtotal × multiplier), 0, 100)
 *
 * ── OPERATIONAL PRIORITY CLASSIFICATION ──────────────────────────────────────
 *   informational: score < 15
 *   watch:         score ≥ 15
 *   elevated:      score ≥ 35
 *   urgent:        score ≥ 55
 *   critical:      score ≥ 75
 *
 *   Escalation (applied if score ≥ 10):
 *     critically_degrading trend → +1 level (cap: critical)
 *     critical fragility         → +1 level (cap: critical)
 *
 * ── WORKSPACE RANKING SEMANTICS ──────────────────────────────────────────────
 *   Sorted: comparativeRiskScore DESC (higher = riskier = rank 1)
 *   Tie-break: workflowId ASC (stable, deterministic)
 *   workspaceRank is 1-based.
 *
 * ── HOTSPOT CONCENTRATION ────────────────────────────────────────────────────
 *   dominantWorkflowCount:       score ≥ DOMINANT_SCORE_THRESHOLD (70)
 *   concentrationRatio:          dominant / total  (0-1)
 *   chronicHotspotWorkflowCount: hotspotCount ≥ 2
 *   criticallyDegradingCount:    trendDirection = "critically_degrading"
 *   urgentOrCriticalCount:       priority = "urgent" or "critical"
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates input, never writes to DB.
 *   Never triggers alerts or workflow execution.
 *   Deterministic: identical inputs always produce identical outputs.
 *   Input arrays never mutated (snapshot objects shallow-cloned in sort).
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   comparative-intelligence.ts → logger.ts  (structured observability events)
 *   No imports from other intelligence engines - self-contained consumer of
 *   P8-C / P8-D output summaries passed in via WorkflowIntelligenceSnapshot[].
 */

import { logger } from "../logger";

// ── Score formula weights ──────────────────────────────────────────────────────
/** Weight applied to runtimeWeightedComplexity (P8-C) in comparativeRiskScore. */
const W_RWC          = 0.35;
/** Weight applied to projectedComplexity (P8-D) in comparativeRiskScore. */
const W_PROJECTED    = 0.25;

// ── Trend direction bonus (added to base score) ───────────────────────────────
const TREND_BONUS_CRITICALLY_DEGRADING = 20;
const TREND_BONUS_DEGRADING            = 10;
const TREND_BONUS_STABLE               = 0;
const TREND_BONUS_IMPROVING            = -5;   // negative - reduces score

// ── Fragility severity bonus ──────────────────────────────────────────────────
const FRAGILITY_BONUS_CRITICAL  = 15;
const FRAGILITY_BONUS_HIGH      = 10;
const FRAGILITY_BONUS_MODERATE  = 5;
const FRAGILITY_BONUS_LOW       = 0;

// ── Hotspot bonus (per hotspot, capped) ───────────────────────────────────────
const HOTSPOT_BONUS_PER          = 1.0;
const HOTSPOT_BONUS_CAP          = 5;

// ── Confidence multiplier ─────────────────────────────────────────────────────
const CONFIDENCE_MULT_HIGH     = 1.00;
const CONFIDENCE_MULT_MODERATE = 0.90;
const CONFIDENCE_MULT_LOW      = 0.80;

// ── Operational priority score thresholds ─────────────────────────────────────
const PRIORITY_CRITICAL_SCORE  = 75;
const PRIORITY_URGENT_SCORE    = 55;
const PRIORITY_ELEVATED_SCORE  = 35;
const PRIORITY_WATCH_SCORE     = 15;
/** Minimum score for escalation rules to apply. */
const PRIORITY_ESCALATION_MIN  = 10;

// ── Hotspot concentration threshold ───────────────────────────────────────────
/** A workflow is "dominant" if comparativeRiskScore ≥ this value. */
const DOMINANT_SCORE_THRESHOLD  = 70;
/** A workflow is a chronic hotspot if hotspotCount ≥ this value. */
const CHRONIC_HOTSPOT_MIN       = 2;

// ── Max workflows processed per call ─────────────────────────────────────────
/** Safety cap - prevents CPU spike on very large workspaces. */
const MAX_SNAPSHOTS             = 200;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Per-workflow summary of intelligence signals gathered from the P8-A → P8-D stack.
 * Built by the route handler (one entry per active workflow definition).
 */
export interface WorkflowIntelligenceSnapshot {
  /** Workflow definition primary key. */
  workflowId:                number;
  /** Human-readable workflow name. */
  workflowName:              string;
  /** Total steps in the workflow definition. */
  stepCount:                 number;
  /** P8-C runtimeWeightedComplexity (0-100 integer). */
  runtimeWeightedComplexity: number;
  /** P8-B operationalComplexityScore (structural, 0-100). */
  structuralComplexity:      number;
  /** P8-C fragility index level. */
  fragilityLevel:            FragilityLevel;
  /** P8-C chronicOperationalHotspots.length */
  hotspotCount:              number;
  /** P8-D projectedComplexity (0-100 integer). */
  projectedComplexity:       number;
  /** P8-D trendDirection. */
  trendDirection:            TrendDirection;
  /** P8-D confidenceLevel. */
  confidenceLevel:           ForecastConfidence;
}

export type TrendDirection    = "improving" | "stable" | "degrading" | "critically_degrading";
export type ForecastConfidence = "low" | "moderate" | "high";
export type FragilityLevel    = "low" | "moderate" | "high" | "critical";
export type OperationalPriority = "informational" | "watch" | "elevated" | "urgent" | "critical";

/** Full comparative intelligence result for one workflow. */
export interface WorkflowComparativeIntelligence {
  workflowId:                number;
  workflowName:              string;
  stepCount:                 number;
  /**
   * Composite comparative risk score (0-100 integer).
   * Blends rWC + projected complexity + trend bonus + fragility bonus +
   * hotspot bonus, then applies a confidence multiplier.
   */
  comparativeRiskScore:      number;
  /** runtimeWeightedComplexity from P8-C (current operational state). */
  runtimeWeightedComplexity: number;
  /** projectedComplexity from P8-D (forecast trajectory). */
  projectedComplexity:       number;
  /** Fragility level from P8-C. */
  fragilityLevel:            FragilityLevel;
  /** Trend direction from P8-D. */
  trendDirection:            TrendDirection;
  /** Number of chronic operational hotspots from P8-C. */
  hotspotCount:              number;
  /** 5-level operational triage priority. */
  operationalPriority:       OperationalPriority;
  /** 1-based rank within the workspace (1 = highest risk). */
  workspaceRank:             number;
  /** Forecast confidence from P8-D (low confidence reduces comparativeRiskScore). */
  confidenceLevel:           ForecastConfidence;
}

/** Workspace-level hotspot concentration analytics. */
export interface WorkspaceHotspotConcentration {
  /** Workflows with comparativeRiskScore ≥ 70 ("dominant" risk contributors). */
  dominantWorkflowCount:        number;
  /** dominantWorkflowCount / totalWorkflows (0-1). */
  concentrationRatio:           number;
  /** Workflows with ≥ 2 chronic operational hotspots (from P8-C). */
  chronicHotspotWorkflowCount:  number;
  /** Workflows with trendDirection = "critically_degrading". */
  criticallyDegradingCount:     number;
  /** Workflows with operationalPriority = "urgent" or "critical". */
  urgentOrCriticalCount:        number;
  /** workflowId of rank-1 workflow, or null if no workflows. */
  topRiskWorkflowId:            number | null;
  /** comparativeRiskScore of rank-1 workflow (0 if no workflows). */
  topRiskScore:                 number;
}

/** Input to computeComparativeIntelligence. */
export interface ComparativeIntelligenceInput {
  /** Per-workflow snapshots built from P8-A → P8-D outputs. Oldest-to-newest order is fine - the engine sorts internally. */
  snapshots:    WorkflowIntelligenceSnapshot[];
  workspaceId?: number;
}

/** Full result returned by computeComparativeIntelligence. */
export interface ComparativeIntelligenceResult {
  /** Workflows sorted by workspaceRank ASC (rank 1 = highest risk). */
  rankedWorkflows:      WorkflowComparativeIntelligence[];
  hotspotConcentration: WorkspaceHotspotConcentration;
  totalWorkflows:       number;
}

// ── Optional context for observability ────────────────────────────────────────

export interface ComparativeContext {
  workspaceId?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Map trend direction to its additive score bonus. */
function trendBonus(t: TrendDirection): number {
  switch (t) {
    case "critically_degrading": return TREND_BONUS_CRITICALLY_DEGRADING;
    case "degrading":            return TREND_BONUS_DEGRADING;
    case "stable":               return TREND_BONUS_STABLE;
    case "improving":            return TREND_BONUS_IMPROVING;
  }
}

/** Map fragility level to its additive score bonus. */
function fragilityBonus(f: FragilityLevel): number {
  switch (f) {
    case "critical":  return FRAGILITY_BONUS_CRITICAL;
    case "high":      return FRAGILITY_BONUS_HIGH;
    case "moderate":  return FRAGILITY_BONUS_MODERATE;
    case "low":       return FRAGILITY_BONUS_LOW;
  }
}

/** Map confidence level to score multiplier. */
function confidenceMultiplier(c: ForecastConfidence): number {
  switch (c) {
    case "high":     return CONFIDENCE_MULT_HIGH;
    case "moderate": return CONFIDENCE_MULT_MODERATE;
    case "low":      return CONFIDENCE_MULT_LOW;
  }
}

/**
 * Compute the comparativeRiskScore for a single workflow snapshot.
 *
 * Formula:
 *   base     = rWC × 0.35 + projected × 0.25    (max 60)
 *   bonuses  = trendBonus + fragilityBonus + hotspotBonus
 *   subtotal = base + bonuses
 *   score    = clamp(round(subtotal × confidenceMultiplier), 0, 100)
 */
function scoreWorkflow(s: WorkflowIntelligenceSnapshot): number {
  const base = s.runtimeWeightedComplexity * W_RWC + s.projectedComplexity * W_PROJECTED;
  const tb   = trendBonus(s.trendDirection);
  const fb   = fragilityBonus(s.fragilityLevel);
  const hb   = Math.min(s.hotspotCount * HOTSPOT_BONUS_PER, HOTSPOT_BONUS_CAP);

  const subtotal = base + tb + fb + hb;
  const mult     = confidenceMultiplier(s.confidenceLevel);

  return clamp(Math.round(subtotal * mult), 0, 100);
}

/**
 * Classify the operational priority for a workflow.
 *
 * Base level:  score → informational / watch / elevated / urgent / critical
 * Escalation (if score ≥ PRIORITY_ESCALATION_MIN):
 *   critically_degrading trend → +1 level  (capped at critical)
 *   critical fragility level   → +1 level  (capped at critical)
 */
function classifyPriority(
  score:         number,
  trend:         TrendDirection,
  fragility:     FragilityLevel,
): OperationalPriority {
  const LEVELS: OperationalPriority[] = ["informational", "watch", "elevated", "urgent", "critical"];

  // Base level from score
  let level: number;
  if      (score >= PRIORITY_CRITICAL_SCORE)  level = 4;
  else if (score >= PRIORITY_URGENT_SCORE)    level = 3;
  else if (score >= PRIORITY_ELEVATED_SCORE)  level = 2;
  else if (score >= PRIORITY_WATCH_SCORE)     level = 1;
  else                                        level = 0;

  // Escalations - only apply when the workflow shows some meaningful risk signal
  if (score >= PRIORITY_ESCALATION_MIN) {
    if (trend === "critically_degrading") level = Math.min(4, level + 1);
    if (fragility === "critical")         level = Math.min(4, level + 1);
  }

  return LEVELS[level]!;
}

/**
 * Sort comparator: highest risk first, tie-break by workflowId ASC (stable).
 */
function riskComparator(
  a: { comparativeRiskScore: number; workflowId: number },
  b: { comparativeRiskScore: number; workflowId: number },
): number {
  if (b.comparativeRiskScore !== a.comparativeRiskScore) {
    return b.comparativeRiskScore - a.comparativeRiskScore;  // DESC
  }
  return a.workflowId - b.workflowId;   // ASC tie-break
}

/**
 * Compute workspace-level hotspot concentration analytics from ranked list.
 */
function computeHotspotConcentration(
  ranked: WorkflowComparativeIntelligence[],
): WorkspaceHotspotConcentration {
  const total = ranked.length;

  const dominantCount     = ranked.filter(w => w.comparativeRiskScore >= DOMINANT_SCORE_THRESHOLD).length;
  const chronicCount      = ranked.filter(w => w.hotspotCount >= CHRONIC_HOTSPOT_MIN).length;
  const criticallyDegCount = ranked.filter(w => w.trendDirection === "critically_degrading").length;
  const urgentCritCount   = ranked.filter(
    w => w.operationalPriority === "urgent" || w.operationalPriority === "critical",
  ).length;

  const top = ranked[0] ?? null;

  return {
    dominantWorkflowCount:       dominantCount,
    concentrationRatio:          total > 0 ? Math.round((dominantCount / total) * 1000) / 1000 : 0,
    chronicHotspotWorkflowCount: chronicCount,
    criticallyDegradingCount:    criticallyDegCount,
    urgentOrCriticalCount:       urgentCritCount,
    topRiskWorkflowId:           top?.workflowId ?? null,
    topRiskScore:                top?.comparativeRiskScore ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: computeComparativeIntelligence  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full deterministic comparative-intelligence pipeline.
 *
 * Accepts intelligence snapshots for all active workflows in a workspace
 * (each built from P8-A → P8-D outputs by the caller), scores and ranks
 * them, classifies operational priority, and computes workspace-level
 * hotspot concentration analytics.
 *
 * Pure - no DB, no async, no side effects.
 * Never mutates input snapshot objects.
 * All outputs are deterministic: identical inputs always produce identical outputs.
 * Emits four structured observability events via logger.
 *
 * @param input   Comparative intelligence input including all workflow snapshots
 * @param context Optional workspace identifier for observability events
 */
export function computeComparativeIntelligence(
  input:   ComparativeIntelligenceInput,
  context: ComparativeContext = {},
): ComparativeIntelligenceResult {
  // Safety cap - defensive limit on snapshots to process
  const snapshots = input.snapshots.slice(0, MAX_SNAPSHOTS);
  const total     = snapshots.length;

  // ── Score all workflows ─────────────────────────────────────────────────────
  const scored: Array<{ snapshot: WorkflowIntelligenceSnapshot; score: number }> =
    snapshots.map(s => ({ snapshot: s, score: scoreWorkflow(s) }));

  // ── Sort by risk DESC, tie-break workflowId ASC ───────────────────────────
  scored.sort((a, b) => riskComparator(
    { comparativeRiskScore: a.score, workflowId: a.snapshot.workflowId },
    { comparativeRiskScore: b.score, workflowId: b.snapshot.workflowId },
  ));

  // ── Build ranked output ────────────────────────────────────────────────────
  const rankedWorkflows: WorkflowComparativeIntelligence[] = scored.map(({ snapshot: s, score }, idx) => {
    const priority = classifyPriority(score, s.trendDirection, s.fragilityLevel);
    return {
      workflowId:                s.workflowId,
      workflowName:              s.workflowName,
      stepCount:                 s.stepCount,
      comparativeRiskScore:      score,
      runtimeWeightedComplexity: s.runtimeWeightedComplexity,
      projectedComplexity:       s.projectedComplexity,
      fragilityLevel:            s.fragilityLevel,
      trendDirection:            s.trendDirection,
      hotspotCount:              s.hotspotCount,
      operationalPriority:       priority,
      workspaceRank:             idx + 1,   // 1-based
      confidenceLevel:           s.confidenceLevel,
    };
  });

  // ── Workspace-level hotspot concentration analytics ────────────────────────
  const hotspotConcentration = computeHotspotConcentration(rankedWorkflows);

  // ── Observability: workflow_comparative_ranking_computed ───────────────────
  logger.info(
    {
      action:               "workflow_comparative_ranking_computed",
      workspaceId:          context.workspaceId ?? null,
      totalWorkflows:       total,
      dominantWorkflows:    hotspotConcentration.dominantWorkflowCount,
      concentrationRatio:   hotspotConcentration.concentrationRatio,
      urgentOrCritical:     hotspotConcentration.urgentOrCriticalCount,
      topRiskWorkflowId:    hotspotConcentration.topRiskWorkflowId,
      topRiskScore:         hotspotConcentration.topRiskScore,
    },
    "[governance] P8-E: Comparative ranking computed",
  );

  // ── Observability: workflow_operational_priority_assigned ─────────────────
  const criticalOrUrgent = rankedWorkflows.filter(
    w => w.operationalPriority === "critical" || w.operationalPriority === "urgent",
  );
  if (criticalOrUrgent.length > 0) {
    logger.info(
      {
        action:            "workflow_operational_priority_assigned",
        workspaceId:       context.workspaceId ?? null,
        criticalCount:     rankedWorkflows.filter(w => w.operationalPriority === "critical").length,
        urgentCount:       rankedWorkflows.filter(w => w.operationalPriority === "urgent").length,
        topWorkflowIds:    criticalOrUrgent.slice(0, 5).map(w => w.workflowId),
      },
      "[governance] P8-E: Urgent/critical operational priorities assigned",
    );
  }

  // ── Observability: workflow_hotspot_concentration_detected ────────────────
  if (hotspotConcentration.dominantWorkflowCount > 0 || hotspotConcentration.chronicHotspotWorkflowCount > 0) {
    logger.info(
      {
        action:                      "workflow_hotspot_concentration_detected",
        workspaceId:                 context.workspaceId ?? null,
        dominantWorkflowCount:       hotspotConcentration.dominantWorkflowCount,
        concentrationRatio:          hotspotConcentration.concentrationRatio,
        chronicHotspotWorkflowCount: hotspotConcentration.chronicHotspotWorkflowCount,
        criticallyDegradingCount:    hotspotConcentration.criticallyDegradingCount,
        topRiskWorkflowId:           hotspotConcentration.topRiskWorkflowId,
      },
      "[governance] P8-E: Hotspot concentration detected",
    );
  }

  // ── Observability: workflow_risk_escalation_detected ─────────────────────
  const escalatedWorkflows = rankedWorkflows.filter(w => {
    // Escalation = priority is higher than score alone would give
    const scoreOnlyLevel =
      w.comparativeRiskScore >= PRIORITY_CRITICAL_SCORE ? "critical"  :
      w.comparativeRiskScore >= PRIORITY_URGENT_SCORE   ? "urgent"    :
      w.comparativeRiskScore >= PRIORITY_ELEVATED_SCORE ? "elevated"  :
      w.comparativeRiskScore >= PRIORITY_WATCH_SCORE    ? "watch"     :
      "informational";
    return w.operationalPriority !== scoreOnlyLevel &&
           (w.trendDirection === "critically_degrading" || w.fragilityLevel === "critical");
  });
  if (escalatedWorkflows.length > 0) {
    logger.info(
      {
        action:               "workflow_risk_escalation_detected",
        workspaceId:          context.workspaceId ?? null,
        escalatedCount:       escalatedWorkflows.length,
        workflowIds:          escalatedWorkflows.slice(0, 5).map(w => ({
          workflowId:           w.workflowId,
          comparativeRiskScore: w.comparativeRiskScore,
          operationalPriority:  w.operationalPriority,
          trendDirection:       w.trendDirection,
        })),
      },
      "[governance] P8-E: Risk escalation detected (trend/fragility override)",
    );
  }

  return {
    rankedWorkflows,
    hotspotConcentration,
    totalWorkflows: total,
  };
}
