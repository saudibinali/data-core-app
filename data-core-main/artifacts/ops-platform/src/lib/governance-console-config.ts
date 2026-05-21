/**
 * @file   lib/governance-console-config.ts
 * @phase  P12-A / P12-B - Governance Dashboard Shell & Audit Integrity UI
 *
 * Pure TypeScript constants for the governance console shell.
 * No React, no browser APIs, no HTTP - safe to import in any environment
 * including node-based test environments.
 *
 * This file is the single source of truth for:
 *   - Governance nav item definitions
 *   - Governance route path registry
 *   - Governance query key names
 *   - Safety contract declarations
 */

// ── Governance route paths ──────────────────────────────────────────────────

export const GOVERNANCE_ROUTES = {
  overview:        "/super-admin/governance",
  auditIntegrity:  "/super-admin/governance/audit-integrity",
  violations:      "/super-admin/governance/violations",
  workflows:       "/super-admin/governance/workflows",
  analytics:       "/super-admin/governance/analytics",
  topology:        "/super-admin/governance/topology",
  evidencePackages:"/super-admin/governance/evidence-packages",
} as const;

export type GovernanceRoutePath = typeof GOVERNANCE_ROUTES[keyof typeof GOVERNANCE_ROUTES];

export const ALL_GOVERNANCE_ROUTE_PATHS: readonly GovernanceRoutePath[] =
  Object.values(GOVERNANCE_ROUTES) as GovernanceRoutePath[];

// ── Governance nav item labels ──────────────────────────────────────────────

export const GOVERNANCE_NAV_LABELS = [
  "Overview",
  "Audit Integrity",
  "Policy Violations",
  "Workflows",
  "Analytics",
  "Topology & Readiness",
  "Evidence Packages",
] as const;

export type GovernanceNavLabel = typeof GOVERNANCE_NAV_LABELS[number];

// ── Governance query key names ──────────────────────────────────────────────
// Mirror of the keys used in governance-console-hooks.ts.
// Kept as a plain string registry so tests can validate coverage without
// importing @tanstack/react-query.

export const GOVERNANCE_QUERY_KEY_NAMES = [
  "auditChains",
  "auditIntegrity",
  "policies",
  "violations",
  "workflows",
  "analytics",
  "analyticsEffectiveness",
  "policyEffectiveness",
  "topology",
  "topologyBoundaries",
  "readiness",
  "evidencePackages",
  "evidenceReadiness",
  "topologySnapshot",
] as const;

export type GovernanceQueryKeyName = typeof GOVERNANCE_QUERY_KEY_NAMES[number];

// ── Governance hook names registry ─────────────────────────────────────────
// Declared as constants so tests can verify the public API contract without
// importing the hook module (which depends on @tanstack/react-query).

export const GOVERNANCE_READ_HOOK_NAMES = [
  "useGovernanceAuditChains",
  "useGovernanceAuditIntegrity",
  "useGovernancePolicies",
  "useGovernanceViolations",
  "useGovernanceWorkflows",
  "useGovernanceAnalytics",
  "useGovernanceAnalyticsEffectiveness",
  "useGovernancePolicyEffectiveness",
  "useGovernanceTopology",
  "useGovernanceTopologyBoundaries",
  "useGovernanceReadiness",
  "useGovernanceEvidencePackages",
  "useGovernanceEvidenceReadiness",
  "useGovernanceTopologySnapshot",
  "useGovernanceOverview",
  "useGovernanceForensicTimeline",
] as const;

export type GovernanceReadHookName = typeof GOVERNANCE_READ_HOOK_NAMES[number];

// ── Governance API base paths ──────────────────────────────────────────────

export const GOVERNANCE_API_PATHS = {
  auditChains:           "/api/platform/compliance/audit-chains",
  auditIntegrity:        "/api/platform/compliance/audit-integrity",
  forensics:             "/api/platform/compliance/forensics",
  policies:              "/api/platform/governance/policies",
  violations:            "/api/platform/governance/violations",
  workflows:             "/api/platform/governance/workflows",
  analytics:             "/api/platform/governance/analytics",
  analyticsEffectiveness:"/api/platform/governance/analytics/effectiveness",
  policyEffectiveness:   "/api/platform/governance/analytics/policy-effectiveness",
  topology:              "/api/platform/governance/topology",
  topologyBoundaries:    "/api/platform/governance/topology/boundaries",
  topologySnapshot:      "/api/platform/governance/topology/snapshot",
  topologyDiff:          "/api/platform/governance/topology/diff",
  readiness:             "/api/platform/governance/readiness",
  evidencePackages:      "/api/platform/governance/evidence-packages",
  evidenceReadiness:     "/api/platform/governance/evidence-packages/readiness",
} as const;

// ── Safety contract declarations ───────────────────────────────────────────
// These are the invariants that P12-A upholds. Tests validate these constants
// directly to ensure they cannot drift without a test failure.

export const GOVERNANCE_CONSOLE_SAFETY_CONTRACT = {
  readOnly:             true,
  noMutationControls:   true,
  noAutoEnforcement:    true,
  noExportRendering:    true,
  noExternalSubmission: true,
  noAiSummaries:        true,
  superAdminOnly:       true,
  allRoutesUnderSuperAdmin: true,
} as const;

// ── P12-C - Violation Severity Map ────────────────────────────────────────
// Maps every possible violation severity value to a UI-safe tier.
// Deterministic ordering index is included so the list can always be
// sorted consistently regardless of API return order.
// No label implies guilt, legal fault, or disciplinary action.

export const VIOLATION_SEVERITY_MAP = {
  informational: { tier: "info",      label: "Informational", order: 0, description: "Observation-level deviation - no immediate action needed." },
  low:           { tier: "low",       label: "Low",           order: 1, description: "Minor policy deviation - log and monitor." },
  medium:        { tier: "medium",    label: "Medium",        order: 2, description: "Moderate deviation - warrants investigation." },
  high:          { tier: "high",      label: "High",          order: 3, description: "Significant deviation - prompt review recommended." },
  critical:      { tier: "critical",  label: "Critical",      order: 4, description: "Severe deviation - immediate review required." },
} as const;

export type ViolationSeverityKey = keyof typeof VIOLATION_SEVERITY_MAP;
export type ViolationSeverityTier = typeof VIOLATION_SEVERITY_MAP[ViolationSeverityKey]["tier"];

export const ALL_VIOLATION_SEVERITY_KEYS: readonly ViolationSeverityKey[] =
  ["informational", "low", "medium", "high", "critical"] as const;

// Ordered highest-first for display (critical first, informational last)
export const VIOLATION_SEVERITY_ORDER_DESC: readonly ViolationSeverityKey[] =
  ["critical", "high", "medium", "low", "informational"] as const;

// ── P12-C - Evidence Reference Type Registry ───────────────────────────────

export const EVIDENCE_REFERENCE_TYPE_MAP = {
  audit_chain_entry:  { label: "Audit Chain Entry",   icon: "link",   description: "Direct reference to an audit chain record." },
  execution_record:   { label: "Execution Record",    icon: "cpu",    description: "Reference to a workflow execution event." },
  snapshot:           { label: "Topology Snapshot",   icon: "camera", description: "Point-in-time topology state capture." },
  policy_evaluation:  { label: "Policy Evaluation",   icon: "shield", description: "Result of a governance policy check." },
  external_ref:       { label: "External Reference",  icon: "file",   description: "Reference to an external identifier." },
} as const;

export type EvidenceReferenceTypeKey = keyof typeof EVIDENCE_REFERENCE_TYPE_MAP;

export const ALL_EVIDENCE_REFERENCE_TYPE_KEYS: readonly EvidenceReferenceTypeKey[] =
  Object.keys(EVIDENCE_REFERENCE_TYPE_MAP) as EvidenceReferenceTypeKey[];

// ── P12-C - Policy Registry Columns ───────────────────────────────────────

export const POLICY_REGISTRY_COLUMNS = [
  { key: "policyId",        label: "Policy ID",    width: "w-28"  },
  { key: "name",            label: "Name",         width: "flex-1"},
  { key: "defaultSeverity", label: "Severity",     width: "w-28"  },
  { key: "enabled",         label: "Status",       width: "w-20"  },
  { key: "violationCount",  label: "Violations",   width: "w-24"  },
  { key: "lastDetectedAt",  label: "Last Detected",width: "w-36"  },
] as const;

export type PolicyRegistryColumnKey = typeof POLICY_REGISTRY_COLUMNS[number]["key"];

// ── P12-C - Violation Filter Options ──────────────────────────────────────

export const VIOLATION_SEVERITY_FILTER_OPTIONS = [
  { value: "",              label: "All Severities"  },
  { value: "critical",      label: "Critical"        },
  { value: "high",          label: "High"            },
  { value: "medium",        label: "Medium"          },
  { value: "low",           label: "Low"             },
  { value: "informational", label: "Informational"   },
] as const;

export const VIOLATION_TYPE_FILTER_OPTIONS = [
  { value: "",                              label: "All Types"                     },
  { value: "audit_completeness",            label: "Audit Completeness"            },
  { value: "execution_integrity",           label: "Execution Integrity"           },
  { value: "retention_compliance",          label: "Retention Compliance"          },
  { value: "forensic_coverage",             label: "Forensic Coverage"             },
  { value: "chain_integrity",              label: "Chain Integrity"               },
  { value: "cross_workspace_isolation",     label: "Cross-Workspace Isolation"     },
  { value: "escalation_threshold",         label: "Escalation Threshold"          },
  { value: "policy_acknowledgement_gap",    label: "Policy Acknowledgement Gap"    },
] as const;

// ── P12-C - Violations UI Safety Contract ─────────────────────────────────

export const VIOLATIONS_UI_SAFETY_CONTRACT = {
  noViolationCreation:    true,
  noViolationDismissal:   true,
  noViolationResolution:  true,
  noPolicyEdit:           true,
  noPolicyEnableDisable:  true,
  noWorkflowTrigger:      true,
  noLegalConclusions:     true,
  noAiSummaries:          true,
  noExportRendering:      true,
  criticalAlwaysVisible:  true,
  highAlwaysVisible:      true,
  superAdminOnly:         true,
} as const;

// ── P12-C - Forensic context link guidance text ────────────────────────────

export const FORENSIC_CONTEXT_GUIDANCE = {
  linkText:    "Review Forensic Timeline",
  copyText:    "Copy Entity ID",
  description: "Use the entity ID below to investigate the full audit trail on the Audit Integrity page.",
} as const;

// ── P12-C - Violation empty states ────────────────────────────────────────

export const VIOLATIONS_EMPTY_STATE = {
  noViolations: {
    title:       "No policy violations detected",
    description: "All 8 governance policies are currently satisfied across all monitored workspaces.",
  },
  noFilterMatch: {
    title:       "No violations match the current filters",
    description: "Try adjusting the severity, type, or workspace filters.",
  },
  evidenceEmpty: {
    title:       "No evidence references attached",
    description: "This violation has no linked audit chain entries, execution records, or snapshots.",
  },
  policyRegistryEmpty: {
    title:       "No governance policies loaded",
    description: "The policy registry could not be retrieved from the governance API.",
  },
} as const;

// ── P12-G - Evidence Package Scope Map ────────────────────────────────────
// Canonical scopes for evidence packages. No export wording, no legal wording.

export const EVIDENCE_PACKAGE_SCOPE_MAP = {
  platform: {
    label: "Platform",   order: 0, tier: "comprehensive",
    description:   "All 7 evidence sections - full platform-wide governance record.",
    displayHint:   "Includes audit integrity, policy violations, workflow lifecycle, analytics, topology, forensic timeline, and boundary summary.",
  },
  workspace: {
    label: "Workspace",  order: 1, tier: "scoped",
    description:   "Workspace-scoped audit, violation, and workflow evidence.",
    displayHint:   "Filtered to a single workspace - includes audit chains, violations, and workflow records.",
  },
  entity: {
    label: "Entity",     order: 2, tier: "scoped",
    description:   "Entity-specific governance evidence (user, workflow, ticket).",
    displayHint:   "Evidence tied to a specific entity ID across all relevant governance layers.",
  },
  violation: {
    label: "Violation",  order: 3, tier: "targeted",
    description:   "Evidence package centred on a specific policy violation.",
    displayHint:   "Includes the violation record, related audit chain entries, and workflow disposition.",
  },
  workflow: {
    label: "Workflow",   order: 4, tier: "targeted",
    description:   "Evidence package for a specific workflow lifecycle.",
    displayHint:   "Includes workflow execution records, escalation history, and outcome data.",
  },
  readiness: {
    label: "Readiness",  order: 5, tier: "lightweight",
    description:   "Topology and boundary sections only - minimal data read.",
    displayHint:   "Lightweight package covering topology clarity and readiness dimensions only.",
  },
} as const;

export type EvidencePackageScopeKey = keyof typeof EVIDENCE_PACKAGE_SCOPE_MAP;
export const EVIDENCE_PACKAGE_SCOPE_ORDER: readonly EvidencePackageScopeKey[] =
  ["platform", "workspace", "entity", "violation", "workflow", "readiness"] as const;

// ── P12-G - Evidence Section Map ──────────────────────────────────────────
// 7 canonical sections that can appear in an evidence package.

export const EVIDENCE_SECTION_MAP = {
  audit_integrity: {
    label: "Audit Integrity",        order: 0,
    description:         "Audit chain completeness and tamper-evidence records.",
    expectedSourceLayer: "audit_integrity",
    reviewMeaning:       "Confirms audit data is complete and unmodified from the source layer.",
  },
  policy_violations: {
    label: "Policy Violations",      order: 1,
    description:         "Detected policy violations and classification records.",
    expectedSourceLayer: "policy_governance",
    reviewMeaning:       "Enumerates violations, their severity classification, and detection timestamps.",
  },
  workflow_lifecycle: {
    label: "Workflow Lifecycle",     order: 2,
    description:         "Governance workflow execution and review outcomes.",
    expectedSourceLayer: "workflow_governance",
    reviewMeaning:       "Records the human review chain - assignment, escalation, resolution.",
  },
  governance_analytics: {
    label: "Governance Analytics",   order: 3,
    description:         "Aggregate analytics metrics and effectiveness indicators.",
    expectedSourceLayer: "analytics_intelligence",
    reviewMeaning:       "Provides statistical context for interpreting violations and workflow patterns.",
  },
  topology_readiness: {
    label: "Topology & Readiness",   order: 4,
    description:         "Layer dependency map and platform readiness assessment.",
    expectedSourceLayer: "topology_readiness",
    reviewMeaning:       "Shows governance layer health and cross-layer boundary status at package time.",
  },
  forensic_timeline: {
    label: "Forensic Timeline",      order: 5,
    description:         "Chronological sequence of governance events for the package scope.",
    expectedSourceLayer: "audit_integrity",
    reviewMeaning:       "Provides a time-ordered narrative of all relevant governance events.",
  },
  boundary_summary: {
    label: "Boundary Summary",       order: 6,
    description:         "Per-layer boundary verification records at package generation time.",
    expectedSourceLayer: "topology_readiness",
    reviewMeaning:       "Documents the observed boundary state for each governance layer.",
  },
} as const;

export type EvidenceSectionKey = keyof typeof EVIDENCE_SECTION_MAP;
export const EVIDENCE_SECTION_ORDER: readonly EvidenceSectionKey[] = [
  "audit_integrity", "policy_violations", "workflow_lifecycle", "governance_analytics",
  "topology_readiness", "forensic_timeline", "boundary_summary",
] as const;

// ── P12-G - Package Integrity Status Map ──────────────────────────────────
// compromised = critical visibility only - no fix/repair action afforded.

export const PACKAGE_INTEGRITY_STATUS_MAP = {
  verified: {
    tier: "good",      order: 0, label: "Verified",
    description: "Package hash verified - contents match the recorded digest.",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
  },
  warning: {
    tier: "attention", order: 1, label: "Warning",
    description: "Minor integrity concern detected - review package metadata.",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
  },
  incomplete: {
    tier: "neutral",   order: 2, label: "Incomplete",
    description: "One or more expected evidence sections are absent from the package.",
    badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0",
  },
  compromised: {
    tier: "critical",  order: 3, label: "Compromised",
    description: "Hash mismatch detected - tamper evidence present. Critical visibility only.",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
  },
  unknown: {
    tier: "muted",     order: 4, label: "Unknown",
    description: "Integrity status cannot be determined from available package metadata.",
    badgeClass: "bg-muted text-muted-foreground border-0",
  },
} as const;

export type PackageIntegrityStatusKey = keyof typeof PACKAGE_INTEGRITY_STATUS_MAP;
export const PACKAGE_INTEGRITY_STATUS_ORDER: readonly PackageIntegrityStatusKey[] =
  ["verified", "warning", "incomplete", "compromised", "unknown"] as const;

// ── P12-G - Evidence Package Filter Options ────────────────────────────────

export const EVIDENCE_SCOPE_FILTER_OPTIONS = [
  { value: "",            label: "All Scopes"   },
  { value: "platform",   label: "Platform"    },
  { value: "workspace",  label: "Workspace"   },
  { value: "entity",     label: "Entity"      },
  { value: "violation",  label: "Violation"   },
  { value: "workflow",   label: "Workflow"    },
  { value: "readiness",  label: "Readiness"   },
] as const;

export const EVIDENCE_INTEGRITY_FILTER_OPTIONS = [
  { value: "",             label: "All Statuses"  },
  { value: "verified",    label: "Verified"      },
  { value: "warning",     label: "Warning"       },
  { value: "incomplete",  label: "Incomplete"    },
  { value: "compromised", label: "Compromised"   },
  { value: "unknown",     label: "Unknown"       },
] as const;

// ── P12-G - Evidence Package Safety Contract ──────────────────────────────

export const EVIDENCE_PACKAGE_SAFETY_CONTRACT = {
  noPackageGeneration:   true,
  noExportRendering:     true,
  noExternalSubmission:  true,
  noVerifyRepairAction:  true,
  noNotarization:        true,
  noAiSummaries:         true,
  noLegalConclusions:    true,
  noDownloadButtons:     true,
  superAdminOnly:        true,
  noPackageMutation:     true,
} as const;

// ── P12-G - Evidence Package Empty States ─────────────────────────────────

export const EVIDENCE_PACKAGE_EMPTY_STATE = {
  noPackages: {
    title:       "No evidence packages available",
    description: "Evidence packages will appear once governance data has been assembled.",
  },
  noFilterMatch: {
    title:       "No packages match the current filters",
    description: "Try adjusting the scope, integrity status, or workspace filters.",
  },
  noReadinessData: {
    title:       "Evidence readiness data unavailable",
    description: "Package readiness information could not be retrieved from the governance API.",
  },
  noSectionData: {
    title:       "No section data available",
    description: "Section coverage will be shown once a package is selected.",
  },
} as const;

// ── P12-F - Topology Layer Map ────────────────────────────────────────────
// Canonical ordered map of every governance layer in the dependency stack.
// No mutation wording, no enforcement wording - description only.

export const TOPOLOGY_LAYER_MAP = {
  audit_integrity: {
    label: "Audit Integrity",         order: 0, tier: "foundation",
    description:       "Immutable event stream capture and chain verification - the base data layer.",
    expectedBoundary:  "isolated",
    dependencyDirection: "produces",
  },
  policy_governance: {
    label: "Policy Governance",        order: 1, tier: "control",
    description:       "Policy definitions and violation classification - reads from audit integrity.",
    expectedBoundary:  "read_only",
    dependencyDirection: "reads_from_audit",
  },
  workflow_governance: {
    label: "Workflow Governance",      order: 2, tier: "control",
    description:       "Human review workflows orchestrated over detected violations.",
    expectedBoundary:  "human_governed",
    dependencyDirection: "reads_from_policy",
  },
  analytics_intelligence: {
    label: "Analytics Intelligence",   order: 3, tier: "intelligence",
    description:       "Aggregate analytics and effectiveness scoring derived from workflow outcomes.",
    expectedBoundary:  "read_only",
    dependencyDirection: "reads_from_workflow",
  },
  topology_readiness: {
    label: "Topology & Readiness",     order: 4, tier: "meta",
    description:       "Cross-layer boundary verification and platform readiness assessment.",
    expectedBoundary:  "read_only",
    dependencyDirection: "observes_all",
  },
  evidence_packaging: {
    label: "Evidence Packaging",       order: 5, tier: "output",
    description:       "Evidence assembly and package integrity verification across all layers.",
    expectedBoundary:  "append_only",
    dependencyDirection: "reads_from_all",
  },
  frontend_console: {
    label: "Frontend Console",         order: 6, tier: "presentation",
    description:       "Super-admin read-only console - visualises all layer outputs.",
    expectedBoundary:  "read_only",
    dependencyDirection: "reads_from_all",
  },
} as const;

export type TopologyLayerKey = keyof typeof TOPOLOGY_LAYER_MAP;
export const TOPOLOGY_LAYER_ORDER: readonly TopologyLayerKey[] = [
  "audit_integrity", "policy_governance", "workflow_governance",
  "analytics_intelligence", "topology_readiness", "evidence_packaging", "frontend_console",
] as const;

// ── P12-F - Boundary Status Map ───────────────────────────────────────────

export const BOUNDARY_STATUS_MAP = {
  isolated: {
    tier: "good",      order: 0, label: "Isolated",
    description: "Layer is fully self-contained - no boundary exposure.",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
  },
  read_only: {
    tier: "good",      order: 1, label: "Read-Only",
    description: "Layer only reads from upstream - no write-back boundary.",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0",
  },
  append_only: {
    tier: "neutral",   order: 2, label: "Append-Only",
    description: "Layer may append records but cannot modify existing data.",
    badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-0",
  },
  human_governed: {
    tier: "good",      order: 3, label: "Human-Governed",
    description: "All boundary transitions require explicit human review.",
    badgeClass: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-0",
  },
  warning: {
    tier: "attention", order: 4, label: "Warning",
    description: "Boundary concern detected - review recommended.",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
  },
  leak_detected: {
    tier: "critical",  order: 5, label: "Leak Detected",
    description: "Boundary violation observed - critical visibility only. Manual review required.",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
  },
  unknown: {
    tier: "muted",     order: 6, label: "Unknown",
    description: "Boundary status cannot be determined at this time.",
    badgeClass: "bg-muted text-muted-foreground border-0",
  },
} as const;

export type BoundaryStatusKey = keyof typeof BOUNDARY_STATUS_MAP;
export const BOUNDARY_STATUS_ORDER: readonly BoundaryStatusKey[] = [
  "isolated", "read_only", "append_only", "human_governed", "warning", "leak_detected", "unknown",
] as const;

// ── P12-F - Readiness Dimension Map ──────────────────────────────────────

export const READINESS_DIMENSION_MAP = {
  audit_integrity: {
    label: "Audit Integrity",        order: 0,
    description:    "Completeness and verification status of the audit chain.",
    expectedInputs: "Event stream records, chain hashes, verification timestamps.",
    outputMeaning:  "Confidence that audit data is complete and tamper-evident.",
  },
  policy_coverage: {
    label: "Policy Coverage",        order: 1,
    description:    "Breadth of policy definitions relative to observed event types.",
    expectedInputs: "Policy registry, violation classification data.",
    outputMeaning:  "Proportion of event surface area covered by active policies.",
  },
  workflow_maturity: {
    label: "Workflow Maturity",      order: 2,
    description:    "Consistency and completeness of governance workflow processes.",
    expectedInputs: "Workflow lifecycle data, escalation patterns, resolution rates.",
    outputMeaning:  "Indicator of how well-defined and consistently applied the review process is.",
  },
  analytics_visibility: {
    label: "Analytics Visibility",   order: 3,
    description:    "Whether analytics metrics provide sufficient operational insight.",
    expectedInputs: "Governance analytics profile, effectiveness scores.",
    outputMeaning:  "Confidence that analytics surface actionable patterns.",
  },
  topology_clarity: {
    label: "Topology Clarity",       order: 4,
    description:    "Clarity and completeness of the layer dependency map.",
    expectedInputs: "Layer definitions, boundary status records.",
    outputMeaning:  "Confidence that all governance layers are properly mapped and bounded.",
  },
  evidence_packaging: {
    label: "Evidence Packaging",     order: 5,
    description:    "Integrity and completeness of assembled evidence packages.",
    expectedInputs: "Evidence package records, reference links, audit trails.",
    outputMeaning:  "Whether evidence packages are complete enough for external review.",
  },
  export_readiness: {
    label: "Package Readiness",      order: 6,
    description:    "Readiness of evidence packages for structured external presentation.",
    expectedInputs: "Packaged evidence, policy summaries, workflow records.",
    outputMeaning:  "Whether the platform can produce a complete, coherent governance record.",
  },
  frontend_operability: {
    label: "Console Operability",    order: 7,
    description:    "Operational status of the governance console itself.",
    expectedInputs: "API availability, hook response status, route health.",
    outputMeaning:  "Whether the console provides complete visibility across all governance layers.",
  },
} as const;

export type ReadinessDimensionKey = keyof typeof READINESS_DIMENSION_MAP;
export const READINESS_DIMENSION_ORDER: readonly ReadinessDimensionKey[] = [
  "audit_integrity", "policy_coverage", "workflow_maturity", "analytics_visibility",
  "topology_clarity", "evidence_packaging", "export_readiness", "frontend_operability",
] as const;

// ── P12-F - Readiness Status Map ──────────────────────────────────────────

export const READINESS_STATUS_MAP = {
  ready: {
    tier: "good",      order: 0, label: "Ready",
    description: "Dimension is fully operational and meeting expected inputs.",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
  },
  partial: {
    tier: "attention", order: 1, label: "Partial",
    description: "Dimension is partially ready - some inputs or outputs are missing.",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0",
  },
  blocked: {
    tier: "critical",  order: 2, label: "Blocked",
    description: "Dimension cannot be considered ready - critical inputs are absent.",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0",
  },
  unknown: {
    tier: "muted",     order: 3, label: "Unknown",
    description: "Readiness status cannot be determined from available data.",
    badgeClass: "bg-muted text-muted-foreground border-0",
  },
} as const;

export type ReadinessStatusKey = keyof typeof READINESS_STATUS_MAP;

// ── P12-F - Topology UI Safety Contract ───────────────────────────────────

export const TOPOLOGY_UI_SAFETY_CONTRACT = {
  noTopologyMutation:      true,
  noBoundaryAutoFix:       true,
  noSnapshotPersistence:   true,
  noDiffExecution:         true,
  noExportRendering:       true,
  noAiSummaries:           true,
  noLegalConclusions:      true,
  noRegulatorSubmission:   true,
  noReadinessOverride:     true,
  superAdminOnly:          true,
} as const;

// ── P12-F - Readiness UI Safety Contract ──────────────────────────────────

export const READINESS_UI_SAFETY_CONTRACT = {
  noReadinessOverride:     true,
  noTopologyMutation:      true,
  noSnapshotPersistence:   true,
  noAutoRemediation:       true,
  noExportRendering:       true,
  noAiSummaries:           true,
  noLegalConclusions:      true,
  noRegulatorSubmission:   true,
  noBusinessValuation:     true,
  superAdminOnly:          true,
} as const;

// ── P12-F - Topology/Readiness empty states ────────────────────────────────

export const TOPOLOGY_EMPTY_STATE = {
  noTopologyData: {
    title:       "No topology data available",
    description: "Topology data will appear once the governance layer map has been computed.",
  },
  noBoundaryData: {
    title:       "No boundary data available",
    description: "Boundary records will appear once layer boundary verification has run.",
  },
  noReadinessData: {
    title:       "No readiness data available",
    description: "Readiness data will appear once the platform governance profile is complete.",
  },
  noSnapshotData: {
    title:       "No snapshot available",
    description: "A topology snapshot will appear after the first snapshot capture.",
  },
} as const;

// ── P12-E - Analytics Metric Map ──────────────────────────────────────────
// Defines every governance analytics metric: label, unit, description, tier.
// No predictive labels, no auto-recommendation wording, no legal risk verdicts.

export const ANALYTICS_METRIC_MAP = {
  totalWorkflows:              { label: "Total Workflows",               unit: "count",   order: 0,  tier: "neutral",  description: "All governance workflows recorded across the platform." },
  activeWorkflows:             { label: "Active Workflows",              unit: "count",   order: 1,  tier: "status",   description: "Workflows currently in an open or investigating state." },
  escalatedWorkflows:          { label: "Escalated Workflows",           unit: "count",   order: 2,  tier: "elevated", description: "Workflows elevated to a higher review authority." },
  resolvedWorkflows:           { label: "Resolved Workflows",            unit: "count",   order: 3,  tier: "good",     description: "Workflows concluded with recorded findings." },
  dismissedWorkflows:          { label: "Dismissed Workflows",           unit: "count",   order: 4,  tier: "neutral",  description: "Workflows closed without resolution." },
  unresolvedCriticalCount:     { label: "Unresolved Critical",           unit: "count",   order: 5,  tier: "critical", description: "Critical-severity workflows awaiting resolution." },
  escalationRate:              { label: "Escalation Rate",               unit: "percent", order: 6,  tier: "elevated", description: "Proportion of workflows that were escalated." },
  throughputRate:              { label: "Throughput Rate",               unit: "percent", order: 7,  tier: "good",     description: "Proportion of workflows successfully resolved." },
  dismissalFrequency:          { label: "Dismissal Frequency",           unit: "percent", order: 8,  tier: "neutral",  description: "Proportion of workflows dismissed without resolution." },
  escalationToResolutionRatio: { label: "Escalation : Resolution Ratio", unit: "ratio",   order: 9,  tier: "elevated", description: "Ratio of escalations to resolutions - higher may indicate review bottlenecks." },
  averageResolutionDurationMs: { label: "Avg Resolution Duration",       unit: "ms",      order: 10, tier: "neutral",  description: "Average time from workflow creation to resolution." },
  averageAcknowledgmentDurationMs: { label: "Avg Acknowledgment Duration", unit: "ms",  order: 11, tier: "neutral",  description: "Average time from creation to first acknowledgment." },
  criticalUnresolvedDurationMs:    { label: "Critical Unresolved Duration", unit: "ms", order: 12, tier: "critical", description: "Average duration of unresolved critical-severity workflows." },
} as const;

export type AnalyticsMetricKey = keyof typeof ANALYTICS_METRIC_MAP;
export const ALL_ANALYTICS_METRIC_KEYS: readonly AnalyticsMetricKey[] =
  Object.keys(ANALYTICS_METRIC_MAP) as AnalyticsMetricKey[];

// ── P12-E - Workflow Effectiveness Score Map ───────────────────────────────

export const WORKFLOW_EFFECTIVENESS_SCORE_MAP = {
  unstable:         { tier: "critical",  label: "Unstable",          order: 0, description: "Workflow processes show significant instability - review governance coverage." },
  inconsistent:     { tier: "attention", label: "Inconsistent",      order: 1, description: "Workflow patterns are inconsistent - review escalation and resolution rates." },
  acceptable:       { tier: "neutral",   label: "Acceptable",        order: 2, description: "Workflow processes meet baseline governance requirements." },
  effective:        { tier: "good",      label: "Effective",         order: 3, description: "Workflow processes are performing well across measured dimensions." },
  highly_effective: { tier: "excellent", label: "Highly Effective",  order: 4, description: "Workflow processes demonstrate strong governance health." },
} as const;

export type WorkflowEffectivenessScoreKey = keyof typeof WORKFLOW_EFFECTIVENESS_SCORE_MAP;

export const WORKFLOW_EFFECTIVENESS_SCORE_ORDER: readonly WorkflowEffectivenessScoreKey[] =
  ["unstable", "inconsistent", "acceptable", "effective", "highly_effective"] as const;

// ── P12-E - Time Range Options ─────────────────────────────────────────────

export const ANALYTICS_TIME_RANGE_OPTIONS = [
  { value: "7d",  label: "Last 7 days"  },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time"     },
] as const;

export type AnalyticsTimeRangeKey = typeof ANALYTICS_TIME_RANGE_OPTIONS[number]["value"];

// ── P12-E - Policy Effectiveness Table Columns ────────────────────────────

export const POLICY_EFFECTIVENESS_COLUMNS = [
  { key: "policyId",                  label: "Policy ID",          width: "w-24",  mono: true  },
  { key: "policyName",                label: "Policy",             width: "flex-1",mono: false },
  { key: "totalViolations",           label: "Total",              width: "w-16",  mono: false },
  { key: "confirmedViolationRate",    label: "Confirmed %",        width: "w-24",  mono: false },
  { key: "falsePositiveRate",         label: "False Pos. %",       width: "w-24",  mono: false },
  { key: "escalationFrequency",       label: "Escalation %",       width: "w-24",  mono: false },
  { key: "averageResolutionDuration", label: "Avg Resolution",     width: "w-28",  mono: false },
  { key: "policyStabilityScore",      label: "Stability",          width: "w-28",  mono: false },
] as const;

export type PolicyEffectivenessColumnKey = typeof POLICY_EFFECTIVENESS_COLUMNS[number]["key"];

// ── P12-E - Trend chart severity colour mapping ────────────────────────────

export const TREND_SEVERITY_COLOURS: Record<string, string> = {
  critical:      "#ef4444",
  high:          "#f97316",
  medium:        "#f59e0b",
  low:           "#3b82f6",
  informational: "#94a3b8",
  total:         "#6366f1",
};

// ── P12-E - Analytics UI Safety Contract ──────────────────────────────────

export const ANALYTICS_UI_SAFETY_CONTRACT = {
  noAutoEscalation:       true,
  noPolicyAutoTuning:     true,
  noAnalyticsMutation:    true,
  noRecommendationEngine: true,
  noLegalConclusions:     true,
  noAiPredictions:        true,
  noAiSummaries:          true,
  noExportRendering:      true,
  noRegulatorSubmission:  true,
  superAdminOnly:         true,
} as const;

// ── P12-E - Analytics empty states ────────────────────────────────────────

export const ANALYTICS_EMPTY_STATE = {
  noTrendData: {
    title:       "No trend data available",
    description: "Trend data will appear once governance workflows have been recorded over time.",
  },
  noPolicyEffectivenessData: {
    title:       "No policy effectiveness profiles",
    description: "Profiles appear once governance workflows have been processed against policies.",
  },
  noUnresolvedCritical: {
    title:       "No unresolved critical workflows",
    description: "All critical-severity workflows are currently resolved or no critical workflows exist.",
  },
  noAnalyticsData: {
    title:       "No analytics data available",
    description: "Analytics will populate once governance workflows have been recorded.",
  },
} as const;

// ── P12-D - Workflow Status Map ────────────────────────────────────────────
// Covers both the canonical status set (initiated/investigating/escalated/
// resolved/closed) and the legacy set (open/acknowledged/under_review/
// dismissed) so either API response shape renders correctly.
// No status label implies a legal transition or verdict.

export const WORKFLOW_STATUS_MAP = {
  // ── Canonical statuses ──
  initiated:      { tier: "active",   label: "Initiated",      order: 0, icon: "play",        description: "Workflow has been created and is awaiting operator assignment." },
  investigating:  { tier: "active",   label: "Investigating",  order: 1, icon: "search",      description: "Active investigation is under way." },
  escalated:      { tier: "elevated", label: "Escalated",      order: 2, icon: "arrow-up",    description: "Elevated to a higher review authority." },
  resolved:       { tier: "closed",   label: "Resolved",       order: 3, icon: "check",       description: "Investigation concluded and findings recorded." },
  closed:         { tier: "closed",   label: "Closed",         order: 4, icon: "archive",     description: "Workflow archived - no further action required." },
  // ── Legacy compatibility ──
  open:           { tier: "active",   label: "Open",           order: 0, icon: "play",        description: "Open investigation awaiting operator review." },
  acknowledged:   { tier: "active",   label: "Acknowledged",   order: 1, icon: "eye",         description: "Operator has acknowledged this workflow." },
  under_review:   { tier: "active",   label: "Under Review",   order: 1, icon: "search",      description: "Active investigation is under way." },
  dismissed:      { tier: "closed",   label: "Dismissed",      order: 4, icon: "archive",     description: "Workflow dismissed without resolution." },
} as const;

export type WorkflowStatusKey = keyof typeof WORKFLOW_STATUS_MAP;

// Canonical status keys in display order
export const WORKFLOW_STATUS_ORDER: readonly WorkflowStatusKey[] =
  ["initiated", "investigating", "escalated", "resolved", "closed"] as const;

// ── P12-D - Escalation Level Map ───────────────────────────────────────────
// Covers canonical L1-L4 levels plus legacy informational/standard/elevated/critical.
// "L1_automated" is a historical naming artefact - it does not mean automatic
// execution in this UI. All review is human-driven.

export const ESCALATION_LEVEL_MAP = {
  // ── Canonical levels ──
  L1_automated:  { tier: "low",      label: "L1 - Automated",  order: 0, description: "Initial automated detection level - human review may follow." },
  L2_operator:   { tier: "medium",   label: "L2 - Operator",   order: 1, description: "Assigned to an operator for hands-on review." },
  L3_management: { tier: "high",     label: "L3 - Management", order: 2, description: "Elevated to management-level review." },
  L4_executive:  { tier: "critical", label: "L4 - Executive",  order: 3, description: "Executive-level review required." },
  // ── Legacy compatibility ──
  informational: { tier: "low",      label: "Informational",   order: 0, description: "Low-priority escalation - informational review." },
  standard:      { tier: "medium",   label: "Standard",        order: 1, description: "Standard operator-level review." },
  elevated:      { tier: "high",     label: "Elevated",        order: 2, description: "Elevated management-level review." },
  critical:      { tier: "critical", label: "Critical",        order: 3, description: "Critical executive-level review." },
} as const;

export type EscalationLevelKey = keyof typeof ESCALATION_LEVEL_MAP;

export const ESCALATION_LEVEL_ORDER: readonly EscalationLevelKey[] =
  ["L1_automated", "L2_operator", "L3_management", "L4_executive"] as const;

// ── P12-D - Resolution Classification Map ─────────────────────────────────
// Describes how an investigation concluded. No label implies legal fault.

export const RESOLUTION_CLASSIFICATION_MAP = {
  confirmed_violation:        { tier: "finding",   label: "Confirmed Violation",       description: "Investigation confirmed a policy deviation occurred." },
  false_positive:             { tier: "cleared",   label: "False Positive",            description: "Investigation found no actual policy deviation." },
  operational_exception:      { tier: "exception", label: "Operational Exception",     description: "Deviation was an approved operational exception." },
  policy_gap:                 { tier: "gap",       label: "Policy Gap Identified",     description: "Investigation revealed an uncovered policy area." },
  unresolved_pending_review:  { tier: "pending",   label: "Pending Review",            description: "Investigation is ongoing - resolution not yet recorded." },
} as const;

export type ResolutionClassificationKey = keyof typeof RESOLUTION_CLASSIFICATION_MAP;

export const ALL_RESOLUTION_CLASSIFICATION_KEYS: readonly ResolutionClassificationKey[] =
  Object.keys(RESOLUTION_CLASSIFICATION_MAP) as ResolutionClassificationKey[];

// ── P12-D - Workflow Filter Options ───────────────────────────────────────

export const WORKFLOW_STATUS_FILTER_OPTIONS = [
  { value: "",               label: "All Statuses"         },
  { value: "initiated",      label: "Initiated"            },
  { value: "investigating",  label: "Investigating"        },
  { value: "escalated",      label: "Escalated"            },
  { value: "resolved",       label: "Resolved"             },
  { value: "closed",         label: "Closed"               },
] as const;

export const ESCALATION_LEVEL_FILTER_OPTIONS = [
  { value: "",               label: "All Levels"           },
  { value: "L1_automated",  label: "L1 - Automated"       },
  { value: "L2_operator",   label: "L2 - Operator"        },
  { value: "L3_management", label: "L3 - Management"      },
  { value: "L4_executive",  label: "L4 - Executive"       },
] as const;

export const RESOLUTION_CLASSIFICATION_FILTER_OPTIONS = [
  { value: "",                           label: "All Classifications"       },
  { value: "confirmed_violation",        label: "Confirmed Violation"       },
  { value: "false_positive",             label: "False Positive"            },
  { value: "operational_exception",      label: "Operational Exception"     },
  { value: "policy_gap",                 label: "Policy Gap"                },
  { value: "unresolved_pending_review",  label: "Pending Review"            },
] as const;

// ── P12-D - Workflows UI Safety Contract ──────────────────────────────────

export const WORKFLOWS_UI_SAFETY_CONTRACT = {
  noWorkflowCreation:         true,
  noAcknowledgeButton:        true,
  noEscalateButton:           true,
  noResolveButton:            true,
  noCloseButton:              true,
  noViolationDismissal:       true,
  noPolicyEdit:               true,
  noEnforcementTrigger:       true,
  noLegalConclusions:         true,
  noAiSummaries:              true,
  noExportRendering:          true,
  superAdminOnly:             true,
} as const;

// ── P12-D - Workflow empty states ──────────────────────────────────────────

export const WORKFLOWS_EMPTY_STATE = {
  noWorkflows: {
    title:       "No governance workflows recorded",
    description: "No investigation workflows have been initiated for any policy violation.",
  },
  noFilterMatch: {
    title:       "No workflows match the current filters",
    description: "Try adjusting the status, escalation level, or other filters.",
  },
  lifecycleEmpty: {
    title:       "No lifecycle events recorded",
    description: "This workflow has no recorded transition history.",
  },
} as const;

// ── P12-D - Lifecycle event display order ─────────────────────────────────

export const WORKFLOW_LIFECYCLE_EVENT_ORDER = [
  "createdAt",
  "acknowledgedAt",
  "investigationStartedAt",
  "escalatedAt",
  "resolvedAt",
  "closedAt",
  "updatedAt",
] as const;

export type WorkflowLifecycleEventKey = typeof WORKFLOW_LIFECYCLE_EVENT_ORDER[number];

// ── P12-B - Audit Integrity status mapping ─────────────────────────────────
// Maps every possible integrityStatus value from the backend to a UI-safe
// severity tier. Never implies legal compliance.

export const INTEGRITY_STATUS_MAP = {
  verified:    { tier: "healthy",   label: "Verified",    description: "Hash verification passed - entry is intact." },
  warning:     { tier: "attention", label: "Warning",     description: "Minor integrity issue detected - review recommended." },
  compromised: { tier: "critical",  label: "Compromised", description: "Hash mismatch detected - tamper evidence present." },
  orphaned:    { tier: "critical",  label: "Orphaned",    description: "Entry references a missing parent chain link." },
  incomplete:  { tier: "attention", label: "Incomplete",  description: "Entry is missing required fields or linkage." },
} as const;

export type IntegrityStatusKey = keyof typeof INTEGRITY_STATUS_MAP;
export type IntegrityTier      = typeof INTEGRITY_STATUS_MAP[IntegrityStatusKey]["tier"];

export const ALL_INTEGRITY_STATUS_KEYS: readonly IntegrityStatusKey[] =
  Object.keys(INTEGRITY_STATUS_MAP) as IntegrityStatusKey[];

// ── P12-B - Retention classification registry ─────────────────────────────
// Short helper text shown as badge tooltips - describes purpose, not legal advice.

export const RETENTION_CLASSIFICATION_MAP = {
  operational:          { label: "Operational",          helper: "Routine platform operation record." },
  governance:           { label: "Governance",           helper: "Governance oversight record." },
  compliance_sensitive: { label: "Compliance Sensitive", helper: "Sensitive to compliance evaluation - handle with care." },
  forensic_critical:    { label: "Forensic Critical",    helper: "Critical for investigation - highest retention priority." },
} as const;

export type RetentionClassificationKey = keyof typeof RETENTION_CLASSIFICATION_MAP;

export const ALL_RETENTION_CLASSIFICATION_KEYS: readonly RetentionClassificationKey[] =
  Object.keys(RETENTION_CLASSIFICATION_MAP) as RetentionClassificationKey[];

// ── P12-B - Forensic timeline hook name ────────────────────────────────────

export const FORENSIC_TIMELINE_HOOK_NAME = "useGovernanceForensicTimeline" as const;

// ── P12-B - Forensic timeline query key name ───────────────────────────────

export const FORENSIC_TIMELINE_QUERY_KEY_NAME = "forensicTimeline" as const;

// ── P12-B - Entity type options for forensic search ───────────────────────

export const FORENSIC_ENTITY_TYPE_OPTIONS = [
  { value: "",           label: "All Entity Types" },
  { value: "workspace",  label: "Workspace" },
  { value: "user",       label: "User" },
  { value: "ticket",     label: "Ticket" },
  { value: "department", label: "Department" },
  { value: "workflow",   label: "Governance Workflow" },
  { value: "policy",     label: "Policy" },
] as const;

export type ForensicEntityTypeOption = typeof FORENSIC_ENTITY_TYPE_OPTIONS[number]["value"];

// ── P12-B - Empty / no-entity-selected state config ───────────────────────

export const FORENSIC_EMPTY_STATE = {
  noEntitySelected: {
    title:       "Enter an Entity ID to review its forensic timeline",
    description: "Type a workspace ID, user ID, ticket ID, or any auditable entity ID. The system will reconstruct its complete audit event history in chronological order.",
  },
  timelineEmpty: {
    title:       "No forensic events found for this entity",
    description: "Either no audit events have been recorded for this entity ID, or it falls outside the current retention window.",
  },
} as const;

// ── P12-B - Safety extension (additive to P12-A contract) ─────────────────

export const AUDIT_UI_SAFETY_CONTRACT = {
  noAuditRecordCreation:   true,
  noChainRepair:           true,
  noDeleteOrArchive:       true,
  noLegalConclusions:      true,
  noExportRendering:       true,
  noAiSummaries:           true,
  compromisedAlwaysVisible: true,
  orphanedAlwaysVisible:    true,
  superAdminOnly:           true,
} as const;

// ── P12-B - Audit chain filter options (client-side) ──────────────────────

export const AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS = [
  { value: "",             label: "All Statuses" },
  { value: "verified",     label: "Verified" },
  { value: "warning",      label: "Warning" },
  { value: "compromised",  label: "Compromised" },
  { value: "orphaned",     label: "Orphaned" },
  { value: "incomplete",   label: "Incomplete" },
] as const;

export const AUDIT_RETENTION_FILTER_OPTIONS = [
  { value: "",                      label: "All Classifications" },
  { value: "operational",           label: "Operational" },
  { value: "governance",            label: "Governance" },
  { value: "compliance_sensitive",  label: "Compliance Sensitive" },
  { value: "forensic_critical",     label: "Forensic Critical" },
] as const;

export const AUDIT_ENTITY_TYPE_FILTER_OPTIONS = [
  { value: "",           label: "All Types" },
  { value: "workspace",  label: "Workspace" },
  { value: "user",       label: "User" },
  { value: "ticket",     label: "Ticket" },
  { value: "department", label: "Department" },
  { value: "workflow",   label: "Workflow" },
  { value: "policy",     label: "Policy" },
] as const;

// ── Platform nav paths (non-governance) ───────────────────────────────────
// Kept here to allow tests to verify no overlap with governance routes.

export const PLATFORM_NAV_PATHS = [
  "/super-admin",
  "/super-admin/workspaces",
  "/super-admin/activity",
  "/super-admin/events",
  "/super-admin/settings",
] as const;
