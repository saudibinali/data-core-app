/**
 * @file   lib/workflows/trend-forecast.ts
 * @phase  P8-D - Predictive Trend Projection & Operational Forecast Foundations
 *
 * Pure deterministic trend-projection engine.
 * No DB, no async, no ML, no side effects.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   computeWorkflowForecast(input) → WorkflowOperationalForecast
 *
 *   Internally:
 *     1. normalizePoints()                 - raw counts → 0-1 pressures + per-bucket rWC
 *     2. getProjectionMethod()             - select algorithm based on sample count
 *     3. computeWeightedSlope()            - weighted linear regression slope (n ≥ 7)
 *                                            or simple slope (n < 7)
 *     4. computeVolatility()               - unweighted standard deviation
 *     5. projectMetric()                   - last value + slope × window, clamped
 *     6. classifyTrendDirection()          - 4-level enum from rWC slope
 *     7. computeForecastConfidence()       - sample size + volatility + window penalties
 *     8. Emit 4 structured observability events via logger
 *
 * ── PROJECTION METHODS ───────────────────────────────────────────────────────
 *   n = 0              → "no_data"              (returns structural defaults)
 *   n = 1              → "last_known_value"     (no extrapolation)
 *   2 ≤ n < 7          → "weighted_moving_average" (triangular slope, extrapolate)
 *   n ≥ 7              → "weighted_linear_regression" (full WLS slope, extrapolate)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *   READ-ONLY: never mutates input arrays, governance history, or DB.
 *   Never triggers alerts, never invokes runtime execution, never claims certainty.
 *   Projected values are always bounded to their valid ranges.
 *   Assistive deterministic forecasting only - no autonomous actions.
 *
 * ── NORMALIZATION CONSTANTS (mirror P8-C for cross-phase consistency) ────────
 *   MAX_APPROVAL_BACKLOG_REF = 50
 *   MAX_DELAY_BACKLOG_REF    = 50
 *   MAX_STUCK_REF            = 20
 *   APPROVAL_AMPLIFIER       = 3.0
 *   DELAY_AMPLIFIER          = 3.0
 *
 * ── PER-BUCKET rWC FORMULA (mirrors P8-C weights exactly) ───────────────────
 *   rWC = min(100, round(
 *     structuralComplexity × 0.40    (max 40 - static structural baseline)
 *     + errorRate × 25               (max 25 - historical error rate)
 *     + approvalLatencyPressure × 20 (max 20 - approval backlog × density)
 *     + delayDurationPressure × 10   (max 10 - delay backlog × density)
 *     + failurePressure × 5          (max  5 - execution failure composite)
 *   ))
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *   trend-forecast.ts → logger.ts   (structured observability events)
 *   No imports from topology.ts or dependency.ts - engine is self-contained.
 */

import { logger } from "../logger";

// ── Normalization constants (mirroring P8-C) ──────────────────────────────────
const MAX_APPROVAL_BACKLOG_REF = 50;
const MAX_DELAY_BACKLOG_REF    = 50;
const MAX_STUCK_REF            = 20;
const APPROVAL_AMPLIFIER       = 3.0;
const DELAY_AMPLIFIER          = 3.0;

// ── P8-C rWC weights (exact mirror) ──────────────────────────────────────────
const W_STRUCTURAL   = 0.40;
const W_ERROR        = 25;
const W_APPROVAL_LAT = 20;
const W_DELAY_DUR    = 10;
const W_FAILURE      = 5;

// ── Trend classification thresholds ──────────────────────────────────────────
/** rWC slope (points/period) above which trend is "critically_degrading". */
const SLOPE_CRITICAL  = 2.0;
/** rWC slope above which trend is "degrading". */
const SLOPE_DEGRADING = 0.5;
/** rWC slope below which trend is "improving". */
const SLOPE_IMPROVING = -0.5;

// ── Confidence thresholds ────────────────────────────────────────────────────
const CONFIDENCE_LOW_MAX_N       = 3;
const CONFIDENCE_MODERATE_MAX_N  = 7;
const CONFIDENCE_HIGH_MIN_N      = 14;
const VOLATILITY_HIGH_THRESHOLD  = 20;   // rWC standard deviation (0-100 scale)
const WINDOW_LARGE_THRESHOLD     = 14;   // forecast window days

// ── Projection method selection ───────────────────────────────────────────────
const METHOD_NO_DATA             = "no_data";
const METHOD_LAST_KNOWN          = "last_known_value";
const METHOD_MOVING_AVERAGE      = "weighted_moving_average";
const METHOD_LINEAR_REGRESSION   = "weighted_linear_regression";
const MIN_N_FOR_REGRESSION       = 7;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One time-period bucket from governance_snapshot_rollups.
 * Array must be ordered oldest-first (index 0 = oldest bucket).
 * The caller (route handler) builds this from rollup rows.
 */
export interface ForecastDataPoint {
  /** Arithmetic mean of workflowErrorRate (0-1). */
  avgErrorRate:       number;
  /** Arithmetic mean of approvalBacklogCount (raw count). */
  avgApprovalBacklog: number;
  /** Arithmetic mean of delayBacklogCount (raw count). */
  avgDelayBacklog:    number;
  /** Arithmetic mean of stuckCount (raw count). */
  avgStuckCount:      number;
  /** Fraction of source snapshots with stormSeverity != 'none' (0-1). */
  stormFrequency:     number;
  /** Total source snapshot records in this bucket. */
  snapshotCount:      number;
}

export type TrendDirection  = "improving" | "stable" | "degrading" | "critically_degrading";
export type ForecastConfidence = "low" | "moderate" | "high";

/** Projection detail for a single numeric metric. */
export interface MetricProjection {
  /** Most recent data-point value. */
  currentValue:   number;
  /** Forecasted value at the end of the projection window. */
  projectedValue: number;
  /** Weighted slope (rate of change per period). */
  slope:          number;
  /** Standard deviation of the series (unweighted). */
  volatility:     number;
}

/** Full operational forecast result. */
export interface WorkflowOperationalForecast {
  /**
   * Projected runtimeWeightedComplexity at the end of the forecast window (0-100).
   * Uses P8-C weights applied to projected pressure metrics.
   */
  projectedComplexity:      number;
  /** Projected operational fragility (projectedComplexity / 100, 0-1). */
  projectedFragility:       number;
  /** Projected combined approval + delay backlog pressure (0-1). */
  projectedBacklogPressure: number;
  /** Projected storm risk (projected stormFrequency, 0-1). */
  projectedStormRisk:       number;
  /** Trend direction classification based on rWC slope. */
  trendDirection:           TrendDirection;
  /** Forecast confidence based on sample size, volatility, and window size. */
  confidenceLevel:          ForecastConfidence;
  /** Projection window used (days). */
  forecastWindowDays:       number;
  /** Name of the projection algorithm selected. */
  projectionMethod:         string;
  /** Per-metric projection details. */
  metrics: {
    errorRate:  MetricProjection;
    backlog:    MetricProjection;
    stormRisk:  MetricProjection;
    complexity: MetricProjection;
  };
}

/** Input bundle passed to computeWorkflowForecast. */
export interface ForecastInput {
  /** Time-ordered data points (oldest first, index 0). Must be non-mutated by caller. */
  dataPoints:           ForecastDataPoint[];
  /** Number of days ahead to project (default 7, max 90). */
  forecastWindowDays:   number;
  /** Static structural complexity from P8-B (0-100, fixed for the workflow definition). */
  structuralComplexity: number;
  /** Approval step density from P8-A (0-1). */
  approvalDensity:      number;
  /** Delay step density from P8-A (0-1). */
  delayDensity:         number;
}

/** Optional context for observability events. */
export interface ForecastContext {
  workflowId?:      number;
  workspaceId?:     number;
  workflowVersion?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Per-bucket normalized values used by the projection series. */
interface NormalizedPoint {
  errorRate:       number;   // 0-1
  backlogPressure: number;   // 0-1
  stormFrequency:  number;   // 0-1
  rWC:             number;   // 0-100 integer
}

/**
 * Apply P8-C normalization to a single ForecastDataPoint.
 * Mirrors the formula in operational-correlation.ts exactly so that
 * historical rWC values are consistent with live P8-C computations.
 */
function normalizePoint(
  dp: ForecastDataPoint,
  structuralComplexity: number,
  approvalDensity: number,
  delayDensity: number,
): NormalizedPoint {
  const normApproval = clamp(dp.avgApprovalBacklog / MAX_APPROVAL_BACKLOG_REF, 0, 1);
  const normDelay    = clamp(dp.avgDelayBacklog    / MAX_DELAY_BACKLOG_REF,    0, 1);
  const normStuck    = clamp(dp.avgStuckCount      / MAX_STUCK_REF,            0, 1);

  const alp = clamp(normApproval * approvalDensity * APPROVAL_AMPLIFIER, 0, 1);
  const ddp = clamp(normDelay    * delayDensity    * DELAY_AMPLIFIER,    0, 1);
  const fp  = clamp(dp.avgErrorRate * 0.7 + normStuck * 0.3,            0, 1);
  const bp  = clamp((normApproval + normDelay) / 2,                     0, 1);

  const rawRWC =
    structuralComplexity * W_STRUCTURAL +
    dp.avgErrorRate       * W_ERROR      +
    alp                   * W_APPROVAL_LAT +
    ddp                   * W_DELAY_DUR  +
    fp                    * W_FAILURE;

  return {
    errorRate:       clamp(dp.avgErrorRate, 0, 1),
    backlogPressure: bp,
    stormFrequency:  clamp(dp.stormFrequency, 0, 1),
    rWC:             Math.min(100, Math.round(rawRWC)),
  };
}

/** Compute weighted linear regression slope using triangular weights (recent = heavier). */
function computeWeightedSlope(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;

  let W = 0, muX = 0, muY = 0;
  for (let i = 0; i < n; i++) {
    const w = i + 1;
    W   += w;
    muX += w * i;
    muY += w * series[i];
  }
  muX /= W;
  muY /= W;

  let cov = 0, varX = 0;
  for (let i = 0; i < n; i++) {
    const w    = i + 1;
    const di   = i - muX;
    const dy   = series[i] - muY;
    cov  += w * di * dy;
    varX += w * di * di;
  }

  return varX > 1e-10 ? cov / varX : 0;
}

/** Compute unweighted standard deviation. */
function computeVolatility(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const mu       = series.reduce((a, v) => a + v, 0) / n;
  const variance = series.reduce((a, v) => a + (v - mu) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/**
 * Select the projection algorithm name based on number of data points.
 */
function getProjectionMethod(n: number): string {
  if (n === 0) return METHOD_NO_DATA;
  if (n === 1) return METHOD_LAST_KNOWN;
  if (n <  MIN_N_FOR_REGRESSION) return METHOD_MOVING_AVERAGE;
  return METHOD_LINEAR_REGRESSION;
}

/**
 * Project a single metric series forward by `windowDays` periods.
 * Formula: projected = series[n-1] + slope × windowDays, then clamped.
 */
function projectMetric(
  series:     number[],
  slope:      number,
  windowDays: number,
  lo:         number,
  hi:         number,
): number {
  if (series.length === 0) return lo;
  const projected = series[series.length - 1] + slope * windowDays;
  return Math.round(clamp(projected, lo, hi) * 1000) / 1000;
}

/** Build a MetricProjection from a series + slope + window. */
function buildProjection(
  series:     number[],
  slope:      number,
  windowDays: number,
  lo:         number,
  hi:         number,
): MetricProjection {
  return {
    currentValue:   series.length > 0
      ? Math.round(series[series.length - 1] * 1000) / 1000
      : lo,
    projectedValue: projectMetric(series, slope, windowDays, lo, hi),
    slope:          Math.round(slope * 10000) / 10000,
    volatility:     Math.round(computeVolatility(series) * 10000) / 10000,
  };
}

/** Classify trend direction from the rWC slope. */
function classifyTrendDirection(rWCSlope: number): TrendDirection {
  if (rWCSlope >= SLOPE_CRITICAL)  return "critically_degrading";
  if (rWCSlope >= SLOPE_DEGRADING) return "degrading";
  if (rWCSlope <= SLOPE_IMPROVING) return "improving";
  return "stable";
}

/**
 * Compute forecast confidence level.
 *
 * Base level from sample count:
 *   n < 3        → "low"
 *   3 ≤ n < 7    → "low"
 *   7 ≤ n < 14   → "moderate"
 *   n ≥ 14       → "high"
 *
 * Reductions (each reduces by one level, minimum "low"):
 *   rWC volatility > VOLATILITY_HIGH_THRESHOLD  → -1 level
 *   forecastWindowDays > WINDOW_LARGE_THRESHOLD  → -1 level
 */
function computeForecastConfidence(
  n:                  number,
  rWCVolatility:      number,
  forecastWindowDays: number,
): ForecastConfidence {
  // Levels: 0=low, 1=moderate, 2=high
  let level: number;
  if (n < CONFIDENCE_LOW_MAX_N) {
    level = 0;
  } else if (n < CONFIDENCE_MODERATE_MAX_N) {
    level = 0;
  } else if (n < CONFIDENCE_HIGH_MIN_N) {
    level = 1;
  } else {
    level = 2;
  }

  if (rWCVolatility > VOLATILITY_HIGH_THRESHOLD) level = Math.max(0, level - 1);
  if (forecastWindowDays > WINDOW_LARGE_THRESHOLD) level = Math.max(0, level - 1);

  return level >= 2 ? "high" : level >= 1 ? "moderate" : "low";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: computeWorkflowForecast  (single entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full deterministic forecast pipeline.
 *
 * Converts a time-ordered series of workspace governance rollup buckets
 * into a forward-looking operational forecast for the given workflow definition.
 *
 * Pure - no DB, no async, no side effects.
 * Never mutates the input array.
 * All projected values are bounded to their valid ranges.
 * Emits four structured observability events via logger.
 *
 * @param input   Forecast input including data points, window, and structural params
 * @param context Optional identifiers for observability events
 */
export function computeWorkflowForecast(
  input:   ForecastInput,
  context: ForecastContext = {},
): WorkflowOperationalForecast {
  const {
    dataPoints,
    forecastWindowDays,
    structuralComplexity,
    approvalDensity,
    delayDensity,
  } = input;

  const n                = dataPoints.length;
  const projectionMethod = getProjectionMethod(n);

  // ── No-data fast path ─────────────────────────────────────────────────────
  if (n === 0) {
    const noDataForecast: WorkflowOperationalForecast = {
      projectedComplexity:      structuralComplexity,
      projectedFragility:       Math.round(clamp(structuralComplexity / 100, 0, 1) * 1000) / 1000,
      projectedBacklogPressure: 0,
      projectedStormRisk:       0,
      trendDirection:           "stable",
      confidenceLevel:          "low",
      forecastWindowDays,
      projectionMethod,
      metrics: {
        errorRate:  { currentValue: 0, projectedValue: 0, slope: 0, volatility: 0 },
        backlog:    { currentValue: 0, projectedValue: 0, slope: 0, volatility: 0 },
        stormRisk:  { currentValue: 0, projectedValue: 0, slope: 0, volatility: 0 },
        complexity: {
          currentValue:   structuralComplexity,
          projectedValue: structuralComplexity,
          slope:          0,
          volatility:     0,
        },
      },
    };

    logger.info(
      {
        action: "workflow_forecast_computed",
        workflowId:  context.workflowId  ?? null,
        workspaceId: context.workspaceId ?? null,
        workflowVersion: context.workflowVersion ?? null,
        projectedComplexity:      noDataForecast.projectedComplexity,
        projectedFragility:       noDataForecast.projectedFragility,
        confidenceLevel:          "low",
        trendDirection:           "stable",
        projectionMethod,
        dataPointsUsed:           0,
        forecastWindowDays,
      },
      "[governance] P8-D: Workflow forecast computed (no data)",
    );

    return noDataForecast;
  }

  // ── Normalize all data points ─────────────────────────────────────────────
  const normalized: NormalizedPoint[] = dataPoints.map(dp =>
    normalizePoint(dp, structuralComplexity, approvalDensity, delayDensity),
  );

  // Build per-metric time series (oldest first)
  const errorSeries:   number[] = normalized.map(p => p.errorRate);
  const backlogSeries: number[] = normalized.map(p => p.backlogPressure);
  const stormSeries:   number[] = normalized.map(p => p.stormFrequency);
  const rWCSeries:     number[] = normalized.map(p => p.rWC);

  // ── Compute slopes ────────────────────────────────────────────────────────
  const errorSlope:   number = computeWeightedSlope(errorSeries);
  const backlogSlope: number = computeWeightedSlope(backlogSeries);
  const stormSlope:   number = computeWeightedSlope(stormSeries);
  const rWCSlope:     number = computeWeightedSlope(rWCSeries);

  // ── Compute volatility ────────────────────────────────────────────────────
  const rWCVolatility = computeVolatility(rWCSeries);

  // ── Classify trend and confidence ────────────────────────────────────────
  const trendDirection = classifyTrendDirection(rWCSlope);
  const confidenceLevel = computeForecastConfidence(n, rWCVolatility, forecastWindowDays);

  // ── Project metrics forward ───────────────────────────────────────────────
  const errorProjection   = buildProjection(errorSeries,   errorSlope,   forecastWindowDays, 0, 1);
  const backlogProjection = buildProjection(backlogSeries, backlogSlope, forecastWindowDays, 0, 1);
  const stormProjection   = buildProjection(stormSeries,   stormSlope,   forecastWindowDays, 0, 1);
  const complexityProjection = buildProjection(rWCSeries, rWCSlope, forecastWindowDays, 0, 100);

  // Final projections (bounded)
  const projectedComplexity      = Math.min(100, Math.max(0, Math.round(complexityProjection.projectedValue)));
  const projectedFragility       = Math.round(clamp(projectedComplexity / 100, 0, 1) * 1000) / 1000;
  const projectedBacklogPressure = clamp(backlogProjection.projectedValue, 0, 1);
  const projectedStormRisk       = clamp(stormProjection.projectedValue,   0, 1);

  const forecast: WorkflowOperationalForecast = {
    projectedComplexity,
    projectedFragility,
    projectedBacklogPressure,
    projectedStormRisk,
    trendDirection,
    confidenceLevel,
    forecastWindowDays,
    projectionMethod,
    metrics: {
      errorRate:  errorProjection,
      backlog:    backlogProjection,
      stormRisk:  stormProjection,
      complexity: {
        ...complexityProjection,
        projectedValue: projectedComplexity,
      },
    },
  };

  // ── Observability: workflow_forecast_computed ─────────────────────────────
  logger.info(
    {
      action:              "workflow_forecast_computed",
      workflowId:          context.workflowId      ?? null,
      workspaceId:         context.workspaceId     ?? null,
      workflowVersion:     context.workflowVersion ?? null,
      projectedComplexity,
      projectedFragility,
      confidenceLevel,
      trendDirection,
      projectionMethod,
      dataPointsUsed:      n,
      forecastWindowDays,
    },
    "[governance] P8-D: Workflow forecast computed",
  );

  // ── Observability: workflow_degradation_projection_detected ───────────────
  if (trendDirection === "degrading" || trendDirection === "critically_degrading") {
    logger.info(
      {
        action:              "workflow_degradation_projection_detected",
        workflowId:          context.workflowId      ?? null,
        workspaceId:         context.workspaceId     ?? null,
        workflowVersion:     context.workflowVersion ?? null,
        projectedComplexity,
        projectedFragility,
        confidenceLevel,
        trendDirection,
        rWCSlope:            Math.round(rWCSlope * 1000) / 1000,
        forecastWindowDays,
      },
      "[governance] P8-D: Workflow degradation projection detected",
    );
  }

  // ── Observability: workflow_forecast_confidence_reduced ───────────────────
  if (confidenceLevel !== "high") {
    logger.info(
      {
        action:              "workflow_forecast_confidence_reduced",
        workflowId:          context.workflowId      ?? null,
        workspaceId:         context.workspaceId     ?? null,
        workflowVersion:     context.workflowVersion ?? null,
        projectedComplexity,
        projectedFragility,
        confidenceLevel,
        trendDirection,
        dataPointsUsed:      n,
        rWCVolatility:       Math.round(rWCVolatility * 100) / 100,
        forecastWindowDays,
      },
      "[governance] P8-D: Workflow forecast confidence reduced",
    );
  }

  // ── Observability: workflow_hotspot_growth_detected ───────────────────────
  if (backlogSlope > 0.01 || stormSlope > 0.01) {
    logger.info(
      {
        action:              "workflow_hotspot_growth_detected",
        workflowId:          context.workflowId      ?? null,
        workspaceId:         context.workspaceId     ?? null,
        workflowVersion:     context.workflowVersion ?? null,
        projectedComplexity,
        projectedFragility,
        confidenceLevel,
        trendDirection,
        backlogSlope:        Math.round(backlogSlope * 10000) / 10000,
        stormSlope:          Math.round(stormSlope   * 10000) / 10000,
        projectedBacklogPressure,
        projectedStormRisk,
      },
      "[governance] P8-D: Workflow hotspot growth detected",
    );
  }

  return forecast;
}
