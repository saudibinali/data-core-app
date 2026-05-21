/**
 * P11-D - Compliance Operations Analytics & Governance Effectiveness Intelligence
 *
 * READ-ONLY deterministic analytics layer over GovernanceWorkflowAction rows (P11-C).
 * No DB writes. No enforcement. No AI. No auto-escalation. Fail-closed on ambiguity.
 *
 * Depends on:
 *   P11-C GovernanceWorkflowAction - input data model
 *   P11-B GOVERNANCE_POLICIES      - policy metadata (name, severity)
 */

import { logger } from "../logger";
import {
  type GovernanceWorkflowAction,
  type GovernanceWorkflowStatus,
  type GovernanceEscalationLevel,
  type ResolutionClassification,
} from "./compliance-workflow-orchestration";
import { GOVERNANCE_POLICIES } from "./governance-policy-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set<GovernanceWorkflowStatus>(["resolved", "dismissed"]);

const ESCALATION_LEVEL_ORDER: Record<GovernanceEscalationLevel, number> = {
  informational: 0,
  standard:      1,
  elevated:      2,
  critical:      3,
};

const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEffectivenessScore - 5-tier deterministic scoring
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowEffectivenessScore =
  | "unstable"
  | "inconsistent"
  | "acceptable"
  | "effective"
  | "highly_effective";

/**
 * Deterministic scoring from four observable metrics.
 * Evaluated fail-closed: worst condition wins.
 *
 * Thresholds (in order of precedence):
 *   unstable       - escalationRate >= 0.70  OR unresolvedCriticalCount >= 5
 *   inconsistent   - escalationRate >= 0.40  OR unresolvedCriticalCount >= 2
 *                    OR avgResolutionMs > 14 days
 *   highly_effective - throughputRate >= 0.90 AND escalationRate < 0.15
 *                      AND unresolvedCriticalCount === 0
 *   effective      - throughputRate >= 0.70 AND escalationRate < 0.30
 *                    AND unresolvedCriticalCount === 0
 *   acceptable     - default
 */
export function classifyWorkflowEffectiveness(
  escalationRate:           number,
  throughputRate:           number,
  unresolvedCriticalCount:  number,
  avgResolutionDurationMs:  number | null,
): WorkflowEffectivenessScore {
  if (
    escalationRate >= 0.70 ||
    unresolvedCriticalCount >= 5
  ) return "unstable";

  if (
    escalationRate >= 0.40 ||
    unresolvedCriticalCount >= 2 ||
    (avgResolutionDurationMs !== null && avgResolutionDurationMs > 14 * MS_PER_DAY)
  ) return "inconsistent";

  if (
    throughputRate >= 0.90 &&
    escalationRate < 0.15 &&
    unresolvedCriticalCount === 0
  ) return "highly_effective";

  if (
    throughputRate >= 0.70 &&
    escalationRate < 0.30 &&
    unresolvedCriticalCount === 0
  ) return "effective";

  return "acceptable";
}

// ─────────────────────────────────────────────────────────────────────────────
// PolicyStabilityScore - 4-tier deterministic scoring per policy
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyStabilityScore =
  | "unstable"
  | "noisy"
  | "stable"
  | "reliable";

/**
 * Deterministic policy stability from false-positive and unresolved rates.
 * Fail-closed: worst condition wins.
 *
 * Thresholds:
 *   unstable  - falsePositiveRate >= 0.50 OR unresolvedFrequency >= 0.50
 *   noisy     - falsePositiveRate >= 0.30 OR unresolvedFrequency >= 0.30
 *   reliable  - confirmedViolationRate >= 0.80 AND falsePositiveRate < 0.10
 *               AND unresolvedFrequency < 0.20
 *   stable    - default
 */
export function classifyPolicyStability(
  confirmedViolationRate: number,
  falsePositiveRate:      number,
  unresolvedFrequency:    number,
): PolicyStabilityScore {
  if (falsePositiveRate >= 0.50 || unresolvedFrequency >= 0.50) return "unstable";
  if (falsePositiveRate >= 0.30 || unresolvedFrequency >= 0.30) return "noisy";
  if (
    confirmedViolationRate >= 0.80 &&
    falsePositiveRate < 0.10 &&
    unresolvedFrequency < 0.20
  ) return "reliable";
  return "stable";
}

// ─────────────────────────────────────────────────────────────────────────────
// EscalationTrend
// ─────────────────────────────────────────────────────────────────────────────

export type EscalationTrend = "improving" | "stable" | "worsening" | "critical";

/**
 * Derives an escalation trend from the current escalation rate and
 * unresolved critical count.
 *
 *   critical   - unresolvedCriticalCount >= 3
 *   worsening  - escalationRate >= 0.50 OR unresolvedCriticalCount >= 1
 *   improving  - escalationRate < 0.10 AND unresolvedCriticalCount === 0
 *   stable     - default
 */
export function classifyEscalationTrend(
  escalationRate:          number,
  unresolvedCriticalCount: number,
): EscalationTrend {
  if (unresolvedCriticalCount >= 3)                                         return "critical";
  if (escalationRate >= 0.50 || unresolvedCriticalCount >= 1)               return "worsening";
  if (escalationRate < 0.10  && unresolvedCriticalCount === 0)              return "improving";
  return "stable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Duration computation primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Average resolution duration in milliseconds across all resolved/dismissed
 * workflows that have both createdAt and resolvedAt set.
 * Returns null when no resolved workflows exist.
 */
export function computeAverageResolutionDuration(
  workflows: readonly GovernanceWorkflowAction[],
): number | null {
  const durations: number[] = [];
  for (const wf of workflows) {
    if (TERMINAL_STATUSES.has(wf.workflowStatus) && wf.resolvedAt !== null) {
      durations.push(wf.resolvedAt.getTime() - wf.createdAt.getTime());
    }
  }
  if (durations.length === 0) return null;
  return durations.reduce((s, d) => s + d, 0) / durations.length;
}

/**
 * Average acknowledgment duration in milliseconds across all workflows
 * that have acknowledgedAt set.
 * Returns null when no acknowledged workflows exist.
 */
export function computeAverageAcknowledgmentDuration(
  workflows: readonly GovernanceWorkflowAction[],
): number | null {
  const durations: number[] = [];
  for (const wf of workflows) {
    if (wf.acknowledgedAt !== null) {
      durations.push(wf.acknowledgedAt.getTime() - wf.createdAt.getTime());
    }
  }
  if (durations.length === 0) return null;
  return durations.reduce((s, d) => s + d, 0) / durations.length;
}

/**
 * Average duration in milliseconds that critical-escalation, non-terminal
 * workflows have been open (from createdAt to `now`).
 * Returns null when no such workflows exist.
 */
export function computeCriticalUnresolvedDuration(
  workflows: readonly GovernanceWorkflowAction[],
  now: Date,
): number | null {
  const durations: number[] = [];
  for (const wf of workflows) {
    if (
      wf.escalationLevel === "critical" &&
      !TERMINAL_STATUSES.has(wf.workflowStatus)
    ) {
      durations.push(now.getTime() - wf.createdAt.getTime());
    }
  }
  if (durations.length === 0) return null;
  return durations.reduce((s, d) => s + d, 0) / durations.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate computation primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escalation rate = workflows that were ever escalated / total workflows.
 * "Ever escalated" = workflowStatus is "escalated" OR escalatedAt is set.
 */
export function computeEscalationRate(
  workflows: readonly GovernanceWorkflowAction[],
): number {
  if (workflows.length === 0) return 0;
  const escalatedCount = workflows.filter(
    wf => wf.workflowStatus === "escalated" || wf.escalatedAt !== null,
  ).length;
  return escalatedCount / workflows.length;
}

/**
 * Throughput rate = terminal (resolved + dismissed) / total workflows.
 * Represents what fraction of opened workflows have been closed.
 */
export function computeThroughputRate(
  workflows: readonly GovernanceWorkflowAction[],
): number {
  if (workflows.length === 0) return 0;
  const terminalCount = workflows.filter(
    wf => TERMINAL_STATUSES.has(wf.workflowStatus),
  ).length;
  return terminalCount / workflows.length;
}

/**
 * Dismissal frequency = dismissed / (resolved + dismissed).
 * Returns 0 when no terminal workflows exist.
 */
export function computeDismissalFrequency(
  workflows: readonly GovernanceWorkflowAction[],
): number {
  const terminal = workflows.filter(wf => TERMINAL_STATUSES.has(wf.workflowStatus));
  if (terminal.length === 0) return 0;
  const dismissed = terminal.filter(wf => wf.workflowStatus === "dismissed").length;
  return dismissed / terminal.length;
}

/**
 * Escalation-to-resolution ratio = escalated workflows / resolved workflows.
 * Returns 0 when no resolved workflows exist.
 * A high ratio means many escalations relative to the number of resolutions -
 * a sign of bottlenecked investigation throughput.
 */
export function computeEscalationToResolutionRatio(
  workflows: readonly GovernanceWorkflowAction[],
): number {
  const escalatedCount = workflows.filter(
    wf => wf.workflowStatus === "escalated" || wf.escalatedAt !== null,
  ).length;
  const resolvedCount = workflows.filter(
    wf => wf.workflowStatus === "resolved",
  ).length;
  if (resolvedCount === 0) return 0;
  return escalatedCount / resolvedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy breach recurrence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a map of policyId → workflow count (all statuses).
 * Only includes policies that appear in at least one workflow.
 * Ordered DESC by count (deterministic: ties broken by policyId ASC).
 */
export function detectRecurringPolicyBreaches(
  workflows: readonly GovernanceWorkflowAction[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const wf of workflows) {
    counts[wf.policyId] = (counts[wf.policyId] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort(
    ([aId, aC], [bId, bC]) => bC - aC || aId.localeCompare(bId),
  );
  return Object.fromEntries(sorted);
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceAnalyticsProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceAnalyticsProfile {
  profileId:                     string;
  workspaceId:                   number | null;
  totalWorkflows:                number;
  activeWorkflows:               number;
  resolvedWorkflows:             number;
  dismissedWorkflows:            number;
  escalatedWorkflows:            number;
  escalationRate:                number;
  throughputRate:                number;
  dismissalFrequency:            number;
  escalationToResolutionRatio:   number;
  averageResolutionDurationMs:   number | null;
  averageAcknowledgmentDurationMs: number | null;
  criticalUnresolvedDurationMs:  number | null;
  unresolvedCriticalCount:       number;
  policyBreachFrequency:         Record<string, number>;
  workflowStabilityScore:        WorkflowEffectivenessScore;
  evaluatedAt:                   Date;
}

/**
 * Computes a deterministic GovernanceAnalyticsProfile from a slice of workflow rows.
 *
 * @param workflows  Pre-filtered list of GovernanceWorkflowAction rows to analyse.
 *                   The caller is responsible for workspace scoping if needed.
 * @param workspaceId  Workspace scope (null for platform-wide).
 * @param now  Reference timestamp for open-duration calculations.
 */
export function evaluateGovernanceAnalytics(
  workflows: readonly GovernanceWorkflowAction[],
  workspaceId: number | null,
  now: Date,
): GovernanceAnalyticsProfile {
  const total          = workflows.length;
  const active         = workflows.filter(wf => !TERMINAL_STATUSES.has(wf.workflowStatus)).length;
  const resolved       = workflows.filter(wf => wf.workflowStatus === "resolved").length;
  const dismissed      = workflows.filter(wf => wf.workflowStatus === "dismissed").length;
  const escalated      = workflows.filter(
    wf => wf.workflowStatus === "escalated" || wf.escalatedAt !== null,
  ).length;
  const criticalUnresolved = workflows.filter(
    wf => wf.escalationLevel === "critical" && !TERMINAL_STATUSES.has(wf.workflowStatus),
  ).length;

  const escalationRate            = computeEscalationRate(workflows);
  const throughputRate            = computeThroughputRate(workflows);
  const dismissalFrequency        = computeDismissalFrequency(workflows);
  const escalationToResolutionRatio = computeEscalationToResolutionRatio(workflows);
  const avgResolutionMs           = computeAverageResolutionDuration(workflows);
  const avgAcknowledgmentMs       = computeAverageAcknowledgmentDuration(workflows);
  const criticalUnresolvedMs      = computeCriticalUnresolvedDuration(workflows, now);
  const policyBreachFrequency     = detectRecurringPolicyBreaches(workflows);
  const workflowStabilityScore    = classifyWorkflowEffectiveness(
    escalationRate,
    throughputRate,
    criticalUnresolved,
    avgResolutionMs,
  );

  const profileId = `gap:${workspaceId ?? "platform"}-${now.getTime()}`;

  return {
    profileId,
    workspaceId,
    totalWorkflows:                  total,
    activeWorkflows:                 active,
    resolvedWorkflows:               resolved,
    dismissedWorkflows:              dismissed,
    escalatedWorkflows:              escalated,
    escalationRate,
    throughputRate,
    dismissalFrequency,
    escalationToResolutionRatio,
    averageResolutionDurationMs:     avgResolutionMs,
    averageAcknowledgmentDurationMs: avgAcknowledgmentMs,
    criticalUnresolvedDurationMs:    criticalUnresolvedMs,
    unresolvedCriticalCount:         criticalUnresolved,
    policyBreachFrequency,
    workflowStabilityScore,
    evaluatedAt:                     now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PolicyEffectivenessProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyEffectivenessProfile {
  policyId:                    string;
  policyName:                  string;
  totalViolations:             number;
  confirmedViolationCount:     number;
  confirmedViolationRate:      number;
  falsePositiveCount:          number;
  falsePositiveRate:           number;
  operationalExceptionCount:   number;
  escalationCount:             number;
  escalationFrequency:         number;
  averageResolutionDurationMs: number | null;
  unresolvedCount:             number;
  unresolvedFrequency:         number;
  policyStabilityScore:        PolicyStabilityScore;
  evaluatedAt:                 Date;
}

/**
 * Computes effectiveness profile for a single policyId from its workflow rows.
 */
export function evaluatePolicyEffectiveness(
  workflows: readonly GovernanceWorkflowAction[],
  policyId: string,
  now: Date,
): PolicyEffectivenessProfile {
  const policyWorkflows = workflows.filter(wf => wf.policyId === policyId);
  const total           = policyWorkflows.length;

  const policy   = GOVERNANCE_POLICIES.find(p => p.policyId === policyId);
  const policyName = policy?.policyName ?? policyId;

  const confirmedCount     = policyWorkflows.filter(
    wf => wf.resolutionClassification === "confirmed_violation",
  ).length;
  const falsePositiveCount = policyWorkflows.filter(
    wf => wf.resolutionClassification === "false_positive",
  ).length;
  const opExceptionCount   = policyWorkflows.filter(
    wf => wf.resolutionClassification === "operational_exception",
  ).length;
  const escalationCount    = policyWorkflows.filter(
    wf => wf.workflowStatus === "escalated" || wf.escalatedAt !== null,
  ).length;
  const unresolvedCount    = policyWorkflows.filter(
    wf => !TERMINAL_STATUSES.has(wf.workflowStatus),
  ).length;

  const confirmedViolationRate = total > 0 ? confirmedCount / total : 0;
  const falsePositiveRate      = total > 0 ? falsePositiveCount / total : 0;
  const escalationFrequency    = total > 0 ? escalationCount / total : 0;
  const unresolvedFrequency    = total > 0 ? unresolvedCount / total : 0;
  const avgResolutionMs        = computeAverageResolutionDuration(policyWorkflows);

  const policyStabilityScore = classifyPolicyStability(
    confirmedViolationRate,
    falsePositiveRate,
    unresolvedFrequency,
  );

  return {
    policyId,
    policyName,
    totalViolations:             total,
    confirmedViolationCount:     confirmedCount,
    confirmedViolationRate,
    falsePositiveCount,
    falsePositiveRate,
    operationalExceptionCount:   opExceptionCount,
    escalationCount,
    escalationFrequency,
    averageResolutionDurationMs: avgResolutionMs,
    unresolvedCount,
    unresolvedFrequency,
    policyStabilityScore,
    evaluatedAt:                 now,
  };
}

/**
 * Evaluates effectiveness profiles for ALL policies that appear in at least
 * one workflow, plus any policyIds explicitly listed in GOVERNANCE_POLICIES.
 * Ordered by totalViolations DESC, then policyId ASC (deterministic).
 */
export function evaluateAllPolicyEffectiveness(
  workflows: readonly GovernanceWorkflowAction[],
  now: Date,
): PolicyEffectivenessProfile[] {
  const seenPolicyIds = new Set<string>();

  for (const wf of workflows) seenPolicyIds.add(wf.policyId);
  for (const p of GOVERNANCE_POLICIES)  seenPolicyIds.add(p.policyId);

  const profiles = Array.from(seenPolicyIds).map(
    pid => evaluatePolicyEffectiveness(workflows, pid, now),
  );

  profiles.sort(
    (a, b) =>
      b.totalViolations - a.totalViolations ||
      a.policyId.localeCompare(b.policyId),
  );

  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceEffectivenessReport
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEffectivenessReport {
  reportId:           string;
  totalWorkflows:     number;
  globalProfile:      GovernanceAnalyticsProfile;
  perPolicyProfiles:  PolicyEffectivenessProfile[];
  escalationTrend:    EscalationTrend;
  evaluatedAt:        Date;
}

/**
 * Builds a full platform-wide governance effectiveness report.
 * All sub-computations reuse the same `now` reference for determinism.
 */
export function buildGovernanceEffectivenessReport(
  workflows: readonly GovernanceWorkflowAction[],
  now: Date,
): GovernanceEffectivenessReport {
  const globalProfile      = evaluateGovernanceAnalytics(workflows, null, now);
  const perPolicyProfiles  = evaluateAllPolicyEffectiveness(workflows, now);
  const escalationTrend    = classifyEscalationTrend(
    globalProfile.escalationRate,
    globalProfile.unresolvedCriticalCount,
  );
  const reportId = `geff:${now.getTime()}`;

  return {
    reportId,
    totalWorkflows:    workflows.length,
    globalProfile,
    perPolicyProfiles,
    escalationTrend,
    evaluatedAt:       now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability events (structured log, no external calls)
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceAnalyticsEventPayload {
  workspaceId:             number | null;
  policyId:                string;
  effectivenessScore:      WorkflowEffectivenessScore | PolicyStabilityScore;
  escalationRate:          number;
  unresolvedCriticalCount: number;
  action:                  string;
}

/** A) governance_analytics_evaluated [INFO] */
export function emitGovernanceAnalyticsEvaluatedEvent(
  p: GovernanceAnalyticsEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_analytics_evaluated" },
    "governance_analytics_evaluated",
  );
}

/** B) policy_effectiveness_scored [INFO] */
export function emitPolicyEffectivenessScored(
  p: GovernanceAnalyticsEventPayload,
): void {
  logger?.info(
    { ...p, event: "policy_effectiveness_scored" },
    "policy_effectiveness_scored",
  );
}

/** C) workflow_stability_classified [INFO] */
export function emitWorkflowStabilityClassifiedEvent(
  p: GovernanceAnalyticsEventPayload,
): void {
  logger?.info(
    { ...p, event: "workflow_stability_classified" },
    "workflow_stability_classified",
  );
}

/** D) critical_unresolved_threshold_detected [WARN] */
export function emitCriticalUnresolvedThresholdDetectedEvent(
  p: GovernanceAnalyticsEventPayload,
): void {
  logger?.warn(
    { ...p, event: "critical_unresolved_threshold_detected" },
    "critical_unresolved_threshold_detected",
  );
}
