/**
 * @file   __tests__/compliance-audit-integrity.test.ts
 * @phase  P11-A - Compliance Governance Foundations & Immutable Audit Integrity
 *
 * T1  - audit chain deterministic
 * T2  - hash continuity verification stable
 * T3  - tamper anomaly detection valid
 * T4  - orphaned record detection correct
 * T5  - forensic reconstruction chronological
 * T6  - retention classification deterministic
 * T7  - append-only guarantees preserved
 * T8  - serialization ordering stable
 * T9  - super-admin enforcement valid
 * T10 - compliance layer remains read-only
 */

import { describe, it, expect } from "vitest";
import {
  computeAuditHash,
  buildAuditChainEntry,
  validateAuditChainInput,
  verifyAuditIntegrity,
  detectTamperAnomalies,
  detectOrphanedRecords,
  classifyRetention,
  reconstructAuditTimeline,
  buildComplianceSummary,
  emitAuditChainRecordedEvent,
  emitAuditIntegrityVerifiedEvent,
  emitAuditIntegrityAnomalyDetectedEvent,
  emitForensicTimelineReconstructedEvent,
  GENESIS_HASH_SENTINEL,
  AUDIT_ERROR_CODES,
  type AuditChainEntry,
  type AuditChainEntryInput,
} from "../compliance-audit-integrity";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME   = new Date("2026-05-15T14:00:00.000Z");
const BASE_TIME_2 = new Date("2026-05-15T14:01:00.000Z");
const BASE_TIME_3 = new Date("2026-05-15T14:02:00.000Z");

function makeInput(overrides: Partial<AuditChainEntryInput> = {}): AuditChainEntryInput {
  return {
    entityType:        "execution_attempt",
    entityId:          "exec:1-001",
    workspaceId:       1,
    previousAuditHash: null,
    eventType:         "execution_confirmed",
    operatorId:        "ops@platform.local",
    payload:           { status: "confirmed" },
    occurredAt:        BASE_TIME,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<AuditChainEntry> = {}): AuditChainEntry {
  const base = makeInput();
  const hash = computeAuditHash(
    base.previousAuditHash,
    base.eventType,
    base.entityId,
    base.operatorId,
    base.occurredAt,
    base.payload,
  );
  return {
    chainId:                 "audit:execution_attempt:exec:1-001-1747310400000",
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

/** Build a linked chain of valid entries. */
function makeChain(n: number, entityId = "exec:1-001"): AuditChainEntry[] {
  const entries: AuditChainEntry[] = [];
  let prev: string | null = null;
  const types = ["execution_confirmed", "status_updated", "execution_completed"];
  for (let i = 0; i < n; i++) {
    const eventType  = types[i % types.length]!;
    const occurredAt = new Date(BASE_TIME.getTime() + i * 60_000);
    const hash       = computeAuditHash(prev, eventType, entityId, "ops@platform.local", occurredAt, { step: i });
    entries.push(makeEntry({
      chainId:           `audit:execution_attempt:${entityId}-${i}`,
      entityId,
      eventType,
      previousAuditHash: prev,
      currentAuditHash:  hash,
      occurredAt,
      payload:           { step: i },
    }));
    prev = hash;
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - audit chain deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: audit chain deterministic", () => {
  it("computeAuditHash returns 64-char hex string (SHA-256)", () => {
    const h = computeAuditHash(null, "execution_confirmed", "exec:1-001", "ops", BASE_TIME, {});
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeAuditHash is identical for same inputs", () => {
    const h1 = computeAuditHash(null, "execution_confirmed", "exec:1-001", "ops", BASE_TIME, { a: 1 });
    const h2 = computeAuditHash(null, "execution_confirmed", "exec:1-001", "ops", BASE_TIME, { a: 1 });
    expect(h1).toBe(h2);
  });

  it("computeAuditHash differs when previousAuditHash changes", () => {
    const h1 = computeAuditHash(null,     "event_type", "eid", "op", BASE_TIME, {});
    const h2 = computeAuditHash("abc123", "event_type", "eid", "op", BASE_TIME, {});
    expect(h1).not.toBe(h2);
  });

  it("computeAuditHash uses GENESIS_HASH_SENTINEL for null previous", () => {
    const h1 = computeAuditHash(null,                  "e", "eid", "op", BASE_TIME, {});
    const h2 = computeAuditHash(GENESIS_HASH_SENTINEL, "e", "eid", "op", BASE_TIME, {});
    expect(h1).toBe(h2);
  });

  it("buildAuditChainEntry produces entry with correct computed hash", () => {
    const input  = makeInput();
    const result = buildAuditChainEntry(input, BASE_TIME);
    expect(result.entry).not.toBeNull();
    const expected = computeAuditHash(null, input.eventType, input.entityId, input.operatorId, input.occurredAt, input.payload);
    expect(result.entry!.currentAuditHash).toBe(expected);
  });

  it("buildAuditChainEntry sets integrityStatus=verified", () => {
    const result = buildAuditChainEntry(makeInput(), BASE_TIME);
    expect(result.entry!.integrityStatus).toBe("verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - hash continuity verification stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: hash continuity verification stable", () => {
  it("verifyAuditIntegrity reports all verified for a valid chain", () => {
    const chain  = makeChain(3);
    const report = verifyAuditIntegrity(chain, BASE_TIME);
    expect(report.overallStatus).toBe("verified");
    expect(report.verifiedCount).toBe(3);
    expect(report.compromisedCount).toBe(0);
  });

  it("verifyAuditIntegrity returns empty results for empty input", () => {
    const report = verifyAuditIntegrity([], BASE_TIME);
    expect(report.totalEntries).toBe(0);
    expect(report.overallStatus).toBe("verified");
  });

  it("each entry in chain has hashValid=true for intact chain", () => {
    const chain  = makeChain(4);
    const report = verifyAuditIntegrity(chain, BASE_TIME);
    expect(report.results.every(r => r.hashValid)).toBe(true);
  });

  it("verifyAuditIntegrity evaluatedAt is set correctly", () => {
    const report = verifyAuditIntegrity([], BASE_TIME);
    expect(report.evaluatedAt).toBe(BASE_TIME.toISOString());
  });

  it("verifyAuditIntegrity detects single compromised entry in larger chain", () => {
    const chain   = makeChain(4);
    const tampered = { ...chain[1]!, payload: { step: 999 } };  // payload changed but hash not updated
    const mixed   = [chain[0]!, tampered, chain[2]!, chain[3]!];
    const report  = verifyAuditIntegrity(mixed, BASE_TIME);
    expect(report.compromisedCount).toBeGreaterThan(0);
    expect(report.overallStatus).toBe("compromised");
  });

  it("severity ordering: compromised > orphaned > verified", () => {
    const chain   = makeChain(2);
    const orphan  = makeEntry({ chainId: "orphan-1", previousAuditHash: "does-not-exist" });
    const tampered = { ...chain[0]!, payload: { x: "tampered" } };
    const report  = verifyAuditIntegrity([tampered, orphan], BASE_TIME);
    expect(report.overallStatus).toBe("compromised");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - tamper anomaly detection valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: tamper anomaly detection valid", () => {
  it("detectTamperAnomalies returns empty for intact entries", () => {
    const chain     = makeChain(3);
    const anomalies = detectTamperAnomalies(chain, BASE_TIME);
    expect(anomalies).toHaveLength(0);
  });

  it("detectTamperAnomalies flags entry with modified payload", () => {
    const entry   = makeEntry();
    const altered = { ...entry, payload: { status: "tampered" } };
    const result  = detectTamperAnomalies([altered], BASE_TIME);
    expect(result).toHaveLength(1);
    expect(result[0]!.chainId).toBe(entry.chainId);
    expect(result[0]!.severity).toBe("compromised");
  });

  it("detectTamperAnomalies flags entry with modified operatorId", () => {
    const entry   = makeEntry();
    const altered = { ...entry, operatorId: "attacker" };
    const result  = detectTamperAnomalies([altered], BASE_TIME);
    expect(result).toHaveLength(1);
  });

  it("detectTamperAnomalies storedHash ≠ recomputedHash on tamper", () => {
    const entry   = makeEntry();
    const altered = { ...entry, eventType: "different_event" };
    const result  = detectTamperAnomalies([altered], BASE_TIME);
    expect(result[0]!.storedHash).toBe(entry.currentAuditHash);
    expect(result[0]!.recomputedHash).not.toBe(result[0]!.storedHash);
  });

  it("detectTamperAnomalies detects only the tampered entry in a chain", () => {
    const chain   = makeChain(4);
    const altered = { ...chain[2]!, payload: { step: 999 } };
    const mixed   = [chain[0]!, chain[1]!, altered, chain[3]!];
    const result  = detectTamperAnomalies(mixed, BASE_TIME);
    expect(result).toHaveLength(1);
    expect(result[0]!.chainId).toBe(chain[2]!.chainId);
  });

  it("detectedAt is preserved in anomaly record", () => {
    const entry   = makeEntry();
    const altered = { ...entry, payload: { x: "changed" } };
    const result  = detectTamperAnomalies([altered], BASE_TIME);
    expect(result[0]!.detectedAt).toBe(BASE_TIME.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - orphaned record detection correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: orphaned record detection correct", () => {
  it("detectOrphanedRecords returns empty for intact chain", () => {
    const chain   = makeChain(3);
    const orphans = detectOrphanedRecords(chain);
    expect(orphans).toHaveLength(0);
  });

  it("detectOrphanedRecords returns empty for genesis entry (null prev)", () => {
    const genesis = makeEntry({ previousAuditHash: null });
    expect(detectOrphanedRecords([genesis])).toHaveLength(0);
  });

  it("detectOrphanedRecords detects entry with unresolvable previousAuditHash", () => {
    const orphan  = makeEntry({ chainId: "orphan-test", previousAuditHash: "ghost-hash-00001" });
    const orphans = detectOrphanedRecords([orphan]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.chainId).toBe("orphan-test");
  });

  it("detectOrphanedRecords does not flag entry whose prev is present", () => {
    const chain = makeChain(2);
    expect(detectOrphanedRecords(chain)).toHaveLength(0);
  });

  it("detectOrphanedRecords flags only the orphan in a mixed set", () => {
    const chain   = makeChain(3);
    const orphan  = makeEntry({ chainId: "orphan-x", entityId: "other-entity", previousAuditHash: "missing-hash" });
    const orphans = detectOrphanedRecords([...chain, orphan]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.chainId).toBe("orphan-x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - forensic reconstruction chronological
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: forensic reconstruction chronological", () => {
  it("reconstructAuditTimeline returns empty timeline for unknown entityId", () => {
    const timeline = reconstructAuditTimeline("unknown-entity", makeChain(3), BASE_TIME);
    expect(timeline.totalEvents).toBe(0);
    expect(timeline.entityType).toBeNull();
  });

  it("reconstructAuditTimeline returns events for known entityId", () => {
    const chain    = makeChain(3, "exec:1-001");
    const timeline = reconstructAuditTimeline("exec:1-001", chain, BASE_TIME);
    expect(timeline.totalEvents).toBe(3);
  });

  it("reconstructAuditTimeline events are sorted ASC by occurredAt", () => {
    const chain    = makeChain(4, "exec:1-001");
    const shuffled = [chain[2]!, chain[0]!, chain[3]!, chain[1]!];
    const timeline = reconstructAuditTimeline("exec:1-001", shuffled, BASE_TIME);
    const times    = timeline.events.map(e => e.occurredAt);
    expect(times).toEqual([...times].sort());
  });

  it("reconstructAuditTimeline chainIntegrity=verified for intact chain", () => {
    const chain    = makeChain(3, "exec:1-001");
    const timeline = reconstructAuditTimeline("exec:1-001", chain, BASE_TIME);
    expect(timeline.chainIntegrity).toBe("verified");
  });

  it("reconstructAuditTimeline chainIntegrity=compromised when tamper present", () => {
    const chain   = makeChain(3, "exec:1-001");
    const altered = { ...chain[1]!, payload: { step: 999 } };
    const timeline = reconstructAuditTimeline("exec:1-001", [chain[0]!, altered, chain[2]!], BASE_TIME);
    expect(timeline.chainIntegrity).toBe("compromised");
  });

  it("reconstructAuditTimeline only includes entries for the queried entityId", () => {
    const chain1   = makeChain(2, "exec:1-001");
    const chain2   = makeChain(2, "exec:2-999");
    const timeline = reconstructAuditTimeline("exec:1-001", [...chain1, ...chain2], BASE_TIME);
    expect(timeline.totalEvents).toBe(2);
    timeline.events.forEach(e => expect(e.chainId).toContain("exec:1-001"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - retention classification deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: retention classification deterministic", () => {
  it("classifyRetention: forensic_critical for rollback events", () => {
    expect(classifyRetention("execution_attempt", "execution_rolled_back")).toBe("forensic_critical");
    expect(classifyRetention("orchestration_action", "rollback_recorded")).toBe("forensic_critical");
  });

  it("classifyRetention: forensic_critical for abandonment events", () => {
    expect(classifyRetention("execution_attempt", "execution_abandoned")).toBe("forensic_critical");
  });

  it("classifyRetention: compliance_sensitive for confirmation events", () => {
    expect(classifyRetention("execution_attempt", "execution_confirmed")).toBe("compliance_sensitive");
  });

  it("classifyRetention: governance for orchestration events", () => {
    expect(classifyRetention("orchestration_action", "orchestration_resolved")).toBe("governance");
  });

  it("classifyRetention: operational for generic events", () => {
    expect(classifyRetention("incident", "status_updated")).toBe("operational");
    expect(classifyRetention("platform_event", "snapshot_captured")).toBe("operational");
  });

  it("classifyRetention is deterministic - same inputs always same output", () => {
    const c1 = classifyRetention("execution_attempt", "execution_confirmed");
    const c2 = classifyRetention("execution_attempt", "execution_confirmed");
    expect(c1).toBe(c2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - append-only guarantees preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: append-only guarantees preserved", () => {
  it("buildAuditChainEntry does not mutate the input payload", () => {
    const input  = makeInput({ payload: { status: "original" } });
    const before = JSON.stringify(input.payload);
    buildAuditChainEntry(input, BASE_TIME);
    expect(JSON.stringify(input.payload)).toBe(before);
  });

  it("verifyAuditIntegrity does not mutate input entries", () => {
    const chain  = makeChain(3);
    const before = JSON.stringify(chain);
    verifyAuditIntegrity(chain, BASE_TIME);
    expect(JSON.stringify(chain)).toBe(before);
  });

  it("detectTamperAnomalies does not mutate input entries", () => {
    const chain  = makeChain(3);
    const before = JSON.stringify(chain);
    detectTamperAnomalies(chain, BASE_TIME);
    expect(JSON.stringify(chain)).toBe(before);
  });

  it("reconstructAuditTimeline does not mutate input entries", () => {
    const chain  = makeChain(3, "exec:1-001");
    const before = JSON.stringify(chain);
    reconstructAuditTimeline("exec:1-001", chain, BASE_TIME);
    expect(JSON.stringify(chain)).toBe(before);
  });

  it("buildAuditChainEntry payload in result is a copy, not a reference", () => {
    const payload = { status: "original" };
    const result  = buildAuditChainEntry(makeInput({ payload }), BASE_TIME);
    expect(result.entry).not.toBeNull();
    expect(result.entry!.payload).not.toBe(payload);
    expect(result.entry!.payload).toEqual(payload);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - serialization ordering stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: serialization ordering stable", () => {
  it("AuditChainEntry is fully JSON-serializable", () => {
    const entry = makeEntry();
    expect(() => JSON.stringify(entry)).not.toThrow();
  });

  it("AuditIntegrityReport is fully JSON-serializable", () => {
    const chain  = makeChain(3);
    const report = verifyAuditIntegrity(chain, BASE_TIME);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("ForensicTimeline is fully JSON-serializable", () => {
    const chain    = makeChain(3, "exec:1-001");
    const timeline = reconstructAuditTimeline("exec:1-001", chain, BASE_TIME);
    expect(() => JSON.stringify(timeline)).not.toThrow();
  });

  it("ComplianceSummary is fully JSON-serializable", () => {
    const chain   = makeChain(3);
    const summary = buildComplianceSummary(chain, BASE_TIME);
    expect(() => JSON.stringify(summary)).not.toThrow();
  });

  it("computeAuditHash is order-sensitive for payload keys", () => {
    // Payload keys are sorted in JSON.stringify, so { a:1, b:2 } and { b:2, a:1 } hash identically
    const h1 = computeAuditHash(null, "e", "eid", "op", BASE_TIME, { a: 1, b: 2 });
    const h2 = computeAuditHash(null, "e", "eid", "op", BASE_TIME, { b: 2, a: 1 });
    expect(h1).toBe(h2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - super-admin enforcement valid (engine has no async / side-effects)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: super-admin enforcement valid", () => {
  it("buildAuditChainEntry returns sync value object", () => {
    const result = buildAuditChainEntry(makeInput(), BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("validateAuditChainInput rejects empty operatorId with EMPTY_OPERATOR", () => {
    const r = validateAuditChainInput(makeInput({ operatorId: "" }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(AUDIT_ERROR_CODES.EMPTY_OPERATOR);
  });

  it("validateAuditChainInput rejects empty entityId", () => {
    const r = validateAuditChainInput(makeInput({ entityId: "" }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(AUDIT_ERROR_CODES.EMPTY_ENTITY_ID);
  });

  it("validateAuditChainInput rejects empty eventType", () => {
    const r = validateAuditChainInput(makeInput({ eventType: "" }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(AUDIT_ERROR_CODES.EMPTY_EVENT_TYPE);
  });

  it("verifyAuditIntegrity is synchronous and returns a plain object", () => {
    const result = verifyAuditIntegrity([], BASE_TIME);
    expect(typeof result).toBe("object");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - compliance layer remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: compliance layer remains read-only", () => {
  it("verifyAuditIntegrity results have no execute/repair methods", () => {
    const report = verifyAuditIntegrity(makeChain(2), BASE_TIME);
    for (const r of report.results) {
      expect(typeof (r as unknown as { repair?: unknown }).repair).not.toBe("function");
      expect(typeof (r as unknown as { fix?: unknown }).fix).not.toBe("function");
    }
  });

  it("ForensicTimeline events have no mutate/write methods", () => {
    const timeline = reconstructAuditTimeline("exec:1-001", makeChain(2, "exec:1-001"), BASE_TIME);
    for (const ev of timeline.events) {
      const hasMutate = Object.values(ev).some(v => typeof v === "function");
      expect(hasMutate).toBe(false);
    }
  });

  it("emitAuditChainRecordedEvent returns void", () => {
    const result = emitAuditChainRecordedEvent({ chainId: "c1", entityType: "incident", entityId: "e1", integrityStatus: "verified", retentionClassification: "operational", action: "recorded" });
    expect(result).toBeUndefined();
  });

  it("emitAuditIntegrityAnomalyDetectedEvent returns void", () => {
    const result = emitAuditIntegrityAnomalyDetectedEvent({ chainId: "c1", entityType: "execution_attempt", entityId: "e1", integrityStatus: "compromised", retentionClassification: "forensic_critical", action: "anomaly_detected" });
    expect(result).toBeUndefined();
  });

  it("buildComplianceSummary byEntityType is read-only data, no methods", () => {
    const chain   = makeChain(3);
    const summary = buildComplianceSummary(chain, BASE_TIME);
    const hasFn   = Object.values(summary.byEntityType).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });
});
