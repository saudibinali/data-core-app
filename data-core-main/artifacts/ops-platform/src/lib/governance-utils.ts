/**
 * @file   lib/governance-utils.ts
 * @phase  P6-E - Governance Dashboard & Operational Console Foundations
 *
 * Pure utility functions for the governance dashboard.
 * No React imports - safe to test in a node environment.
 */

// ── Severity ordering (lower = more severe) ───────────────────────────────────

export const SEVERITY_ORDER = {
  critical: 0,
  degraded: 1,
  warning:  2,
  healthy:  3,
  none:     4,
  info:     5,
} as const;

export type HealthSeverity = "healthy" | "warning" | "degraded" | "critical";
export type AlertSeverity  = "info" | "warning" | "critical";
export type StormSeverity  = "none" | "warning" | "critical";
export type StuckSeverity  = "warning" | "critical";

// ── Health severity color palette ─────────────────────────────────────────────

export interface SeverityPalette {
  bg:     string;
  text:   string;
  border: string;
  badge:  string;
  dot:    string;
}

export function healthSeverityPalette(severity: HealthSeverity | string): SeverityPalette {
  switch (severity) {
    case "critical": return {
      bg:     "bg-red-50 dark:bg-red-950/30",
      text:   "text-red-700 dark:text-red-400",
      border: "border-red-200 dark:border-red-800",
      badge:  "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
      dot:    "bg-red-500",
    };
    case "degraded": return {
      bg:     "bg-orange-50 dark:bg-orange-950/30",
      text:   "text-orange-700 dark:text-orange-400",
      border: "border-orange-200 dark:border-orange-800",
      badge:  "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300",
      dot:    "bg-orange-500",
    };
    case "warning": return {
      bg:     "bg-yellow-50 dark:bg-yellow-950/30",
      text:   "text-yellow-700 dark:text-yellow-400",
      border: "border-yellow-200 dark:border-yellow-800",
      badge:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300",
      dot:    "bg-yellow-500",
    };
    case "healthy":
    default: return {
      bg:     "bg-green-50 dark:bg-green-950/30",
      text:   "text-green-700 dark:text-green-400",
      border: "border-green-200 dark:border-green-800",
      badge:  "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
      dot:    "bg-green-500",
    };
  }
}

// ── Alert severity badge class ────────────────────────────────────────────────

export function alertSeverityBadge(severity: AlertSeverity | string): string {
  switch (severity) {
    case "critical": return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300";
    case "warning":  return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300";
    case "info":     return "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300";
    default:         return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
}

// ── Stuck severity badge class ────────────────────────────────────────────────

export function stuckSeverityBadge(severity: StuckSeverity | string): string {
  switch (severity) {
    case "critical": return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300";
    case "warning":  return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300";
    default:         return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
}

// ── Stuck reason label + color ────────────────────────────────────────────────

export function stuckReasonLabel(reason: string): string {
  switch (reason) {
    case "running_too_long": return "Running too long";
    case "approval_overdue": return "Approval overdue";
    case "delay_overdue":    return "Delay overdue";
    default:                 return reason.replace(/_/g, " ");
  }
}

export function stuckReasonBadge(reason: string): string {
  switch (reason) {
    case "running_too_long": return "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300";
    case "approval_overdue": return "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300";
    case "delay_overdue":    return "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300";
    default:                 return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
}

// ── Duration formatting ───────────────────────────────────────────────────────

/**
 * Format a milliseconds duration as a human-readable string.
 * e.g. 90_000 → "1m 30s", 3_700_000 → "1h 1m", 60_000 → "1m"
 * PURE.
 */
export function formatOverdueMs(ms: number): string {
  if (ms <= 0)         return "0s";
  if (ms < 60_000)     return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Stale data detection ──────────────────────────────────────────────────────

/**
 * Age in ms after which captured-at data is considered stale.
 * Default: 3 × the 30s polling interval = 90s, indicating at least 2 missed polls.
 */
export const STALE_THRESHOLD_MS = 90_000;

/**
 * Returns true when the captured-at ISO timestamp is older than STALE_THRESHOLD_MS.
 * PURE - injectable `now` for deterministic tests.
 */
export function isCapturedAtStale(capturedAt: string, now: Date = new Date()): boolean {
  const captured = new Date(capturedAt);
  if (isNaN(captured.getTime())) return true; // unparseable → treat as stale
  return now.getTime() - captured.getTime() > STALE_THRESHOLD_MS;
}

/**
 * Return a human-readable "N seconds ago" / "N minutes ago" string for capturedAt.
 * PURE - injectable `now`.
 */
export function capturedAtAge(capturedAt: string, now: Date = new Date()): string {
  const captured = new Date(capturedAt);
  if (isNaN(captured.getTime())) return "unknown";
  const ms = now.getTime() - captured.getTime();
  if (ms < 1_000)     return "just now";
  if (ms < 60_000)    return `${Math.floor(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

// ── Alert severity sorting ────────────────────────────────────────────────────

/**
 * Sort alerts by severity descending (critical first, info last).
 * Stable sort: preserves original order within same severity.
 * PURE - does not mutate the input array.
 */
export function sortAlertsBySeverity<T extends { severity?: string | null }>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => {
    const ao = SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] ?? 99;
    const bo = SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] ?? 99;
    return ao - bo;
  });
}

// ── Error rate utilities ──────────────────────────────────────────────────────

/**
 * Map a 0..1 error rate to a health severity.
 * PURE.
 */
export function errorRateToSeverity(rate: number): HealthSeverity {
  if (rate >= 0.5) return "critical";
  if (rate >= 0.2) return "degraded";
  if (rate >= 0.1) return "warning";
  return "healthy";
}

/**
 * Format a 0..1 rate as a percentage string with one decimal.
 * PURE.
 */
export function formatErrorRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ── Severity label ────────────────────────────────────────────────────────────

export function healthSeverityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "Critical";
    case "degraded": return "Degraded";
    case "warning":  return "Warning";
    case "healthy":  return "Healthy";
    default:         return severity;
  }
}

// ── Observability event construction ─────────────────────────────────────────

export type DashboardAction =
  | "governance_dashboard_loaded"
  | "governance_dashboard_refreshed"
  | "governance_alert_viewed"
  | "governance_stuck_table_viewed";

export interface DashboardObservabilityEvent {
  action:               DashboardAction;
  visibleAlertCount:    number;
  visibleStuckCount:    number;
  dashboardSeverity:    string;
}

/**
 * Construct a governance dashboard observability event payload.
 * PURE - no side effects, injectable for tests.
 */
export function buildDashboardEvent(
  action:            DashboardAction,
  alertCount:        number,
  stuckCount:        number,
  dashboardSeverity: string,
): DashboardObservabilityEvent {
  return {
    action,
    visibleAlertCount: Math.max(0, alertCount),
    visibleStuckCount: Math.max(0, stuckCount),
    dashboardSeverity,
  };
}
