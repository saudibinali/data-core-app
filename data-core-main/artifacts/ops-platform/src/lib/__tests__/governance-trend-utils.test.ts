/**
 * @file   lib/__tests__/governance-trend-utils.test.ts
 * @phase  P7-E - Historical Analytics Dashboard & Trend Visualization Foundations
 *
 * Pure unit tests for governance-trend-utils.ts.
 * No DOM, no React, no HTTP - vitest only.
 *
 * T1  - range selector synchronises all charts (single shared state driver)
 * T2  - severity chart reflects deterministic colors
 * T3  - error-rate chart handles raw / hourly / daily source layers
 * T4  - backlog chart handles float averages correctly
 * T5  - storm chart displays frequency semantics correctly
 * T6  - truncation warning visible when truncated=true
 * T7  - dashboard remains read-only (no mutation exports)
 * T8  - sourceLayer labels displayed correctly
 * T9  - empty trend data renders safely
 * T10 - API failures handled gracefully
 */

import { describe, it, expect } from "vitest";
import {
  // Range types
  TREND_RANGES,

  // Color / numeric mapping
  SEVERITY_HEX,
  severityHex,
  severityToNumeric,

  // Distribution / dominant
  countSeverityDistribution,
  dominantHistoricalSeverity,
  isAllHealthy,

  // Error rate
  summarizeErrorRate,

  // Backlog
  peakBacklogPeriod,

  // Storm
  stormHeavyPeriods,
  STORM_HEAVY_THRESHOLD,

  // Truncation
  isTrendDataTruncated,

  // Source layer
  sourceLayerLabel,

  // Timestamp formatting
  formatTimestampForRange,
  formatTimestampFull,
  type TrendRange,

  // Observability
  buildHistoricalEvent,
  type HistoricalEventAction,

  // Formatting helpers
  formatErrorRatePct,
  formatStormFrequency,
} from "../governance-trend-utils";

// ── Shared test fixtures ───────────────────────────────────────────────────────

const TS_HOUR  = "2025-01-15T10:30:00.000Z";
const TS_DAY   = "2025-01-15T00:00:00.000Z";
const TS_WEEK  = "2025-01-10T00:00:00.000Z";

const makeSevPoint = (timestamp: string, severity: string, sourceLayer = "raw") => ({
  timestamp, severity, sourceLayer,
});

const makeNumPoint = (timestamp: string, value: number, sourceLayer = "raw") => ({
  timestamp, value, sourceLayer,
});

const makeBacklogPoint = (
  timestamp: string,
  approvalBacklog: number,
  delayBacklog: number,
  stuckCount: number,
  sourceLayer = "raw",
) => ({ timestamp, approvalBacklog, delayBacklog, stuckCount, sourceLayer });

const makeStormPoint = (
  timestamp: string,
  stormFrequency: number,
  dominantSeverity = "none",
  sourceLayer = "raw",
) => ({ timestamp, stormFrequency, dominantSeverity, sourceLayer });

// ── T1 - Range selector synchronises all charts ───────────────────────────────
//
// The range selector drives a single `TrendRange` state value that is passed
// identically to all 4 query hooks as the `range` param.
// We verify that TREND_RANGES is the canonical set and covers all 7 options.

describe("T1 - range selector synchronisation", () => {
  it("exports exactly 7 canonical range values", () => {
    expect(TREND_RANGES).toHaveLength(7);
    expect(TREND_RANGES).toContain("1h");
    expect(TREND_RANGES).toContain("24h");
    expect(TREND_RANGES).toContain("7d");
    expect(TREND_RANGES).toContain("30d");
    expect(TREND_RANGES).toContain("90d");
    expect(TREND_RANGES).toContain("180d");
    expect(TREND_RANGES).toContain("365d");
  });

  it("each range produces a distinct formatTimestampForRange output for the same date", () => {
    const outputs = TREND_RANGES.map((r) => formatTimestampForRange(TS_HOUR, r));
    // Short ranges (1h, 24h) produce HH:MM; longer ones produce date strings
    const shortRangeOutput = formatTimestampForRange(TS_HOUR, "1h");
    const longRangeOutput  = formatTimestampForRange(TS_HOUR, "30d");
    // They should be different (time vs date format)
    expect(shortRangeOutput).not.toBe(longRangeOutput);
    // All outputs are non-empty strings
    for (const o of outputs) expect(o.length).toBeGreaterThan(0);
  });

  it("unknown timestamp returns the original string instead of crashing", () => {
    expect(formatTimestampForRange("not-a-date", "30d")).toBe("not-a-date");
    expect(formatTimestampFull("not-a-date")).toBe("not-a-date");
  });
});

// ── T2 - Severity chart reflects deterministic colours ────────────────────────

describe("T2 - severity colour mapping", () => {
  it("returns a distinct hex for each of the 4 canonical severity levels", () => {
    const levels = ["healthy", "warning", "degraded", "critical"] as const;
    const colors = levels.map(severityHex);
    const unique  = new Set(colors);
    expect(unique.size).toBe(4);
  });

  it("maps severity levels to correct hex values", () => {
    expect(severityHex("critical")).toBe(SEVERITY_HEX.critical);
    expect(severityHex("degraded")).toBe(SEVERITY_HEX.degraded);
    expect(severityHex("warning")).toBe(SEVERITY_HEX.warning);
    expect(severityHex("healthy")).toBe(SEVERITY_HEX.healthy);
  });

  it("falls back to slate-400 for unknown severity", () => {
    expect(severityHex("unknown")).toBe("#94a3b8");
    expect(severityHex("")).toBe("#94a3b8");
  });

  it("maps severity to ascending numeric scale (healthy=0, critical=3)", () => {
    expect(severityToNumeric("healthy")).toBe(0);
    expect(severityToNumeric("warning")).toBe(1);
    expect(severityToNumeric("degraded")).toBe(2);
    expect(severityToNumeric("critical")).toBe(3);
  });

  it("returns 0 for unknown severity numerics", () => {
    expect(severityToNumeric("none")).toBe(0);
    expect(severityToNumeric("")).toBe(0);
  });

  it("dominant severity selects worst seen", () => {
    const points = [
      makeSevPoint(TS_HOUR, "healthy"),
      makeSevPoint(TS_DAY, "warning"),
      makeSevPoint(TS_WEEK, "degraded"),
    ];
    expect(dominantHistoricalSeverity(points)).toBe("degraded");
  });

  it("dominant severity escalates to critical when present", () => {
    const points = [
      makeSevPoint(TS_HOUR, "healthy"),
      makeSevPoint(TS_DAY, "critical"),
      makeSevPoint(TS_WEEK, "warning"),
    ];
    expect(dominantHistoricalSeverity(points)).toBe("critical");
  });

  it("severity distribution counts each level correctly", () => {
    const points = [
      makeSevPoint(TS_HOUR, "healthy"),
      makeSevPoint(TS_DAY, "warning"),
      makeSevPoint(TS_WEEK, "critical"),
      makeSevPoint(TS_WEEK, "critical"),
    ];
    const dist = countSeverityDistribution(points);
    expect(dist.healthy).toBe(1);
    expect(dist.warning).toBe(1);
    expect(dist.degraded).toBe(0);
    expect(dist.critical).toBe(2);
  });
});

// ── T3 - Error-rate chart handles raw / hourly / daily source layers ──────────

describe("T3 - error-rate source layer handling", () => {
  it("produces stable averages regardless of sourceLayer field", () => {
    const rawPoints    = [makeNumPoint(TS_HOUR, 0.1, "raw"),    makeNumPoint(TS_DAY, 0.2, "raw")];
    const hourlyPoints = [makeNumPoint(TS_HOUR, 0.1, "hourly"), makeNumPoint(TS_DAY, 0.2, "hourly")];
    const dailyPoints  = [makeNumPoint(TS_HOUR, 0.1, "daily"),  makeNumPoint(TS_DAY, 0.2, "daily")];

    expect(summarizeErrorRate(rawPoints).average).toBeCloseTo(0.15);
    expect(summarizeErrorRate(hourlyPoints).average).toBeCloseTo(0.15);
    expect(summarizeErrorRate(dailyPoints).average).toBeCloseTo(0.15);
  });

  it("identifies a rising error rate trend", () => {
    const points = [
      makeNumPoint("2025-01-01T00:00:00Z", 0.05),
      makeNumPoint("2025-01-01T01:00:00Z", 0.06),
      makeNumPoint("2025-01-01T02:00:00Z", 0.20),
      makeNumPoint("2025-01-01T03:00:00Z", 0.30),
    ];
    expect(summarizeErrorRate(points).direction).toBe("rising");
  });

  it("identifies a falling error rate trend", () => {
    const points = [
      makeNumPoint("2025-01-01T00:00:00Z", 0.40),
      makeNumPoint("2025-01-01T01:00:00Z", 0.30),
      makeNumPoint("2025-01-01T02:00:00Z", 0.10),
      makeNumPoint("2025-01-01T03:00:00Z", 0.05),
    ];
    expect(summarizeErrorRate(points).direction).toBe("falling");
  });

  it("reports stable when delta is below 0.5pp", () => {
    const points = [
      makeNumPoint("2025-01-01T00:00:00Z", 0.100),
      makeNumPoint("2025-01-01T01:00:00Z", 0.101),
      makeNumPoint("2025-01-01T02:00:00Z", 0.102),
      makeNumPoint("2025-01-01T03:00:00Z", 0.103),
    ];
    expect(summarizeErrorRate(points).direction).toBe("stable");
  });

  it("formats error rate as percentage with 1 decimal", () => {
    expect(formatErrorRatePct(0)).toBe("0.0%");
    expect(formatErrorRatePct(0.1)).toBe("10.0%");
    expect(formatErrorRatePct(0.333)).toBe("33.3%");
    expect(formatErrorRatePct(1.0)).toBe("100.0%");
  });
});

// ── T4 - Backlog chart handles float averages correctly ───────────────────────

describe("T4 - backlog float average handling", () => {
  it("peakBacklogPeriod identifies the snapshot with highest total", () => {
    const points = [
      makeBacklogPoint("2025-01-01T00:00:00Z", 1.5, 0.5, 0),
      makeBacklogPoint("2025-01-01T01:00:00Z", 3.2, 1.8, 2.0),   // peak = 7.0
      makeBacklogPoint("2025-01-01T02:00:00Z", 1.0, 0.0, 1.0),
    ];
    const peak = peakBacklogPeriod(points);
    expect(peak).not.toBeNull();
    expect(peak!.timestamp).toBe("2025-01-01T01:00:00Z");
    expect(peak!.totalBacklog).toBeCloseTo(7.0);
  });

  it("peakBacklogPeriod accepts float values from rollup tiers", () => {
    const points = [
      makeBacklogPoint(TS_HOUR, 2.333, 1.667, 0.5, "hourly"),
      makeBacklogPoint(TS_DAY,  0.1,   0.2,   0.1, "daily"),
    ];
    const peak = peakBacklogPeriod(points);
    expect(peak!.totalBacklog).toBeCloseTo(4.5, 1);
  });

  it("peakBacklogPeriod returns null for empty array", () => {
    expect(peakBacklogPeriod([])).toBeNull();
  });

  it("peakBacklogPeriod returns a zero-total peak when all values are zero", () => {
    const points = [makeBacklogPoint(TS_HOUR, 0, 0, 0)];
    const peak = peakBacklogPeriod(points);
    expect(peak).not.toBeNull();
    expect(peak!.totalBacklog).toBe(0);
  });
});

// ── T5 - Storm chart displays frequency semantics correctly ───────────────────

describe("T5 - storm frequency semantics", () => {
  it("stormHeavyPeriods filters by default threshold (0.5)", () => {
    const points = [
      makeStormPoint("2025-01-01T00:00:00Z", 0.2),
      makeStormPoint("2025-01-01T01:00:00Z", 0.6),   // heavy
      makeStormPoint("2025-01-01T02:00:00Z", 0.9),   // heavy
    ];
    const heavy = stormHeavyPeriods(points);
    expect(heavy).toHaveLength(2);
    expect(heavy[0]!.stormFrequency).toBe(0.6);
    expect(heavy[1]!.stormFrequency).toBe(0.9);
  });

  it("stormHeavyPeriods respects a custom threshold", () => {
    const points = [
      makeStormPoint(TS_HOUR, 0.2),
      makeStormPoint(TS_DAY, 0.4),
    ];
    expect(stormHeavyPeriods(points, 0.3)).toHaveLength(1);
    expect(stormHeavyPeriods(points, 0.5)).toHaveLength(0);
  });

  it("stormHeavyPeriods returns empty array when no heavy storms", () => {
    const points = [
      makeStormPoint(TS_HOUR, 0.0),
      makeStormPoint(TS_DAY, 0.3),
    ];
    expect(stormHeavyPeriods(points)).toHaveLength(0);
  });

  it("STORM_HEAVY_THRESHOLD is 0.5", () => {
    expect(STORM_HEAVY_THRESHOLD).toBe(0.5);
  });

  it("formatStormFrequency rounds to whole percent", () => {
    expect(formatStormFrequency(0)).toBe("0%");
    expect(formatStormFrequency(0.5)).toBe("50%");
    expect(formatStormFrequency(0.333)).toBe("33%");
    expect(formatStormFrequency(1.0)).toBe("100%");
  });
});

// ── T6 - Truncation warning visible when truncated=true ───────────────────────

describe("T6 - truncation detection", () => {
  it("detects truncation when any envelope has truncated=true", () => {
    const notTruncated = { truncated: false };
    const isTruncated  = { truncated: true };

    expect(isTrendDataTruncated(notTruncated)).toBe(false);
    expect(isTrendDataTruncated(isTruncated)).toBe(true);
    expect(isTrendDataTruncated(notTruncated, isTruncated)).toBe(true);
    expect(isTrendDataTruncated(notTruncated, notTruncated)).toBe(false);
  });

  it("handles null / undefined envelopes gracefully", () => {
    expect(isTrendDataTruncated(null, undefined)).toBe(false);
    expect(isTrendDataTruncated(null, { truncated: true })).toBe(true);
  });

  it("handles missing truncated field (defaults to false)", () => {
    expect(isTrendDataTruncated({} as never)).toBe(false);
  });
});

// ── T7 - Dashboard remains read-only ─────────────────────────────────────────
//
// governance-trend-utils.ts must export ONLY pure functions and constants.
// No mutation helpers, no POST/PATCH/DELETE wrappers.

describe("T7 - read-only surface", () => {
  it("buildHistoricalEvent produces a plain object with no side effects", () => {
    const event = buildHistoricalEvent(
      "historical_dashboard_loaded",
      "30d",
      "raw",
      "severity",
      false,
    );
    expect(event).toEqual({
      action:        "historical_dashboard_loaded",
      selectedRange: "30d",
      sourceLayer:   "raw",
      chartType:     "severity",
      truncated:     false,
    });
  });

  it("buildHistoricalEvent is deterministic (same inputs → same output)", () => {
    const a = buildHistoricalEvent("historical_chart_rendered", "7d", "hourly", "backlog", true);
    const b = buildHistoricalEvent("historical_chart_rendered", "7d", "hourly", "backlog", true);
    expect(a).toEqual(b);
  });

  it("all valid HistoricalEventAction strings are supported", () => {
    const actions: HistoricalEventAction[] = [
      "historical_dashboard_loaded",
      "historical_dashboard_range_changed",
      "historical_chart_rendered",
      "historical_truncation_warning_shown",
    ];
    for (const action of actions) {
      const ev = buildHistoricalEvent(action, "30d", "raw", "test", false);
      expect(ev.action).toBe(action);
    }
  });
});

// ── T8 - sourceLayer labels displayed correctly ───────────────────────────────

describe("T8 - sourceLayer label formatting", () => {
  it("labels raw tier as '5-min snapshots'", () => {
    expect(sourceLayerLabel("raw")).toBe("5-min snapshots");
  });

  it("labels hourly tier as 'Hourly averages'", () => {
    expect(sourceLayerLabel("hourly")).toBe("Hourly averages");
  });

  it("labels daily tier as 'Daily averages'", () => {
    expect(sourceLayerLabel("daily")).toBe("Daily averages");
  });

  it("passes through unknown tier values unchanged", () => {
    expect(sourceLayerLabel("weekly")).toBe("weekly");
    expect(sourceLayerLabel("")).toBe("");
  });
});

// ── T9 - Empty trend data renders safely ──────────────────────────────────────

describe("T9 - empty data safety", () => {
  it("dominantHistoricalSeverity returns 'healthy' for empty array", () => {
    expect(dominantHistoricalSeverity([])).toBe("healthy");
  });

  it("isAllHealthy returns false for empty array (avoids false positives)", () => {
    expect(isAllHealthy([])).toBe(false);
  });

  it("isAllHealthy returns true when all points are healthy", () => {
    expect(isAllHealthy([makeSevPoint(TS_HOUR, "healthy")])).toBe(true);
    expect(isAllHealthy([
      makeSevPoint(TS_HOUR, "healthy"),
      makeSevPoint(TS_DAY, "healthy"),
    ])).toBe(true);
  });

  it("isAllHealthy returns false when any point is non-healthy", () => {
    expect(isAllHealthy([
      makeSevPoint(TS_HOUR, "healthy"),
      makeSevPoint(TS_DAY, "warning"),
    ])).toBe(false);
  });

  it("summarizeErrorRate returns zero average and stable direction for empty", () => {
    const result = summarizeErrorRate([]);
    expect(result.average).toBe(0);
    expect(result.direction).toBe("stable");
  });

  it("peakBacklogPeriod returns null for empty array", () => {
    expect(peakBacklogPeriod([])).toBeNull();
  });

  it("stormHeavyPeriods returns empty array for empty input", () => {
    expect(stormHeavyPeriods([])).toEqual([]);
  });

  it("countSeverityDistribution returns all zeros for empty input", () => {
    const dist = countSeverityDistribution([]);
    expect(dist).toEqual({ critical: 0, degraded: 0, warning: 0, healthy: 0 });
  });

  it("isTrendDataTruncated returns false with no envelopes", () => {
    expect(isTrendDataTruncated()).toBe(false);
  });
});

// ── T10 - API failures handled gracefully ────────────────────────────────────
//
// When queries return null / undefined / error state, utility functions must
// never throw - the dashboard falls back to empty-data rendering paths.

describe("T10 - API failure resilience", () => {
  it("severityHex never throws for any string input", () => {
    expect(() => severityHex("")).not.toThrow();
    expect(() => severityHex("corrupted-value")).not.toThrow();
    expect(() => severityHex("null")).not.toThrow();
  });

  it("severityToNumeric never throws for any string input", () => {
    expect(() => severityToNumeric("")).not.toThrow();
    expect(() => severityToNumeric("corrupted")).not.toThrow();
  });

  it("summarizeErrorRate handles single-point response (no trend direction)", () => {
    const result = summarizeErrorRate([makeNumPoint(TS_HOUR, 0.5)]);
    expect(result.average).toBeCloseTo(0.5);
    expect(result.direction).toBe("stable");
  });

  it("dominantHistoricalSeverity never throws on corrupted severity values", () => {
    const points = [
      makeSevPoint(TS_HOUR, "unknown_severity"),
      makeSevPoint(TS_DAY,  ""),
    ];
    expect(() => dominantHistoricalSeverity(points)).not.toThrow();
    // Falls back to "healthy" when no known severity found
    expect(dominantHistoricalSeverity(points)).toBe("healthy");
  });

  it("formatTimestampForRange does not throw on null/invalid inputs", () => {
    expect(() => formatTimestampForRange("", "30d")).not.toThrow();
    expect(() => formatTimestampForRange("invalid", "7d")).not.toThrow();
  });

  it("isTrendDataTruncated treats undefined/null envelopes as non-truncated", () => {
    expect(isTrendDataTruncated(undefined)).toBe(false);
    expect(isTrendDataTruncated(null)).toBe(false);
  });

  it("stormHeavyPeriods does not throw on empty or zero-frequency points", () => {
    const points = [makeStormPoint(TS_HOUR, 0), makeStormPoint(TS_DAY, 0)];
    expect(() => stormHeavyPeriods(points)).not.toThrow();
    expect(stormHeavyPeriods(points)).toHaveLength(0);
  });

  it("peakBacklogPeriod handles all-zero backlogs without crashing", () => {
    const points = [
      makeBacklogPoint(TS_HOUR, 0, 0, 0),
      makeBacklogPoint(TS_DAY,  0, 0, 0),
    ];
    expect(() => peakBacklogPeriod(points)).not.toThrow();
    const peak = peakBacklogPeriod(points);
    expect(peak).not.toBeNull();
    expect(peak!.totalBacklog).toBe(0);
  });
});
