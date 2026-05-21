/**
 * @file   lib/workflows/governance-policy-intelligence.ts
 * @phase  P11-B - Policy Governance Foundations & Compliance Rule Intelligence
 *
 * Pure deterministic governance policy evaluation engine.
 * READ-ONLY: no DB writes, no enforcement, no automatic remediation.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Provides built-in governance policies and a deterministic rule evaluation
 *   engine that detects policy violations from existing compliance + execution data.
 *
 *   GOVERNANCE_POLICIES           - 8 built-in policy definitions (constants)
 *
 *   evaluateGovernancePolicies(auditEntries, executionRecords)
 *     → GovernanceViolation[]      (all detected violations)
 *
 *   detectMissingAuditChains(executionIds, auditEntries)
 *     → GovernanceViolation[]      (POL-001: executions with no audit chain)
 *
 *   detectOrphanedIntegrityChains(auditEntries)
 *     → GovernanceViolation[]      (POL-002: orphaned chain links)
 *
 *   detectRollbackWithoutConfirmation(executionRecords)
 *     → GovernanceViolation[]      (POL-003: rolled_back + no confirmedBy)
 *
 *   detectRetentionMisclassification(auditEntries)
 *     → GovernanceViolation[]      (POL-004: stored classification ≠ recomputed)
 *
 *   detectTamperedIntegrityChains(auditEntries)
 *     → GovernanceViolation[]      (POL-005: integrityStatus="compromised")
 *
 *   detectForensicCoverageGaps(executionRecords, auditEntries)
 *     → GovernanceViolation[]      (POL-006: rollback with no forensic audit entry)
 *
 *   detectUnresolvedCriticalIncidents(auditEntries)
 *     → GovernanceViolation[]      (POL-007: forensic_critical + not verified)
 *
 *   detectExecutionOrchestrationGaps(executionRecords)
 *     → GovernanceViolation[]      (POL-008: execution with empty actionId)
 *
 *   buildGovernanceSummary(violations)
 *     → GovernanceSummary          (aggregate stats by type / severity)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   READ-ONLY:         engine never writes to DB, never mutates input records
 *   NO ENFORCEMENT:    violations are intelligence only, never trigger actions
 *   NO AI:             all rule evaluation is deterministic keyword + status checks
 *   FAIL-CLOSED:       ambiguous states produce a violation, never silently pass
 *   APPEND-ONLY:       violation history is not modified by the engine
 *   DETERMINISTIC:     same inputs → same violations, same ordering, every time
 */

import { logger } from "../logger";
import { classifyRetention } from "./compliance-audit-integrity";
import type {
  AuditChainEntry,
  AuditEntityType,
  RetentionClassification,
} from "./compliance-audit-integrity";
import type { ExecutionRecord } from "./remediation-outcome-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE POLICY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PolicySeverity  = "critical" | "high" | "medium" | "low";
export type PolicyScope     = "workspace" | "platform" | "entity";
export type PolicyStatus    = "active" | "inactive" | "under_review";
export type PolicyCategory  =
  | "audit_integrity"
  | "execution_governance"
  | "retention_compliance"
  | "forensic_coverage"
  | "operational_continuity";

export type GovernanceViolationType =
  | "missing_audit_chain"
  | "orphaned_integrity_chain"
  | "rollback_without_confirmation"
  | "execution_without_orchestration"
  | "retention_misclassification"
  | "unresolved_critical_incident"
  | "compliance_gap_detected"
  | "governance_policy_breach";

export type ViolationStatus = "open" | "acknowledged" | "resolved";

/**
 * A built-in governance policy definition.
 * Policies are defined in code - never stored in DB.
 * They are immutable constants within this module.
 */
export interface GovernancePolicy {
  policyId:         string;
  policyName:       string;
  policyCategory:   PolicyCategory;
  policySeverity:   PolicySeverity;
  policyScope:      PolicyScope;
  evaluationMode:   "automated" | "manual";
  policyStatus:     PolicyStatus;
  createdBy:        string;
  createdAt:        string;   // ISO 8601
  lastReviewedAt:   string;   // ISO 8601
  description:      string;
  violationType:    GovernanceViolationType;
}

/**
 * A detected governance policy violation.
 * Produced by the evaluation engine from live compliance + execution data.
 * Never persisted - computed on demand, returned as JSON.
 */
export interface GovernanceViolation {
  violationId:        string;  // "viol:<policyId>:<entityId>:<detectedAtMs>"
  policyId:           string;
  workspaceId:        number | null;
  entityId:           string;
  violationType:      GovernanceViolationType;
  severity:           PolicySeverity;
  detectedAt:         string;   // ISO 8601
  evidenceReferences: string[]; // chainIds, executionIds, or other audit IDs
  violationStatus:    ViolationStatus;
  description:        string;
}

/**
 * Aggregate governance health summary.
 */
export interface GovernanceSummary {
  totalViolations:     number;
  criticalViolations:  number;
  highViolations:      number;
  mediumViolations:    number;
  lowViolations:       number;
  openViolations:      number;
  bySeverity:          Record<PolicySeverity, number>;
  byViolationType:     Partial<Record<GovernanceViolationType, number>>;
  overallRiskLevel:    PolicySeverity | "none";
  evaluatedAt:         string;  // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN GOVERNANCE POLICIES (immutable constants)
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_META_DATE = "2026-01-01T00:00:00.000Z";
const POLICY_REVIEW_DATE = "2026-05-15T00:00:00.000Z";

/**
 * 8 built-in governance policies.
 * Immutable: never modified at runtime.
 * Each maps to one GovernanceViolationType.
 */
export const GOVERNANCE_POLICIES: ReadonlyArray<GovernancePolicy> = [
  {
    policyId:       "POL-001",
    policyName:     "Audit Chain Completeness",
    policyCategory: "audit_integrity",
    policySeverity: "critical",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Every remediation execution attempt MUST have at least one corresponding " +
      "audit chain entry for traceability. Executions with no audit record violate " +
      "forensic completeness requirements.",
    violationType:  "missing_audit_chain",
  },
  {
    policyId:       "POL-002",
    policyName:     "Integrity Chain Continuity",
    policyCategory: "audit_integrity",
    policySeverity: "high",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Audit chain entries MUST form a continuous linked list. An orphaned entry " +
      "(previousAuditHash references a non-existent predecessor) indicates a broken " +
      "chain that may have resulted from record deletion or corruption.",
    violationType:  "orphaned_integrity_chain",
  },
  {
    policyId:       "POL-003",
    policyName:     "Rollback Confirmation Requirement",
    policyCategory: "execution_governance",
    policySeverity: "critical",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Any remediation execution that reaches rolled_back status MUST have been " +
      "confirmed by an identified operator (confirmedBy non-null). A rollback " +
      "without prior confirmation indicates the execution lifecycle was bypassed.",
    violationType:  "rollback_without_confirmation",
  },
  {
    policyId:       "POL-004",
    policyName:     "Retention Classification Accuracy",
    policyCategory: "retention_compliance",
    policySeverity: "medium",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Audit chain entries MUST carry the correct retention classification " +
      "as determined by classifyRetention(entityType, eventType). A mismatch " +
      "between stored and recomputed classification indicates the entry was " +
      "either tampered with or recorded with an incorrect classification.",
    violationType:  "retention_misclassification",
  },
  {
    policyId:       "POL-005",
    policyName:     "Integrity Tamper Detection",
    policyCategory: "audit_integrity",
    policySeverity: "critical",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Any audit chain entry with integrityStatus='compromised' represents a " +
      "confirmed hash mismatch indicating the entry content may have been " +
      "modified after recording. This is a critical governance breach requiring " +
      "immediate human review.",
    violationType:  "governance_policy_breach",
  },
  {
    policyId:       "POL-006",
    policyName:     "Forensic Coverage for Rollback Events",
    policyCategory: "forensic_coverage",
    policySeverity: "high",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Every rolled-back execution MUST have a corresponding forensic_critical " +
      "audit chain entry to ensure rollback events are captured in the immutable " +
      "audit log. A rollback with no forensic audit entry creates a coverage gap.",
    violationType:  "compliance_gap_detected",
  },
  {
    policyId:       "POL-007",
    policyName:     "Unresolved Critical Compliance Events",
    policyCategory: "forensic_coverage",
    policySeverity: "high",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Forensic-critical audit chain entries (retentionClassification='forensic_critical') " +
      "with integrityStatus != 'verified' represent unresolved critical compliance events. " +
      "These entries require human review and integrity restoration before they can " +
      "be considered resolved.",
    violationType:  "unresolved_critical_incident",
  },
  {
    policyId:       "POL-008",
    policyName:     "Execution Orchestration Linkage",
    policyCategory: "execution_governance",
    policySeverity: "medium",
    policyScope:    "entity",
    evaluationMode: "automated",
    policyStatus:   "active",
    createdBy:      "platform",
    createdAt:      POLICY_META_DATE,
    lastReviewedAt: POLICY_REVIEW_DATE,
    description:
      "Every remediation execution attempt MUST reference a valid orchestration " +
      "action via a non-empty actionId. Executions with an empty actionId indicate " +
      "the execution lifecycle was initiated outside the governed orchestration chain.",
    violationType:  "execution_without_orchestration",
  },
] as const;

/** Map for fast policy lookup by violationType. */
const POLICY_BY_TYPE = new Map<GovernanceViolationType, GovernancePolicy>(
  GOVERNANCE_POLICIES.map(p => [p.violationType, p]),
);

/** Get the active policy for a violationType. Returns undefined if none active. */
export function getPolicyByViolationType(
  type: GovernanceViolationType,
): GovernancePolicy | undefined {
  return POLICY_BY_TYPE.get(type);
}

// ─────────────────────────────────────────────────────────────────────────────
// VIOLATION BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildViolation(
  policy:             GovernancePolicy,
  entityId:           string,
  workspaceId:        number | null,
  evidenceReferences: string[],
  description:        string,
  now:                Date,
): GovernanceViolation {
  return {
    violationId:        `viol:${policy.policyId}:${entityId}-${now.getTime()}`,
    policyId:           policy.policyId,
    workspaceId,
    entityId,
    violationType:      policy.violationType,
    severity:           policy.policySeverity,
    detectedAt:         now.toISOString(),
    evidenceReferences: [...evidenceReferences],
    violationStatus:    "open",
    description,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL VIOLATION DETECTORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POL-001: Audit Chain Completeness
 * Detects execution attempts that have no corresponding audit chain entry.
 *
 * Pure: no DB, no async.
 */
export function detectMissingAuditChains(
  executionRecords: ReadonlyArray<ExecutionRecord>,
  auditEntries:     ReadonlyArray<AuditChainEntry>,
  now:              Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-001")!;
  const auditedEntityIds = new Set(auditEntries.map(e => e.entityId));
  const violations: GovernanceViolation[] = [];

  for (const exec of executionRecords) {
    if (!auditedEntityIds.has(exec.executionId)) {
      violations.push(buildViolation(
        policy,
        exec.executionId,
        exec.workspaceId,
        [exec.executionId],
        `Execution ${exec.executionId} (type: ${exec.executionType}) has no audit chain entries.`,
        now,
      ));
    }
  }

  return violations;
}

/**
 * POL-002: Integrity Chain Continuity
 * Detects audit entries with integrityStatus="orphaned".
 *
 * Pure: no DB, no async.
 */
export function detectOrphanedIntegrityChains(
  auditEntries: ReadonlyArray<AuditChainEntry>,
  now:          Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-002")!;
  return auditEntries
    .filter(e => e.integrityStatus === "orphaned")
    .map(e =>
      buildViolation(
        policy,
        e.entityId,
        e.workspaceId,
        [e.chainId],
        `Audit chain entry ${e.chainId} for entity ${e.entityId} is orphaned: ` +
        `previousAuditHash "${e.previousAuditHash?.slice(0, 8)}..." resolves to no known entry.`,
        now,
      ),
    );
}

/**
 * POL-003: Rollback Confirmation Requirement
 * Detects executions that were rolled_back but had no confirmedBy operator.
 *
 * Pure: no DB, no async.
 */
export function detectRollbackWithoutConfirmation(
  executionRecords: ReadonlyArray<ExecutionRecord>,
  now:              Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-003")!;
  return executionRecords
    .filter(
      r => r.executionStatus === "rolled_back" && (r.confirmedBy === null || r.confirmedBy === ""),
    )
    .map(r =>
      buildViolation(
        policy,
        r.executionId,
        r.workspaceId,
        [r.executionId],
        `Execution ${r.executionId} was rolled back but was never confirmed by an operator. ` +
        `confirmedBy is null - the execution lifecycle may have been bypassed.`,
        now,
      ),
    );
}

/**
 * POL-004: Retention Classification Accuracy
 * Detects audit entries where stored retentionClassification ≠ recomputed value.
 *
 * Pure: no DB, no async.
 */
export function detectRetentionMisclassification(
  auditEntries: ReadonlyArray<AuditChainEntry>,
  now:          Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-004")!;
  const violations: GovernanceViolation[] = [];

  for (const entry of auditEntries) {
    const expected = classifyRetention(entry.entityType, entry.eventType);
    if (expected !== entry.retentionClassification) {
      violations.push(buildViolation(
        policy,
        entry.entityId,
        entry.workspaceId,
        [entry.chainId],
        `Audit entry ${entry.chainId} has retentionClassification="${entry.retentionClassification}" ` +
        `but classifyRetention("${entry.entityType}", "${entry.eventType}") produces "${expected}". ` +
        `Possible tampering or recording error.`,
        now,
      ));
    }
  }

  return violations;
}

/**
 * POL-005: Integrity Tamper Detection
 * Detects audit entries with integrityStatus="compromised".
 *
 * Pure: no DB, no async.
 */
export function detectTamperedIntegrityChains(
  auditEntries: ReadonlyArray<AuditChainEntry>,
  now:          Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-005")!;
  return auditEntries
    .filter(e => e.integrityStatus === "compromised")
    .map(e =>
      buildViolation(
        policy,
        e.entityId,
        e.workspaceId,
        [e.chainId],
        `Audit chain entry ${e.chainId} has integrityStatus="compromised". ` +
        `The stored hash does not match the recomputed hash - content may have been ` +
        `modified after recording. Immediate review required.`,
        now,
      ),
    );
}

/**
 * POL-006: Forensic Coverage for Rollback Events
 * Detects rolled-back executions that have no forensic_critical audit chain entry.
 *
 * A rollback execution should produce at least one audit entry with
 * retentionClassification="forensic_critical" for the same entityId (executionId).
 *
 * Pure: no DB, no async.
 */
export function detectForensicCoverageGaps(
  executionRecords: ReadonlyArray<ExecutionRecord>,
  auditEntries:     ReadonlyArray<AuditChainEntry>,
  now:              Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-006")!;

  // Build index: entityId → forensic_critical audit entries
  const forensicByEntityId = new Map<string, AuditChainEntry[]>();
  for (const entry of auditEntries) {
    if (entry.retentionClassification === "forensic_critical") {
      const existing = forensicByEntityId.get(entry.entityId);
      if (existing) existing.push(entry);
      else forensicByEntityId.set(entry.entityId, [entry]);
    }
  }

  const violations: GovernanceViolation[] = [];
  for (const exec of executionRecords) {
    if (exec.executionStatus === "rolled_back") {
      const forensicEntries = forensicByEntityId.get(exec.executionId) ?? [];
      if (forensicEntries.length === 0) {
        violations.push(buildViolation(
          policy,
          exec.executionId,
          exec.workspaceId,
          [exec.executionId],
          `Execution ${exec.executionId} was rolled back but has no forensic_critical ` +
          `audit chain entry. The rollback event is not covered in the immutable audit log.`,
          now,
        ));
      }
    }
  }

  return violations;
}

/**
 * POL-007: Unresolved Critical Compliance Events
 * Detects forensic_critical audit entries with integrityStatus != "verified".
 *
 * Pure: no DB, no async.
 */
export function detectUnresolvedCriticalIncidents(
  auditEntries: ReadonlyArray<AuditChainEntry>,
  now:          Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-007")!;
  return auditEntries
    .filter(
      e =>
        e.retentionClassification === "forensic_critical" &&
        e.integrityStatus !== "verified",
    )
    .map(e =>
      buildViolation(
        policy,
        e.entityId,
        e.workspaceId,
        [e.chainId],
        `Forensic-critical audit entry ${e.chainId} for entity ${e.entityId} ` +
        `has integrityStatus="${e.integrityStatus}". Critical compliance events ` +
        `must be in "verified" state. Human review and integrity investigation required.`,
        now,
      ),
    );
}

/**
 * POL-008: Execution Orchestration Linkage
 * Detects executions with an empty actionId (no orchestration link).
 *
 * Pure: no DB, no async.
 */
export function detectExecutionOrchestrationGaps(
  executionRecords: ReadonlyArray<ExecutionRecord & { actionId?: string }>,
  now:              Date = new Date(),
): GovernanceViolation[] {
  const policy = GOVERNANCE_POLICIES.find(p => p.policyId === "POL-008")!;
  return executionRecords
    .filter(r => {
      const aid = (r as { actionId?: string }).actionId;
      return aid === "" || aid === null || aid === undefined;
    })
    .map(r =>
      buildViolation(
        policy,
        r.executionId,
        r.workspaceId,
        [r.executionId],
        `Execution ${r.executionId} has an empty or missing actionId - it was not ` +
        `initiated through the governed orchestration chain (P10-D). ` +
        `All executions must trace back to a recovery orchestration action.`,
        now,
      ),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER EVALUATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEvaluationInput {
  executionRecords:  ReadonlyArray<ExecutionRecord & { actionId?: string }>;
  auditEntries:      ReadonlyArray<AuditChainEntry>;
  workspaceIdFilter?: number;  // if set, only violations for this workspace are returned
}

/**
 * Runs all active governance policies against the provided data.
 * Returns all detected violations, sorted by severity (critical first) then detectedAt.
 *
 * Severity order: critical > high > medium > low
 *
 * Pure: no DB, no async, no side effects. Deterministic.
 */
export function evaluateGovernancePolicies(
  input: GovernanceEvaluationInput,
  now:   Date = new Date(),
): GovernanceViolation[] {
  const { executionRecords, auditEntries, workspaceIdFilter } = input;

  const allViolations: GovernanceViolation[] = [
    ...detectMissingAuditChains(executionRecords, auditEntries, now),
    ...detectOrphanedIntegrityChains(auditEntries, now),
    ...detectRollbackWithoutConfirmation(executionRecords, now),
    ...detectRetentionMisclassification(auditEntries, now),
    ...detectTamperedIntegrityChains(auditEntries, now),
    ...detectForensicCoverageGaps(executionRecords, auditEntries, now),
    ...detectUnresolvedCriticalIncidents(auditEntries, now),
    ...detectExecutionOrchestrationGaps(executionRecords, now),
  ];

  const filtered = workspaceIdFilter != null
    ? allViolations.filter(
        v => v.workspaceId === workspaceIdFilter || v.workspaceId === null,
      )
    : allViolations;

  const SEVERITY_ORDER: Record<PolicySeverity, number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
  };

  return filtered.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return a.detectedAt.localeCompare(b.detectedAt);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds an aggregate governance health summary from evaluated violations.
 * Pure: no DB, no async, no side effects.
 */
export function buildGovernanceSummary(
  violations: ReadonlyArray<GovernanceViolation>,
  now:        Date = new Date(),
): GovernanceSummary {
  const bySeverity: Record<PolicySeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0,
  };
  const byType: Partial<Record<GovernanceViolationType, number>> = {};
  let openCount = 0;

  for (const v of violations) {
    bySeverity[v.severity]++;
    byType[v.violationType] = (byType[v.violationType] ?? 0) + 1;
    if (v.violationStatus === "open") openCount++;
  }

  let overallRiskLevel: PolicySeverity | "none" = "none";
  if (bySeverity.critical > 0)      overallRiskLevel = "critical";
  else if (bySeverity.high > 0)     overallRiskLevel = "high";
  else if (bySeverity.medium > 0)   overallRiskLevel = "medium";
  else if (bySeverity.low > 0)      overallRiskLevel = "low";

  return {
    totalViolations:    violations.length,
    criticalViolations: bySeverity.critical,
    highViolations:     bySeverity.high,
    mediumViolations:   bySeverity.medium,
    lowViolations:      bySeverity.low,
    openViolations:     openCount,
    bySeverity,
    byViolationType:    byType,
    overallRiskLevel,
    evaluatedAt:        now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE LINKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves evidence references in a violation to matching audit chain entries
 * and execution records. Returns a combined evidence bundle for the violation.
 *
 * Pure: no DB, no async, no side effects.
 */
export function resolveEvidenceReferences(
  violation:        GovernanceViolation,
  auditEntries:     ReadonlyArray<AuditChainEntry>,
  executionRecords: ReadonlyArray<ExecutionRecord>,
): {
  auditEvidence:     AuditChainEntry[];
  executionEvidence: ExecutionRecord[];
  unresolved:        string[];
} {
  const auditEvidence:     AuditChainEntry[] = [];
  const executionEvidence: ExecutionRecord[]  = [];
  const unresolved:        string[]           = [];

  const auditByChainId  = new Map(auditEntries.map(e => [e.chainId, e]));
  const execByExecId    = new Map(executionRecords.map(r => [r.executionId, r]));

  for (const ref of violation.evidenceReferences) {
    const auditEntry = auditByChainId.get(ref);
    const execRecord = execByExecId.get(ref);

    if (auditEntry) {
      auditEvidence.push(auditEntry);
    } else if (execRecord) {
      executionEvidence.push(execRecord);
    } else {
      unresolved.push(ref);
    }
  }

  return { auditEvidence, executionEvidence, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEventPayload {
  policyId:           string;
  workspaceId:        number | null;
  violationType:      string;
  severity:           string;
  evidenceReferences: string[];
  action:             string;
}

export function emitGovernancePolicyEvaluatedEvent(p: GovernanceEventPayload): void {
  logger.info(
    { event: "governance_policy_evaluated", ...p },
    "[governance-policy] P11-B: governance_policy_evaluated",
  );
}

export function emitGovernanceViolationDetectedEvent(p: GovernanceEventPayload): void {
  logger.warn(
    { event: "governance_violation_detected", ...p },
    "[governance-policy] P11-B: governance_violation_detected - REVIEW REQUIRED",
  );
}

export function emitComplianceGapClassifiedEvent(p: GovernanceEventPayload): void {
  logger.warn(
    { event: "compliance_gap_classified", ...p },
    "[governance-policy] P11-B: compliance_gap_classified",
  );
}

export function emitPolicyReviewRequiredEvent(p: GovernanceEventPayload): void {
  logger.warn(
    { event: "policy_review_required", ...p },
    "[governance-policy] P11-B: policy_review_required",
  );
}
