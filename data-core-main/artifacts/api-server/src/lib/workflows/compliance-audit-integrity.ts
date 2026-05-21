/**
 * @file   lib/workflows/compliance-audit-integrity.ts
 * @phase  P11-A - Compliance Governance Foundations & Immutable Audit Integrity
 *                 Architecture
 *
 * Pure deterministic compliance governance engine.
 * APPEND-ONLY: entries are created but never mutated or deleted.
 * NO SELF-REPAIR: integrity failures are surfaced for operator review only.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Provides the cryptographic + semantic foundation for immutable audit chains:
 *
 *   computeAuditHash(prev, eventType, entityId, operatorId, occurredAt, payload)
 *     → string  (SHA-256 hex, deterministic)
 *
 *   buildAuditChainEntry(input)
 *     → AuditChainEntry  (value object with computed currentAuditHash)
 *
 *   verifyAuditIntegrity(entries)
 *     → AuditIntegrityReport  (per-entry status + overall assessment)
 *
 *   detectTamperAnomalies(entries)
 *     → TamperAnomaly[]  (entries where stored hash ≠ recomputed hash)
 *
 *   detectOrphanedRecords(entries)
 *     → AuditChainEntry[]  (entries with a previousAuditHash that resolves to nothing)
 *
 *   classifyRetention(entityType, eventType)
 *     → RetentionClassification  (deterministic, no DB, no async)
 *
 *   reconstructAuditTimeline(entityId, allEntries)
 *     → ForensicTimeline  (chronologically ordered, integrity-annotated)
 *
 *   buildComplianceSummary(entries)
 *     → ComplianceSummary  (aggregate stats across all chains)
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   APPEND-ONLY:     engine never modifies or deletes audit entries
 *   NO SELF-REPAIR:  integrity failures classified, never auto-corrected
 *   NO AI:           all classification and scoring is deterministic rule-based
 *   FAIL-CLOSED:     ambiguous states default to "warning" or "incomplete"
 *   DETERMINISTIC:   same inputs → same hash, same classification, every time
 *   OPERATOR-MANDATORY: empty operatorId is an error code, not a fallback
 */

import { createHash } from "crypto";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// CORE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entity types that can be audited in the compliance chain.
 */
export type AuditEntityType =
  | "incident"
  | "recommendation"
  | "orchestration_action"
  | "execution_attempt"
  | "platform_event";

/**
 * Five-tier integrity status.
 */
export type AuditIntegrityStatus =
  | "verified"      // hash chain intact, no anomalies
  | "warning"       // minor anomaly (time gap, out-of-order recording)
  | "compromised"   // hash mismatch detected (possible tampering)
  | "orphaned"      // previousAuditHash references a non-existent entry
  | "incomplete";   // expected chain entries are missing (sequence gap)

/**
 * Four-tier retention classification.
 * Set deterministically from entityType + eventType at entry creation.
 */
export type RetentionClassification =
  | "operational"           // day-to-day ops events, standard retention
  | "governance"            // policy/config/orchestration creation, longer retention
  | "compliance_sensitive"  // confirmation, approval, access decision events
  | "forensic_critical";    // rollbacks, abandonments, integrity failures, max retention

/**
 * Value object representing a single immutable audit chain entry.
 * Mirrors the DB row shape but as a typed in-memory structure.
 */
export interface AuditChainEntry {
  chainId:                 string;
  entityType:              AuditEntityType;
  entityId:                string;
  workspaceId:             number | null;
  previousAuditHash:       string | null;
  currentAuditHash:        string;
  eventType:               string;
  operatorId:              string;
  payload:                 Record<string, unknown>;
  occurredAt:              Date;
  recordedAt:              Date;
  integrityStatus:         AuditIntegrityStatus;
  retentionClassification: RetentionClassification;
}

/**
 * Input for buildAuditChainEntry().
 */
export interface AuditChainEntryInput {
  entityType:        AuditEntityType;
  entityId:          string;
  workspaceId:       number | null;
  previousAuditHash: string | null;
  eventType:         string;
  operatorId:        string;
  payload:           Record<string, unknown>;
  occurredAt:        Date;
}

/**
 * A detected tamper anomaly - entry where recomputed hash ≠ stored hash.
 */
export interface TamperAnomaly {
  chainId:           string;
  entityId:          string;
  storedHash:        string;
  recomputedHash:    string;
  severity:          "compromised" | "warning";
  detectedAt:        string;  // ISO 8601
}

/**
 * Per-entry integrity verification result.
 */
export interface EntryIntegrityResult {
  chainId:           string;
  entityId:          string;
  eventType:         string;
  computedStatus:    AuditIntegrityStatus;
  storedStatus:      AuditIntegrityStatus;
  statusMatch:       boolean;
  hashValid:         boolean;
  linkValid:         boolean;  // previousAuditHash resolves correctly
  anomalyDetails:    string | null;
}

/**
 * Full integrity report for a set of audit chain entries.
 */
export interface AuditIntegrityReport {
  totalEntries:     number;
  verifiedCount:    number;
  warningCount:     number;
  compromisedCount: number;
  orphanedCount:    number;
  incompleteCount:  number;
  overallStatus:    AuditIntegrityStatus;
  results:          EntryIntegrityResult[];
  evaluatedAt:      string;  // ISO 8601
}

/**
 * A single event in a forensic timeline.
 */
export interface ForensicTimelineEvent {
  chainId:                 string;
  eventType:               string;
  operatorId:              string;
  occurredAt:              string;  // ISO 8601
  recordedAt:              string;  // ISO 8601
  integrityStatus:         AuditIntegrityStatus;
  retentionClassification: RetentionClassification;
  hashValid:               boolean;
  payload:                 Record<string, unknown>;
}

/**
 * Full forensic reconstruction for an entityId.
 */
export interface ForensicTimeline {
  entityId:        string;
  entityType:      AuditEntityType | null;
  totalEvents:     number;
  chainIntegrity:  AuditIntegrityStatus;  // worst status across all events
  events:          ForensicTimelineEvent[];  // sorted ASC by occurredAt
  reconstructedAt: string;  // ISO 8601
}

/**
 * Platform-wide compliance summary.
 */
export interface ComplianceSummary {
  totalEntries:               number;
  byRetentionClassification:  Record<RetentionClassification, number>;
  byIntegrityStatus:          Record<AuditIntegrityStatus, number>;
  byEntityType:               Partial<Record<AuditEntityType, number>>;
  overallIntegrityStatus:     AuditIntegrityStatus;
  compromisedEntries:         number;
  forensicCriticalEntries:    number;
  evaluatedAt:                string;  // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_ERROR_CODES = {
  EMPTY_OPERATOR:       "AUDIT_EMPTY_OPERATOR",
  EMPTY_ENTITY_ID:      "AUDIT_EMPTY_ENTITY_ID",
  EMPTY_ENTITY_TYPE:    "AUDIT_EMPTY_ENTITY_TYPE",
  EMPTY_EVENT_TYPE:     "AUDIT_EMPTY_EVENT_TYPE",
  INVALID_OCCURRED_AT:  "AUDIT_INVALID_OCCURRED_AT",
} as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[keyof typeof AUDIT_ERROR_CODES];

export interface AuditValidationResult {
  valid:  boolean;
  errors: AuditErrorCode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HASH COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel value used as previousAuditHash for the genesis entry of a chain. */
export const GENESIS_HASH_SENTINEL = "GENESIS";

/**
 * Computes a deterministic SHA-256 audit hash.
 *
 * Input string: PREV|eventType|entityId|operatorId|occurredAt.ISO|payload_json
 * Where PREV = previousAuditHash ?? "GENESIS"
 *
 * Pure: no DB, no async, no side effects. Deterministic.
 */
export function computeAuditHash(
  previousAuditHash: string | null,
  eventType:         string,
  entityId:          string,
  operatorId:        string,
  occurredAt:        Date,
  payload:           Record<string, unknown>,
): string {
  const prev       = previousAuditHash ?? GENESIS_HASH_SENTINEL;
  const payloadStr = JSON.stringify(payload, Object.keys(payload).sort());
  const data       = [
    prev,
    eventType,
    entityId,
    operatorId,
    occurredAt.toISOString(),
    payloadStr,
  ].join("|");

  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the inputs for a new audit chain entry.
 * Pure: no DB, no async, no side effects.
 */
export function validateAuditChainInput(
  input: AuditChainEntryInput,
): AuditValidationResult {
  const errors: AuditErrorCode[] = [];

  if (!input.operatorId || input.operatorId.trim().length === 0) {
    errors.push(AUDIT_ERROR_CODES.EMPTY_OPERATOR);
  }
  if (!input.entityId || input.entityId.trim().length === 0) {
    errors.push(AUDIT_ERROR_CODES.EMPTY_ENTITY_ID);
  }
  if (!input.entityType) {
    errors.push(AUDIT_ERROR_CODES.EMPTY_ENTITY_TYPE);
  }
  if (!input.eventType || input.eventType.trim().length === 0) {
    errors.push(AUDIT_ERROR_CODES.EMPTY_EVENT_TYPE);
  }
  if (!(input.occurredAt instanceof Date) || isNaN(input.occurredAt.getTime())) {
    errors.push(AUDIT_ERROR_CODES.INVALID_OCCURRED_AT);
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// RETENTION CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic retention classification from entityType + eventType.
 *
 * Classification rules (first match wins):
 *
 *   forensic_critical - any rollback, abandonment, cancellation, integrity
 *                       anomaly, or tamper-related event
 *
 *   compliance_sensitive - confirmation, approval, access decisions, and
 *                          execution lifecycle confirmations
 *
 *   governance - orchestration creation/resolution, policy changes,
 *                recommendation acknowledgements
 *
 *   operational - all other events (captures, progressions, status changes)
 *
 * Pure: no DB, no async, no side effects. Deterministic.
 */
export function classifyRetention(
  entityType: AuditEntityType | string,
  eventType:  string,
): RetentionClassification {
  const et = eventType.toLowerCase();

  // forensic_critical: rollbacks, abandonments, cancellations, integrity issues
  if (
    et.includes("rollback")      ||
    et.includes("rolled_back")   ||
    et.includes("abandon")       ||
    et.includes("cancelled")     ||
    et.includes("tamper")        ||
    et.includes("compromised")   ||
    et.includes("integrity_failure") ||
    et.includes("integrity_anomaly")
  ) {
    return "forensic_critical";
  }

  // compliance_sensitive: confirmations, approvals, access events
  if (
    et.includes("confirm")       ||
    et.includes("approved")      ||
    et.includes("rejected")      ||
    et.includes("access")        ||
    et.includes("permission")    ||
    et.includes("auth")          ||
    et.includes("sign_in")       ||
    et.includes("password")
  ) {
    return "compliance_sensitive";
  }

  // governance: policy, orchestration, recommendations
  if (
    et.includes("orchestrat")    ||
    et.includes("policy")        ||
    et.includes("configuration") ||
    et.includes("resolution")    ||
    et.includes("resolved")      ||
    et.includes("recommendation") ||
    et.includes("workspace_created") ||
    et.includes("workspace_updated")
  ) {
    return "governance";
  }

  // Governance by entity type
  if (
    entityType === "orchestration_action" ||
    entityType === "recommendation"
  ) {
    return "governance";
  }

  return "operational";
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a new AuditChainEntry value object.
 * Computes the currentAuditHash deterministically from inputs.
 * Sets integrityStatus to "verified" and classifyRetention from entityType+eventType.
 *
 * Returns { entry: null, errors } if validation fails.
 *
 * Pure: no DB, no async, no side effects.
 */
export function buildAuditChainEntry(
  input:     AuditChainEntryInput,
  now:       Date = new Date(),
): { entry: AuditChainEntry; errors: [] } | { entry: null; errors: AuditErrorCode[] } {
  const validation = validateAuditChainInput(input);
  if (!validation.valid) {
    return { entry: null, errors: validation.errors };
  }

  const currentAuditHash = computeAuditHash(
    input.previousAuditHash,
    input.eventType,
    input.entityId,
    input.operatorId,
    input.occurredAt,
    input.payload,
  );

  const retention = classifyRetention(input.entityType, input.eventType);

  const chainId = `audit:${input.entityType}:${input.entityId}-${now.getTime()}`;

  const entry: AuditChainEntry = {
    chainId,
    entityType:              input.entityType,
    entityId:                input.entityId,
    workspaceId:             input.workspaceId,
    previousAuditHash:       input.previousAuditHash,
    currentAuditHash,
    eventType:               input.eventType,
    operatorId:              input.operatorId,
    payload:                 { ...input.payload },  // shallow-copy to prevent external mutation
    occurredAt:              input.occurredAt,
    recordedAt:              now,
    integrityStatus:         "verified",
    retentionClassification: retention,
  };

  return { entry, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRITY VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects tamper anomalies by recomputing each entry's hash and comparing
 * it to the stored currentAuditHash.
 *
 * An anomaly is reported for every entry where the stored hash does not
 * match the hash computed from the entry's own fields.
 *
 * severity:
 *   "compromised" - hash does not match (definitive tampering indicator)
 *   "warning"     - (reserved for future use; currently only "compromised" emitted)
 *
 * Pure: no DB, no async, no side effects.
 */
export function detectTamperAnomalies(
  entries:    ReadonlyArray<AuditChainEntry>,
  detectedAt: Date = new Date(),
): TamperAnomaly[] {
  const anomalies: TamperAnomaly[] = [];

  for (const entry of entries) {
    const recomputedHash = computeAuditHash(
      entry.previousAuditHash,
      entry.eventType,
      entry.entityId,
      entry.operatorId,
      entry.occurredAt,
      entry.payload,
    );

    if (recomputedHash !== entry.currentAuditHash) {
      anomalies.push({
        chainId:        entry.chainId,
        entityId:       entry.entityId,
        storedHash:     entry.currentAuditHash,
        recomputedHash,
        severity:       "compromised",
        detectedAt:     detectedAt.toISOString(),
      });
    }
  }

  return anomalies;
}

/**
 * Detects orphaned audit records - entries whose previousAuditHash does not
 * resolve to any currentAuditHash in the provided entry set.
 *
 * A genesis entry (previousAuditHash = null) is never orphaned.
 * An entry is orphaned if its previousAuditHash is non-null but no other
 * entry in the set has that value as its currentAuditHash.
 *
 * Pure: no DB, no async, no side effects.
 */
export function detectOrphanedRecords(
  entries: ReadonlyArray<AuditChainEntry>,
): AuditChainEntry[] {
  const knownHashes = new Set(entries.map(e => e.currentAuditHash));
  return entries.filter(
    e => e.previousAuditHash !== null && !knownHashes.has(e.previousAuditHash),
  );
}

/**
 * Verifies the integrity of all provided audit chain entries.
 *
 * Per-entry status is computed as follows (first match wins):
 *   compromised - recomputed hash ≠ stored hash
 *   orphaned    - non-null previousAuditHash not found in entry set
 *   verified    - hash valid and link valid
 *
 * Overall status = worst individual status across all entries.
 * Severity order: compromised > orphaned > incomplete > warning > verified
 *
 * Pure: no DB, no async, no side effects.
 */
export function verifyAuditIntegrity(
  entries:    ReadonlyArray<AuditChainEntry>,
  now:        Date = new Date(),
): AuditIntegrityReport {
  const knownHashes = new Set(entries.map(e => e.currentAuditHash));
  const tamperMap   = new Map(
    detectTamperAnomalies(entries, now).map(a => [a.chainId, a]),
  );
  const orphanSet   = new Set(
    detectOrphanedRecords(entries).map(e => e.chainId),
  );

  const results: EntryIntegrityResult[] = [];

  for (const entry of entries) {
    const tamper    = tamperMap.get(entry.chainId);
    const hashValid = !tamper;
    const linkValid =
      entry.previousAuditHash === null ||
      knownHashes.has(entry.previousAuditHash);

    let computedStatus: AuditIntegrityStatus;
    let anomalyDetails: string | null = null;

    if (!hashValid) {
      computedStatus = "compromised";
      anomalyDetails = `stored hash ${entry.currentAuditHash.slice(0, 8)}... ≠ recomputed ${tamper!.recomputedHash.slice(0, 8)}...`;
    } else if (orphanSet.has(entry.chainId)) {
      computedStatus = "orphaned";
      anomalyDetails = `previousAuditHash "${entry.previousAuditHash?.slice(0, 8)}..." not found in entry set`;
    } else {
      computedStatus = "verified";
    }

    results.push({
      chainId:        entry.chainId,
      entityId:       entry.entityId,
      eventType:      entry.eventType,
      computedStatus,
      storedStatus:   entry.integrityStatus,
      statusMatch:    computedStatus === entry.integrityStatus,
      hashValid,
      linkValid,
      anomalyDetails,
    });
  }

  const counts = {
    verified:   0,
    warning:    0,
    compromised: 0,
    orphaned:   0,
    incomplete: 0,
  };
  for (const r of results) {
    counts[r.computedStatus]++;
  }

  // Severity order: compromised > orphaned > incomplete > warning > verified
  let overallStatus: AuditIntegrityStatus = "verified";
  if (counts.compromised > 0)  overallStatus = "compromised";
  else if (counts.orphaned > 0) overallStatus = "orphaned";
  else if (counts.incomplete > 0) overallStatus = "incomplete";
  else if (counts.warning > 0)  overallStatus = "warning";

  return {
    totalEntries:     entries.length,
    verifiedCount:    counts.verified,
    warningCount:     counts.warning,
    compromisedCount: counts.compromised,
    orphanedCount:    counts.orphaned,
    incompleteCount:  counts.incomplete,
    overallStatus,
    results,
    evaluatedAt:      now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORENSIC RECONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a forensic audit timeline for a specific entityId.
 *
 * Process:
 *   1. Filter all entries to those matching the entityId
 *   2. Sort chronologically by occurredAt (ASC) - deterministic ordering
 *   3. Verify hash integrity for each entry
 *   4. Build ForensicTimelineEvent[] with integrity annotations
 *   5. Compute worst-case chainIntegrity across all events
 *
 * Pure: no DB, no async, no side effects.
 */
export function reconstructAuditTimeline(
  entityId:   string,
  allEntries: ReadonlyArray<AuditChainEntry>,
  now:        Date = new Date(),
): ForensicTimeline {
  const matching = allEntries
    .filter(e => e.entityId === entityId)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const knownHashes = new Set(matching.map(e => e.currentAuditHash));
  const tamperMap   = new Map(
    detectTamperAnomalies(matching, now).map(a => [a.chainId, a]),
  );

  const events: ForensicTimelineEvent[] = matching.map(entry => {
    const hashValid =
      !tamperMap.has(entry.chainId) &&
      computeAuditHash(
        entry.previousAuditHash,
        entry.eventType,
        entry.entityId,
        entry.operatorId,
        entry.occurredAt,
        entry.payload,
      ) === entry.currentAuditHash;

    const isOrphaned =
      entry.previousAuditHash !== null &&
      !knownHashes.has(entry.previousAuditHash);

    let integrityStatus: AuditIntegrityStatus;
    if (!hashValid)       integrityStatus = "compromised";
    else if (isOrphaned)  integrityStatus = "orphaned";
    else                  integrityStatus = "verified";

    return {
      chainId:                 entry.chainId,
      eventType:               entry.eventType,
      operatorId:              entry.operatorId,
      occurredAt:              entry.occurredAt.toISOString(),
      recordedAt:              entry.recordedAt.toISOString(),
      integrityStatus,
      retentionClassification: entry.retentionClassification,
      hashValid,
      payload:                 { ...entry.payload },
    };
  });

  // Worst-case chain integrity
  const SEVERITY = { compromised: 4, orphaned: 3, incomplete: 2, warning: 1, verified: 0 };
  let worst: AuditIntegrityStatus = "verified";
  for (const ev of events) {
    if (SEVERITY[ev.integrityStatus] > SEVERITY[worst]) {
      worst = ev.integrityStatus;
    }
  }

  return {
    entityId,
    entityType: matching.length > 0 ? matching[0]!.entityType : null,
    totalEvents:     events.length,
    chainIntegrity:  worst,
    events,
    reconstructedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a platform-wide compliance summary from all audit chain entries.
 *
 * Pure: no DB, no async, no side effects.
 */
export function buildComplianceSummary(
  entries: ReadonlyArray<AuditChainEntry>,
  now:     Date = new Date(),
): ComplianceSummary {
  const byRetention: Record<RetentionClassification, number> = {
    operational:          0,
    governance:           0,
    compliance_sensitive: 0,
    forensic_critical:    0,
  };
  const byStatus: Record<AuditIntegrityStatus, number> = {
    verified:   0,
    warning:    0,
    compromised: 0,
    orphaned:   0,
    incomplete: 0,
  };
  const byType: Partial<Record<AuditEntityType, number>> = {};

  for (const e of entries) {
    byRetention[e.retentionClassification]++;
    byStatus[e.integrityStatus]++;
    byType[e.entityType] = (byType[e.entityType] ?? 0) + 1;
  }

  const SEVERITY = { compromised: 4, orphaned: 3, incomplete: 2, warning: 1, verified: 0 };
  let worst: AuditIntegrityStatus = "verified";
  for (const status of Object.keys(byStatus) as AuditIntegrityStatus[]) {
    if (byStatus[status] > 0 && SEVERITY[status] > SEVERITY[worst]) {
      worst = status;
    }
  }

  return {
    totalEntries:              entries.length,
    byRetentionClassification: byRetention,
    byIntegrityStatus:         byStatus,
    byEntityType:              byType,
    overallIntegrityStatus:    worst,
    compromisedEntries:        byStatus.compromised,
    forensicCriticalEntries:   byRetention.forensic_critical,
    evaluatedAt:               now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditObservabilityPayload {
  chainId:                 string;
  entityType:              string;
  entityId:                string;
  integrityStatus:         string;
  retentionClassification: string;
  action:                  string;
}

export function emitAuditChainRecordedEvent(p: AuditObservabilityPayload): void {
  logger.info(
    { event: "audit_chain_recorded", ...p },
    "[compliance-audit] P11-A: audit_chain_recorded",
  );
}

export function emitAuditIntegrityVerifiedEvent(p: AuditObservabilityPayload): void {
  logger.info(
    { event: "audit_integrity_verified", ...p },
    "[compliance-audit] P11-A: audit_integrity_verified",
  );
}

export function emitAuditIntegrityAnomalyDetectedEvent(p: AuditObservabilityPayload): void {
  logger.warn(
    { event: "audit_integrity_anomaly_detected", ...p },
    "[compliance-audit] P11-A: audit_integrity_anomaly_detected - REVIEW REQUIRED",
  );
}

export function emitForensicTimelineReconstructedEvent(p: AuditObservabilityPayload): void {
  logger.info(
    { event: "forensic_timeline_reconstructed", ...p },
    "[compliance-audit] P11-A: forensic_timeline_reconstructed",
  );
}
