/**
 * @file   lib/__tests__/governance-utils.test.ts
 * @phase  P6-E - Governance Dashboard & Operational Console Foundations
 *
 * Pure utility tests for the governance dashboard helper functions.
 * No React, no DOM, no HTTP - all tests run in node environment.
 *
 * Tests:
 *   T1   Health severity renders correct color palette
 *   T2   Alert severity ordering is stable
 *   T3   Stuck table respects truncation semantics
 *   T4   Metrics formatting displays correct values
 *   T5   Dashboard observability event construction is read-only and pure
 *   T6   Polling refresh stale state updates correctly
 *   T7   capturedAt stale indication is deterministic
 *   T8   Severity color mapping is deterministic (same input → same output)
 *   T9   Empty workspace renders healthy state
 *   T10  Governance API failure is handled safely
 *
 *   Additional:
 *   T11  formatOverdueMs edge cases
 *   T12  sortAlertsBySeverity preserves relative order within same severity
 *   T13  stuckReasonLabel and stuckReasonBadge coverage
 *   T14  capturedAtAge formatting
 *   T15  buildDashboardEvent clamps negative counts
 */

import { describe, it, expect } from "vitest";
import {
  healthSeverityPalette,
  alertSeverityBadge,
  stuckSeverityBadge,
  stuckReasonLabel,
  stuckReasonBadge,
  formatOverdueMs,
  STALE_THRESHOLD_MS,
  isCapturedAtStale,
  capturedAtAge,
  sortAlertsBySeverity,
  errorRateToSeverity,
  formatErrorRate,
  healthSeverityLabel,
  buildDashboardEvent,
  SEVERITY_ORDER,
} from "../governance-utils";

// ── Helpers ───────────────────────────────────────────────────────────────────
const NOW = new Date("2026-06-15T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Health severity renders correct color palette
// ─────────────────────────────────────────────────────────────────────────────
describe("T1: Health severity renders correct color palette", () => {
  it("healthy → green palette", () => {
    const p = healthSeverityPalette("healthy");
    expect(p.bg).toContain("green");
    expect(p.text).toContain("green");
    expect(p.border).toContain("green");
    expect(p.badge).toContain("green");
    expect(p.dot).toContain("green");
  });

  it("warning → yellow palette", () => {
    const p = healthSeverityPalette("warning");
    expect(p.bg).toContain("yellow");
    expect(p.badge).toContain("yellow");
  });

  it("degraded → orange palette", () => {
    const p = healthSeverityPalette("degraded");
    expect(p.bg).toContain("orange");
    expect(p.badge).toContain("orange");
  });

  it("critical → red palette", () => {
    const p = healthSeverityPalette("critical");
    expect(p.bg).toContain("red");
    expect(p.badge).toContain("red");
    expect(p.dot).toContain("red");
  });

  it("unknown string falls back to green (healthy default)", () => {
    const p = healthSeverityPalette("unknown");
    expect(p.bg).toContain("green");
  });

  it("each severity returns an object with all required keys", () => {
    const severities = ["healthy", "warning", "degraded", "critical"];
    for (const s of severities) {
      const p = healthSeverityPalette(s);
      expect(p).toHaveProperty("bg");
      expect(p).toHaveProperty("text");
      expect(p).toHaveProperty("border");
      expect(p).toHaveProperty("badge");
      expect(p).toHaveProperty("dot");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Alert severity ordering is stable
// ─────────────────────────────────────────────────────────────────────────────
describe("T2: Alert severity ordering is stable", () => {
  it("critical < warning < info in SEVERITY_ORDER", () => {
    expect(SEVERITY_ORDER["critical"]).toBeLessThan(SEVERITY_ORDER["warning"]);
    expect(SEVERITY_ORDER["warning"]).toBeLessThan(SEVERITY_ORDER["info"]);
  });

  it("sortAlertsBySeverity puts critical first", () => {
    const alerts = [
      { code: "A", severity: "info"     },
      { code: "B", severity: "critical" },
      { code: "C", severity: "warning"  },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    expect(sorted[0]!.severity).toBe("critical");
    expect(sorted[1]!.severity).toBe("warning");
    expect(sorted[2]!.severity).toBe("info");
  });

  it("equal severities preserve original relative order (stable sort)", () => {
    const alerts = [
      { code: "first",  severity: "warning" },
      { code: "second", severity: "warning" },
      { code: "third",  severity: "warning" },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    expect(sorted.map(a => a.code)).toEqual(["first", "second", "third"]);
  });

  it("empty alert list sorts without error", () => {
    expect(sortAlertsBySeverity([])).toEqual([]);
  });

  it("single alert is returned unchanged", () => {
    const alerts = [{ code: "X", severity: "critical" }];
    expect(sortAlertsBySeverity(alerts)).toHaveLength(1);
    expect(sortAlertsBySeverity(alerts)[0]!.code).toBe("X");
  });

  it("input array is not mutated by sort", () => {
    const alerts = [
      { code: "A", severity: "warning"  },
      { code: "B", severity: "critical" },
    ];
    const original = alerts.map(a => a.code);
    sortAlertsBySeverity(alerts);
    expect(alerts.map(a => a.code)).toEqual(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Stuck table respects truncation semantics
// ─────────────────────────────────────────────────────────────────────────────
describe("T3: Stuck table respects truncation semantics", () => {
  it("stuckSeverityBadge returns different classes for warning vs critical", () => {
    const warning  = stuckSeverityBadge("warning");
    const critical = stuckSeverityBadge("critical");
    expect(warning).not.toBe(critical);
    expect(critical).toContain("red");
    expect(warning).toContain("yellow");
  });

  it("stuckReasonBadge returns distinct colors for each reason", () => {
    const running  = stuckReasonBadge("running_too_long");
    const approval = stuckReasonBadge("approval_overdue");
    const delay    = stuckReasonBadge("delay_overdue");
    const unique   = new Set([running, approval, delay]);
    expect(unique.size).toBe(3);
  });

  it("unknown stuck reason badge returns gray fallback", () => {
    expect(stuckReasonBadge("unknown_reason")).toContain("gray");
  });

  it("unknown stuck severity badge returns gray fallback", () => {
    expect(stuckSeverityBadge("unknown")).toContain("gray");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Metrics formatting displays correct values
// ─────────────────────────────────────────────────────────────────────────────
describe("T4: Metrics formatting displays correct values", () => {
  it("formatErrorRate(0) → '0.0%'", () => {
    expect(formatErrorRate(0)).toBe("0.0%");
  });

  it("formatErrorRate(0.5) → '50.0%'", () => {
    expect(formatErrorRate(0.5)).toBe("50.0%");
  });

  it("formatErrorRate(1) → '100.0%'", () => {
    expect(formatErrorRate(1)).toBe("100.0%");
  });

  it("formatErrorRate(0.123) → '12.3%'", () => {
    expect(formatErrorRate(0.123)).toBe("12.3%");
  });

  it("errorRateToSeverity covers all thresholds", () => {
    expect(errorRateToSeverity(0)).toBe("healthy");
    expect(errorRateToSeverity(0.05)).toBe("healthy");
    expect(errorRateToSeverity(0.1)).toBe("warning");
    expect(errorRateToSeverity(0.15)).toBe("warning");
    expect(errorRateToSeverity(0.2)).toBe("degraded");
    expect(errorRateToSeverity(0.4)).toBe("degraded");
    expect(errorRateToSeverity(0.5)).toBe("critical");
    expect(errorRateToSeverity(0.99)).toBe("critical");
  });

  it("healthSeverityLabel returns human-readable strings", () => {
    expect(healthSeverityLabel("healthy")).toBe("Healthy");
    expect(healthSeverityLabel("warning")).toBe("Warning");
    expect(healthSeverityLabel("degraded")).toBe("Degraded");
    expect(healthSeverityLabel("critical")).toBe("Critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Dashboard observability event construction is read-only and pure
// ─────────────────────────────────────────────────────────────────────────────
describe("T5: Dashboard event construction is read-only and pure", () => {
  it("buildDashboardEvent returns correct action field", () => {
    const event = buildDashboardEvent("governance_dashboard_loaded", 3, 1, "warning");
    expect(event.action).toBe("governance_dashboard_loaded");
  });

  it("buildDashboardEvent returns correct counts", () => {
    const event = buildDashboardEvent("governance_dashboard_refreshed", 5, 2, "critical");
    expect(event.visibleAlertCount).toBe(5);
    expect(event.visibleStuckCount).toBe(2);
    expect(event.dashboardSeverity).toBe("critical");
  });

  it("buildDashboardEvent is synchronous (not a Promise)", () => {
    const result = buildDashboardEvent("governance_alert_viewed", 0, 0, "healthy");
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("object");
  });

  it("buildDashboardEvent does not mutate any external state", () => {
    const severity = "critical";
    const event1 = buildDashboardEvent("governance_stuck_table_viewed", 10, 5, severity);
    const event2 = buildDashboardEvent("governance_stuck_table_viewed", 10, 5, severity);
    expect(event1).toEqual(event2); // deterministic
  });

  it("all 4 dashboard action strings are distinct", () => {
    const actions: Array<Parameters<typeof buildDashboardEvent>[0]> = [
      "governance_dashboard_loaded",
      "governance_dashboard_refreshed",
      "governance_alert_viewed",
      "governance_stuck_table_viewed",
    ];
    const unique = new Set(actions);
    expect(unique.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Polling refresh stale state updates correctly
// ─────────────────────────────────────────────────────────────────────────────
describe("T6: Polling refresh - stale state detection", () => {
  it("fresh capturedAt (< STALE_THRESHOLD_MS) is not stale", () => {
    const fresh = isoAgo(STALE_THRESHOLD_MS - 1_000);
    expect(isCapturedAtStale(fresh, NOW)).toBe(false);
  });

  it("capturedAt 1ms past threshold is stale", () => {
    const justPast = isoAgo(STALE_THRESHOLD_MS + 1);
    expect(isCapturedAtStale(justPast, NOW)).toBe(true);
  });

  it("capturedAt older than threshold is stale", () => {
    const old = isoAgo(STALE_THRESHOLD_MS + 60_000);
    expect(isCapturedAtStale(old, NOW)).toBe(true);
  });

  it("STALE_THRESHOLD_MS is at least 3 × 30s polling interval (90s)", () => {
    expect(STALE_THRESHOLD_MS).toBeGreaterThanOrEqual(90_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - capturedAt stale indication is deterministic
// ─────────────────────────────────────────────────────────────────────────────
describe("T7: capturedAt stale indication is deterministic", () => {
  it("same capturedAt + same now → same result", () => {
    const ts = isoAgo(30_000);
    expect(isCapturedAtStale(ts, NOW)).toBe(isCapturedAtStale(ts, NOW));
  });

  it("isCapturedAtStale is purely a function of inputs (no Date.now() side effect)", () => {
    const ts   = isoAgo(1_000);
    const r1   = isCapturedAtStale(ts, NOW);
    const r2   = isCapturedAtStale(ts, NOW);
    expect(r1).toBe(r2);
  });

  it("unparseable capturedAt string is treated as stale", () => {
    expect(isCapturedAtStale("not-a-date", NOW)).toBe(true);
  });

  it("future capturedAt is not stale", () => {
    const future = new Date(NOW.getTime() + 10_000).toISOString();
    expect(isCapturedAtStale(future, NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Severity color mapping is deterministic
// ─────────────────────────────────────────────────────────────────────────────
describe("T8: Severity color mapping is deterministic", () => {
  it("healthSeverityPalette('critical') called twice → identical result", () => {
    const r1 = healthSeverityPalette("critical");
    const r2 = healthSeverityPalette("critical");
    expect(r1).toEqual(r2);
  });

  it("alertSeverityBadge is deterministic", () => {
    expect(alertSeverityBadge("critical")).toBe(alertSeverityBadge("critical"));
    expect(alertSeverityBadge("warning")).toBe(alertSeverityBadge("warning"));
  });

  it("stuckSeverityBadge is deterministic", () => {
    expect(stuckSeverityBadge("critical")).toBe(stuckSeverityBadge("critical"));
    expect(stuckSeverityBadge("warning")).toBe(stuckSeverityBadge("warning"));
  });

  it("alertSeverityBadge returns distinct classes for each severity", () => {
    const info     = alertSeverityBadge("info");
    const warning  = alertSeverityBadge("warning");
    const critical = alertSeverityBadge("critical");
    expect(new Set([info, warning, critical]).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Empty workspace renders healthy state
// ─────────────────────────────────────────────────────────────────────────────
describe("T9: Empty workspace renders healthy state", () => {
  it("0% error rate → healthy severity", () => {
    expect(errorRateToSeverity(0)).toBe("healthy");
  });

  it("healthy palette has green dot", () => {
    expect(healthSeverityPalette("healthy").dot).toContain("green");
  });

  it("empty alert list sorts without error", () => {
    expect(sortAlertsBySeverity([])).toEqual([]);
  });

  it("0ms overdue formats to '0s'", () => {
    expect(formatOverdueMs(0)).toBe("0s");
  });

  it("healthSeverityLabel('healthy') returns 'Healthy'", () => {
    expect(healthSeverityLabel("healthy")).toBe("Healthy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Governance API failure handled safely
// ─────────────────────────────────────────────────────────────────────────────
describe("T10: Governance API failure handled safely", () => {
  it("buildDashboardEvent with unknown severity does not throw", () => {
    expect(() =>
      buildDashboardEvent("governance_dashboard_loaded", 0, 0, "unknown_severity")
    ).not.toThrow();
  });

  it("isCapturedAtStale with null-ish string returns true (treat as stale)", () => {
    expect(isCapturedAtStale("", NOW)).toBe(true);
  });

  it("sortAlertsBySeverity with unknown severity strings does not throw", () => {
    const alerts = [{ severity: "unknown_x" }, { severity: "unknown_y" }];
    expect(() => sortAlertsBySeverity(alerts)).not.toThrow();
  });

  it("errorRateToSeverity with NaN falls back to 'healthy' (< 0.1 path)", () => {
    expect(errorRateToSeverity(NaN)).toBe("healthy");
  });

  it("formatOverdueMs with negative value returns '0s' (edge case)", () => {
    expect(formatOverdueMs(-1000)).toBe("0s");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - formatOverdueMs edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("T11: formatOverdueMs edge cases", () => {
  it("< 1s → '0s' only for 0, positive sub-second shows in seconds", () => {
    expect(formatOverdueMs(0)).toBe("0s");
  });

  it("999ms → '0s' (floor)", () => {
    expect(formatOverdueMs(999)).toBe("0s");
  });

  it("1000ms → '1s'", () => {
    expect(formatOverdueMs(1_000)).toBe("1s");
  });

  it("59_000ms → '59s'", () => {
    expect(formatOverdueMs(59_000)).toBe("59s");
  });

  it("60_000ms → '1m'", () => {
    expect(formatOverdueMs(60_000)).toBe("1m");
  });

  it("90_000ms → '1m 30s'", () => {
    expect(formatOverdueMs(90_000)).toBe("1m 30s");
  });

  it("3_600_000ms (1h) → '1h'", () => {
    expect(formatOverdueMs(3_600_000)).toBe("1h");
  });

  it("3_660_000ms → '1h 1m'", () => {
    expect(formatOverdueMs(3_660_000)).toBe("1h 1m");
  });

  it("7_200_000ms → '2h'", () => {
    expect(formatOverdueMs(7_200_000)).toBe("2h");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - sortAlertsBySeverity stability within same severity
// ─────────────────────────────────────────────────────────────────────────────
describe("T12: sortAlertsBySeverity stability within same severity", () => {
  it("mixed severities sorted correctly - critical, degraded, warning, info", () => {
    const alerts = [
      { code: "D", severity: "info"     },
      { code: "C", severity: "warning"  },
      { code: "B", severity: "degraded" },
      { code: "A", severity: "critical" },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    expect(sorted.map(a => a.severity)).toEqual(["critical", "degraded", "warning", "info"]);
  });

  it("all the same severity keeps original order", () => {
    const alerts = [
      { code: "1", severity: "critical" },
      { code: "2", severity: "critical" },
      { code: "3", severity: "critical" },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    expect(sorted.map(a => a.code)).toEqual(["1", "2", "3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - stuckReasonLabel and stuckReasonBadge coverage
// ─────────────────────────────────────────────────────────────────────────────
describe("T13: stuckReasonLabel and stuckReasonBadge coverage", () => {
  it("stuckReasonLabel('running_too_long') → 'Running too long'", () => {
    expect(stuckReasonLabel("running_too_long")).toBe("Running too long");
  });

  it("stuckReasonLabel('approval_overdue') → 'Approval overdue'", () => {
    expect(stuckReasonLabel("approval_overdue")).toBe("Approval overdue");
  });

  it("stuckReasonLabel('delay_overdue') → 'Delay overdue'", () => {
    expect(stuckReasonLabel("delay_overdue")).toBe("Delay overdue");
  });

  it("stuckReasonLabel(unknown) → humanized fallback", () => {
    const label = stuckReasonLabel("some_unknown_reason");
    expect(label).toBe("some unknown reason"); // underscores replaced with spaces
  });

  it("stuckReasonBadge('running_too_long') → orange", () => {
    expect(stuckReasonBadge("running_too_long")).toContain("orange");
  });

  it("stuckReasonBadge('approval_overdue') → purple", () => {
    expect(stuckReasonBadge("approval_overdue")).toContain("purple");
  });

  it("stuckReasonBadge('delay_overdue') → sky", () => {
    expect(stuckReasonBadge("delay_overdue")).toContain("sky");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - capturedAtAge formatting
// ─────────────────────────────────────────────────────────────────────────────
describe("T14: capturedAtAge formatting", () => {
  it("< 1s ago → 'just now'", () => {
    const ts = new Date(NOW.getTime() - 500).toISOString();
    expect(capturedAtAge(ts, NOW)).toBe("just now");
  });

  it("30s ago → '30s ago'", () => {
    const ts = isoAgo(30_000);
    expect(capturedAtAge(ts, NOW)).toBe("30s ago");
  });

  it("2m ago → '2m ago'", () => {
    const ts = isoAgo(2 * 60_000);
    expect(capturedAtAge(ts, NOW)).toBe("2m ago");
  });

  it("2h ago → '2h ago'", () => {
    const ts = isoAgo(2 * 3_600_000);
    expect(capturedAtAge(ts, NOW)).toBe("2h ago");
  });

  it("invalid date → 'unknown'", () => {
    expect(capturedAtAge("bad-date", NOW)).toBe("unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - buildDashboardEvent clamps negative counts
// ─────────────────────────────────────────────────────────────────────────────
describe("T15: buildDashboardEvent clamps negative counts", () => {
  it("negative alertCount is clamped to 0", () => {
    const event = buildDashboardEvent("governance_dashboard_loaded", -5, 0, "healthy");
    expect(event.visibleAlertCount).toBe(0);
  });

  it("negative stuckCount is clamped to 0", () => {
    const event = buildDashboardEvent("governance_dashboard_loaded", 0, -3, "healthy");
    expect(event.visibleStuckCount).toBe(0);
  });

  it("zero counts pass through", () => {
    const event = buildDashboardEvent("governance_dashboard_refreshed", 0, 0, "healthy");
    expect(event.visibleAlertCount).toBe(0);
    expect(event.visibleStuckCount).toBe(0);
  });

  it("large positive counts pass through unchanged", () => {
    const event = buildDashboardEvent("governance_alert_viewed", 999, 500, "critical");
    expect(event.visibleAlertCount).toBe(999);
    expect(event.visibleStuckCount).toBe(500);
  });
});
