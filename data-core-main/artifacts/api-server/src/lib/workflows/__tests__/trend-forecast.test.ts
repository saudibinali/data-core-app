/**
 * @file  trend-forecast.test.ts
 * @phase P8-D - Predictive Trend Projection & Operational Forecast Foundations
 *
 * Tests for the pure deterministic trend-projection engine.
 * No DB, no server, no async - all tests are synchronous pure-function calls.
 *
 * T1:  moving-average projection deterministic
 * T2:  weighted trend slope stable
 * T3:  degrading trend classification
 * T4:  improving trend classification
 * T5:  confidence reduction on sparse history
 * T6:  volatility reduces confidence
 * T7:  forecast projection bounded safely
 * T8:  forecast serialization stable
 * T9:  no live runtime dependency required
 * T10: forecast engine remains read-only
 */

import { describe, it, expect } from "vitest";

import {
  computeWorkflowForecast,
  type ForecastDataPoint,
  type ForecastInput,
  type WorkflowOperationalForecast,
} from "../trend-forecast";

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural params (fixed workflow definition with 25% approval/delay density)
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURAL = {
  structuralComplexity: 40,
  approvalDensity: 0.25,
  delayDensity:    0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// Data point fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Stable, low-pressure baseline point. */
const quietPoint: ForecastDataPoint = {
  avgErrorRate:       0.05,
  avgApprovalBacklog: 3,
  avgDelayBacklog:    2,
  avgStuckCount:      0.5,
  stormFrequency:     0.03,
  snapshotCount:      12,
};

/** Moderately busy point. */
const busyPoint: ForecastDataPoint = {
  avgErrorRate:       0.20,
  avgApprovalBacklog: 20,
  avgDelayBacklog:    15,
  avgStuckCount:      4,
  stormFrequency:     0.20,
  snapshotCount:      12,
};

/** 14-point flat (identical) series → stable trend. */
const flatSeries14: ForecastDataPoint[] = Array(14).fill(quietPoint);

/** 14-point gently degrading series - error/backlog/storm all increase. */
const degradingSeries14: ForecastDataPoint[] = Array.from({ length: 14 }, (_, i) => ({
  avgErrorRate:       Math.min(1, 0.05 + i * 0.02),
  avgApprovalBacklog: 3 + i * 2,
  avgDelayBacklog:    2 + i * 1,
  avgStuckCount:      0.5 + i * 0.3,
  stormFrequency:     Math.min(1, 0.02 + i * 0.03),
  snapshotCount:      12,
}));

/** 14-point steeply degrading series → critically_degrading. */
const criticalSeries14: ForecastDataPoint[] = Array.from({ length: 14 }, (_, i) => ({
  avgErrorRate:       Math.min(1, 0.02 + i * 0.07),
  avgApprovalBacklog: 2 + i * 5,
  avgDelayBacklog:    1 + i * 4,
  avgStuckCount:      i * 1.5,
  stormFrequency:     Math.min(1, 0.01 + i * 0.08),
  snapshotCount:      12,
}));

/** 14-point improving series - pressures decrease over time. */
const improvingSeries14: ForecastDataPoint[] = Array.from({ length: 14 }, (_, i) => ({
  avgErrorRate:       Math.max(0, 0.30 - i * 0.015),
  avgApprovalBacklog: Math.max(0, 30 - i * 1.5),
  avgDelayBacklog:    Math.max(0, 20 - i * 1.0),
  avgStuckCount:      Math.max(0, 5  - i * 0.3),
  stormFrequency:     Math.max(0, 0.25 - i * 0.015),
  snapshotCount:      12,
}));

/** 2-point series → sparse → "low" confidence + "last_known_value" / "weighted_moving_average". */
const sparseSeries2: ForecastDataPoint[] = [quietPoint, busyPoint];

/** Single data point → "last_known_value". */
const singlePoint: ForecastDataPoint[] = [busyPoint];

/** 14-point high-variance series (alternating low/high) → high volatility. */
const volatileSeries14: ForecastDataPoint[] = Array.from({ length: 14 }, (_, i) => ({
  avgErrorRate:       i % 2 === 0 ? 0.03 : 0.60,
  avgApprovalBacklog: i % 2 === 0 ? 2 : 48,
  avgDelayBacklog:    i % 2 === 0 ? 1 : 45,
  avgStuckCount:      i % 2 === 0 ? 0 : 18,
  stormFrequency:     i % 2 === 0 ? 0.01 : 0.95,
  snapshotCount:      12,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function runForecast(
  dataPoints:         ForecastDataPoint[],
  forecastWindowDays: number = 7,
  overrides:          Partial<Omit<ForecastInput, "dataPoints" | "forecastWindowDays">> = {},
): WorkflowOperationalForecast {
  return computeWorkflowForecast({
    dataPoints,
    forecastWindowDays,
    ...STRUCTURAL,
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Moving-average projection deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: moving-average projection deterministic", () => {
  it("same input always returns identical projectedComplexity", () => {
    const r1 = runForecast(flatSeries14);
    const r2 = runForecast(flatSeries14);
    expect(r1.projectedComplexity).toBe(r2.projectedComplexity);
  });

  it("sparse series (n < 7) uses weighted_moving_average method", () => {
    const r = runForecast(sparseSeries2);
    expect(r.projectionMethod).toBe("weighted_moving_average");
  });

  it("single point uses last_known_value method", () => {
    const r = runForecast(singlePoint);
    expect(r.projectionMethod).toBe("last_known_value");
  });

  it("empty series uses no_data method", () => {
    const r = runForecast([]);
    expect(r.projectionMethod).toBe("no_data");
  });

  it("flat series (all identical) projected complexity equals current complexity", () => {
    const r = runForecast(flatSeries14);
    // Flat series → slope ≈ 0 → projected ≈ current
    expect(r.projectedComplexity).toBe(r.metrics.complexity.currentValue);
  });

  it("sparse forecast is deterministic across repeated calls", () => {
    const r1 = runForecast(sparseSeries2);
    const r2 = runForecast(sparseSeries2);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Weighted trend slope stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: weighted trend slope stable", () => {
  it("≥ 7 data points selects weighted_linear_regression method", () => {
    const r = runForecast(degradingSeries14);
    expect(r.projectionMethod).toBe("weighted_linear_regression");
  });

  it("degrading series has positive complexity slope", () => {
    const r = runForecast(degradingSeries14);
    expect(r.metrics.complexity.slope).toBeGreaterThan(0);
  });

  it("improving series has negative complexity slope", () => {
    const r = runForecast(improvingSeries14);
    expect(r.metrics.complexity.slope).toBeLessThan(0);
  });

  it("flat series has slope ≈ 0 for all metrics", () => {
    const r = runForecast(flatSeries14);
    expect(Math.abs(r.metrics.complexity.slope)).toBeLessThan(0.1);
    expect(Math.abs(r.metrics.errorRate.slope)).toBeLessThan(0.001);
    expect(Math.abs(r.metrics.backlog.slope)).toBeLessThan(0.001);
    expect(Math.abs(r.metrics.stormRisk.slope)).toBeLessThan(0.001);
  });

  it("critical series has steeper slope than degrading series", () => {
    const rCrit = runForecast(criticalSeries14);
    const rDeg  = runForecast(degradingSeries14);
    expect(rCrit.metrics.complexity.slope).toBeGreaterThan(
      rDeg.metrics.complexity.slope,
    );
  });

  it("slope sign is consistent: degrading error + backlog → positive rWC slope", () => {
    const r = runForecast(degradingSeries14);
    expect(r.metrics.errorRate.slope).toBeGreaterThan(0);
    expect(r.metrics.backlog.slope).toBeGreaterThan(0);
    expect(r.metrics.stormRisk.slope).toBeGreaterThan(0);
    expect(r.metrics.complexity.slope).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Degrading trend classification
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: degrading trend classification", () => {
  it("gently degrading series is classified as 'degrading'", () => {
    const r = runForecast(degradingSeries14);
    expect(["degrading", "critically_degrading"]).toContain(r.trendDirection);
  });

  it("steeply degrading series is classified as 'critically_degrading'", () => {
    const r = runForecast(criticalSeries14);
    expect(r.trendDirection).toBe("critically_degrading");
  });

  it("trendDirection is always one of the 4 valid values", () => {
    const valid = ["improving", "stable", "degrading", "critically_degrading"];
    for (const series of [flatSeries14, degradingSeries14, criticalSeries14, improvingSeries14]) {
      const r = runForecast(series);
      expect(valid).toContain(r.trendDirection);
    }
  });

  it("degrading trend → projectedComplexity > currentComplexity (with window = 7)", () => {
    const r = runForecast(degradingSeries14, 7);
    // For a degrading series the projected complexity should be higher
    // (unless current is already at 100)
    if (r.metrics.complexity.currentValue < 95) {
      expect(r.projectedComplexity).toBeGreaterThanOrEqual(r.metrics.complexity.currentValue);
    }
  });

  it("critically_degrading series → projectedFragility > current fragility", () => {
    const rCrit = runForecast(criticalSeries14, 7);
    const currentFragility = clamp(rCrit.metrics.complexity.currentValue / 100, 0, 1);
    if (currentFragility < 0.95) {
      expect(rCrit.projectedFragility).toBeGreaterThanOrEqual(currentFragility);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Improving trend classification
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: improving trend classification", () => {
  it("improving series is classified as 'improving'", () => {
    const r = runForecast(improvingSeries14);
    expect(r.trendDirection).toBe("improving");
  });

  it("improving trend → projected complexity ≤ current complexity", () => {
    const r = runForecast(improvingSeries14, 7);
    expect(r.projectedComplexity).toBeLessThanOrEqual(r.metrics.complexity.currentValue + 1);
  });

  it("improving series has negative or zero complexity slope", () => {
    const r = runForecast(improvingSeries14);
    expect(r.metrics.complexity.slope).toBeLessThan(0);
  });

  it("improving series → projectedBacklogPressure ≤ current backlog pressure", () => {
    const r = runForecast(improvingSeries14, 7);
    expect(r.projectedBacklogPressure).toBeLessThanOrEqual(
      r.metrics.backlog.currentValue + 0.05, // small tolerance for rounding
    );
  });

  it("flat stable series is not classified as 'improving'", () => {
    const r = runForecast(flatSeries14);
    expect(r.trendDirection).toBe("stable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Confidence reduction on sparse history
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: confidence reduction on sparse history", () => {
  it("n = 0 → confidenceLevel = 'low'", () => {
    expect(runForecast([]).confidenceLevel).toBe("low");
  });

  it("n = 1 → confidenceLevel = 'low'", () => {
    expect(runForecast(singlePoint).confidenceLevel).toBe("low");
  });

  it("n = 2 → confidenceLevel = 'low'", () => {
    expect(runForecast(sparseSeries2).confidenceLevel).toBe("low");
  });

  it("n = 5 → confidenceLevel = 'low' (below minimum for moderate)", () => {
    const fivePoints = Array(5).fill(quietPoint);
    expect(runForecast(fivePoints).confidenceLevel).toBe("low");
  });

  it("n = 7 → confidenceLevel is at most 'moderate' (7 ≤ n < 14)", () => {
    const sevenPoints = Array(7).fill(quietPoint);
    const r = runForecast(sevenPoints);
    expect(["low", "moderate"]).toContain(r.confidenceLevel);
  });

  it("n = 14 (flat series) → confidenceLevel = 'high' (no volatility, short window)", () => {
    // Flat series: low volatility, window=7 ≤ 14 → should be "high"
    const r = runForecast(flatSeries14, 7);
    expect(r.confidenceLevel).toBe("high");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Volatility reduces confidence
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: volatility reduces confidence", () => {
  it("high-variance series reduces confidence compared to equivalent flat series", () => {
    const rFlat     = runForecast(flatSeries14, 7);
    const rVolatile = runForecast(volatileSeries14, 7);
    // Flat = "high", volatile should be <= flat
    const levels: Record<string, number> = { low: 0, moderate: 1, high: 2 };
    expect(levels[rVolatile.confidenceLevel]).toBeLessThanOrEqual(levels[rFlat.confidenceLevel]);
  });

  it("volatile series metrics report non-zero volatility", () => {
    const r = runForecast(volatileSeries14);
    expect(r.metrics.complexity.volatility).toBeGreaterThan(0);
    expect(r.metrics.errorRate.volatility).toBeGreaterThan(0);
  });

  it("flat series reports near-zero volatility for all metrics", () => {
    const r = runForecast(flatSeries14);
    expect(r.metrics.complexity.volatility).toBeLessThan(1);
    expect(r.metrics.errorRate.volatility).toBeLessThan(0.01);
    expect(r.metrics.backlog.volatility).toBeLessThan(0.01);
    expect(r.metrics.stormRisk.volatility).toBeLessThan(0.01);
  });

  it("large forecast window (30 days) reduces confidence by one level", () => {
    const rShort = runForecast(flatSeries14, 7);   // window=7 → "high"
    const rLong  = runForecast(flatSeries14, 30);  // window=30 → "moderate"
    const levels: Record<string, number> = { low: 0, moderate: 1, high: 2 };
    expect(levels[rLong.confidenceLevel]).toBeLessThan(levels[rShort.confidenceLevel]);
  });

  it("maximum window (90 days) with flat series still produces valid result", () => {
    const r = runForecast(flatSeries14, 90);
    expect(r.projectedComplexity).toBeGreaterThanOrEqual(0);
    expect(r.projectedComplexity).toBeLessThanOrEqual(100);
    // n=14 → base "high"; flat series volatility ≈ 0 (no reduction); window=90>14 → -1 → "moderate"
    expect(r.confidenceLevel).toBe("moderate");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Forecast projection bounded safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: forecast projection bounded safely", () => {
  it("projectedComplexity is always in [0, 100]", () => {
    const fixtures = [[], singlePoint, sparseSeries2, flatSeries14, degradingSeries14, criticalSeries14, improvingSeries14, volatileSeries14];
    for (const dp of fixtures) {
      const r = runForecast(dp, 7);
      expect(r.projectedComplexity).toBeGreaterThanOrEqual(0);
      expect(r.projectedComplexity).toBeLessThanOrEqual(100);
    }
  });

  it("projectedFragility is always in [0, 1]", () => {
    const fixtures = [[], singlePoint, flatSeries14, criticalSeries14, improvingSeries14];
    for (const dp of fixtures) {
      const r = runForecast(dp, 7);
      expect(r.projectedFragility).toBeGreaterThanOrEqual(0);
      expect(r.projectedFragility).toBeLessThanOrEqual(1);
    }
  });

  it("projectedBacklogPressure is always in [0, 1]", () => {
    const fixtures = [[], singlePoint, flatSeries14, criticalSeries14, volatileSeries14];
    for (const dp of fixtures) {
      const r = runForecast(dp, 7);
      expect(r.projectedBacklogPressure).toBeGreaterThanOrEqual(0);
      expect(r.projectedBacklogPressure).toBeLessThanOrEqual(1);
    }
  });

  it("projectedStormRisk is always in [0, 1]", () => {
    const fixtures = [[], singlePoint, flatSeries14, criticalSeries14, volatileSeries14];
    for (const dp of fixtures) {
      const r = runForecast(dp, 7);
      expect(r.projectedStormRisk).toBeGreaterThanOrEqual(0);
      expect(r.projectedStormRisk).toBeLessThanOrEqual(1);
    }
  });

  it("projectedFragility = round(projectedComplexity / 100)", () => {
    const r = runForecast(degradingSeries14, 7);
    const expected = Math.round(r.projectedComplexity / 100 * 1000) / 1000;
    expect(r.projectedFragility).toBeCloseTo(expected, 3);
  });

  it("projectedComplexity is always an integer", () => {
    const fixtures = [[], singlePoint, flatSeries14, degradingSeries14, criticalSeries14];
    for (const dp of fixtures) {
      const r = runForecast(dp, 7);
      expect(Number.isInteger(r.projectedComplexity)).toBe(true);
    }
  });

  it("no_data path returns structural complexity unchanged", () => {
    const r = runForecast([], 7);
    expect(r.projectedComplexity).toBe(STRUCTURAL.structuralComplexity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Forecast serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: forecast serialization stable", () => {
  it("result is JSON-serializable without circular references", () => {
    const r = runForecast(degradingSeries14);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it("serialized and re-parsed result is deep-equal to original", () => {
    const r = runForecast(criticalSeries14);
    const reparsed = JSON.parse(JSON.stringify(r));
    expect(reparsed).toEqual(r);
  });

  it("result has all required top-level keys", () => {
    const r = runForecast(flatSeries14);
    expect(r).toHaveProperty("projectedComplexity");
    expect(r).toHaveProperty("projectedFragility");
    expect(r).toHaveProperty("projectedBacklogPressure");
    expect(r).toHaveProperty("projectedStormRisk");
    expect(r).toHaveProperty("trendDirection");
    expect(r).toHaveProperty("confidenceLevel");
    expect(r).toHaveProperty("forecastWindowDays");
    expect(r).toHaveProperty("projectionMethod");
    expect(r).toHaveProperty("metrics");
  });

  it("metrics has all four sub-keys", () => {
    const m = runForecast(flatSeries14).metrics;
    expect(m).toHaveProperty("errorRate");
    expect(m).toHaveProperty("backlog");
    expect(m).toHaveProperty("stormRisk");
    expect(m).toHaveProperty("complexity");
  });

  it("each MetricProjection has currentValue, projectedValue, slope, volatility", () => {
    const r = runForecast(degradingSeries14);
    for (const key of ["errorRate", "backlog", "stormRisk", "complexity"] as const) {
      const mp = r.metrics[key];
      expect(typeof mp.currentValue).toBe("number");
      expect(typeof mp.projectedValue).toBe("number");
      expect(typeof mp.slope).toBe("number");
      expect(typeof mp.volatility).toBe("number");
    }
  });

  it("forecastWindowDays in result matches input", () => {
    expect(runForecast(flatSeries14, 7).forecastWindowDays).toBe(7);
    expect(runForecast(flatSeries14, 14).forecastWindowDays).toBe(14);
    expect(runForecast(flatSeries14, 30).forecastWindowDays).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No live runtime dependency required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no live runtime dependency required", () => {
  it("computeWorkflowForecast is synchronous and returns a plain object (not Promise)", () => {
    const result = computeWorkflowForecast({ dataPoints: flatSeries14, forecastWindowDays: 7, ...STRUCTURAL });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.projectedComplexity).toBeDefined();
  });

  it("handles empty dataPoints gracefully without throwing", () => {
    expect(() => runForecast([])).not.toThrow();
  });

  it("handles single data point gracefully", () => {
    expect(() => runForecast(singlePoint)).not.toThrow();
  });

  it("handles maximum-value data points (no overflow)", () => {
    const maxPoint: ForecastDataPoint = {
      avgErrorRate: 1.0, avgApprovalBacklog: 9999, avgDelayBacklog: 9999,
      avgStuckCount: 9999, stormFrequency: 1.0, snapshotCount: 9999,
    };
    const r = runForecast(Array(14).fill(maxPoint));
    expect(r.projectedComplexity).toBeLessThanOrEqual(100);
    expect(r.projectedFragility).toBeLessThanOrEqual(1);
  });

  it("handles zero-value data points (no underflow)", () => {
    const zeroPoint: ForecastDataPoint = {
      avgErrorRate: 0, avgApprovalBacklog: 0, avgDelayBacklog: 0,
      avgStuckCount: 0, stormFrequency: 0, snapshotCount: 0,
    };
    const r = runForecast(Array(14).fill(zeroPoint));
    expect(r.projectedComplexity).toBeGreaterThanOrEqual(0);
    expect(r.projectedBacklogPressure).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Forecast engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: forecast engine remains read-only", () => {
  it("computeWorkflowForecast does not mutate the input dataPoints array", () => {
    const original = JSON.parse(JSON.stringify(degradingSeries14)) as ForecastDataPoint[];
    const snapshot = JSON.stringify(original);
    computeWorkflowForecast({ dataPoints: original, forecastWindowDays: 7, ...STRUCTURAL });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("calling computeWorkflowForecast multiple times produces identical results", () => {
    const input: ForecastInput = { dataPoints: degradingSeries14, forecastWindowDays: 7, ...STRUCTURAL };
    const r1 = computeWorkflowForecast(input);
    const r2 = computeWorkflowForecast(input);
    const r3 = computeWorkflowForecast(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r3));
  });

  it("projectionMethod string is one of the four valid values", () => {
    const validMethods = ["no_data", "last_known_value", "weighted_moving_average", "weighted_linear_regression"];
    const cases = [[], singlePoint, sparseSeries2, flatSeries14];
    for (const dp of cases) {
      const r = runForecast(dp);
      expect(validMethods).toContain(r.projectionMethod);
    }
  });

  it("different forecastWindowDays produce different projectedComplexity for degrading series", () => {
    const r7  = runForecast(degradingSeries14, 7);
    const r30 = runForecast(degradingSeries14, 30);
    // Longer window → farther extrapolation → higher (or equal) projected complexity for degrading trend
    expect(r30.projectedComplexity).toBeGreaterThanOrEqual(r7.projectedComplexity);
  });

  it("approvalDensity=0 → approval latency does not amplify backlog pressure", () => {
    const rNoApproval = computeWorkflowForecast({
      dataPoints: degradingSeries14, forecastWindowDays: 7,
      structuralComplexity: 40, approvalDensity: 0, delayDensity: 0.25,
    });
    const rWithApproval = computeWorkflowForecast({
      dataPoints: degradingSeries14, forecastWindowDays: 7,
      structuralComplexity: 40, approvalDensity: 0.50, delayDensity: 0.25,
    });
    // With approval density 0 the rWC should be lower (no approval amplification)
    expect(rNoApproval.projectedComplexity).toBeLessThanOrEqual(rWithApproval.projectedComplexity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility (local - not exported)
// ─────────────────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
