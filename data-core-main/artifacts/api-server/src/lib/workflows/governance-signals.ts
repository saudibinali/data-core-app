/**
 * @file   lib/workflows/governance-signals.ts
 * @phase  P8-F - Proactive Governance Signals & Advisory Intelligence Foundations
 *
 * Pure deterministic governance advisory engine.
 * No DB, no async, no ML, no side effects.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   generateGovernanceSignals(input, context?) → GovernanceSignalResult
 *
 *   Internally:
 *     1. generateCriticalSignals()        - GOV-WORKFLOW-CRITICAL
 *     2. generateUrgentSignals()          - GOV-WORKFLOW-URGENT
 *     3. generateEscalatingSignals()      - GOV-WORKFLOW-ESCALATING
 *     4. generateFragilitySignals()       - GOV-FRAGILITY-GROWTH
 *     5. generateConcentrationSignal()    - GOV-HOTSPOT-CONCENTRATION (workspace-level)
 *     6. generateStormRiskSignals()       - GOV-STORM-RISK-GROWTH (requires forecast data)
 *     7. deduplicateSignals()             - fingerprint-based dedup + external cooldown
 *     8. computeAdvisoryLevel()           - worst severity → GovernanceAdvisoryLevel
 *     9. Emit 4 structured observability events via logger
 *
 * ── SIGNAL CODES ─────────────────────────────────────────────────────────────
 *   GOV-WORKFLOW-CRITICAL      operationalPriority = "critical"
 *   GOV-WORKFLOW-URGENT        operationalPriority = "urgent"
 *   GOV-WORKFLOW-ESCALATING    trendDirection = "critically_degrading"
 *   GOV-FRAGILITY-GROWTH       fragilityLevel ∈ {"high", "critical"}
 *   GOV-HOTSPOT-CONCENTRATION  concentrationRatio > CONCENTRATION_SIGNAL_THRESHOLD
 *   GOV-STORM-RISK-GROWTH      projectedStormRisk > STORM_RISK_SIGNAL_THRESHOLD
 *                               (only emitted when workflowForecasts is provided)
 *
 * ── DEDUPLICATION STRATEGY ───────────────────────────────────────────────────
 *   Fingerprint = "${signalCode}:${affectedWorkflowId ?? 'workspace'}:${workspaceId}"
 *
 *   Two deduplication layers:
 *     A) Within-evaluation dedup:  each fingerprint emitted at most once per call.
 *     B) External cooldown:        if fingerprint ∈ priorSignalFingerprints, it is
 *                                  suppressed and counted in deduplicatedCount.
 *   The route handler populates priorSignalFingerprints from recently emitted
 *   signals (e.g. within the last cooldown window) to prevent advisory storms.
 *
 * ── ADVISORY LEVEL CLASSIFICATION ────────────────────────────────────────────
 *   Worst severity across all emitted signals → GovernanceAdvisoryLevel:
 *     critical → critical
 *     high     → urgent
 *     medium   → elevated
 *     low      → advisory
 *     (none)   → informational
 *
 * ── SIGNAL TTL (expiresAt) ───────────────────────────────────────────────────
 *   GOV-WORKFLOW-CRITICAL:       60 min  (high urgency, refresh needed quickly)
 *   GOV-WORKFLOW-URGENT:        120 min
 *   GOV-WORKFLOW-ESCALATING:    240 min
 *   GOV-FRAGILITY-GROWTH:       360 min
 *   GOV-HOTSPOT-CONCENTRATION:  240 min
 *   GOV-STORM-RISK-GROWTH:      480 min  (storm risk changes slowly)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates workflow definitions, governance history, or DB.
 *   Never triggers workflow execution, never invokes scheduler.
 *   Advisory-only: no autonomous actions, no execution blocking.
 *   Deterministic: identical inputs + identical evaluationTime → identical outputs.
 *   Input arrays never mutated.
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   governance-signals.ts → comparative-intelligence.ts  (types only)
 *   governance-signals.ts → logger.ts                    (observability events)
 *   No imports from topology.ts, dependency.ts, operational-correlation.ts,
 *   or trend-forecast.ts - pure consumer of P8-E output summaries.
 */

import { logger } from "../logger";
import type {
  WorkflowComparativeIntelligence,
  WorkspaceHotspotConcentration,
} from "./comparative-intelligence";

// ── Signal TTL minutes per signal code ────────────────────────────────────────
const SIGNAL_TTL_MINUTES: Record<string, number> = {
  "GOV-WORKFLOW-CRITICAL":      60,
  "GOV-WORKFLOW-URGENT":        120,
  "GOV-WORKFLOW-ESCALATING":    240,
  "GOV-FRAGILITY-GROWTH":       360,
  "GOV-HOTSPOT-CONCENTRATION":  240,
  "GOV-STORM-RISK-GROWTH":      480,
};

// ── Signal generation thresholds ──────────────────────────────────────────────

/** concentrationRatio above which GOV-HOTSPOT-CONCENTRATION is emitted. */
const CONCENTRATION_SIGNAL_THRESHOLD = 0.25;
/** concentrationRatio at or above which GOV-HOTSPOT-CONCENTRATION severity = "critical". */
const CONCENTRATION_CRITICAL_THRESHOLD = 0.50;
/** projectedStormRisk above which GOV-STORM-RISK-GROWTH is emitted (0-1). */
const STORM_RISK_SIGNAL_THRESHOLD = 0.15;
/** projectedStormRisk at or above which GOV-STORM-RISK-GROWTH severity = "high". */
const STORM_RISK_HIGH_THRESHOLD = 0.30;

// ── Severity numeric weights (used to derive advisory level) ──────────────────
const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  low:      1,
  medium:   2,
  high:     3,
  critical: 4,
};

// ── Public types ──────────────────────────────────────────────────────────────

/** Machine-readable governance signal identifier. */
export type SignalCode =
  | "GOV-WORKFLOW-CRITICAL"
  | "GOV-WORKFLOW-URGENT"
  | "GOV-WORKFLOW-ESCALATING"
  | "GOV-HOTSPOT-CONCENTRATION"
  | "GOV-FRAGILITY-GROWTH"
  | "GOV-STORM-RISK-GROWTH";

/** Operational severity of the signal. */
export type SignalSeverity = "low" | "medium" | "high" | "critical";

/** Governance concern category. */
export type SignalCategory =
  | "operational_priority"
  | "degradation"
  | "fragility"
  | "hotspot_concentration"
  | "storm_risk";

/**
 * 5-level advisory triage level.
 * Derived from the worst SignalSeverity across all emitted signals.
 * Advisory-only - never blocks or triggers autonomous actions.
 */
export type GovernanceAdvisoryLevel =
  | "informational"
  | "advisory"
  | "elevated"
  | "urgent"
  | "critical";

/**
 * A single deterministic governance advisory signal.
 * Encodes one detected operational concern for a workflow or the workspace.
 * Advisory-only: never implies automatic action.
 */
export interface GovernanceSignal {
  /** Machine-readable signal identifier. */
  signalCode: SignalCode;
  /** Operational severity of the concern. */
  severity: SignalSeverity;
  /** Governance concern category. */
  category: SignalCategory;
  /**
   * Workflow definition primary key for workflow-scoped signals.
   * null for workspace-level signals (e.g. GOV-HOTSPOT-CONCENTRATION).
   */
  affectedWorkflowId: number | null;
  workspaceId: number;
  /**
   * Deterministic human-readable advisory message.
   * Template-based, never AI-generated.
   */
  advisoryMessage: string;
  /**
   * Named metric indicators that triggered the signal.
   * Each entry is "metric:value" format.
   */
  supportingIndicators: string[];
  /** ISO 8601 timestamp when this signal was generated. */
  generatedAt: string;
  /**
   * ISO 8601 expiry timestamp.
   * Signal is considered stale after this time.
   * TTL per code - see SIGNAL_TTL_MINUTES.
   */
  expiresAt: string;
}

/**
 * Per-workflow P8-D forecast summary.
 * Needed to generate GOV-STORM-RISK-GROWTH signals.
 * Extracted by the route handler from WorkflowOperationalForecast.
 */
export interface WorkflowForecastSummary {
  workflowId: number;
  /** P8-D projectedStormRisk (0-1). */
  projectedStormRisk: number;
  /** P8-D projectedBacklogPressure (0-1). */
  projectedBacklogPressure: number;
}

/** Input to generateGovernanceSignals. */
export interface GovernanceSignalInput {
  /** Ranked workflows from P8-E computeComparativeIntelligence. */
  rankedWorkflows: WorkflowComparativeIntelligence[];
  /** Workspace hotspot concentration analytics from P8-E. */
  hotspotConcentration: WorkspaceHotspotConcentration;
  workspaceId: number;
  totalWorkflows: number;
  /**
   * Optional per-workflow P8-D forecast summaries.
   * Required to emit GOV-STORM-RISK-GROWTH signals.
   * If absent, storm-risk signals are skipped gracefully.
   */
  workflowForecasts?: WorkflowForecastSummary[];
  /**
   * Optional set of signal fingerprints already active in the workspace.
   * Signals whose fingerprint appears here are suppressed (external cooldown).
   * The route handler populates this from recently stored governance signals
   * to prevent advisory storms when the same condition persists across evaluations.
   */
  priorSignalFingerprints?: ReadonlySet<string>;
}

/** Optional context for observability and deterministic testing. */
export interface GovernanceSignalContext {
  /** Caller-assigned evaluation identifier (for log correlation). */
  evaluationId?: string;
  /**
   * Timestamp to use for generatedAt / expiresAt.
   * Defaults to new Date(). Inject a fixed value in tests for deterministic output.
   */
  evaluationTime?: Date;
}

/** Full result returned by generateGovernanceSignals. */
export interface GovernanceSignalResult {
  /** Emitted governance signals, sorted by severity DESC then signalCode ASC. */
  signals: GovernanceSignal[];
  /** Worst advisory level across all emitted signals. */
  advisoryLevel: GovernanceAdvisoryLevel;
  /** Count of signals successfully emitted (after deduplication). */
  totalSignals: number;
  /**
   * Count of candidate signals suppressed by deduplication.
   * Includes both within-evaluation duplicates and external cooldown suppressions.
   */
  deduplicatedCount: number;
  workspaceId: number;
  /** ISO 8601 timestamp when the evaluation ran. */
  evaluatedAt: string;
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

/**
 * Compute the deduplication fingerprint for a signal.
 * Fingerprint = "${signalCode}:${affectedWorkflowId ?? 'workspace'}:${workspaceId}"
 */
export function makeSignalFingerprint(
  code: string,
  workflowId: number | null,
  workspaceId: number,
): string {
  return `${code}:${workflowId ?? "workspace"}:${workspaceId}`;
}

// ── TTL helpers ───────────────────────────────────────────────────────────────

function makeExpiresAt(code: string, now: Date): string {
  const ttlMs = (SIGNAL_TTL_MINUTES[code] ?? 60) * 60 * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal generators - one pure function per signal code
// ─────────────────────────────────────────────────────────────────────────────

function generateCriticalSignals(
  ranked:      WorkflowComparativeIntelligence[],
  workspaceId: number,
  now:         Date,
): GovernanceSignal[] {
  const code: SignalCode = "GOV-WORKFLOW-CRITICAL";
  return ranked
    .filter(wf => wf.operationalPriority === "critical")
    .map(wf => ({
      signalCode:           code,
      severity:             "critical" as SignalSeverity,
      category:             "operational_priority" as SignalCategory,
      affectedWorkflowId:   wf.workflowId,
      workspaceId,
      advisoryMessage:
        `Workflow '${wf.workflowName}' is ranked #${wf.workspaceRank} in the workspace ` +
        `with a critical risk score of ${wf.comparativeRiskScore}/100. ` +
        `Immediate operator review is recommended.`,
      supportingIndicators: [
        `comparativeRiskScore:${wf.comparativeRiskScore}`,
        `operationalPriority:critical`,
        `workspaceRank:${wf.workspaceRank}`,
        `fragilityLevel:${wf.fragilityLevel}`,
        `trendDirection:${wf.trendDirection}`,
      ],
      generatedAt: now.toISOString(),
      expiresAt:   makeExpiresAt(code, now),
    }));
}

function generateUrgentSignals(
  ranked:      WorkflowComparativeIntelligence[],
  workspaceId: number,
  now:         Date,
): GovernanceSignal[] {
  const code: SignalCode = "GOV-WORKFLOW-URGENT";
  return ranked
    .filter(wf => wf.operationalPriority === "urgent")
    .map(wf => ({
      signalCode:           code,
      severity:             "high" as SignalSeverity,
      category:             "operational_priority" as SignalCategory,
      affectedWorkflowId:   wf.workflowId,
      workspaceId,
      advisoryMessage:
        `Workflow '${wf.workflowName}' is ranked #${wf.workspaceRank} in the workspace ` +
        `with an urgent risk score of ${wf.comparativeRiskScore}/100. ` +
        `Operator attention is recommended.`,
      supportingIndicators: [
        `comparativeRiskScore:${wf.comparativeRiskScore}`,
        `operationalPriority:urgent`,
        `workspaceRank:${wf.workspaceRank}`,
        `fragilityLevel:${wf.fragilityLevel}`,
        `trendDirection:${wf.trendDirection}`,
      ],
      generatedAt: now.toISOString(),
      expiresAt:   makeExpiresAt(code, now),
    }));
}

function generateEscalatingSignals(
  ranked:      WorkflowComparativeIntelligence[],
  workspaceId: number,
  now:         Date,
): GovernanceSignal[] {
  const code: SignalCode = "GOV-WORKFLOW-ESCALATING";
  return ranked
    .filter(wf => wf.trendDirection === "critically_degrading")
    .map(wf => ({
      signalCode:           code,
      severity:             "high" as SignalSeverity,
      category:             "degradation" as SignalCategory,
      affectedWorkflowId:   wf.workflowId,
      workspaceId,
      advisoryMessage:
        `Workflow '${wf.workflowName}' (rank #${wf.workspaceRank}, score ${wf.comparativeRiskScore}/100) ` +
        `has a critically degrading operational trend. ` +
        `Projected complexity is accelerating beyond stable thresholds.`,
      supportingIndicators: [
        `trendDirection:critically_degrading`,
        `comparativeRiskScore:${wf.comparativeRiskScore}`,
        `fragilityLevel:${wf.fragilityLevel}`,
        `projectedComplexity:${wf.projectedComplexity}`,
        `confidenceLevel:${wf.confidenceLevel}`,
      ],
      generatedAt: now.toISOString(),
      expiresAt:   makeExpiresAt(code, now),
    }));
}

function generateFragilitySignals(
  ranked:      WorkflowComparativeIntelligence[],
  workspaceId: number,
  now:         Date,
): GovernanceSignal[] {
  const code: SignalCode = "GOV-FRAGILITY-GROWTH";
  return ranked
    .filter(wf => wf.fragilityLevel === "high" || wf.fragilityLevel === "critical")
    .map(wf => {
      const sev: SignalSeverity = wf.fragilityLevel === "critical" ? "critical" : "high";
      return {
        signalCode:           code,
        severity:             sev,
        category:             "fragility" as SignalCategory,
        affectedWorkflowId:   wf.workflowId,
        workspaceId,
        advisoryMessage:
          `Workflow '${wf.workflowName}' has reached ${wf.fragilityLevel} operational fragility ` +
          `(runtime-weighted complexity: ${wf.runtimeWeightedComplexity}/100). ` +
          `Structural and runtime pressures are compounding.`,
        supportingIndicators: [
          `fragilityLevel:${wf.fragilityLevel}`,
          `runtimeWeightedComplexity:${wf.runtimeWeightedComplexity}`,
          `hotspotCount:${wf.hotspotCount}`,
          `comparativeRiskScore:${wf.comparativeRiskScore}`,
          `trendDirection:${wf.trendDirection}`,
        ],
        generatedAt: now.toISOString(),
        expiresAt:   makeExpiresAt(code, now),
      };
    });
}

function generateConcentrationSignal(
  concentration: WorkspaceHotspotConcentration,
  totalWorkflows: number,
  workspaceId:   number,
  now:           Date,
): GovernanceSignal | null {
  if (concentration.concentrationRatio <= CONCENTRATION_SIGNAL_THRESHOLD) return null;

  const code: SignalCode = "GOV-HOTSPOT-CONCENTRATION";
  const sev: SignalSeverity =
    concentration.concentrationRatio >= CONCENTRATION_CRITICAL_THRESHOLD ? "critical" : "high";
  const pct = Math.round(concentration.concentrationRatio * 100);

  return {
    signalCode:           code,
    severity:             sev,
    category:             "hotspot_concentration" as SignalCategory,
    affectedWorkflowId:   null,
    workspaceId,
    advisoryMessage:
      `${concentration.dominantWorkflowCount} of ${totalWorkflows} workflows (${pct}%) ` +
      `are operating at dominant risk levels (score ≥ 70). ` +
      `Workspace operational risk is heavily concentrated.`,
    supportingIndicators: [
      `concentrationRatio:${concentration.concentrationRatio}`,
      `dominantWorkflowCount:${concentration.dominantWorkflowCount}`,
      `urgentOrCriticalCount:${concentration.urgentOrCriticalCount}`,
      `chronicHotspotWorkflowCount:${concentration.chronicHotspotWorkflowCount}`,
      `criticallyDegradingCount:${concentration.criticallyDegradingCount}`,
    ],
    generatedAt: now.toISOString(),
    expiresAt:   makeExpiresAt(code, now),
  };
}

function generateStormRiskSignals(
  ranked:          WorkflowComparativeIntelligence[],
  forecasts:       WorkflowForecastSummary[],
  workspaceId:     number,
  now:             Date,
): GovernanceSignal[] {
  const code: SignalCode = "GOV-STORM-RISK-GROWTH";
  if (forecasts.length === 0) return [];

  const forecastMap = new Map<number, WorkflowForecastSummary>(
    forecasts.map(f => [f.workflowId, f]),
  );

  const signals: GovernanceSignal[] = [];

  for (const wf of ranked) {
    const fc = forecastMap.get(wf.workflowId);
    if (!fc) continue;
    if (fc.projectedStormRisk <= STORM_RISK_SIGNAL_THRESHOLD) continue;

    const sev: SignalSeverity = fc.projectedStormRisk >= STORM_RISK_HIGH_THRESHOLD ? "high" : "medium";
    const pct = Math.round(fc.projectedStormRisk * 100);

    signals.push({
      signalCode:           code,
      severity:             sev,
      category:             "storm_risk" as SignalCategory,
      affectedWorkflowId:   wf.workflowId,
      workspaceId,
      advisoryMessage:
        `Workflow '${wf.workflowName}' has an elevated projected storm risk of ${pct}% ` +
        `within the 7-day forecast window. Governance alert volume may increase.`,
      supportingIndicators: [
        `projectedStormRisk:${pct}%`,
        `workspaceRank:${wf.workspaceRank}`,
        `trendDirection:${wf.trendDirection}`,
        `comparativeRiskScore:${wf.comparativeRiskScore}`,
        `projectedBacklogPressure:${Math.round(fc.projectedBacklogPressure * 100)}%`,
      ],
      generatedAt: now.toISOString(),
      expiresAt:   makeExpiresAt(code, now),
    });
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

interface DeduplicationResult {
  emitted:           GovernanceSignal[];
  deduplicatedCount: number;
}

/**
 * Deduplicate a list of candidate signals.
 *
 * Two deduplication layers:
 *   A) Within-evaluation:  each fingerprint emitted at most once per call.
 *   B) External cooldown:  signals whose fingerprint is in priorSignalFingerprints
 *                          are suppressed (cooldown window set by the caller).
 */
function deduplicateSignals(
  candidates:       GovernanceSignal[],
  priorFingerprints: ReadonlySet<string> | undefined,
): DeduplicationResult {
  const seenThisEval = new Set<string>();
  const emitted: GovernanceSignal[] = [];
  let deduplicatedCount = 0;

  for (const signal of candidates) {
    const fp = makeSignalFingerprint(
      signal.signalCode,
      signal.affectedWorkflowId,
      signal.workspaceId,
    );

    if (seenThisEval.has(fp) || priorFingerprints?.has(fp)) {
      deduplicatedCount++;
      continue;
    }

    seenThisEval.add(fp);
    emitted.push(signal);
  }

  return { emitted, deduplicatedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Advisory level computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive workspace advisory level from the worst signal severity.
 * Maps: critical→critical | high→urgent | medium→elevated | low→advisory | none→informational
 */
function computeAdvisoryLevel(signals: GovernanceSignal[]): GovernanceAdvisoryLevel {
  if (signals.length === 0) return "informational";

  const maxWeight = Math.max(...signals.map(s => SEVERITY_WEIGHT[s.severity]));

  if (maxWeight >= SEVERITY_WEIGHT.critical) return "critical";
  if (maxWeight >= SEVERITY_WEIGHT.high)     return "urgent";
  if (maxWeight >= SEVERITY_WEIGHT.medium)   return "elevated";
  if (maxWeight >= SEVERITY_WEIGHT.low)      return "advisory";
  return "informational";
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal sort comparator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort emitted signals for deterministic, operator-friendly output.
 * Primary:    severity DESC (critical first)
 * Secondary:  signalCode ASC (stable)
 * Tertiary:   affectedWorkflowId ASC nulls-last (workspace signals last)
 */
function signalSortComparator(a: GovernanceSignal, b: GovernanceSignal): number {
  const wA = SEVERITY_WEIGHT[a.severity];
  const wB = SEVERITY_WEIGHT[b.severity];
  if (wB !== wA) return wB - wA;

  const codeCompare = a.signalCode.localeCompare(b.signalCode);
  if (codeCompare !== 0) return codeCompare;

  const idA = a.affectedWorkflowId ?? Number.MAX_SAFE_INTEGER;
  const idB = b.affectedWorkflowId ?? Number.MAX_SAFE_INTEGER;
  return idA - idB;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: generateGovernanceSignals  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full deterministic governance advisory signal pipeline.
 *
 * Accepts the full P8-E comparative intelligence result for a workspace,
 * runs all six signal generators, deduplicates results, and computes the
 * workspace-level advisory level.
 *
 * Pure - no DB, no async, no side effects.
 * Never mutates input arrays.
 * Advisory-only: never triggers actions, never blocks executions.
 * Deterministic: identical inputs + context.evaluationTime → identical outputs.
 * Emits four structured observability events via logger.
 *
 * @param input   Governance signal generation input (P8-E output + optional forecast data)
 * @param context Optional evaluation metadata (ID for log correlation, time for determinism)
 */
export function generateGovernanceSignals(
  input:   GovernanceSignalInput,
  context: GovernanceSignalContext = {},
): GovernanceSignalResult {
  const now         = context.evaluationTime ?? new Date();
  const workspaceId = input.workspaceId;
  const ranked      = input.rankedWorkflows;
  const forecasts   = input.workflowForecasts ?? [];

  // ── 1-6: Collect all candidate signals ──────────────────────────────────────
  const candidates: GovernanceSignal[] = [
    ...generateCriticalSignals(ranked, workspaceId, now),
    ...generateUrgentSignals(ranked, workspaceId, now),
    ...generateEscalatingSignals(ranked, workspaceId, now),
    ...generateFragilitySignals(ranked, workspaceId, now),
    ...generateStormRiskSignals(ranked, forecasts, workspaceId, now),
  ];

  const concentrationSignal = generateConcentrationSignal(
    input.hotspotConcentration,
    input.totalWorkflows,
    workspaceId,
    now,
  );
  if (concentrationSignal) candidates.push(concentrationSignal);

  // ── 7: Deduplicate (within-evaluation + external cooldown) ─────────────────
  const { emitted, deduplicatedCount } = deduplicateSignals(
    candidates,
    input.priorSignalFingerprints,
  );

  // ── 8: Sort signals for deterministic, operator-friendly output ────────────
  emitted.sort(signalSortComparator);

  // ── 8: Compute advisory level ─────────────────────────────────────────────
  const advisoryLevel = computeAdvisoryLevel(emitted);

  const result: GovernanceSignalResult = {
    signals:           emitted,
    advisoryLevel,
    totalSignals:      emitted.length,
    deduplicatedCount,
    workspaceId,
    evaluatedAt:       now.toISOString(),
  };

  // ── 9a: Observability: governance_signal_generated ────────────────────────
  logger.info(
    {
      action:            "governance_signal_generated",
      workspaceId,
      evaluationId:      context.evaluationId ?? null,
      totalSignals:      emitted.length,
      deduplicatedCount,
      advisoryLevel,
      criticalCount:     emitted.filter(s => s.severity === "critical").length,
      highCount:         emitted.filter(s => s.severity === "high").length,
      signalCodes:       [...new Set(emitted.map(s => s.signalCode))],
    },
    "[governance] P8-F: Governance signals generated",
  );

  // ── 9b: Observability: governance_signal_escalated ────────────────────────
  const escalatedSignals = emitted.filter(
    s => s.severity === "critical" || s.severity === "high",
  );
  if (escalatedSignals.length > 0) {
    logger.info(
      {
        action:       "governance_signal_escalated",
        workspaceId,
        evaluationId: context.evaluationId ?? null,
        count:        escalatedSignals.length,
        advisoryLevel,
        signals:      escalatedSignals.slice(0, 5).map(s => ({
          signalCode:         s.signalCode,
          severity:           s.severity,
          affectedWorkflowId: s.affectedWorkflowId,
          advisoryLevel,
        })),
      },
      "[governance] P8-F: Governance signals escalated (high/critical severity)",
    );
  }

  // ── 9c: Observability: governance_signal_deduplicated ─────────────────────
  if (deduplicatedCount > 0) {
    logger.info(
      {
        action:            "governance_signal_deduplicated",
        workspaceId,
        evaluationId:      context.evaluationId ?? null,
        deduplicatedCount,
        totalCandidates:   candidates.length,
        emittedCount:      emitted.length,
      },
      "[governance] P8-F: Governance signals deduplicated",
    );
  }

  // ── 9d: Observability: governance_signal_expired (expiry analysis) ─────────
  const expiringSignals = emitted.filter(s => {
    const expiresMs = new Date(s.expiresAt).getTime() - now.getTime();
    return expiresMs < 2 * 60 * 60 * 1000; // expires within 2h
  });
  if (expiringSignals.length > 0) {
    logger.info(
      {
        action:          "governance_signal_expired",
        workspaceId,
        evaluationId:    context.evaluationId ?? null,
        shortLivedCount: expiringSignals.length,
        signalCodes:     expiringSignals.map(s => s.signalCode),
      },
      "[governance] P8-F: Governance signals with short TTL (expires < 2h)",
    );
  }

  return result;
}
