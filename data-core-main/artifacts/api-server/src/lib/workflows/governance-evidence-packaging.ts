/**
 * P11-F - Governance Evidence Packaging & Audit Export Readiness Foundations
 *
 * READ-ONLY deterministic evidence packaging layer. Assembles cross-layer
 * governance evidence from P11-A → P11-E into structured audit bundles
 * with integrity hashing. No DB writes. No external submission. No AI.
 * Fail-closed on missing evidence. Pure functions only.
 *
 * Responsibility:
 *   - Aggregate governance evidence into scope-filtered packages
 *   - Classify package integrity deterministically
 *   - Build topology snapshot payloads (no DB persistence)
 *   - Diff two topology snapshots to surface changes
 *   - Add structured warning codes to all advisory signals
 */

import { createHash } from "crypto";
import { logger } from "../logger";
import type {
  GovernanceBoundaryStatus,
  GovernanceCoverageScore,
  GovernanceReadinessStatus,
  GovernanceTopologyProfile,
  GovernanceBoundarySummary,
  GovernanceReadinessProfile,
  GovernanceBoundaryVerification,
} from "./governance-intelligence-consolidation";

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceEvidencePackageScope - what the package covers
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceEvidencePackageScope =
  | "platform"    // full cross-workspace view (super_admin)
  | "workspace"   // single workspace evidence bundle
  | "entity"      // evidence for a specific entity (user / resource)
  | "violation"   // evidence around a specific policy violation
  | "workflow"    // evidence for a single governance workflow lifecycle
  | "readiness";  // topology + boundary + readiness profile only

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceEvidenceSection - which sections can appear in a package
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceEvidenceSection =
  | "audit_integrity"       // P11-A: chain records, hash verification, orphan status
  | "policy_violations"     // P11-B: violation profiles with evidence references
  | "workflow_lifecycle"    // P11-C: workflow action history with transitions
  | "governance_analytics"  // P11-D: analytics profile (metrics, stability score)
  | "topology_readiness"    // P11-E: topology + readiness profile
  | "forensic_timeline"     // P11-A: chronological event reconstruction
  | "boundary_summary";     // P11-E: boundary verification results

// ─────────────────────────────────────────────────────────────────────────────
// GovernancePackageIntegrityStatus - 4-state package integrity classification
// ─────────────────────────────────────────────────────────────────────────────

export type GovernancePackageIntegrityStatus =
  | "verified"    // all expected sections present, no leaks, no missing references
  | "warning"     // advisory concerns but package is usable
  | "incomplete"  // expected sections missing or evidence references absent
  | "compromised"; // boundary_leak_detected or serialization mismatch

// ─────────────────────────────────────────────────────────────────────────────
// Structured Warning Codes
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceWarningCode =
  | "P11A_NO_RUNTIME_DATA"
  | "P11C_NO_RUNTIME_DATA"
  | "GOVERNANCE_BOUNDARY_LEAK"
  | "GOVERNANCE_READINESS_PARTIAL"
  | "GOVERNANCE_CRITICAL_UNRESOLVED"
  | "GOVERNANCE_OBSERVABILITY_INCOMPLETE"
  | "EVIDENCE_REFERENCE_MISSING"
  | "EVIDENCE_SECTION_INCOMPLETE";

export interface GovernanceScopedWarning {
  code:      GovernanceWarningCode;
  message:   string;
  layerId?:  string;
  section?:  GovernanceEvidenceSection;
}

/** Build a GovernanceScopedWarning without throwing - safe to call from any context. */
export function buildWarning(
  code:      GovernanceWarningCode,
  message:   string,
  layerId?:  string,
  section?:  GovernanceEvidenceSection,
): GovernanceScopedWarning {
  return { code, message, ...(layerId ? { layerId } : {}), ...(section ? { section } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceEvidenceReference - cross-reference to a specific record or layer
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEvidenceReference {
  referenceId:   string;   // "evref:<layerId>:<entityType>:<nowMs>"
  sourceLayer:   string;   // "P11-A" through "P11-E"
  entityType:    string;   // "audit_chain" | "violation" | "workflow" | "topology" | etc.
  entityId:      string;   // specific ID or count descriptor
  description:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Summary Models
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditChainSectionSummary {
  totalRecords:             number;
  integrityStatus:          string;
  orphanCount:              number;
  retentionClassifications: Record<string, number>;
}

export interface ViolationSectionSummary {
  totalViolations:  number;
  bySeverity:       Record<string, number>;
  byPolicy:         Record<string, number>;
  criticalCount:    number;
}

export interface WorkflowSectionSummary {
  totalWorkflows:     number;
  activeWorkflows:    number;
  resolvedWorkflows:  number;
  escalatedWorkflows: number;
  criticalUnresolved: number;
  escalationRate:     number;
  throughputRate:     number;
}

export interface AnalyticsSectionSummary {
  workflowStabilityScore:  string;
  escalationTrend:         string;
  policyBreachFrequency:   Record<string, number>;
  unresolvedCriticalCount: number;
}

export interface TopologyReadinessSectionSummary {
  overallBoundaryStatus: string;
  coverageScore:         string;
  readinessStatus:       string;
  totalLayers:           number;
  activeLayers:          number;
  observabilityComplete: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceEvidencePackage - the main audit bundle model
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEvidencePackage {
  packageId:             string;    // "gevpkg:<scope>-<nowMs>"
  packageScope:          GovernanceEvidencePackageScope;
  workspaceId:           number | null;
  entityId:              string | null;
  includedSections:      GovernanceEvidenceSection[];
  auditChainSummary:     AuditChainSectionSummary | null;
  violationSummary:      ViolationSectionSummary | null;
  workflowSummary:       WorkflowSectionSummary | null;
  analyticsSummary:      AnalyticsSectionSummary | null;
  topologySummary:       TopologyReadinessSectionSummary | null;
  boundaryDetails:       GovernanceBoundarySummary | null;
  evidenceReferences:    GovernanceEvidenceReference[];
  warnings:              GovernanceScopedWarning[];
  integrityStatus:       GovernancePackageIntegrityStatus;
  packageIntegrityHash:  string;    // SHA-256 of stable canonical content (hash field excluded)
  generatedBy:           string;    // "governance-evidence-packaging/P11-F"
  generatedAt:           Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input model - all optional per-section data
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEvidencePackageInput {
  scope:        GovernanceEvidencePackageScope;
  workspaceId:  number | null;
  entityId:     string | null;
  now:          Date;
  generatedBy?: string;
  // P11-A
  auditRecordsTotal?:     number;
  auditOrphanCount?:      number;
  auditIntegrityStatus?:  string;
  auditRetentionMap?:     Record<string, number>;
  // P11-B
  totalViolations?:        number;
  violationsBySeverity?:   Record<string, number>;
  violationsByPolicy?:     Record<string, number>;
  criticalViolationCount?: number;
  // P11-C
  workflowStats?: {
    total:              number;
    active:             number;
    resolved:           number;
    escalated:          number;
    criticalUnresolved: number;
    escalationRate:     number;
    throughputRate:     number;
  };
  // P11-D
  analyticsStats?: {
    workflowStabilityScore:  string;
    escalationTrend:         string;
    policyBreachFrequency:   Record<string, number>;
    unresolvedCriticalCount: number;
  };
  // P11-E
  topology?:        GovernanceTopologyProfile;
  boundarySummary?: GovernanceBoundarySummary;
  readinessProfile?: GovernanceReadinessProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// sectionsForScope() - deterministic section list per scope
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE_TO_SECTIONS: Readonly<Record<GovernanceEvidencePackageScope, GovernanceEvidenceSection[]>> = {
  platform:  [
    "audit_integrity",
    "policy_violations",
    "workflow_lifecycle",
    "governance_analytics",
    "topology_readiness",
    "forensic_timeline",
    "boundary_summary",
  ],
  workspace: [
    "audit_integrity",
    "policy_violations",
    "workflow_lifecycle",
    "governance_analytics",
    "boundary_summary",
  ],
  entity: [
    "audit_integrity",
    "forensic_timeline",
    "policy_violations",
  ],
  violation: [
    "policy_violations",
    "workflow_lifecycle",
  ],
  workflow: [
    "workflow_lifecycle",
  ],
  readiness: [
    "topology_readiness",
    "boundary_summary",
  ],
};

export function sectionsForScope(scope: GovernanceEvidencePackageScope): GovernanceEvidenceSection[] {
  return [...SCOPE_TO_SECTIONS[scope]];
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEvidenceReferences() - generate cross-layer references from available data
// ─────────────────────────────────────────────────────────────────────────────

export function buildEvidenceReferences(
  input: GovernanceEvidencePackageInput,
  includedSections: GovernanceEvidenceSection[],
): GovernanceEvidenceReference[] {
  const refs: GovernanceEvidenceReference[] = [];
  const ts = input.now.getTime();

  if (includedSections.includes("audit_integrity") &&
      input.auditRecordsTotal !== undefined && input.auditRecordsTotal > 0) {
    refs.push({
      referenceId:  `evref:P11-A:audit_chain:${ts}`,
      sourceLayer:  "P11-A",
      entityType:   "audit_chain",
      entityId:     `count:${input.auditRecordsTotal}`,
      description:  `${input.auditRecordsTotal} immutable audit chain record(s) in compliance_audit_chains`,
    });
  }

  if (includedSections.includes("forensic_timeline") &&
      input.auditRecordsTotal !== undefined && input.auditRecordsTotal > 0) {
    refs.push({
      referenceId:  `evref:P11-A:forensic_timeline:${ts}`,
      sourceLayer:  "P11-A",
      entityType:   "forensic_timeline",
      entityId:     input.entityId ?? "platform",
      description:  `Forensic timeline available for ${input.auditRecordsTotal} audit chain record(s)`,
    });
  }

  if (includedSections.includes("policy_violations") &&
      input.totalViolations !== undefined && input.totalViolations > 0) {
    refs.push({
      referenceId:  `evref:P11-B:violation:${ts}`,
      sourceLayer:  "P11-B",
      entityType:   "violation",
      entityId:     `count:${input.totalViolations}`,
      description:  `${input.totalViolations} governance violation(s) detected across ${Object.keys(input.violationsByPolicy ?? {}).length} policy/policies`,
    });
  }

  if (includedSections.includes("workflow_lifecycle") &&
      input.workflowStats && input.workflowStats.total > 0) {
    refs.push({
      referenceId:  `evref:P11-C:workflow:${ts}`,
      sourceLayer:  "P11-C",
      entityType:   "workflow",
      entityId:     `count:${input.workflowStats.total}`,
      description:  `${input.workflowStats.total} governance workflow lifecycle record(s) in governance_workflow_actions`,
    });
  }

  if (includedSections.includes("governance_analytics") && input.analyticsStats) {
    refs.push({
      referenceId:  `evref:P11-D:analytics:${ts}`,
      sourceLayer:  "P11-D",
      entityType:   "analytics",
      entityId:     `stability:${input.analyticsStats.workflowStabilityScore}`,
      description:  `Governance analytics profile - stability: ${input.analyticsStats.workflowStabilityScore}, escalation trend: ${input.analyticsStats.escalationTrend}`,
    });
  }

  if (includedSections.includes("topology_readiness") && input.topology) {
    refs.push({
      referenceId:  `evref:P11-E:topology:${ts}`,
      sourceLayer:  "P11-E",
      entityType:   "topology",
      entityId:     input.topology.topologyId,
      description:  `Governance topology profile with ${input.topology.governanceLayers.length} layers - coverage: ${input.topology.lifecycleCoverage.coverageScore}`,
    });
  }

  if (includedSections.includes("boundary_summary") && input.boundarySummary) {
    refs.push({
      referenceId:  `evref:P11-E:boundary:${ts}`,
      sourceLayer:  "P11-E",
      entityType:   "boundary_summary",
      entityId:     input.boundarySummary.summaryId,
      description:  `Boundary verification: ${input.boundarySummary.verifiedLayers}/${input.boundarySummary.totalLayers} verified, overall: ${input.boundarySummary.overallStatus}`,
    });
  }

  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────
// gatherWarnings() - collect all structured warnings from available data
// ─────────────────────────────────────────────────────────────────────────────

export function gatherWarnings(
  input:            GovernanceEvidencePackageInput,
  includedSections: GovernanceEvidenceSection[],
  refs:             GovernanceEvidenceReference[],
): GovernanceScopedWarning[] {
  const warnings: GovernanceScopedWarning[] = [];

  // P11-A runtime data check
  if (includedSections.includes("audit_integrity") &&
      (input.auditRecordsTotal === undefined || input.auditRecordsTotal === 0)) {
    warnings.push(buildWarning(
      "P11A_NO_RUNTIME_DATA",
      "No audit chain records found in compliance_audit_chains. Audit integrity section has no runtime data.",
      "P11-A",
      "audit_integrity",
    ));
  }

  // P11-C runtime data check
  if (includedSections.includes("workflow_lifecycle") &&
      (!input.workflowStats || input.workflowStats.total === 0)) {
    warnings.push(buildWarning(
      "P11C_NO_RUNTIME_DATA",
      "No workflow records found in governance_workflow_actions. Workflow lifecycle section has no runtime data.",
      "P11-C",
      "workflow_lifecycle",
    ));
  }

  // Boundary leak check
  if (input.boundarySummary && input.boundarySummary.leakDetectedLayers > 0) {
    const leakedLayers = input.boundarySummary.byLayer
      .filter((v: GovernanceBoundaryVerification) => v.boundaryStatus === "boundary_leak_detected")
      .map((v: GovernanceBoundaryVerification) => v.layerId)
      .join(", ");
    warnings.push(buildWarning(
      "GOVERNANCE_BOUNDARY_LEAK",
      `Boundary leak detected in layer(s): ${leakedLayers}. Package integrity is compromised.`,
      leakedLayers,
      "boundary_summary",
    ));
  }

  // Readiness partial check
  if (input.readinessProfile &&
      input.readinessProfile.overallStatus !== "production_ready" &&
      input.readinessProfile.overallStatus !== "ready") {
    warnings.push(buildWarning(
      "GOVERNANCE_READINESS_PARTIAL",
      `Governance readiness status is "${input.readinessProfile.overallStatus}". Platform is not production-ready.`,
      undefined,
      "topology_readiness",
    ));
  }

  // Critical unresolved check
  if (input.workflowStats && input.workflowStats.criticalUnresolved > 0) {
    warnings.push(buildWarning(
      "GOVERNANCE_CRITICAL_UNRESOLVED",
      `${input.workflowStats.criticalUnresolved} critical violation(s) remain unresolved.`,
      "P11-C",
      "workflow_lifecycle",
    ));
  }

  // Observability completeness check
  if (input.topology && !input.topology.observabilityCoverage.coverageComplete) {
    warnings.push(buildWarning(
      "GOVERNANCE_OBSERVABILITY_INCOMPLETE",
      "Observability coverage is incomplete - not all governance layers emit structured events.",
      undefined,
      "topology_readiness",
    ));
  }

  // Missing evidence reference checks
  if (includedSections.includes("audit_integrity") &&
      !refs.some(r => r.sourceLayer === "P11-A" && r.entityType === "audit_chain")) {
    warnings.push(buildWarning(
      "EVIDENCE_REFERENCE_MISSING",
      "No evidence reference found for P11-A audit chain records.",
      "P11-A",
      "audit_integrity",
    ));
  }

  if (includedSections.includes("workflow_lifecycle") &&
      !refs.some(r => r.sourceLayer === "P11-C")) {
    warnings.push(buildWarning(
      "EVIDENCE_REFERENCE_MISSING",
      "No evidence reference found for P11-C workflow lifecycle records.",
      "P11-C",
      "workflow_lifecycle",
    ));
  }

  // Incomplete section checks
  if (includedSections.includes("governance_analytics") && !input.analyticsStats) {
    warnings.push(buildWarning(
      "EVIDENCE_SECTION_INCOMPLETE",
      "Governance analytics section requested but no analytics data was provided.",
      "P11-D",
      "governance_analytics",
    ));
  }

  if (includedSections.includes("topology_readiness") && !input.topology) {
    warnings.push(buildWarning(
      "EVIDENCE_SECTION_INCOMPLETE",
      "Topology readiness section requested but no topology data was provided.",
      "P11-E",
      "topology_readiness",
    ));
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyPackageIntegrity() - fail-closed
// ─────────────────────────────────────────────────────────────────────────────

export function classifyPackageIntegrity(
  warnings: GovernanceScopedWarning[],
): GovernancePackageIntegrityStatus {
  const codes = new Set(warnings.map(w => w.code));

  if (codes.has("GOVERNANCE_BOUNDARY_LEAK")) return "compromised";
  if (codes.has("EVIDENCE_SECTION_INCOMPLETE") || codes.has("EVIDENCE_REFERENCE_MISSING")) {
    return "incomplete";
  }
  if (warnings.length > 0) return "warning";
  return "verified";
}

// ─────────────────────────────────────────────────────────────────────────────
// computePackageIntegrityHash() - SHA-256 of stable canonical content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a SHA-256 hash of the package content, excluding the hash field itself
 * and the generatedAt field (which varies by call time).
 * Uses deterministic JSON serialization (sorted keys, stable values).
 */
export function computePackageIntegrityHash(content: object): string {
  const stable = JSON.stringify(content, Object.keys(content).sort());
  return createHash("sha256").update(stable).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSectionSummaries() - derive per-section summaries from input data
// ─────────────────────────────────────────────────────────────────────────────

function buildAuditChainSummary(input: GovernanceEvidencePackageInput): AuditChainSectionSummary | null {
  if (input.auditRecordsTotal === undefined) return null;
  return {
    totalRecords:             input.auditRecordsTotal,
    integrityStatus:          input.auditIntegrityStatus ?? "unknown",
    orphanCount:              input.auditOrphanCount ?? 0,
    retentionClassifications: input.auditRetentionMap ?? {},
  };
}

function buildViolationSummary(input: GovernanceEvidencePackageInput): ViolationSectionSummary | null {
  if (input.totalViolations === undefined) return null;
  return {
    totalViolations: input.totalViolations,
    bySeverity:      input.violationsBySeverity ?? {},
    byPolicy:        input.violationsByPolicy ?? {},
    criticalCount:   input.criticalViolationCount ?? 0,
  };
}

function buildWorkflowSummary(input: GovernanceEvidencePackageInput): WorkflowSectionSummary | null {
  if (!input.workflowStats) return null;
  return {
    totalWorkflows:     input.workflowStats.total,
    activeWorkflows:    input.workflowStats.active,
    resolvedWorkflows:  input.workflowStats.resolved,
    escalatedWorkflows: input.workflowStats.escalated,
    criticalUnresolved: input.workflowStats.criticalUnresolved,
    escalationRate:     input.workflowStats.escalationRate,
    throughputRate:     input.workflowStats.throughputRate,
  };
}

function buildAnalyticsSummary(input: GovernanceEvidencePackageInput): AnalyticsSectionSummary | null {
  if (!input.analyticsStats) return null;
  return { ...input.analyticsStats };
}

function buildTopologySummary(input: GovernanceEvidencePackageInput): TopologyReadinessSectionSummary | null {
  if (!input.topology && !input.readinessProfile) return null;
  return {
    overallBoundaryStatus: input.boundarySummary?.overallStatus ?? "incomplete",
    coverageScore:         input.topology?.lifecycleCoverage.coverageScore ?? "minimal",
    readinessStatus:       input.readinessProfile?.overallStatus ?? "partial",
    totalLayers:           input.topology?.lifecycleCoverage.totalLayers ?? 4,
    activeLayers:          input.topology?.lifecycleCoverage.activeLayers ?? 0,
    observabilityComplete: input.topology?.observabilityCoverage.coverageComplete ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildGovernanceEvidencePackage() - main pure builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildGovernanceEvidencePackage(
  input: GovernanceEvidencePackageInput,
): GovernanceEvidencePackage {
  const includedSections = sectionsForScope(input.scope);

  const auditChainSummary  = includedSections.includes("audit_integrity") || includedSections.includes("forensic_timeline")
    ? buildAuditChainSummary(input)
    : null;
  const violationSummary   = includedSections.includes("policy_violations")
    ? buildViolationSummary(input)
    : null;
  const workflowSummary    = includedSections.includes("workflow_lifecycle")
    ? buildWorkflowSummary(input)
    : null;
  const analyticsSummary   = includedSections.includes("governance_analytics")
    ? buildAnalyticsSummary(input)
    : null;
  const topologySummary    = includedSections.includes("topology_readiness")
    ? buildTopologySummary(input)
    : null;
  const boundaryDetails    = includedSections.includes("boundary_summary")
    ? (input.boundarySummary ?? null)
    : null;

  const evidenceReferences = buildEvidenceReferences(input, includedSections);
  const warnings           = gatherWarnings(input, includedSections, evidenceReferences);
  const integrityStatus    = classifyPackageIntegrity(warnings);

  const packageId = `gevpkg:${input.scope}-${input.now.getTime()}`;
  const generatedBy = input.generatedBy ?? "governance-evidence-packaging/P11-F";

  // Compute hash over content - exclude hash field and generatedAt
  const hashableContent = {
    packageId,
    packageScope:     input.scope,
    workspaceId:      input.workspaceId,
    entityId:         input.entityId,
    includedSections,
    auditChainSummary,
    violationSummary,
    workflowSummary,
    analyticsSummary,
    topologySummary,
    boundaryDetails,
    evidenceReferences,
    warnings,
    integrityStatus,
    generatedBy,
  };
  const packageIntegrityHash = computePackageIntegrityHash(hashableContent);

  return {
    ...hashableContent,
    packageIntegrityHash,
    generatedAt: input.now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceTopologySnapshotPayload - for future persistent storage
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceTopologySnapshotPayload {
  snapshotId:       string;    // "gtsnap:<nowMs>"
  topology:         GovernanceTopologyProfile;
  boundarySummary:  GovernanceBoundarySummary;
  readinessProfile: GovernanceReadinessProfile;
  generatedAt:      Date;
  snapshotHash:     string;    // SHA-256 of stable canonical content (excluding hash)
}

export function buildTopologySnapshotPayload(
  topology:        GovernanceTopologyProfile,
  boundarySummary: GovernanceBoundarySummary,
  readiness:       GovernanceReadinessProfile,
  now:             Date,
): GovernanceTopologySnapshotPayload {
  const snapshotId = `gtsnap:${now.getTime()}`;
  const hashableContent = {
    snapshotId,
    topology,
    boundarySummary,
    readinessProfile: readiness,
  };
  const snapshotHash = computePackageIntegrityHash(hashableContent);
  return {
    snapshotId,
    topology,
    boundarySummary,
    readinessProfile: readiness,
    generatedAt: now,
    snapshotHash,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceTopologyDiff - changes between two topology snapshots
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceBoundaryStatusChange {
  layerId: string;
  prev:    GovernanceBoundaryStatus;
  next:    GovernanceBoundaryStatus;
}

export interface GovernanceTopologyDiff {
  diffId:                       string;    // "gtdiff:<nowMs>"
  prevSnapshotId:               string;
  nextSnapshotId:               string;
  boundaryStatusChanges:        GovernanceBoundaryStatusChange[];
  coverageScoreChange:          { prev: GovernanceCoverageScore; next: GovernanceCoverageScore } | null;
  readinessStatusChange:        { prev: GovernanceReadinessStatus; next: GovernanceReadinessStatus } | null;
  layerChanges:                 { added: string[]; removed: string[] };
  observabilityCoverageChange:  { prev: number; next: number } | null;
  criticalGapChanges:           { added: string[]; removed: string[] };
  hasChanges:                   boolean;
  computedAt:                   Date;
}

export function diffGovernanceTopologySnapshots(
  prev:      GovernanceTopologySnapshotPayload,
  next:      GovernanceTopologySnapshotPayload,
  now:       Date,
): GovernanceTopologyDiff {
  const diffId = `gtdiff:${now.getTime()}`;

  // Boundary status changes - compare byLayer arrays by layerId
  const prevByLayer = new Map(prev.boundarySummary.byLayer.map(v => [v.layerId, v.boundaryStatus]));
  const nextByLayer = new Map(next.boundarySummary.byLayer.map(v => [v.layerId, v.boundaryStatus]));
  const allLayerIds = new Set([...prevByLayer.keys(), ...nextByLayer.keys()]);

  const boundaryStatusChanges: GovernanceBoundaryStatusChange[] = [];
  for (const layerId of allLayerIds) {
    const p = prevByLayer.get(layerId);
    const n = nextByLayer.get(layerId);
    if (p !== undefined && n !== undefined && p !== n) {
      boundaryStatusChanges.push({ layerId, prev: p, next: n });
    }
  }

  // Coverage score change
  const prevScore = prev.topology.lifecycleCoverage.coverageScore;
  const nextScore = next.topology.lifecycleCoverage.coverageScore;
  const coverageScoreChange = prevScore !== nextScore
    ? { prev: prevScore, next: nextScore }
    : null;

  // Readiness status change
  const prevReadiness = prev.readinessProfile.overallStatus;
  const nextReadiness = next.readinessProfile.overallStatus;
  const readinessStatusChange = prevReadiness !== nextReadiness
    ? { prev: prevReadiness, next: nextReadiness }
    : null;

  // Layer additions/removals
  const prevLayerIds = new Set(prev.topology.governanceLayers.map(l => l.layerId));
  const nextLayerIds = new Set(next.topology.governanceLayers.map(l => l.layerId));
  const addedLayers   = [...nextLayerIds].filter(id => !prevLayerIds.has(id));
  const removedLayers = [...prevLayerIds].filter(id => !nextLayerIds.has(id));

  // Observability coverage change
  const prevObs = prev.topology.observabilityCoverage.totalEventTypes;
  const nextObs = next.topology.observabilityCoverage.totalEventTypes;
  const observabilityCoverageChange = prevObs !== nextObs
    ? { prev: prevObs, next: nextObs }
    : null;

  // Critical gap changes
  const prevGaps = new Set(prev.readinessProfile.criticalGaps);
  const nextGaps = new Set(next.readinessProfile.criticalGaps);
  const addedGaps   = [...nextGaps].filter(g => !prevGaps.has(g)).sort();
  const removedGaps = [...prevGaps].filter(g => !nextGaps.has(g)).sort();

  const hasChanges =
    boundaryStatusChanges.length > 0 ||
    coverageScoreChange !== null ||
    readinessStatusChange !== null ||
    addedLayers.length > 0 ||
    removedLayers.length > 0 ||
    observabilityCoverageChange !== null ||
    addedGaps.length > 0 ||
    removedGaps.length > 0;

  return {
    diffId,
    prevSnapshotId:               prev.snapshotId,
    nextSnapshotId:               next.snapshotId,
    boundaryStatusChanges,
    coverageScoreChange,
    readinessStatusChange,
    layerChanges:                 { added: addedLayers.sort(), removed: removedLayers.sort() },
    observabilityCoverageChange,
    criticalGapChanges:           { added: addedGaps, removed: removedGaps },
    hasChanges,
    computedAt:                   now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability events (structured log, no external calls)
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceEvidencePackagingEventPayload {
  packageId:       string;
  packageScope:    GovernanceEvidencePackageScope | string;
  workspaceId:     number | null | string;
  integrityStatus: GovernancePackageIntegrityStatus | string;
  readinessStatus: string;
  action:          string;
}

/** A) governance_evidence_package_generated [INFO] */
export function emitGovernanceEvidencePackageGeneratedEvent(
  p: GovernanceEvidencePackagingEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_evidence_package_generated" },
    "governance_evidence_package_generated",
  );
}

/** B) governance_package_integrity_verified [INFO or WARN] */
export function emitGovernancePackageIntegrityVerifiedEvent(
  p: GovernanceEvidencePackagingEventPayload,
): void {
  if (p.integrityStatus === "compromised") {
    logger?.warn(
      { ...p, event: "governance_package_integrity_verified" },
      "governance_package_integrity_verified",
    );
  } else {
    logger?.info(
      { ...p, event: "governance_package_integrity_verified" },
      "governance_package_integrity_verified",
    );
  }
}

/** C) governance_topology_snapshot_built [INFO] */
export function emitGovernanceTopologySnapshotBuiltEvent(
  p: GovernanceEvidencePackagingEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_topology_snapshot_built" },
    "governance_topology_snapshot_built",
  );
}

/** D) governance_topology_diff_computed [INFO] */
export function emitGovernanceTopologyDiffComputedEvent(
  p: GovernanceEvidencePackagingEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_topology_diff_computed" },
    "governance_topology_diff_computed",
  );
}
