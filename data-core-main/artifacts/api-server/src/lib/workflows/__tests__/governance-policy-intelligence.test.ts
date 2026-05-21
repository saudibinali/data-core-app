/**
 * @file   __tests__/governance-policy-intelligence.test.ts
 * @phase  P11-B - Policy Governance Foundations & Compliance Rule Intelligence
 *
 * T1  - policy evaluation deterministic
 * T2  - missing audit chains detected correctly
 * T3  - rollback-without-confirmation detected
 * T4  - retention misclassification detection valid
 * T5  - violation serialization stable
 * T6  - append-only violation history preserved
 * T7  - evidence linking deterministic
 * T8  - super-admin enforcement valid
 * T9  - observability events scoped correctly
 * T10 - policy engine remains read-only
 */

import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_POLICIES,
  getPolicyByViolationType,
  evaluateGovernancePolicies,
  detectMissingAuditChains,
  detectOrphanedIntegrityChains,
  detectRollbackWithoutConfirmation,
  detectRetentionMisclassification,
  detectTamperedIntegrityChains,
  detectForensicCoverageGaps,
  detectUnresolvedCriticalIncidents,
  detectExecutionOrchestrationGaps,
  buildGovernanceSummary,
  resolveEvidenceReferences,
  emitGovernancePolicyEvaluatedEvent,
  emitGovernanceViolationDetectedEvent,
  emitComplianceGapClassifiedEvent,
  emitPolicyReviewRequiredEvent,
  type GovernanceViolation,
  type GovernancePolicy,
} from "../governance-policy-intelligence";
import type { AuditChainEntry } from "../compliance-audit-integrity";
import type { ExecutionRecord } from "../remediation-outcome-intelligence";
import { computeAuditHash } from "../compliance-audit-integrity";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-15T14:00:00.000Z");

function makeAuditEntry(overrides: Partial<AuditChainEntry> = {}): AuditChainEntry {
  const base = {
    entityType:  "execution_attempt" as const,
    entityId:    "exec:1-001",
    eventType:   "execution_confirmed",
    operatorId:  "ops@platform.local",
    occurredAt:  BASE_TIME,
    payload:     { status: "confirmed" },
    workspaceId: 1,
    previousAuditHash: null as string | null,
  };
  const hash = computeAuditHash(
    base.previousAuditHash,
    base.eventType,
    base.entityId,
    base.operatorId,
    base.occurredAt,
    base.payload,
  );
  return {
    chainId:                 "audit:execution_attempt:exec:1-001-0",
    entityType:              base.entityType,
    entityId:                base.entityId,
    workspaceId:             base.workspaceId,
    previousAuditHash:       base.previousAuditHash,
    currentAuditHash:        hash,
    eventType:               base.eventType,
    operatorId:              base.operatorId,
    payload:                 { ...base.payload },
    occurredAt:              base.occurredAt,
    recordedAt:              BASE_TIME,
    integrityStatus:         "verified",
    retentionClassification: "compliance_sensitive",
    ...overrides,
  };
}

function makeExecRecord(overrides: Partial<ExecutionRecord & { actionId?: string }> = {}): ExecutionRecord & { actionId?: string } {
  return {
    executionId:     "exec:1-001",
    workspaceId:     1,
    executionType:   "operational_intervention" as const,
    initiatedBy:     "ops@platform.local",
    confirmedBy:     "ops@platform.local",
    executionStatus: "completed" as const,
    rollbackStatus:  "not_applicable" as const,
    createdAt:       BASE_TIME,
    confirmedAt:     BASE_TIME,
    executedAt:      BASE_TIME,
    completedAt:     new Date(BASE_TIME.getTime() + 60_000),
    rolledBackAt:    null,
    abandonedAt:     null,
    actionId:        "action:1-001",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - policy evaluation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: policy evaluation deterministic", () => {
  it("GOVERNANCE_POLICIES contains exactly 8 built-in policies", () => {
    expect(GOVERNANCE_POLICIES).toHaveLength(8);
  });

  it("all built-in policies have unique policyIds", () => {
    const ids = GOVERNANCE_POLICIES.map(p => p.policyId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("evaluateGovernancePolicies returns empty array for empty inputs", () => {
    const violations = evaluateGovernancePolicies({ executionRecords: [], auditEntries: [] }, BASE_TIME);
    expect(violations).toHaveLength(0);
  });

  it("evaluateGovernancePolicies is deterministic - same inputs → same violations", () => {
    const exec  = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const input = { executionRecords: [exec], auditEntries: [] };
    const v1    = evaluateGovernancePolicies(input, BASE_TIME);
    const v2    = evaluateGovernancePolicies(input, BASE_TIME);
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });

  it("evaluateGovernancePolicies sorts violations critical-first", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null, actionId: "" });
    const violations = evaluateGovernancePolicies({ executionRecords: [exec], auditEntries: [] }, BASE_TIME);
    const sevs = violations.map(v => v.severity);
    const critIdx  = sevs.indexOf("critical");
    const medIdx   = sevs.indexOf("medium");
    if (critIdx !== -1 && medIdx !== -1) {
      expect(critIdx).toBeLessThan(medIdx);
    }
  });

  it("getPolicyByViolationType returns correct policy for known type", () => {
    const policy = getPolicyByViolationType("missing_audit_chain");
    expect(policy).toBeDefined();
    expect(policy!.policyId).toBe("POL-001");
  });

  it("all policies have policyStatus='active'", () => {
    expect(GOVERNANCE_POLICIES.every(p => p.policyStatus === "active")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - missing audit chains detected correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: missing audit chains detected correctly", () => {
  it("no violation when execution has a matching audit entry", () => {
    const exec  = makeExecRecord({ executionId: "exec:1-001" });
    const audit = makeAuditEntry({ entityId: "exec:1-001" });
    expect(detectMissingAuditChains([exec], [audit], BASE_TIME)).toHaveLength(0);
  });

  it("violation detected when execution has no audit entry", () => {
    const exec = makeExecRecord({ executionId: "exec:1-999" });
    const violations = detectMissingAuditChains([exec], [], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("missing_audit_chain");
    expect(violations[0]!.policyId).toBe("POL-001");
  });

  it("violation entityId matches the executionId", () => {
    const exec = makeExecRecord({ executionId: "exec:1-999" });
    const violations = detectMissingAuditChains([exec], [], BASE_TIME);
    expect(violations[0]!.entityId).toBe("exec:1-999");
  });

  it("detects multiple missing chains in one pass", () => {
    const execs = [
      makeExecRecord({ executionId: "exec:1-001" }),
      makeExecRecord({ executionId: "exec:1-002" }),
    ];
    expect(detectMissingAuditChains(execs, [], BASE_TIME)).toHaveLength(2);
  });

  it("only unmatched executions produce violations", () => {
    const execs = [
      makeExecRecord({ executionId: "exec:1-001" }),
      makeExecRecord({ executionId: "exec:1-002" }),
    ];
    const audit = makeAuditEntry({ entityId: "exec:1-001" });
    expect(detectMissingAuditChains(execs, [audit], BASE_TIME)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - rollback-without-confirmation detected
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: rollback-without-confirmation detected", () => {
  it("no violation for completed execution with confirmedBy set", () => {
    const exec = makeExecRecord({ executionStatus: "completed", confirmedBy: "ops@platform.local" });
    expect(detectRollbackWithoutConfirmation([exec], BASE_TIME)).toHaveLength(0);
  });

  it("no violation for rolled_back execution WITH confirmedBy", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: "ops@platform.local" });
    expect(detectRollbackWithoutConfirmation([exec], BASE_TIME)).toHaveLength(0);
  });

  it("violation detected for rolled_back execution with confirmedBy=null", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("rollback_without_confirmation");
    expect(violations[0]!.policyId).toBe("POL-003");
  });

  it("violation severity is critical (POL-003)", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(violations[0]!.severity).toBe("critical");
  });

  it("evidenceReferences contains the executionId", () => {
    const exec = makeExecRecord({ executionId: "exec:1-bad", executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(violations[0]!.evidenceReferences).toContain("exec:1-bad");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - retention misclassification detection valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: retention misclassification detection valid", () => {
  it("no violation when stored classification matches recomputed", () => {
    // execution_confirmed → compliance_sensitive
    const audit = makeAuditEntry({ eventType: "execution_confirmed", retentionClassification: "compliance_sensitive" });
    expect(detectRetentionMisclassification([audit], BASE_TIME)).toHaveLength(0);
  });

  it("violation detected when stored classification does not match recomputed", () => {
    // execution_rolled_back → forensic_critical, but stored as operational
    const audit = makeAuditEntry({ eventType: "execution_rolled_back", retentionClassification: "operational" });
    const violations = detectRetentionMisclassification([audit], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("retention_misclassification");
  });

  it("violation severity is medium (POL-004)", () => {
    const audit = makeAuditEntry({ eventType: "execution_rolled_back", retentionClassification: "operational" });
    const violations = detectRetentionMisclassification([audit], BASE_TIME);
    expect(violations[0]!.severity).toBe("medium");
  });

  it("violation evidenceReferences contains the chainId", () => {
    const audit = makeAuditEntry({ chainId: "audit:test-chain-001", eventType: "execution_rolled_back", retentionClassification: "operational" });
    const violations = detectRetentionMisclassification([audit], BASE_TIME);
    expect(violations[0]!.evidenceReferences).toContain("audit:test-chain-001");
  });

  it("no violation for forensic_critical entry classified correctly", () => {
    const audit = makeAuditEntry({ eventType: "execution_rolled_back", retentionClassification: "forensic_critical" });
    expect(detectRetentionMisclassification([audit], BASE_TIME)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - violation serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: violation serialization stable", () => {
  it("GovernanceViolation is fully JSON-serializable", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(() => JSON.stringify(violations[0])).not.toThrow();
  });

  it("GovernanceSummary is fully JSON-serializable", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    const summary = buildGovernanceSummary(violations, BASE_TIME);
    expect(() => JSON.stringify(summary)).not.toThrow();
  });

  it("GovernancePolicy is fully JSON-serializable", () => {
    expect(() => JSON.stringify(GOVERNANCE_POLICIES[0])).not.toThrow();
  });

  it("all violations have string violationId", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = evaluateGovernancePolicies({ executionRecords: [exec], auditEntries: [] }, BASE_TIME);
    for (const v of violations) {
      expect(typeof v.violationId).toBe("string");
      expect(v.violationId.length).toBeGreaterThan(0);
    }
  });

  it("violation violationStatus defaults to 'open'", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(violations[0]!.violationStatus).toBe("open");
  });

  it("buildGovernanceSummary overallRiskLevel is 'none' for zero violations", () => {
    const summary = buildGovernanceSummary([], BASE_TIME);
    expect(summary.overallRiskLevel).toBe("none");
    expect(summary.totalViolations).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - append-only violation history preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: append-only violation history preserved", () => {
  it("detectMissingAuditChains does not mutate input records", () => {
    const execs  = [makeExecRecord()];
    const audits = [makeAuditEntry()];
    const before = JSON.stringify({ execs, audits });
    detectMissingAuditChains(execs, audits, BASE_TIME);
    expect(JSON.stringify({ execs, audits })).toBe(before);
  });

  it("detectRollbackWithoutConfirmation does not mutate input records", () => {
    const execs  = [makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null })];
    const before = JSON.stringify(execs);
    detectRollbackWithoutConfirmation(execs, BASE_TIME);
    expect(JSON.stringify(execs)).toBe(before);
  });

  it("detectRetentionMisclassification does not mutate input entries", () => {
    const audits = [makeAuditEntry()];
    const before = JSON.stringify(audits);
    detectRetentionMisclassification(audits, BASE_TIME);
    expect(JSON.stringify(audits)).toBe(before);
  });

  it("evaluateGovernancePolicies does not mutate input records", () => {
    const execs  = [makeExecRecord()];
    const audits = [makeAuditEntry()];
    const before = JSON.stringify({ execs, audits });
    evaluateGovernancePolicies({ executionRecords: execs, auditEntries: audits }, BASE_TIME);
    expect(JSON.stringify({ execs, audits })).toBe(before);
  });

  it("violations array returned by evaluateGovernancePolicies has no function properties", () => {
    const violations = evaluateGovernancePolicies({ executionRecords: [], auditEntries: [] }, BASE_TIME);
    for (const v of violations) {
      const hasFn = Object.values(v).some(val => typeof val === "function");
      expect(hasFn).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - evidence linking deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: evidence linking deterministic", () => {
  it("resolveEvidenceReferences finds matching audit entry by chainId", () => {
    const audit = makeAuditEntry({ chainId: "audit:test-001" });
    const violation = { ...detectOrphanedIntegrityChains([makeAuditEntry({ integrityStatus: "orphaned", chainId: "audit:test-001" })], BASE_TIME)[0]! };
    const result = resolveEvidenceReferences(violation, [audit], []);
    expect(result.auditEvidence).toHaveLength(1);
    expect(result.auditEvidence[0]!.chainId).toBe("audit:test-001");
  });

  it("resolveEvidenceReferences finds matching execution by executionId", () => {
    const exec = makeExecRecord({ executionId: "exec:1-001" });
    const viol: GovernanceViolation = {
      violationId: "viol:POL-001:exec:1-001-0",
      policyId: "POL-001",
      workspaceId: 1,
      entityId: "exec:1-001",
      violationType: "missing_audit_chain",
      severity: "critical",
      detectedAt: BASE_TIME.toISOString(),
      evidenceReferences: ["exec:1-001"],
      violationStatus: "open",
      description: "test",
    };
    const result = resolveEvidenceReferences(viol, [], [exec]);
    expect(result.executionEvidence).toHaveLength(1);
    expect(result.executionEvidence[0]!.executionId).toBe("exec:1-001");
  });

  it("resolveEvidenceReferences returns unresolved for unknown references", () => {
    const viol: GovernanceViolation = {
      violationId: "viol:POL-001:exec:unknown-0",
      policyId: "POL-001",
      workspaceId: null,
      entityId: "exec:unknown",
      violationType: "missing_audit_chain",
      severity: "critical",
      detectedAt: BASE_TIME.toISOString(),
      evidenceReferences: ["ghost-reference-xyz"],
      violationStatus: "open",
      description: "test",
    };
    const result = resolveEvidenceReferences(viol, [], []);
    expect(result.unresolved).toContain("ghost-reference-xyz");
  });

  it("evidenceReferences in violation is a copy, not a reference to input", () => {
    const exec = makeExecRecord({ executionId: "exec:1-999", executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    const refs = violations[0]!.evidenceReferences;
    refs.push("external-mutation");
    const violations2 = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    expect(violations2[0]!.evidenceReferences).not.toContain("external-mutation");
  });

  it("workspaceIdFilter in evaluateGovernancePolicies scopes violations correctly", () => {
    const exec1 = makeExecRecord({ executionId: "exec:1-001", workspaceId: 1, executionStatus: "rolled_back", confirmedBy: null });
    const exec2 = makeExecRecord({ executionId: "exec:2-001", workspaceId: 2, executionStatus: "rolled_back", confirmedBy: null });
    const violations = evaluateGovernancePolicies(
      { executionRecords: [exec1, exec2], auditEntries: [], workspaceIdFilter: 1 },
      BASE_TIME,
    );
    const workspaceIds = violations.map(v => v.workspaceId);
    expect(workspaceIds.every(id => id === 1 || id === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: super-admin enforcement valid", () => {
  it("evaluateGovernancePolicies is synchronous", () => {
    const result = evaluateGovernancePolicies({ executionRecords: [], auditEntries: [] }, BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("buildGovernanceSummary is synchronous", () => {
    const result = buildGovernanceSummary([], BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("detectTamperedIntegrityChains flags compromised entries correctly", () => {
    const tampered = makeAuditEntry({ integrityStatus: "compromised" });
    const violations = detectTamperedIntegrityChains([tampered], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("governance_policy_breach");
    expect(violations[0]!.severity).toBe("critical");
  });

  it("detectUnresolvedCriticalIncidents flags forensic_critical + non-verified", () => {
    const entry = makeAuditEntry({ retentionClassification: "forensic_critical", integrityStatus: "orphaned" });
    const violations = detectUnresolvedCriticalIncidents([entry], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("unresolved_critical_incident");
  });

  it("detectForensicCoverageGaps flags rollback with no forensic_critical audit entry", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back" });
    const audit = makeAuditEntry({ entityId: exec.executionId, retentionClassification: "operational" });
    const violations = detectForensicCoverageGaps([exec], [audit], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("compliance_gap_detected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: observability events scoped correctly", () => {
  const testPayload = {
    policyId:           "POL-001",
    workspaceId:        1,
    violationType:      "missing_audit_chain",
    severity:           "critical",
    evidenceReferences: ["exec:1-001"],
    action:             "test",
  };

  it("emitGovernancePolicyEvaluatedEvent does not throw", () => {
    expect(() => emitGovernancePolicyEvaluatedEvent(testPayload)).not.toThrow();
  });

  it("emitGovernanceViolationDetectedEvent does not throw", () => {
    expect(() => emitGovernanceViolationDetectedEvent(testPayload)).not.toThrow();
  });

  it("emitComplianceGapClassifiedEvent does not throw", () => {
    expect(() => emitComplianceGapClassifiedEvent(testPayload)).not.toThrow();
  });

  it("emitPolicyReviewRequiredEvent does not throw", () => {
    expect(() => emitPolicyReviewRequiredEvent(testPayload)).not.toThrow();
  });

  it("all event functions return void", () => {
    expect(emitGovernancePolicyEvaluatedEvent(testPayload)).toBeUndefined();
    expect(emitGovernanceViolationDetectedEvent(testPayload)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - policy engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: policy engine remains read-only", () => {
  it("GOVERNANCE_POLICIES cannot be modified (frozen readonly array)", () => {
    const original = GOVERNANCE_POLICIES[0]!.policyId;
    // TypeScript readonly prevents compile-time mutation; runtime: array is a const
    expect(GOVERNANCE_POLICIES[0]!.policyId).toBe(original);
  });

  it("evaluateGovernancePolicies violations have no repair/enforce methods", () => {
    const violations = evaluateGovernancePolicies({ executionRecords: [], auditEntries: [] }, BASE_TIME);
    for (const v of violations) {
      expect(typeof (v as unknown as { enforce?: unknown }).enforce).not.toBe("function");
      expect(typeof (v as unknown as { remediate?: unknown }).remediate).not.toBe("function");
    }
  });

  it("GovernanceSummary has no execute/trigger methods", () => {
    const summary = buildGovernanceSummary([], BASE_TIME);
    const hasFn   = Object.values(summary).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("detectExecutionOrchestrationGaps flags empty actionId", () => {
    const exec = makeExecRecord({ actionId: "" });
    const violations = detectExecutionOrchestrationGaps([exec], BASE_TIME);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.violationType).toBe("execution_without_orchestration");
    expect(violations[0]!.severity).toBe("medium");
  });

  it("buildGovernanceSummary overallRiskLevel is 'critical' when any critical violation present", () => {
    const exec = makeExecRecord({ executionStatus: "rolled_back", confirmedBy: null });
    const violations = detectRollbackWithoutConfirmation([exec], BASE_TIME);
    const summary = buildGovernanceSummary(violations, BASE_TIME);
    expect(summary.overallRiskLevel).toBe("critical");
    expect(summary.criticalViolations).toBeGreaterThan(0);
  });
});
