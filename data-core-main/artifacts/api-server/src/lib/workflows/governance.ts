/**
 * @file   governance.ts
 * @phase  P6-C - Operational Governance & Platform Monitoring Foundations
 *
 * Deterministic operational governance model for the workflow platform.
 * Converts raw runtime execution data into structured operational visibility:
 * tenant health snapshots, stuck execution detection, automation storm
 * detection, and governance alerts.
 *
 * ── ARCHITECTURE ─────────────────────────────────────────────────────────────
 *
 *   Two-layer design (mirrors P6-B simulation engine):
 *
 *   Layer 1 - Pure model functions (synchronous, no DB, fully testable):
 *     computeMetricsFromRows()  - aggregate metrics from execution rows
 *     detectStuckFromRows()     - stuck execution detection from rows
 *     detectStormFromRows()     - automation storm detection from rows
 *     generateGovernanceAlerts()- deterministic alert generation from metrics
 *     classifyIndicators()      - per-dimension severity classification
 *     classifyOverallSeverity() - overall health severity from alerts
 *     classifyTenantHealth()    - full TenantHealthSummary from computed data
 *
 *   Layer 2 - DB query functions (async, thin wrappers):
 *     queryExecutionRows()       - fetch minimal execution data from DB
 *     computeOperationalMetrics()- query + compute metrics
 *     detectStuckExecutions()    - query + detect stuck
 *     evaluateTenantHealth()     - full tenant health evaluation + logging
 *
 * ── SAFETY RULES ─────────────────────────────────────────────────────────────
 *
 *   • All DB functions are READ-ONLY - no INSERT, UPDATE, or DELETE.
 *   • Pure model functions have zero I/O - identical inputs → identical outputs.
 *   • No external telemetry, no AI/ML, no async pipelines.
 *   • Observability events are fire-and-forget structured logs only.
 *
 * ── GOVERNANCE THRESHOLDS ─────────────────────────────────────────────────────
 *
 *   All thresholds are exported for use in tests.  They are conservative
 *   defaults; a future configuration layer can override them per workspace.
 */

import { and, eq, gte, or, inArray } from "drizzle-orm";
import { db as defaultDb, workflowExecutionsTable } from "@workspace/db";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Governance thresholds (exported for transparency + test use)
// ─────────────────────────────────────────────────────────────────────────────

/** Hours an approval can be waiting before it is considered backlogged. */
export const APPROVAL_BACKLOG_THRESHOLD_HOURS = 24;

/** Minutes a delayed execution can be past its wakeAt before it is overdue. */
export const DELAY_OVERDUE_GRACE_MINUTES = 15;

/** Hours an execution can be in "running" status before it is flagged stuck. */
export const RUNNING_TOO_LONG_HOURS = 2;

/** Error rate (0-1) above which a WARNING is raised. */
export const HIGH_ERROR_RATE_THRESHOLD = 0.2;

/** Error rate (0-1) above which a CRITICAL alert is raised. */
export const CRITICAL_ERROR_RATE_THRESHOLD = 0.5;

/** Total active execution count (per workspace) that triggers a WARNING. */
export const MAX_ACTIVE_WARNING = 50;

/** Total active execution count (per workspace) that triggers a CRITICAL alert. */
export const MAX_ACTIVE_CRITICAL = 200;

/** Approval backlog count that triggers a WARNING. */
export const MAX_APPROVAL_BACKLOG_WARNING = 5;

/** Approval backlog count that triggers a CRITICAL alert. */
export const MAX_APPROVAL_BACKLOG_CRITICAL = 20;

/** Delay backlog count that triggers a WARNING. */
export const DELAY_BACKLOG_WARNING = 5;

/** Delay backlog count that triggers a CRITICAL alert. */
export const DELAY_BACKLOG_CRITICAL = 20;

/** Rolling window (minutes) for automation storm detection. */
export const STORM_WINDOW_MINUTES = 5;

/** Executions in the storm window that trigger a WARNING. */
export const STORM_THRESHOLD_WARNING = 20;

/** Executions in the storm window that trigger a CRITICAL alert. */
export const STORM_THRESHOLD_CRITICAL = 100;

/** Lookback window (hours) for recent execution history. */
export const METRICS_LOOKBACK_HOURS = 24;

/** Total query window (hours) for fetching execution rows (active + recent). */
export const QUERY_LOOKBACK_HOURS = 72;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of a workflow execution row needed for all governance
 * computations.  Used as input to pure model functions so they remain
 * independent of the Drizzle schema type.
 */
export interface ExecutionRow {
  id:           number;
  workflowId:   number;
  workspaceId:  number;
  status:       string;
  startedAt:    Date;
  completedAt:  Date | null;
  timeoutAt:    Date | null;
  wakeAt:       Date | null;
  error:        string | null;
}

/**
 * Workspace-scoped operational metrics snapshot.
 *
 * All counts are derived from execution rows:
 *   • "active" counts: executions in non-terminal status (any age)
 *   • "recent" counts: executions started within METRICS_LOOKBACK_HOURS (24h)
 */
export interface OperationalMetricsSnapshot {
  workspaceId:   number;
  capturedAt:    Date;

  /** Executions currently in status='pending' or status='running'. */
  activeExecutions:        number;
  /** Executions currently in status='waiting_approval'. */
  waitingApprovalCount:    number;
  /** Executions currently in status='waiting_delay'. */
  waitingDelayCount:       number;

  /** Completed executions started in the last 24 h. */
  completedExecutions:     number;
  /** Failed/error executions started in the last 24 h. */
  failedExecutions:        number;
  /** Timed-out executions started in the last 24 h. */
  timedOutExecutions:      number;
  /** Cancelled executions started in the last 24 h. */
  cancelledExecutions:     number;

  /**
   * Approval executions waiting longer than APPROVAL_BACKLOG_THRESHOLD_HOURS.
   * Indicates approvals that may be abandoned or need escalation.
   */
  approvalBacklogCount:    number;

  /**
   * Delayed executions whose wakeAt is in the past by more than
   * DELAY_OVERDUE_GRACE_MINUTES.  Indicates scheduler lag or starvation.
   */
  delayBacklogCount:       number;

  /**
   * Average wall-clock duration of completed executions (ms).
   * 0 when no completed executions are present in the lookback window.
   */
  averageExecutionDurationMs: number;

  /**
   * Error rate = failedExecutions / (completedExecutions + failedExecutions).
   * 0 when no executions completed in the lookback window.
   * Range: [0, 1].
   */
  workflowErrorRate:       number;

  /**
   * Estimated worst-case notification fanout across active workflow definitions.
   * Populated by the DB query layer (requires querying workflow_definitions).
   * Set to 0 by pure model functions.
   */
  estimatedNotificationFanout: number;
}

/**
 * A single stuck execution with its reason and timing information.
 */
export interface StuckExecutionInfo {
  executionId:    number;
  workflowId:     number;
  workspaceId:    number;
  status:         string;
  /** Why this execution is classified as stuck. */
  stuckReason:    "approval_overdue" | "delay_overdue" | "running_too_long";
  /** How long (ms) the execution has been in its current state. */
  stuckDurationMs: number;
  /** How long past the governance threshold (ms). */
  overdueMs:      number;
}

/** Result of storm detection over a rolling window. */
export interface StormDetectionResult {
  /** Executions started within the detection window. */
  count:         number;
  /** "none" | "warning" | "critical" */
  severity:      "none" | "warning" | "critical";
  /** The window length used for this detection. */
  windowMinutes: number;
}

/** Severity levels used across all governance output types. */
export type GovernanceAlertSeverity = "info" | "warning" | "critical";

/**
 * A structured governance alert produced by the pure model.
 * Stable codes are prefixed GOV-NN_ to allow upstream filtering.
 */
export interface GovernanceAlert {
  /** Stable machine-readable code. Format: "GOV-NN_DESCRIPTION". */
  code:                  string;
  severity:              GovernanceAlertSeverity;
  title:                 string;
  description:           string;
  workspaceId:           number;
  affectedWorkflowIds:   number[];
  affectedExecutionIds:  number[];
  detectedAt:            Date;
  recommendedAction:     string;
}

/** Overall tenant health severity (escalating order). */
export type TenantHealthSeverity = "healthy" | "warning" | "degraded" | "critical";

/** Per-dimension health indicators for the tenant. */
export interface TenantHealthIndicators {
  /** Pressure from active + waiting executions. */
  executionPressure:         TenantHealthSeverity;
  /** Concentration of errors in the recent window. */
  errorConcentration:        TenantHealthSeverity;
  /** Approval steps awaiting decisions too long. */
  approvalBacklog:           TenantHealthSeverity;
  /** Delayed executions past their scheduled wake time. */
  delayBacklog:              TenantHealthSeverity;
  /** Running executions that have not completed in expected time. */
  stuckExecutionRisk:        TenantHealthSeverity;
}

/** Full operational health summary for one workspace. */
export interface TenantHealthSummary {
  workspaceId:      number;
  capturedAt:       Date;
  /** Worst severity across all dimensions and alerts. */
  severity:         TenantHealthSeverity;
  metrics:          OperationalMetricsSnapshot;
  alerts:           GovernanceAlert[];
  stuckExecutions:  StuckExecutionInfo[];
  stormResult:      StormDetectionResult;
  indicators:       TenantHealthIndicators;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure model functions - synchronous, no DB, deterministic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute aggregate operational metrics from a slice of execution rows.
 *
 * "Active" counts include all non-terminal executions regardless of age.
 * "Recent" counts include executions started within METRICS_LOOKBACK_HOURS.
 *
 * PURE - identical (rows, workspaceId, now) → identical result.
 */
export function computeMetricsFromRows(
  rows:        ExecutionRow[],
  workspaceId: number,
  now:         Date,
): OperationalMetricsSnapshot {
  const lookbackCutoff = new Date(now.getTime() - METRICS_LOOKBACK_HOURS * 3_600_000);
  const approvalThresholdMs = APPROVAL_BACKLOG_THRESHOLD_HOURS * 3_600_000;
  const delayGraceMs        = DELAY_OVERDUE_GRACE_MINUTES * 60_000;

  let activeExecutions     = 0;
  let waitingApprovalCount = 0;
  let waitingDelayCount    = 0;
  let completedExecutions  = 0;
  let failedExecutions     = 0;
  let timedOutExecutions   = 0;
  let cancelledExecutions  = 0;
  let approvalBacklogCount = 0;
  let delayBacklogCount    = 0;
  let totalDurationMs      = 0;
  let durationCount        = 0;

  for (const row of rows) {
    const isRecent = row.startedAt >= lookbackCutoff;

    switch (row.status) {
      case "pending":
      case "running":
        activeExecutions++;
        break;

      case "waiting_approval":
        waitingApprovalCount++;
        // Backlog: waiting longer than the threshold
        if ((now.getTime() - row.startedAt.getTime()) > approvalThresholdMs) {
          approvalBacklogCount++;
        }
        break;

      case "waiting_delay":
        waitingDelayCount++;
        // Backlog: past wake_at by more than the grace period
        if (row.wakeAt !== null && (now.getTime() - row.wakeAt.getTime()) > delayGraceMs) {
          delayBacklogCount++;
        }
        break;

      case "completed":
        if (isRecent) {
          completedExecutions++;
          if (row.completedAt !== null) {
            totalDurationMs += row.completedAt.getTime() - row.startedAt.getTime();
            durationCount++;
          }
        }
        break;

      case "failed":
      case "error":
        if (isRecent) failedExecutions++;
        break;

      case "timed_out":
        if (isRecent) timedOutExecutions++;
        break;

      case "cancelled":
        if (isRecent) cancelledExecutions++;
        break;

      // "pending" and unknown statuses handled above / ignored
    }
  }

  const averageExecutionDurationMs =
    durationCount > 0 ? totalDurationMs / durationCount : 0;

  const totalForErrorRate = completedExecutions + failedExecutions;
  const workflowErrorRate =
    totalForErrorRate > 0 ? failedExecutions / totalForErrorRate : 0;

  return {
    workspaceId,
    capturedAt:              now,
    activeExecutions,
    waitingApprovalCount,
    waitingDelayCount,
    completedExecutions,
    failedExecutions,
    timedOutExecutions,
    cancelledExecutions,
    approvalBacklogCount,
    delayBacklogCount,
    averageExecutionDurationMs,
    workflowErrorRate,
    estimatedNotificationFanout: 0, // populated by DB layer
  };
}

/**
 * Detect stuck executions from a slice of execution rows.
 *
 * Detection rules (deterministic thresholds, no heuristics):
 *   approval_overdue  - waiting_approval for > APPROVAL_BACKLOG_THRESHOLD_HOURS
 *   delay_overdue     - waiting_delay past wakeAt by > DELAY_OVERDUE_GRACE_MINUTES
 *   running_too_long  - running for > RUNNING_TOO_LONG_HOURS
 *
 * PURE - identical (rows, now) → identical result.
 */
export function detectStuckFromRows(
  rows: ExecutionRow[],
  now:  Date,
): StuckExecutionInfo[] {
  const stuck: StuckExecutionInfo[]    = [];
  const nowMs                          = now.getTime();
  const runningThresholdMs             = RUNNING_TOO_LONG_HOURS * 3_600_000;
  const approvalThresholdMs            = APPROVAL_BACKLOG_THRESHOLD_HOURS * 3_600_000;
  const delayGraceMs                   = DELAY_OVERDUE_GRACE_MINUTES * 60_000;

  for (const row of rows) {
    if (row.status === "running") {
      const runningMs = nowMs - row.startedAt.getTime();
      if (runningMs > runningThresholdMs) {
        stuck.push({
          executionId:     row.id,
          workflowId:      row.workflowId,
          workspaceId:     row.workspaceId,
          status:          row.status,
          stuckReason:     "running_too_long",
          stuckDurationMs: runningMs,
          overdueMs:       runningMs - runningThresholdMs,
        });
      }
    }

    if (row.status === "waiting_approval") {
      const waitMs = nowMs - row.startedAt.getTime();
      if (waitMs > approvalThresholdMs) {
        stuck.push({
          executionId:     row.id,
          workflowId:      row.workflowId,
          workspaceId:     row.workspaceId,
          status:          row.status,
          stuckReason:     "approval_overdue",
          stuckDurationMs: waitMs,
          overdueMs:       waitMs - approvalThresholdMs,
        });
      }
    }

    if (row.status === "waiting_delay" && row.wakeAt !== null) {
      const pastWakeAtMs = nowMs - row.wakeAt.getTime();
      if (pastWakeAtMs > delayGraceMs) {
        stuck.push({
          executionId:     row.id,
          workflowId:      row.workflowId,
          workspaceId:     row.workspaceId,
          status:          row.status,
          stuckReason:     "delay_overdue",
          stuckDurationMs: pastWakeAtMs,
          overdueMs:       pastWakeAtMs - delayGraceMs,
        });
      }
    }
  }

  return stuck;
}

/**
 * Detect automation storms - an unusual burst of execution starts within a
 * rolling time window.
 *
 * PURE - identical (rows, windowMinutes, now) → identical result.
 */
export function detectStormFromRows(
  rows:          ExecutionRow[],
  windowMinutes: number,
  now:           Date,
): StormDetectionResult {
  const windowMs    = windowMinutes * 60_000;
  const windowStart = now.getTime() - windowMs;
  const recentCount = rows.filter(r => r.startedAt.getTime() > windowStart).length;

  let severity: StormDetectionResult["severity"] = "none";
  if (recentCount >= STORM_THRESHOLD_CRITICAL) severity = "critical";
  else if (recentCount >= STORM_THRESHOLD_WARNING)  severity = "warning";

  return { count: recentCount, severity, windowMinutes };
}

/**
 * Generate governance alerts from computed metrics, stuck executions, and
 * storm detection results.
 *
 * Alert codes (stable, forward-compatible):
 *   GOV-01_APPROVAL_BACKLOG   - too many approvals waiting too long
 *   GOV-02_DELAY_BACKLOG      - delayed executions past their wake time
 *   GOV-03_HIGH_ERROR_RATE    - error rate above threshold
 *   GOV-04_EXECUTION_PRESSURE - too many active executions
 *   GOV-05_STUCK_EXECUTIONS   - individual executions detected as stuck
 *   GOV-06_AUTOMATION_STORM   - burst of execution starts detected
 *   GOV-07_SCHEDULER_BACKLOG  - alias for GOV-02 with scheduler framing
 *
 * PURE - identical inputs → identical alerts (same count, codes, severities).
 */
export function generateGovernanceAlerts(
  metrics:          OperationalMetricsSnapshot,
  stuckExecutions:  StuckExecutionInfo[],
  stormResult:      StormDetectionResult,
  workspaceId:      number,
  now:              Date,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  // ── GOV-01: Approval backlog ───────────────────────────────────────────────
  if (metrics.approvalBacklogCount >= MAX_APPROVAL_BACKLOG_CRITICAL) {
    alerts.push({
      code:                 "GOV-01_APPROVAL_BACKLOG",
      severity:             "critical",
      title:                "Critical approval backlog",
      description:
        `${metrics.approvalBacklogCount} approval(s) have been waiting for more than ` +
        `${APPROVAL_BACKLOG_THRESHOLD_HOURS} hours. These may be abandoned or blocked by ` +
        `absent approvers. Immediate escalation is recommended.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: stuckExecutions
        .filter(s => s.stuckReason === "approval_overdue")
        .map(s => s.executionId),
      detectedAt:           now,
      recommendedAction:
        "Review waiting approval executions and escalate or force-timeout as appropriate.",
    });
  } else if (metrics.approvalBacklogCount >= MAX_APPROVAL_BACKLOG_WARNING) {
    alerts.push({
      code:                 "GOV-01_APPROVAL_BACKLOG",
      severity:             "warning",
      title:                "Approval backlog detected",
      description:
        `${metrics.approvalBacklogCount} approval(s) have been waiting for more than ` +
        `${APPROVAL_BACKLOG_THRESHOLD_HOURS} hours. Review whether approvers are responsive.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: stuckExecutions
        .filter(s => s.stuckReason === "approval_overdue")
        .map(s => s.executionId),
      detectedAt:           now,
      recommendedAction:
        "Notify approvers or configure approval timeout policies on affected workflows.",
    });
  }

  // ── GOV-02: Delay backlog (scheduler backlog) ──────────────────────────────
  if (metrics.delayBacklogCount >= DELAY_BACKLOG_CRITICAL) {
    alerts.push({
      code:                 "GOV-02_DELAY_BACKLOG",
      severity:             "critical",
      title:                "Critical delay backlog - possible scheduler starvation",
      description:
        `${metrics.delayBacklogCount} execution(s) are past their scheduled wake time ` +
        `by more than ${DELAY_OVERDUE_GRACE_MINUTES} minutes. The scheduler may be ` +
        `overwhelmed or stopped. Executions are accumulating without resuming.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: stuckExecutions
        .filter(s => s.stuckReason === "delay_overdue")
        .map(s => s.executionId),
      detectedAt:           now,
      recommendedAction:
        "Check that the WorkflowScheduler is running. Verify server load and poll cycle health.",
    });
  } else if (metrics.delayBacklogCount >= DELAY_BACKLOG_WARNING) {
    alerts.push({
      code:                 "GOV-02_DELAY_BACKLOG",
      severity:             "warning",
      title:                "Delay backlog detected",
      description:
        `${metrics.delayBacklogCount} execution(s) are past their scheduled wake time. ` +
        `Minor scheduler lag is expected under load, but this may indicate a problem.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: stuckExecutions
        .filter(s => s.stuckReason === "delay_overdue")
        .map(s => s.executionId),
      detectedAt:           now,
      recommendedAction:    "Monitor scheduler poll cycle logs for errors or slowdowns.",
    });
  }

  // ── GOV-03: High error rate ────────────────────────────────────────────────
  const errorPct = Math.round(metrics.workflowErrorRate * 100);
  if (metrics.workflowErrorRate >= CRITICAL_ERROR_RATE_THRESHOLD) {
    alerts.push({
      code:                 "GOV-03_HIGH_ERROR_RATE",
      severity:             "critical",
      title:                `Critical error rate: ${errorPct}%`,
      description:
        `${errorPct}% of workflow executions in the last 24 h have failed ` +
        `(${metrics.failedExecutions} failed out of ` +
        `${metrics.completedExecutions + metrics.failedExecutions} total). ` +
        `This indicates a systemic failure in one or more workflows.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: [],
      detectedAt:           now,
      recommendedAction:
        "Review recent failed executions for common error patterns. Check step handler configurations.",
    });
  } else if (metrics.workflowErrorRate >= HIGH_ERROR_RATE_THRESHOLD) {
    alerts.push({
      code:                 "GOV-03_HIGH_ERROR_RATE",
      severity:             "warning",
      title:                `Elevated error rate: ${errorPct}%`,
      description:
        `${errorPct}% of workflow executions in the last 24 h have failed. ` +
        `Review failing workflows before the rate increases further.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: [],
      detectedAt:           now,
      recommendedAction:    "Inspect failed executions for patterns. Consider deactivating faulty workflows.",
    });
  }

  // ── GOV-04: Execution pressure ─────────────────────────────────────────────
  const totalActive =
    metrics.activeExecutions +
    metrics.waitingApprovalCount +
    metrics.waitingDelayCount;

  if (totalActive >= MAX_ACTIVE_CRITICAL) {
    alerts.push({
      code:                 "GOV-04_EXECUTION_PRESSURE",
      severity:             "critical",
      title:                `Critical execution pressure: ${totalActive} active`,
      description:
        `${totalActive} executions are currently active (running + waiting). ` +
        `This may indicate runaway workflow triggers or a processing bottleneck.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: [],
      detectedAt:           now,
      recommendedAction:
        "Check for workflows triggering on every event. Consider throttling or adding trigger conditions.",
    });
  } else if (totalActive >= MAX_ACTIVE_WARNING) {
    alerts.push({
      code:                 "GOV-04_EXECUTION_PRESSURE",
      severity:             "warning",
      title:                `Elevated execution pressure: ${totalActive} active`,
      description:
        `${totalActive} executions are currently active. Monitor for further growth.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: [],
      detectedAt:           now,
      recommendedAction:    "Review high-volume trigger events and consider adding conditions.",
    });
  }

  // ── GOV-05: Stuck executions ───────────────────────────────────────────────
  if (stuckExecutions.length > 0) {
    const severity: GovernanceAlertSeverity = stuckExecutions.length >= 5 ? "critical" : "warning";
    alerts.push({
      code:                 "GOV-05_STUCK_EXECUTIONS",
      severity,
      title:                `${stuckExecutions.length} stuck execution(s) detected`,
      description:
        `${stuckExecutions.length} execution(s) are stuck: ` +
        stuckExecutions
          .map(s => `#${s.executionId} (${s.stuckReason})`)
          .slice(0, 5)
          .join(", ") +
        (stuckExecutions.length > 5 ? ` and ${stuckExecutions.length - 5} more.` : "."),
      workspaceId,
      affectedWorkflowIds:  [...new Set(stuckExecutions.map(s => s.workflowId))],
      affectedExecutionIds: stuckExecutions.map(s => s.executionId),
      detectedAt:           now,
      recommendedAction:
        "Use POST /workflows/executions/:id/timeout to force-timeout stuck executions.",
    });
  }

  // ── GOV-06: Automation storm ───────────────────────────────────────────────
  if (stormResult.severity !== "none") {
    alerts.push({
      code:                 "GOV-06_AUTOMATION_STORM",
      severity:             stormResult.severity,
      title:
        `Automation storm: ${stormResult.count} executions in ${stormResult.windowMinutes} minutes`,
      description:
        `${stormResult.count} workflow executions started in the last ` +
        `${stormResult.windowMinutes} minutes, exceeding the ` +
        `${stormResult.severity === "critical" ? STORM_THRESHOLD_CRITICAL : STORM_THRESHOLD_WARNING} ` +
        `execution ${stormResult.severity} threshold. This may indicate a runaway trigger loop ` +
        `or an unexpected event burst.`,
      workspaceId,
      affectedWorkflowIds:  [],
      affectedExecutionIds: [],
      detectedAt:           now,
      recommendedAction:
        "Identify the triggering event source. Deactivate suspected runaway workflows immediately.",
    });
  }

  return alerts;
}

/**
 * Classify per-dimension health indicators from metrics and stuck execution data.
 * PURE.
 */
export function classifyIndicators(
  metrics:         OperationalMetricsSnapshot,
  stuckExecutions: StuckExecutionInfo[],
): TenantHealthIndicators {
  const totalActive =
    metrics.activeExecutions +
    metrics.waitingApprovalCount +
    metrics.waitingDelayCount;

  const executionPressure: TenantHealthSeverity =
    totalActive >= MAX_ACTIVE_CRITICAL ? "critical" :
    totalActive >= MAX_ACTIVE_WARNING  ? "warning"  : "healthy";

  const errorConcentration: TenantHealthSeverity =
    metrics.workflowErrorRate >= CRITICAL_ERROR_RATE_THRESHOLD ? "critical" :
    metrics.workflowErrorRate >= HIGH_ERROR_RATE_THRESHOLD      ? "warning"  : "healthy";

  const approvalBacklog: TenantHealthSeverity =
    metrics.approvalBacklogCount >= MAX_APPROVAL_BACKLOG_CRITICAL ? "critical" :
    metrics.approvalBacklogCount >= MAX_APPROVAL_BACKLOG_WARNING  ? "warning"  : "healthy";

  const delayBacklog: TenantHealthSeverity =
    metrics.delayBacklogCount >= DELAY_BACKLOG_CRITICAL ? "critical" :
    metrics.delayBacklogCount >= DELAY_BACKLOG_WARNING  ? "warning"  : "healthy";

  const stuckCount                  = stuckExecutions.length;
  const stuckExecutionRisk: TenantHealthSeverity =
    stuckCount >= 5 ? "critical" :
    stuckCount >= 1 ? "warning"  : "healthy";

  return {
    executionPressure,
    errorConcentration,
    approvalBacklog,
    delayBacklog,
    stuckExecutionRisk,
  };
}

/**
 * Derive the overall health severity from a list of governance alerts.
 * The overall severity is the worst severity across all alerts.
 * PURE.
 */
export function classifyOverallSeverity(alerts: GovernanceAlert[]): TenantHealthSeverity {
  if (alerts.some(a => a.severity === "critical")) return "critical";
  if (alerts.length > 3)                           return "degraded";
  if (alerts.some(a => a.severity === "warning"))  return "warning";
  return "healthy";
}

/**
 * Assemble a complete TenantHealthSummary from pre-computed components.
 * PURE - all inputs are values; no DB or I/O.
 */
export function classifyTenantHealth(
  metrics:         OperationalMetricsSnapshot,
  alerts:          GovernanceAlert[],
  stuckExecutions: StuckExecutionInfo[],
  stormResult:     StormDetectionResult,
  workspaceId:     number,
  now:             Date,
): TenantHealthSummary {
  const indicators = classifyIndicators(metrics, stuckExecutions);
  const severity   = classifyOverallSeverity(alerts);

  return {
    workspaceId,
    capturedAt:    now,
    severity,
    metrics,
    alerts,
    stuckExecutions,
    stormResult,
    indicators,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB query layer - async, READ-ONLY
// ─────────────────────────────────────────────────────────────────────────────

type DbClient = typeof defaultDb;

/**
 * Fetch the minimal execution rows needed for all governance computations.
 *
 * Fetches:
 *   • All non-terminal executions (regardless of age) - for active counts
 *   • Terminal executions started within QUERY_LOOKBACK_HOURS - for recent stats
 *
 * READ-ONLY - no DB mutations.
 */
export async function queryExecutionRows(
  workspaceId: number,
  database:    DbClient,
  now:         Date,
): Promise<ExecutionRow[]> {
  const lookbackCutoff  = new Date(now.getTime() - QUERY_LOOKBACK_HOURS * 3_600_000);
  const activeStatuses  = ["pending", "running", "waiting_approval", "waiting_delay"] as const;

  const rows = await database
    .select({
      id:          workflowExecutionsTable.id,
      workflowId:  workflowExecutionsTable.workflowId,
      workspaceId: workflowExecutionsTable.workspaceId,
      status:      workflowExecutionsTable.status,
      startedAt:   workflowExecutionsTable.startedAt,
      completedAt: workflowExecutionsTable.completedAt,
      timeoutAt:   workflowExecutionsTable.timeoutAt,
      wakeAt:      workflowExecutionsTable.wakeAt,
      error:       workflowExecutionsTable.error,
    })
    .from(workflowExecutionsTable)
    .where(
      and(
        eq(workflowExecutionsTable.workspaceId, workspaceId),
        or(
          inArray(workflowExecutionsTable.status, [...activeStatuses]),
          gte(workflowExecutionsTable.startedAt, lookbackCutoff),
        ),
      ),
    );

  return rows;
}

/**
 * Compute an OperationalMetricsSnapshot for the given workspace.
 * READ-ONLY.
 */
export async function computeOperationalMetrics(
  workspaceId: number,
  database:    DbClient = defaultDb,
  now:         Date     = new Date(),
): Promise<OperationalMetricsSnapshot> {
  const rows    = await queryExecutionRows(workspaceId, database, now);
  const metrics = computeMetricsFromRows(rows, workspaceId, now);
  return metrics;
}

/**
 * Detect stuck executions for the given workspace.
 * READ-ONLY.
 */
export async function detectStuckExecutions(
  workspaceId: number,
  database:    DbClient = defaultDb,
  now:         Date     = new Date(),
): Promise<StuckExecutionInfo[]> {
  const rows = await queryExecutionRows(workspaceId, database, now);
  return detectStuckFromRows(rows, now);
}

/**
 * Evaluate the full tenant health for the given workspace.
 *
 * Orchestrates:
 *   1. Query execution rows
 *   2. Compute aggregate metrics
 *   3. Detect stuck executions
 *   4. Detect automation storm
 *   5. Generate governance alerts
 *   6. Classify health indicators + overall severity
 *   7. Emit structured observability events
 *
 * READ-ONLY - no DB mutations.
 */
export async function evaluateTenantHealth(
  workspaceId: number,
  database:    DbClient = defaultDb,
  now:         Date     = new Date(),
): Promise<TenantHealthSummary> {
  const rows    = await queryExecutionRows(workspaceId, database, now);
  const metrics = computeMetricsFromRows(rows, workspaceId, now);
  const stuck   = detectStuckFromRows(rows, now);
  const storm   = detectStormFromRows(rows, STORM_WINDOW_MINUTES, now);
  const alerts  = generateGovernanceAlerts(metrics, stuck, storm, workspaceId, now);
  const summary = classifyTenantHealth(metrics, alerts, stuck, storm, workspaceId, now);

  // ── Observability: tenant_health_snapshot_generated ──────────────────────
  logger.info(
    {
      workspaceId,
      severity:            summary.severity,
      alertCount:          alerts.length,
      stuckCount:          stuck.length,
      stormSeverity:       storm.severity,
      activeExecutions:    metrics.activeExecutions,
      waitingApproval:     metrics.waitingApprovalCount,
      waitingDelay:        metrics.waitingDelayCount,
      approvalBacklog:     metrics.approvalBacklogCount,
      delayBacklog:        metrics.delayBacklogCount,
      workflowErrorRate:   metrics.workflowErrorRate,
      alertCodes:          alerts.map(a => a.code),
      action:              "tenant_health_snapshot_generated",
    },
    "[governance] P6-C: Tenant health snapshot generated",
  );

  // ── Observability: stuck_execution_detected ───────────────────────────────
  if (stuck.length > 0) {
    logger.warn(
      {
        workspaceId,
        stuckCount:          stuck.length,
        stuckReasons:        stuck.map(s => s.stuckReason),
        affectedExecutionIds: stuck.map(s => s.executionId),
        severity:            stuck.length >= 5 ? "critical" : "warning",
        metricsSnapshot:     { activeExecutions: metrics.activeExecutions,
                               approvalBacklog: metrics.approvalBacklogCount,
                               delayBacklog: metrics.delayBacklogCount },
        action:              "stuck_execution_detected",
      },
      "[governance] P6-C: Stuck executions detected",
    );
  }

  // ── Observability: automation_storm_detected ──────────────────────────────
  if (storm.severity !== "none") {
    logger.warn(
      {
        workspaceId,
        stormCount:      storm.count,
        windowMinutes:   storm.windowMinutes,
        severity:        storm.severity,
        metricsSnapshot: { activeExecutions: metrics.activeExecutions },
        action:          "automation_storm_detected",
      },
      "[governance] P6-C: Automation storm detected",
    );
  }

  // ── Observability: scheduler_backlog_detected ─────────────────────────────
  if (metrics.delayBacklogCount >= DELAY_BACKLOG_WARNING) {
    logger.warn(
      {
        workspaceId,
        delayBacklogCount: metrics.delayBacklogCount,
        severity:          metrics.delayBacklogCount >= DELAY_BACKLOG_CRITICAL ? "critical" : "warning",
        metricsSnapshot:   { delayBacklogCount: metrics.delayBacklogCount,
                             waitingDelayCount: metrics.waitingDelayCount },
        action:            "scheduler_backlog_detected",
      },
      "[governance] P6-C: Scheduler delay backlog detected",
    );
  }

  // ── Observability: workflow_operational_warning ───────────────────────────
  for (const alert of alerts) {
    if (alert.severity === "warning" || alert.severity === "critical") {
      logger.warn(
        {
          workspaceId,
          alertCode:            alert.code,
          alertSeverity:        alert.severity,
          alertTitle:           alert.title,
          affectedWorkflowIds:  alert.affectedWorkflowIds,
          affectedExecutionIds: alert.affectedExecutionIds,
          metricsSnapshot:      {
            activeExecutions:    metrics.activeExecutions,
            approvalBacklog:     metrics.approvalBacklogCount,
            workflowErrorRate:   metrics.workflowErrorRate,
          },
          action:               "workflow_operational_warning",
        },
        `[governance] P6-C: Operational warning - ${alert.code}`,
      );
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// API response serialization - pure functions for P6-D governance endpoints
// ─────────────────────────────────────────────────────────────────────────────

// ── API limits (payload hardening) ───────────────────────────────────────────

/** Maximum stuck executions returned per /governance/stuck response. */
export const MAX_STUCK_RESULTS = 100;

/** Maximum alerts per page on /governance/alerts. */
export const MAX_ALERTS_PAGE = 50;

/** Maximum alert IDs included per alert in API responses. */
export const MAX_AFFECTED_IDS = 20;

/** Maximum alerts included in the compact /governance/health response. */
export const MAX_ALERTS_IN_HEALTH = 10;

/**
 * overdueMs threshold above which a stuck entry is classified "critical".
 * Default: 4 hours past the governing threshold.
 */
export const STUCK_CRITICAL_OVERDUE_MS = 4 * 3_600_000;

// ── Observability action codes (stable, exported for route + test use) ────────

export const GOVERNANCE_ACTION_HEALTH_REQUESTED  = "governance_api_health_requested"  as const;
export const GOVERNANCE_ACTION_METRICS_REQUESTED = "governance_api_metrics_requested" as const;
export const GOVERNANCE_ACTION_STUCK_REQUESTED   = "governance_api_stuck_requested"   as const;
export const GOVERNANCE_ACTION_ALERTS_REQUESTED  = "governance_api_alerts_requested"  as const;

// ── API response shapes ───────────────────────────────────────────────────────

/** Compact alert item safe for HTTP responses. */
export interface AlertApiItem {
  code:                  string;
  severity:              GovernanceAlertSeverity;
  title:                 string;
  description:           string;
  /** Capped at MAX_AFFECTED_IDS. */
  affectedWorkflowIds:   number[];
  /** Capped at MAX_AFFECTED_IDS. */
  affectedExecutionIds:  number[];
  detectedAt:            string;
  recommendedAction:     string;
}

/** Compact stuck item safe for HTTP responses. */
export interface StuckApiItem {
  executionId:      number;
  workflowId:       number;
  status:           string;
  stuckReason:      StuckExecutionInfo["stuckReason"];
  stuckDurationMs:  number;
  overdueMs:        number;
  /** Derived severity for this individual entry. */
  severity:         "warning" | "critical";
}

/** Response shape for GET /governance/health. */
export interface HealthApiResponse {
  capturedAt:          string;
  workspaceId:         number;
  severity:            TenantHealthSeverity;
  indicators:          TenantHealthIndicators;
  /** Up to MAX_ALERTS_IN_HEALTH alerts; use /governance/alerts for full list. */
  alerts:              AlertApiItem[];
  /** Total stuck executions; use /governance/stuck for detail. */
  stuckExecutionCount: number;
  stormSeverity:       StormDetectionResult["severity"];
  /** Key metric summary for at-a-glance dashboards. */
  metrics: {
    activeExecutions:          number;
    waitingApprovalCount:      number;
    waitingDelayCount:         number;
    approvalBacklogCount:      number;
    delayBacklogCount:         number;
    workflowErrorRate:         number;
    averageExecutionDurationMs: number;
  };
}

/** Response shape for GET /governance/metrics. */
export interface MetricsApiResponse {
  capturedAt:  string;
  workspaceId: number;
  counts: {
    active:         number;
    waitingApproval: number;
    waitingDelay:   number;
    completed:      number;
    failed:         number;
    timedOut:       number;
    cancelled:      number;
  };
  backlog: {
    approvalBacklogCount: number;
    delayBacklogCount:    number;
  };
  performance: {
    averageExecutionDurationMs: number;
    workflowErrorRate:          number;
  };
}

/** Response shape for GET /governance/stuck. */
export interface StuckApiResponse {
  capturedAt: string;
  /** True total before truncation. */
  total:      number;
  /** True when total > MAX_STUCK_RESULTS. */
  truncated:  boolean;
  limit:      number;
  data:       StuckApiItem[];
}

/** Response shape for GET /governance/alerts. */
export interface AlertsApiResponse {
  capturedAt: string;
  total:      number;
  page:       number;
  limit:      number;
  data:       AlertApiItem[];
}

// ── Pure serialization functions ──────────────────────────────────────────────

/**
 * Derive per-entry severity for a stuck execution.
 * "critical" when overdueMs >= STUCK_CRITICAL_OVERDUE_MS (4h past threshold).
 * PURE.
 */
export function deriveStuckSeverity(entry: StuckExecutionInfo): "warning" | "critical" {
  return entry.overdueMs >= STUCK_CRITICAL_OVERDUE_MS ? "critical" : "warning";
}

/**
 * Serialize a GovernanceAlert to a safe HTTP-response shape.
 * Caps affectedWorkflowIds and affectedExecutionIds at MAX_AFFECTED_IDS.
 * PURE.
 */
export function serializeAlertItem(alert: GovernanceAlert): AlertApiItem {
  return {
    code:                 alert.code,
    severity:             alert.severity,
    title:                alert.title,
    description:          alert.description,
    affectedWorkflowIds:  alert.affectedWorkflowIds.slice(0, MAX_AFFECTED_IDS),
    affectedExecutionIds: alert.affectedExecutionIds.slice(0, MAX_AFFECTED_IDS),
    detectedAt:           alert.detectedAt.toISOString(),
    recommendedAction:    alert.recommendedAction,
  };
}

/**
 * Serialize a TenantHealthSummary to the compact GET /governance/health shape.
 *
 * Hardening:
 *   • No raw execution rows - only aggregate counts.
 *   • No stepsSnapshot, context, or error fields.
 *   • Alerts capped at MAX_ALERTS_IN_HEALTH (full list via /governance/alerts).
 *   • Affected IDs capped per alert at MAX_AFFECTED_IDS.
 *
 * PURE.
 */
export function serializeHealthResponse(summary: TenantHealthSummary): HealthApiResponse {
  return {
    capturedAt:          summary.capturedAt.toISOString(),
    workspaceId:         summary.workspaceId,
    severity:            summary.severity,
    indicators:          summary.indicators,
    alerts:              summary.alerts.slice(0, MAX_ALERTS_IN_HEALTH).map(serializeAlertItem),
    stuckExecutionCount: summary.stuckExecutions.length,
    stormSeverity:       summary.stormResult.severity,
    metrics: {
      activeExecutions:           summary.metrics.activeExecutions,
      waitingApprovalCount:       summary.metrics.waitingApprovalCount,
      waitingDelayCount:          summary.metrics.waitingDelayCount,
      approvalBacklogCount:       summary.metrics.approvalBacklogCount,
      delayBacklogCount:          summary.metrics.delayBacklogCount,
      workflowErrorRate:          summary.metrics.workflowErrorRate,
      averageExecutionDurationMs: summary.metrics.averageExecutionDurationMs,
    },
  };
}

/**
 * Serialize an OperationalMetricsSnapshot to the GET /governance/metrics shape.
 * Structured for future dashboard compatibility (counts / backlog / performance).
 * PURE.
 */
export function serializeMetricsResponse(
  metrics: OperationalMetricsSnapshot,
): MetricsApiResponse {
  return {
    capturedAt:  metrics.capturedAt.toISOString(),
    workspaceId: metrics.workspaceId,
    counts: {
      active:          metrics.activeExecutions,
      waitingApproval: metrics.waitingApprovalCount,
      waitingDelay:    metrics.waitingDelayCount,
      completed:       metrics.completedExecutions,
      failed:          metrics.failedExecutions,
      timedOut:        metrics.timedOutExecutions,
      cancelled:       metrics.cancelledExecutions,
    },
    backlog: {
      approvalBacklogCount: metrics.approvalBacklogCount,
      delayBacklogCount:    metrics.delayBacklogCount,
    },
    performance: {
      averageExecutionDurationMs: metrics.averageExecutionDurationMs,
      workflowErrorRate:          metrics.workflowErrorRate,
    },
  };
}

/**
 * Serialize stuck executions for GET /governance/stuck.
 *
 * Hardening:
 *   • Results sorted by overdueMs descending (most critical first).
 *   • List capped at MAX_STUCK_RESULTS; truncated=true when more exist.
 *   • No raw execution context, stepsSnapshot, or error fields.
 *   • Per-entry severity derived from overdueMs threshold.
 *
 * PURE.
 */
export function serializeStuckResponse(
  stuck: StuckExecutionInfo[],
  now:   Date,
): StuckApiResponse {
  const sorted    = [...stuck].sort((a, b) => b.overdueMs - a.overdueMs);
  const truncated = sorted.length > MAX_STUCK_RESULTS;
  const page      = sorted.slice(0, MAX_STUCK_RESULTS);

  return {
    capturedAt: now.toISOString(),
    total:      stuck.length,
    truncated,
    limit:      MAX_STUCK_RESULTS,
    data: page.map(s => ({
      executionId:     s.executionId,
      workflowId:      s.workflowId,
      status:          s.status,
      stuckReason:     s.stuckReason,
      stuckDurationMs: s.stuckDurationMs,
      overdueMs:       s.overdueMs,
      severity:        deriveStuckSeverity(s),
    })),
  };
}

/**
 * Serialize governance alerts for GET /governance/alerts (paginated).
 *
 * Hardening:
 *   • page and limit are clamped to safe ranges.
 *   • limit capped at MAX_ALERTS_PAGE.
 *   • affectedWorkflowIds and affectedExecutionIds capped at MAX_AFFECTED_IDS per alert.
 *
 * PURE.
 */
export function serializeAlertsResponse(
  alerts: GovernanceAlert[],
  page:   number,
  limit:  number,
  now:    Date,
): AlertsApiResponse {
  const safeLimit  = Math.min(MAX_ALERTS_PAGE, Math.max(1, limit));
  const safePage   = Math.max(1, page);
  const offset     = (safePage - 1) * safeLimit;
  const pageAlerts = alerts.slice(offset, offset + safeLimit);

  return {
    capturedAt: now.toISOString(),
    total:      alerts.length,
    page:       safePage,
    limit:      safeLimit,
    data:       pageAlerts.map(serializeAlertItem),
  };
}
