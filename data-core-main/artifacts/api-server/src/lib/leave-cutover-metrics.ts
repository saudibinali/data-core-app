/**
 * P18-D4 — In-process counters for leave cutover monitoring (minimal hooks).
 */

type CounterMap = Record<string, number>;

const counters: CounterMap = {
  canonical_submit_total: 0,
  canonical_submit_conflict: 0,
  canonical_approve_total: 0,
  canonical_reject_total: 0,
  legacy_submit_blocked_410: 0,
  legacy_patch_blocked_410: 0,
  overlap_legacy_hit: 0,
  overlap_canonical_hit: 0,
  balance_reconciliation_failure: 0,
};

export function incrementLeaveMetric(
  key: keyof typeof counters,
  by = 1,
): void {
  counters[key] = (counters[key] ?? 0) + by;
}

export function getLeaveCutoverMetrics(): Readonly<CounterMap> {
  return { ...counters };
}

export function resetLeaveCutoverMetrics(): void {
  for (const k of Object.keys(counters)) counters[k] = 0;
}
