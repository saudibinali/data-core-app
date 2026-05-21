/**
 * P11-E - Governance Intelligence Closure & Enterprise Compliance Architecture Consolidation
 *
 * READ-ONLY deterministic topology and boundary verification layer over the
 * full P11-A → P11-D governance stack. No DB writes. No enforcement. No AI.
 * Fail-closed on ambiguity. Pure functions only.
 *
 * Responsibility:
 *   - Describe and verify the four governance layers as a unified topology
 *   - Classify boundary properties (append-only, read-only, human-governed...)
 *   - Compute lifecycle coverage from runtime counts (passed in by the caller)
 *   - Produce a governance readiness assessment
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceLayerType - 4 canonical governance layers (P11-A through P11-D)
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceLayerType =
  | "integrity_layer"   // P11-A - immutable audit chains
  | "policy_layer"      // P11-B - violation detection, pure engine
  | "workflow_layer"    // P11-C - human-governed lifecycle orchestration
  | "analytics_layer";  // P11-D - read-only effectiveness intelligence

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceBoundaryProperty - verifiable invariants per layer
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceBoundaryProperty =
  | "append_only"       // inserts only; no updates or deletes
  | "read_only"         // no writes at all
  | "human_governed"    // every state change requires explicit operator input
  | "deterministic"     // same inputs → same outputs, always
  | "fail_closed"       // ambiguous states default to strictest/most conservative result
  | "no_enforcement"    // outputs are advisory only; nothing is automatically acted upon
  | "no_ai";            // all classification is rule-based, no ML or probabilistic scoring

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceBoundaryStatus - 4-state verification result
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceBoundaryStatus =
  | "verified"              // all expected boundary properties confirmed
  | "warning"               // one or more advisory concerns, not blocking
  | "boundary_leak_detected" // a property violation was detected
  | "incomplete";           // insufficient data to verify

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceLifecycleRole - what each layer does in the lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceLifecycleRole =
  | "record"      // P11-A: creates and preserves immutable records
  | "detect"      // P11-B: evaluates rules and produces violation intelligence
  | "orchestrate" // P11-C: manages human-governed lifecycle transitions
  | "observe";    // P11-D: reads and computes analytics, no mutation

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceLayerDescriptor - static definition of a governance layer
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceLayerDescriptor {
  layerId:              string;                     // "P11-A" through "P11-D"
  layerType:            GovernanceLayerType;
  layerName:            string;
  description:          string;
  phase:                string;                     // "11-A" through "11-D"
  dbTables:             string[];                   // [] for pure-engine layers
  engineFile:           string;                     // source filename
  lifecycleRole:        GovernanceLifecycleRole;
  boundaryProperties:   GovernanceBoundaryProperty[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Static layer registry - authoritative definitions of the 4 governance layers
// ─────────────────────────────────────────────────────────────────────────────

export const GOVERNANCE_LAYERS: ReadonlyArray<GovernanceLayerDescriptor> = [
  {
    layerId:            "P11-A",
    layerType:          "integrity_layer",
    layerName:          "Immutable Audit Integrity",
    description:        "Hash-linked, append-only audit chain records. Provides tamper-detection, " +
                        "forensic timeline reconstruction, retention classification, and orphan detection. " +
                        "Every record is INSERT-only; no UPDATE or DELETE is ever issued against " +
                        "compliance_audit_chains.",
    phase:              "11-A",
    dbTables:           ["compliance_audit_chains"],
    engineFile:         "compliance-audit-integrity.ts",
    lifecycleRole:      "record",
    boundaryProperties: [
      "append_only",
      "deterministic",
      "fail_closed",
      "no_enforcement",
      "no_ai",
    ],
  },
  {
    layerId:            "P11-B",
    layerType:          "policy_layer",
    layerName:          "Governance Policy Intelligence",
    description:        "Eight built-in governance policies evaluated against audit chain and execution " +
                        "data. Produces GovernanceViolation intelligence with evidence references. " +
                        "Pure engine - no DB writes, no persistent state.",
    phase:              "11-B",
    dbTables:           [],
    engineFile:         "governance-policy-intelligence.ts",
    lifecycleRole:      "detect",
    boundaryProperties: [
      "read_only",
      "deterministic",
      "fail_closed",
      "no_enforcement",
      "no_ai",
    ],
  },
  {
    layerId:            "P11-C",
    layerType:          "workflow_layer",
    layerName:          "Compliance Workflow Orchestration",
    description:        "Human-governed six-state lifecycle for each governance violation: " +
                        "open → acknowledged → under_review → escalated → resolved / dismissed. " +
                        "Every transition requires an explicit human operatorId. " +
                        "Persists one row per violation lifecycle in governance_workflow_actions.",
    phase:              "11-C",
    dbTables:           ["governance_workflow_actions"],
    engineFile:         "compliance-workflow-orchestration.ts",
    lifecycleRole:      "orchestrate",
    boundaryProperties: [
      "human_governed",
      "deterministic",
      "fail_closed",
      "no_enforcement",
      "no_ai",
    ],
  },
  {
    layerId:            "P11-D",
    layerType:          "analytics_layer",
    layerName:          "Compliance Operations Analytics",
    description:        "Read-only deterministic analytics over governance_workflow_actions. " +
                        "Computes GovernanceAnalyticsProfile, PolicyEffectivenessProfile, " +
                        "WorkflowEffectivenessScore, PolicyStabilityScore, and EscalationTrend. " +
                        "Pure engine - no DB writes, no state mutation.",
    phase:              "11-D",
    dbTables:           [],
    engineFile:         "compliance-operations-analytics.ts",
    lifecycleRole:      "observe",
    boundaryProperties: [
      "read_only",
      "deterministic",
      "fail_closed",
      "no_enforcement",
      "no_ai",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceBoundaryVerification - result of verifying a layer's boundaries
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceBoundaryVerification {
  layerId:              string;
  layerType:            GovernanceLayerType;
  boundaryStatus:       GovernanceBoundaryStatus;
  verifiedProperties:   GovernanceBoundaryProperty[];
  missingProperties:    GovernanceBoundaryProperty[];
  warnings:             string[];
}

/**
 * Verifies a layer's declared boundary properties against an expected set.
 *
 * Rules (fail-closed):
 *   - If any expected property is absent from the layer's declared properties → boundary_leak_detected
 *   - If any warnings are produced → warning (unless leak already detected)
 *   - If all expected properties are present and no warnings → verified
 */
export function verifyLayerBoundary(
  layer:              GovernanceLayerDescriptor,
  expectedProperties: GovernanceBoundaryProperty[],
  additionalWarnings: string[] = [],
): GovernanceBoundaryVerification {
  const declared    = new Set(layer.boundaryProperties);
  const verified    = expectedProperties.filter(p => declared.has(p));
  const missing     = expectedProperties.filter(p => !declared.has(p));

  let status: GovernanceBoundaryStatus;
  if (missing.length > 0) {
    status = "boundary_leak_detected";
  } else if (additionalWarnings.length > 0) {
    status = "warning";
  } else {
    status = "verified";
  }

  return {
    layerId:            layer.layerId,
    layerType:          layer.layerType,
    boundaryStatus:     status,
    verifiedProperties: verified,
    missingProperties:  missing,
    warnings:           additionalWarnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceCoverageScore - 4-tier lifecycle coverage rating
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceCoverageScore =
  | "minimal"       // <25% of expected lifecycle elements present
  | "partial"       // 25-74%
  | "substantial"   // 75-89%
  | "comprehensive"; // ≥90%

/**
 * Derives a coverage score from the fraction of lifecycle elements present.
 * coverageFraction is a value in [0, 1].
 * Fail-closed: ties round down.
 */
export function classifyCoverageScore(
  coverageFraction: number,
): GovernanceCoverageScore {
  if (coverageFraction >= 0.90) return "comprehensive";
  if (coverageFraction >= 0.75) return "substantial";
  if (coverageFraction >= 0.25) return "partial";
  return "minimal";
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceLifecycleCoverage - runtime data from the two persisted layers
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceLifecycleCoverage {
  auditRecordsTotal:      number;   // compliance_audit_chains row count
  workflowsTotal:         number;   // governance_workflow_actions row count
  activeWorkflows:        number;   // non-terminal workflows
  resolvedWorkflows:      number;   // resolved + dismissed
  criticalUnresolved:     number;   // escalationLevel=critical AND non-terminal
  policyLayerActive:      boolean;  // always true (pure engine, no deployment gate)
  analyticsLayerActive:   boolean;  // always true (pure engine, no deployment gate)
  totalLayers:            number;   // always 4 for the current stack
  activeLayers:           number;   // layers with runtime evidence of activity
  coverageScore:          GovernanceCoverageScore;
}

/**
 * Computes GovernanceLifecycleCoverage from raw runtime counts.
 *
 * @param auditRecordsTotal   count(*) from compliance_audit_chains
 * @param workflowsTotal      count(*) from governance_workflow_actions
 * @param activeWorkflows     count of non-terminal workflows
 * @param resolvedWorkflows   count of resolved + dismissed
 * @param criticalUnresolved  count of critical escalationLevel + non-terminal
 */
export function computeLifecycleCoverage(
  auditRecordsTotal:  number,
  workflowsTotal:     number,
  activeWorkflows:    number,
  resolvedWorkflows:  number,
  criticalUnresolved: number,
): GovernanceLifecycleCoverage {
  const policyLayerActive    = true; // P11-B: always active - it's code, not data
  const analyticsLayerActive = true; // P11-D: always active - pure engine

  // Active layers: P11-B and P11-D are always active (pure engines).
  // P11-A is active if auditRecordsTotal > 0.
  // P11-C is active if workflowsTotal > 0.
  let activeLayers = 2; // P11-B + P11-D always
  if (auditRecordsTotal > 0) activeLayers++;
  if (workflowsTotal > 0)    activeLayers++;

  const coverageFraction = activeLayers / 4;
  const coverageScore    = classifyCoverageScore(coverageFraction);

  return {
    auditRecordsTotal,
    workflowsTotal,
    activeWorkflows,
    resolvedWorkflows,
    criticalUnresolved,
    policyLayerActive,
    analyticsLayerActive,
    totalLayers:  4,
    activeLayers,
    coverageScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ObservabilityCoverage - which layers emit structured events
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservabilityCoverage {
  layersCovered:          string[];  // layer IDs with observability events
  totalEventTypes:        number;    // sum of event types across all layers
  coverageComplete:       boolean;   // all 4 layers have at least one event type
  perLayer: Record<string, {
    eventTypes: string[];
    count:      number;
  }>;
}

/** Returns the static observability coverage map for the P11-A → P11-D stack. */
export function buildObservabilityCoverage(): ObservabilityCoverage {
  const perLayer: ObservabilityCoverage["perLayer"] = {
    "P11-A": {
      eventTypes: [
        "audit_chain_recorded",
        "audit_integrity_verified",
        "audit_integrity_anomaly_detected",
        "forensic_timeline_reconstructed",
      ],
      count: 4,
    },
    "P11-B": {
      eventTypes: [
        "governance_policy_evaluated",
        "governance_violation_detected",
        "compliance_gap_classified",
        "policy_review_required",
      ],
      count: 4,
    },
    "P11-C": {
      eventTypes: [
        "governance_workflow_initiated",
        "governance_workflow_acknowledged",
        "governance_workflow_escalated",
        "governance_workflow_resolved",
      ],
      count: 4,
    },
    "P11-D": {
      eventTypes: [
        "governance_analytics_evaluated",
        "policy_effectiveness_scored",
        "workflow_stability_classified",
        "critical_unresolved_threshold_detected",
      ],
      count: 4,
    },
  };

  const layersCovered   = Object.keys(perLayer);
  const totalEventTypes = Object.values(perLayer).reduce((s, v) => s + v.count, 0);

  return {
    layersCovered,
    totalEventTypes,
    coverageComplete: layersCovered.length === 4,
    perLayer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceTopologyProfile - full consolidated view
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceTopologyProfile {
  topologyId:             string;   // "gtopo:<nowMs>"
  governanceLayers:       GovernanceLayerDescriptor[];
  integrityBoundaries:    GovernanceBoundaryVerification;  // P11-A
  policyBoundaries:       GovernanceBoundaryVerification;  // P11-B
  workflowBoundaries:     GovernanceBoundaryVerification;  // P11-C
  analyticsBoundaries:    GovernanceBoundaryVerification;  // P11-D
  enforcementBoundaries:  GovernanceBoundaryVerification;  // cross-layer
  observabilityCoverage:  ObservabilityCoverage;
  lifecycleCoverage:      GovernanceLifecycleCoverage;
  evaluatedAt:            Date;
}

/**
 * Builds the full governance topology profile from runtime lifecycle coverage data.
 * All boundary verifications are performed against the static GOVERNANCE_LAYERS registry.
 *
 * @param lifecycleCoverage  Computed by computeLifecycleCoverage() using DB counts.
 * @param now                Reference timestamp.
 */
export function buildGovernanceTopology(
  lifecycleCoverage: GovernanceLifecycleCoverage,
  now: Date,
): GovernanceTopologyProfile {
  const layerA = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-A")!;
  const layerB = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-B")!;
  const layerC = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-C")!;
  const layerD = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-D")!;

  // P11-A: must be append-only, deterministic, fail-closed, no-enforcement, no-ai
  const integrityBoundaries = verifyLayerBoundary(
    layerA,
    ["append_only", "deterministic", "fail_closed", "no_enforcement", "no_ai"],
    lifecycleCoverage.auditRecordsTotal === 0
      ? ["No audit records yet - P11-A table is empty. Layer boundary verified but no runtime activity."]
      : [],
  );

  // P11-B: must be read-only, deterministic, fail-closed, no-enforcement, no-ai
  const policyBoundaries = verifyLayerBoundary(
    layerB,
    ["read_only", "deterministic", "fail_closed", "no_enforcement", "no_ai"],
  );

  // P11-C: must be human-governed, deterministic, fail-closed, no-enforcement, no-ai
  const workflowBoundaries = verifyLayerBoundary(
    layerC,
    ["human_governed", "deterministic", "fail_closed", "no_enforcement", "no_ai"],
    lifecycleCoverage.workflowsTotal === 0
      ? ["No workflow rows yet - P11-C table is empty. Layer boundary verified but no runtime activity."]
      : [],
  );

  // P11-D: must be read-only, deterministic, fail-closed, no-enforcement, no-ai
  const analyticsBoundaries = verifyLayerBoundary(
    layerD,
    ["read_only", "deterministic", "fail_closed", "no_enforcement", "no_ai"],
  );

  // Cross-layer enforcement boundary: verify that NO layer has auto-enforcement
  // by checking all four layers declare no_enforcement.
  const allDeclareNoEnforcement = GOVERNANCE_LAYERS.every(
    l => l.boundaryProperties.includes("no_enforcement"),
  );
  const allDeclareNoAi = GOVERNANCE_LAYERS.every(
    l => l.boundaryProperties.includes("no_ai"),
  );

  // Build a synthetic "cross-layer" descriptor for the enforcement check
  const crossLayerDescriptor: GovernanceLayerDescriptor = {
    layerId:           "CROSS",
    layerType:         "analytics_layer", // closest structural fit for a synthetic layer
    layerName:         "Cross-Layer Enforcement Boundary",
    description:       "Verifies that no layer in the P11-A→P11-D stack auto-enforces outcomes.",
    phase:             "11-E",
    dbTables:          [],
    engineFile:        "governance-intelligence-consolidation.ts",
    lifecycleRole:     "observe",
    boundaryProperties: [
      ...(allDeclareNoEnforcement ? ["no_enforcement" as GovernanceBoundaryProperty] : []),
      ...(allDeclareNoAi         ? ["no_ai"          as GovernanceBoundaryProperty] : []),
    ],
  };

  const enforcementBoundaries = verifyLayerBoundary(
    crossLayerDescriptor,
    ["no_enforcement", "no_ai"],
  );

  const observabilityCoverage = buildObservabilityCoverage();
  const topologyId = `gtopo:${now.getTime()}`;

  return {
    topologyId,
    governanceLayers:    [...GOVERNANCE_LAYERS],
    integrityBoundaries,
    policyBoundaries,
    workflowBoundaries,
    analyticsBoundaries,
    enforcementBoundaries,
    observabilityCoverage,
    lifecycleCoverage,
    evaluatedAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance Boundary Summary
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceBoundarySummary {
  summaryId:          string;   // "gbsum:<nowMs>"
  totalLayers:        number;
  verifiedLayers:     number;
  warningLayers:      number;
  leakDetectedLayers: number;
  incompleteLayers:   number;
  overallStatus:      GovernanceBoundaryStatus;
  byLayer:            GovernanceBoundaryVerification[];
  evaluatedAt:        Date;
}

/**
 * Computes a summary of boundary verification statuses across all four layers
 * plus the cross-layer enforcement check, from a topology profile.
 */
export function buildBoundarySummary(
  topology: GovernanceTopologyProfile,
  now: Date,
): GovernanceBoundarySummary {
  const verifications = [
    topology.integrityBoundaries,
    topology.policyBoundaries,
    topology.workflowBoundaries,
    topology.analyticsBoundaries,
    topology.enforcementBoundaries,
  ];

  const verified     = verifications.filter(v => v.boundaryStatus === "verified").length;
  const warnings     = verifications.filter(v => v.boundaryStatus === "warning").length;
  const leaks        = verifications.filter(v => v.boundaryStatus === "boundary_leak_detected").length;
  const incomplete   = verifications.filter(v => v.boundaryStatus === "incomplete").length;

  let overallStatus: GovernanceBoundaryStatus;
  if (leaks > 0)         overallStatus = "boundary_leak_detected";
  else if (incomplete > 0) overallStatus = "incomplete";
  else if (warnings > 0)   overallStatus = "warning";
  else                     overallStatus = "verified";

  return {
    summaryId:          `gbsum:${now.getTime()}`,
    totalLayers:        verifications.length,
    verifiedLayers:     verified,
    warningLayers:      warnings,
    leakDetectedLayers: leaks,
    incompleteLayers:   incomplete,
    overallStatus,
    byLayer:            verifications,
    evaluatedAt:        now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceReadinessStatus
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceReadinessStatus =
  | "not_ready"       // critical gaps present
  | "partial"         // some layers unverified or incomplete
  | "ready"           // all boundaries verified, coverage may be limited
  | "production_ready"; // all boundaries verified + comprehensive coverage

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceReadinessProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceReadinessProfile {
  readinessId:       string;   // "gready:<nowMs>"
  overallStatus:     GovernanceReadinessStatus;
  layerReadiness:    Record<string, GovernanceBoundaryStatus>;
  criticalGaps:      string[];
  readinessNotes:    string[];
  coverageScore:     GovernanceCoverageScore;
  lifecycleCoverage: GovernanceLifecycleCoverage;
  observabilityComplete: boolean;
  evaluatedAt:       Date;
}

/**
 * Derives a governance readiness profile from a topology + boundary summary.
 * Fail-closed: any boundary_leak → not_ready; incomplete → partial.
 */
export function buildGovernanceReadiness(
  topology:        GovernanceTopologyProfile,
  boundarySummary: GovernanceBoundarySummary,
  now: Date,
): GovernanceReadinessProfile {
  const criticalGaps: string[]   = [];
  const readinessNotes: string[] = [];

  // Collect gaps from boundary leaks
  for (const v of boundarySummary.byLayer) {
    if (v.boundaryStatus === "boundary_leak_detected") {
      criticalGaps.push(
        `${v.layerId}: boundary_leak_detected - missing properties: ${v.missingProperties.join(", ")}`,
      );
    }
    if (v.boundaryStatus === "warning") {
      readinessNotes.push(...v.warnings.map(w => `${v.layerId}: ${w}`));
    }
  }

  // Collect lifecycle coverage gaps
  if (topology.lifecycleCoverage.auditRecordsTotal === 0) {
    readinessNotes.push("P11-A: No audit chain records yet. Integrity layer is structurally ready but has no runtime data.");
  }
  if (topology.lifecycleCoverage.workflowsTotal === 0) {
    readinessNotes.push("P11-C: No workflow records yet. Orchestration layer is structurally ready but has no runtime data.");
  }
  if (topology.lifecycleCoverage.criticalUnresolved > 0) {
    readinessNotes.push(
      `P11-C/P11-D: ${topology.lifecycleCoverage.criticalUnresolved} critical violation(s) remain unresolved.`,
    );
  }

  // Observability completeness
  const observabilityComplete = topology.observabilityCoverage.coverageComplete;
  if (!observabilityComplete) {
    readinessNotes.push("Observability coverage is incomplete - not all layers emit structured events.");
  }

  // Derive overall readiness - fail-closed
  let overallStatus: GovernanceReadinessStatus;
  const hasCriticalGaps     = criticalGaps.length > 0;
  const hasLeaks             = boundarySummary.leakDetectedLayers > 0;
  const hasIncomplete        = boundarySummary.incompleteLayers > 0;
  const allVerified          = boundarySummary.leakDetectedLayers === 0 &&
                               boundarySummary.incompleteLayers === 0;
  const comprehensiveCoverage = topology.lifecycleCoverage.coverageScore === "comprehensive" ||
                                topology.lifecycleCoverage.coverageScore === "substantial";

  if (hasCriticalGaps || hasLeaks) {
    overallStatus = "not_ready";
  } else if (hasIncomplete) {
    overallStatus = "partial";
  } else if (allVerified && comprehensiveCoverage && observabilityComplete) {
    overallStatus = "production_ready";
  } else if (allVerified) {
    overallStatus = "ready";
  } else {
    overallStatus = "partial";
  }

  // Per-layer readiness map
  const layerReadiness: Record<string, GovernanceBoundaryStatus> = {};
  for (const v of boundarySummary.byLayer) {
    layerReadiness[v.layerId] = v.boundaryStatus;
  }

  return {
    readinessId:          `gready:${now.getTime()}`,
    overallStatus,
    layerReadiness,
    criticalGaps,
    readinessNotes,
    coverageScore:        topology.lifecycleCoverage.coverageScore,
    lifecycleCoverage:    topology.lifecycleCoverage,
    observabilityComplete,
    evaluatedAt:          now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability events (structured log, no external calls)
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceConsolidationEventPayload {
  topologyId:        string;
  governanceLayer:   string;
  boundaryStatus:    GovernanceBoundaryStatus;
  lifecycleCoverage: string;   // coverageScore as string
  action:            string;
}

/** A) governance_topology_evaluated [INFO] */
export function emitGovernanceTopologyEvaluatedEvent(
  p: GovernanceConsolidationEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_topology_evaluated" },
    "governance_topology_evaluated",
  );
}

/** B) governance_boundary_verified [INFO] */
export function emitGovernanceBoundaryVerifiedEvent(
  p: GovernanceConsolidationEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_boundary_verified" },
    "governance_boundary_verified",
  );
}

/** C) governance_layer_classified [INFO] */
export function emitGovernanceLayerClassifiedEvent(
  p: GovernanceConsolidationEventPayload,
): void {
  logger?.info(
    { ...p, event: "governance_layer_classified" },
    "governance_layer_classified",
  );
}

/** D) governance_readiness_confirmed [INFO or WARN] */
export function emitGovernanceReadinessConfirmedEvent(
  p: GovernanceConsolidationEventPayload,
): void {
  if (p.boundaryStatus === "boundary_leak_detected") {
    logger?.warn(
      { ...p, event: "governance_readiness_confirmed" },
      "governance_readiness_confirmed",
    );
  } else {
    logger?.info(
      { ...p, event: "governance_readiness_confirmed" },
      "governance_readiness_confirmed",
    );
  }
}
