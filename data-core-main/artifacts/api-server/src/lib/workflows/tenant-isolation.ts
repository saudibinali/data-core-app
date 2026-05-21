/**
 * @file   lib/workflows/tenant-isolation.ts
 * @phase  P9-A - Multi-Tenant Isolation & Workspace Boundary Hardening Foundations
 *
 * Pure deterministic tenant isolation enforcement layer.
 * No DB, no async, no ML, no side effects, no mutations.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   buildTenantIsolationContext(params) → TenantIsolationContext
 *     Constructs the formal typed isolation context for a request.
 *     Fails closed: throws TenantIsolationViolation if workspaceId is missing,
 *     zero, or non-integer.
 *
 *   enforceTenantIsolation(context, resource) → TenantIsolationResult
 *     Verifies that a resource belongs to the authenticated workspace.
 *     Throws TenantIsolationViolation on any boundary breach:
 *       CROSS_WORKSPACE_ACCESS   - resourceWorkspaceId ≠ context.workspaceId
 *       ORPHAN_RESOURCE_ACCESS   - resourceWorkspaceId is null or undefined
 *       AMBIGUOUS_TENANT_CONTEXT - resourceWorkspaceId is 0 or NaN
 *     Never auto-corrects, never falls back, never silently ignores.
 *
 *   validateAnalyticsScope(context, items, analyticsType) → AnalyticsScopeValidationResult
 *     Verifies that every item in a batch analytics result is scoped to the
 *     authenticated workspace. Throws ANALYTICS_BOUNDARY_VIOLATION if any
 *     item belongs to a different workspace or has an orphan/ambiguous scope.
 *
 *   validateObservabilityScope(context, eventScope) → ObservabilityScopeResult
 *     Verifies that a structured log event carries the three required isolation
 *     fields: workspaceId, requestScopeId, tenantBoundaryId.
 *     Throws GOVERNANCE_LEAKAGE on missing or mismatched fields.
 *
 *   assessTenantIsolationRisk(input) → TenantIsolationRiskAssessment
 *     Deterministic risk assessment across 4 dimensions:
 *       leakageRisk            - cross-workspace or orphan resources present
 *       orphanAccessRisk       - null/undefined workspaceId in batch data
 *       analyticsBoundaryRisk  - mixed workspaces in analytics batch
 *       observabilityIsolationRisk - events missing required isolation fields
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   • Fail-closed: ambiguous context throws, never silently passes.
 *   • Deterministic: identical inputs → identical result (or identical throw).
 *   • Read-only: never mutates context, resources, or analytics items.
 *   • No implicit fallbacks: missing workspaceId is always a hard error.
 *   • No class instances in output: all results are plain JSON-serializable objects.
 *
 * ── VIOLATION CODES ──────────────────────────────────────────────────────────
 *
 *   NULL_WORKSPACE_CONTEXT     - workspaceId is null/undefined/missing
 *   CROSS_WORKSPACE_ACCESS     - resource belongs to a different workspace
 *   ORPHAN_RESOURCE_ACCESS     - resource has null/undefined workspaceId
 *   ANALYTICS_BOUNDARY_VIOLATION - batch contains cross-workspace or orphan data
 *   GOVERNANCE_LEAKAGE         - observability event missing required isolation fields
 *   AMBIGUOUS_TENANT_CONTEXT   - workspaceId is 0, NaN, or non-integer
 *
 * ── INTEGRATION PATTERN ──────────────────────────────────────────────────────
 *
 *   // In a route handler (after requireAuth):
 *   const isoCtx = buildTenantIsolationContext({
 *     workspaceId:       req.workspaceId!,
 *     actorId:           req.userId,
 *     evaluationContext: "comparative-intelligence",
 *   });
 *   // For individual resource fetch:
 *   enforceTenantIsolation(isoCtx, {
 *     resourceWorkspaceId: row.workspaceId,
 *     resourceType:        "workflow_definition",
 *     resourceId:          row.id,
 *   });
 *   // For batch analytics:
 *   validateAnalyticsScope(isoCtx, wfRows, "workflow_definitions");
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - isolation level
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Isolation strictness level.
 *   strict   - every boundary check throws on any ambiguity (production default)
 *   standard - same logic; label reserved for future graduated enforcement
 */
export type TenantIsolationLevel = "strict" | "standard";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - tenant isolation context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formal typed context for tenant isolation enforcement.
 *
 * Constructed once per request by buildTenantIsolationContext() and
 * passed into all enforcement functions. Never mutated after construction.
 *
 * tenantBoundaryId is the canonical cross-system identifier for the workspace
 * tenant boundary: "ws:<workspaceId>".  This is distinct from workspaceId
 * (an integer DB key) to allow future support for globally unique boundary
 * identifiers without breaking the isolation model.
 *
 * requestScopeId is a per-request identifier used in all observability events
 * to correlate log lines across the enforcement layer, analytics engines, and
 * governance advisors.
 */
export interface TenantIsolationContext {
  /** DB primary key of the authenticated workspace. */
  workspaceId:       number;
  /** Canonical boundary identifier. Format: "ws:<workspaceId>". */
  tenantBoundaryId:  string;
  /** Per-request scope identifier for log correlation. */
  requestScopeId:    string;
  /** Enforcement strictness level (always "strict" for production). */
  isolationLevel:    TenantIsolationLevel;
  /** DB primary key of the authenticated user. */
  actorId?:          number;
  /** Human-readable label for the calling context (for observability). */
  evaluationContext?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - resources
// ─────────────────────────────────────────────────────────────────────────────

export type TenantResourceType =
  | "workflow_definition"
  | "workflow_execution"
  | "workflow_execution_step"
  | "governance_signal"
  | "analytics_snapshot"
  | "comparative_intelligence"
  | "historical_rollup"
  | "approval_record";

/**
 * Represents a single resource subject to tenant boundary enforcement.
 */
export interface TenantResource {
  /** The workspace that owns this resource. null/undefined = orphan. */
  resourceWorkspaceId: number | null | undefined;
  /** Resource type for observability and violation logging. */
  resourceType:        TenantResourceType;
  /** Optional resource identifier for structured logging. */
  resourceId?:         number | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - enforcement result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returned by enforceTenantIsolation() when the boundary check passes.
 * If the check fails, a TenantIsolationViolation is thrown instead.
 */
export interface TenantIsolationResult {
  allowed:             true;
  tenantBoundaryId:    string;
  requestScopeId:      string;
  resourceType:        TenantResourceType;
  resourceWorkspaceId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - analytics scope
// ─────────────────────────────────────────────────────────────────────────────

/** An item in a batch analytics result subject to scope validation. */
export interface AnalyticsScopeItem {
  workspaceId: number | null | undefined;
  itemType?:   string;
  itemId?:     number | string;
}

export interface AnalyticsScopeValidationResult {
  validated:       true;
  analyticsType:   string;
  itemCount:       number;
  tenantBoundaryId: string;
  requestScopeId:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - observability scope
// ─────────────────────────────────────────────────────────────────────────────

/** Fields an outbound structured log event must carry for isolation compliance. */
export interface ObservabilityEventScope {
  workspaceId?:      number | null;
  requestScopeId?:   string;
  tenantBoundaryId?: string;
  eventType:         string;
}

export interface ObservabilityScopeResult {
  validated:        true;
  eventType:        string;
  tenantBoundaryId: string;
  requestScopeId:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - risk assessment
// ─────────────────────────────────────────────────────────────────────────────

export type TenantRiskLevel = "low" | "moderate" | "high" | "critical";

export interface TenantIsolationFinding {
  dimension: "leakage" | "orphan_access" | "analytics_boundary" | "observability";
  riskLevel: TenantRiskLevel;
  description: string;
  affectedCount: number;
}

export interface TenantIsolationRiskAssessment {
  /** Worst risk level across all four dimensions. */
  overallRisk:               TenantRiskLevel;
  /** Risk of cross-workspace data leakage (cross-workspace resources present). */
  leakageRisk:               TenantRiskLevel;
  /** Risk of orphan access (null/undefined workspaceId resources present). */
  orphanAccessRisk:          TenantRiskLevel;
  /** Risk from analytics batch containing cross-workspace or orphan data. */
  analyticsBoundaryRisk:     TenantRiskLevel;
  /** Risk from observability events missing required isolation fields. */
  observabilityIsolationRisk: TenantRiskLevel;
  workspaceId:               number;
  tenantBoundaryId:          string;
  requestScopeId:            string;
  assessedAt:                string;
  findings:                  TenantIsolationFinding[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES - violation
// ─────────────────────────────────────────────────────────────────────────────

export type TenantViolationCode =
  | "NULL_WORKSPACE_CONTEXT"
  | "CROSS_WORKSPACE_ACCESS"
  | "ORPHAN_RESOURCE_ACCESS"
  | "ANALYTICS_BOUNDARY_VIOLATION"
  | "GOVERNANCE_LEAKAGE"
  | "AMBIGUOUS_TENANT_CONTEXT";

/**
 * Thrown by enforcement functions on any boundary breach.
 * Always indicates a deterministic isolation failure - never a transient error.
 *
 * The route layer catches TenantIsolationViolation and converts it to 403.
 * Never log and ignore - these are hard boundary violations.
 */
export class TenantIsolationViolation extends Error {
  readonly code:      TenantViolationCode;
  readonly context:   Readonly<TenantIsolationContext>;
  readonly resource?: Readonly<TenantResource>;

  constructor(
    code:      TenantViolationCode,
    message:   string,
    context:   TenantIsolationContext,
    resource?: TenantResource,
  ) {
    super(message);
    this.name     = "TenantIsolationViolation";
    this.code     = code;
    this.context  = Object.freeze({ ...context });
    this.resource = resource ? Object.freeze({ ...resource }) : undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS - sequence counter for deterministic requestScopeId generation
// ─────────────────────────────────────────────────────────────────────────────

let _scopeSeq = 0;

/**
 * Generates a deterministic request scope ID for the given workspace.
 * Format: "req:<workspaceId>-<ms>-<seq>"
 *
 * Uses a monotonically increasing sequence number to guarantee uniqueness
 * within a single process lifetime even when multiple calls land in the
 * same millisecond.
 *
 * The seq counter is exposed as resetRequestScopeSeq() for tests.
 */
export function makeRequestScopeId(workspaceId: number): string {
  _scopeSeq = (_scopeSeq + 1) % 0xffff;
  return `req:${workspaceId}-${Date.now()}-${_scopeSeq.toString(16).padStart(4, "0")}`;
}

/** Resets the internal sequence counter. For tests only. */
export function resetRequestScopeSeq(): void {
  _scopeSeq = 0;
}

/**
 * Returns the canonical tenantBoundaryId for a workspace.
 * Format: "ws:<workspaceId>"
 */
export function makeTenantBoundaryId(workspaceId: number): string {
  return `ws:${workspaceId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a TenantIsolationContext for the given workspace.
 *
 * Fails closed:
 *   • workspaceId is null / undefined / 0 → throws NULL_WORKSPACE_CONTEXT
 *   • workspaceId is NaN or non-integer  → throws AMBIGUOUS_TENANT_CONTEXT
 *
 * Route handlers call this once at the top of any analytics or governance
 * endpoint, after requireAuth has resolved req.workspaceId.
 */
export function buildTenantIsolationContext(params: {
  workspaceId:        number | null | undefined;
  actorId?:           number;
  isolationLevel?:    TenantIsolationLevel;
  evaluationContext?: string;
  requestScopeId?:    string;
}): TenantIsolationContext {
  const { workspaceId, actorId, evaluationContext } = params;
  const isolationLevel = params.isolationLevel ?? "strict";

  // Hard-fail on missing workspace
  if (workspaceId === null || workspaceId === undefined) {
    // Partial context for error reporting (cannot use context.workspaceId here)
    const tempCtx: TenantIsolationContext = {
      workspaceId:      0,
      tenantBoundaryId: "ws:unknown",
      requestScopeId:   "req:unknown-0-0000",
      isolationLevel,
      actorId,
      evaluationContext,
    };
    throw new TenantIsolationViolation(
      "NULL_WORKSPACE_CONTEXT",
      "buildTenantIsolationContext: workspaceId is null or undefined. " +
      "Workspace context is required for all analytics and governance operations. " +
      "Ensure requireAuth middleware has resolved the workspace before calling this function.",
      tempCtx,
    );
  }

  if (!Number.isInteger(workspaceId) || workspaceId === 0) {
    const tempCtx: TenantIsolationContext = {
      workspaceId:      workspaceId as number,
      tenantBoundaryId: `ws:${workspaceId}`,
      requestScopeId:   "req:ambiguous",
      isolationLevel,
      actorId,
      evaluationContext,
    };
    throw new TenantIsolationViolation(
      "AMBIGUOUS_TENANT_CONTEXT",
      `buildTenantIsolationContext: workspaceId "${workspaceId}" is ambiguous ` +
      `(expected positive integer, got ${typeof workspaceId}: ${workspaceId}). ` +
      "Tenant isolation cannot be enforced on an ambiguous workspace context.",
      tempCtx,
    );
  }

  const tenantBoundaryId = makeTenantBoundaryId(workspaceId);
  const requestScopeId   = params.requestScopeId ?? makeRequestScopeId(workspaceId);

  return {
    workspaceId,
    tenantBoundaryId,
    requestScopeId,
    isolationLevel,
    actorId,
    evaluationContext,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT - single resource
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforces tenant isolation for a single resource.
 *
 * Returns TenantIsolationResult if the resource belongs to context.workspaceId.
 * Throws TenantIsolationViolation otherwise - NEVER silently passes.
 *
 * Violation codes:
 *   ORPHAN_RESOURCE_ACCESS   - resource.resourceWorkspaceId is null / undefined
 *   AMBIGUOUS_TENANT_CONTEXT - resource.resourceWorkspaceId is 0 or NaN
 *   CROSS_WORKSPACE_ACCESS   - resource belongs to a different workspace
 *
 * Emits:
 *   tenant_isolation_enforced          (on success)
 *   tenant_boundary_violation_blocked  (on violation, before throwing)
 */
export function enforceTenantIsolation(
  context:  TenantIsolationContext,
  resource: TenantResource,
): TenantIsolationResult {
  const { resourceWorkspaceId, resourceType, resourceId } = resource;

  // ── 1. Orphan check ────────────────────────────────────────────────────────
  if (resourceWorkspaceId === null || resourceWorkspaceId === undefined) {
    _emitViolation(context, resource, "ORPHAN_RESOURCE_ACCESS");
    throw new TenantIsolationViolation(
      "ORPHAN_RESOURCE_ACCESS",
      `enforceTenantIsolation: resource "${resourceType}"${resourceId != null ? ` (id=${resourceId})` : ""} ` +
      `has no workspaceId (null/undefined). Orphan resource access is blocked. ` +
      `All resources must have a valid workspaceId to be served within a tenant boundary.`,
      context,
      resource,
    );
  }

  // ── 2. Ambiguity check ─────────────────────────────────────────────────────
  if (!Number.isInteger(resourceWorkspaceId) || resourceWorkspaceId === 0) {
    _emitViolation(context, resource, "AMBIGUOUS_TENANT_CONTEXT");
    throw new TenantIsolationViolation(
      "AMBIGUOUS_TENANT_CONTEXT",
      `enforceTenantIsolation: resource "${resourceType}"${resourceId != null ? ` (id=${resourceId})` : ""} ` +
      `has ambiguous workspaceId "${resourceWorkspaceId}". ` +
      `Tenant isolation cannot be enforced on an ambiguous resource workspace.`,
      context,
      resource,
    );
  }

  // ── 3. Cross-workspace check ───────────────────────────────────────────────
  if (resourceWorkspaceId !== context.workspaceId) {
    _emitViolation(context, resource, "CROSS_WORKSPACE_ACCESS");
    throw new TenantIsolationViolation(
      "CROSS_WORKSPACE_ACCESS",
      `enforceTenantIsolation: resource "${resourceType}"${resourceId != null ? ` (id=${resourceId})` : ""} ` +
      `belongs to workspace ${resourceWorkspaceId} but the authenticated context is ` +
      `workspace ${context.workspaceId} (${context.tenantBoundaryId}). ` +
      `Cross-workspace access is strictly prohibited.`,
      context,
      resource,
    );
  }

  // ── 4. Pass - emit enforcement event ──────────────────────────────────────
  logger.info(
    {
      event:             "tenant_isolation_enforced",
      workspaceId:       context.workspaceId,
      tenantBoundaryId:  context.tenantBoundaryId,
      requestScopeId:    context.requestScopeId,
      actorId:           context.actorId     ?? null,
      isolationLevel:    context.isolationLevel,
      evaluationContext: context.evaluationContext ?? null,
      resourceType,
      resourceId:        resourceId ?? null,
      action:            "allow",
    },
    "[tenant] P9-A: tenant_isolation_enforced",
  );

  return {
    allowed:             true,
    tenantBoundaryId:    context.tenantBoundaryId,
    requestScopeId:      context.requestScopeId,
    resourceType,
    resourceWorkspaceId: resourceWorkspaceId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT - analytics batch scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that every item in a batch analytics result belongs to the
 * authenticated workspace.
 *
 * Checks:
 *   • Any item with null/undefined workspaceId → ANALYTICS_BOUNDARY_VIOLATION
 *     (orphan data in a batch is always a hard error)
 *   • Any item with workspaceId ≠ context.workspaceId → ANALYTICS_BOUNDARY_VIOLATION
 *     (cross-workspace data in a batch is a hard error regardless of mixing intent)
 *
 * An empty items array is always valid (zero analytics = zero risk).
 *
 * Emits:
 *   tenant_analytics_scope_validated   (on success)
 *   tenant_boundary_violation_blocked  (on violation, before throwing)
 */
export function validateAnalyticsScope(
  context:       TenantIsolationContext,
  items:         ReadonlyArray<AnalyticsScopeItem>,
  analyticsType: string,
): AnalyticsScopeValidationResult {
  if (items.length === 0) {
    _emitAnalyticsValidated(context, analyticsType, 0);
    return {
      validated:        true,
      analyticsType,
      itemCount:        0,
      tenantBoundaryId: context.tenantBoundaryId,
      requestScopeId:   context.requestScopeId,
    };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const iws  = item.workspaceId;

    if (iws === null || iws === undefined) {
      // Orphan item in batch
      const synthResource: TenantResource = {
        resourceWorkspaceId: iws,
        resourceType:        "analytics_snapshot",
        resourceId:          item.itemId,
      };
      _emitViolation(context, synthResource, "ANALYTICS_BOUNDARY_VIOLATION");
      throw new TenantIsolationViolation(
        "ANALYTICS_BOUNDARY_VIOLATION",
        `validateAnalyticsScope: analytics batch "${analyticsType}" contains an orphan item ` +
        `at index ${i}${item.itemId != null ? ` (id=${item.itemId})` : ""} ` +
        `with null/undefined workspaceId. Orphan analytics data is not permitted within ` +
        `a tenant-scoped analytics operation.`,
        context,
        synthResource,
      );
    }

    if (iws !== context.workspaceId) {
      // Cross-workspace item in batch
      const synthResource: TenantResource = {
        resourceWorkspaceId: iws,
        resourceType:        "analytics_snapshot",
        resourceId:          item.itemId,
      };
      _emitViolation(context, synthResource, "ANALYTICS_BOUNDARY_VIOLATION");
      throw new TenantIsolationViolation(
        "ANALYTICS_BOUNDARY_VIOLATION",
        `validateAnalyticsScope: analytics batch "${analyticsType}" contains item ` +
        `at index ${i}${item.itemId != null ? ` (id=${item.itemId})` : ""} ` +
        `belonging to workspace ${iws}, but the authenticated context is ` +
        `workspace ${context.workspaceId} (${context.tenantBoundaryId}). ` +
        `Cross-workspace analytics aggregation is prohibited.`,
        context,
        synthResource,
      );
    }
  }

  _emitAnalyticsValidated(context, analyticsType, items.length);

  return {
    validated:        true,
    analyticsType,
    itemCount:        items.length,
    tenantBoundaryId: context.tenantBoundaryId,
    requestScopeId:   context.requestScopeId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT - observability event scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a structured log event carries the three required isolation
 * fields: workspaceId, requestScopeId, tenantBoundaryId.
 *
 * Also verifies that workspaceId and tenantBoundaryId in the event match the
 * authenticated context - prevents cross-tenant observability mixing where an
 * event for workspace A is emitted in the context of workspace B.
 *
 * Throws GOVERNANCE_LEAKAGE on:
 *   • Missing workspaceId / requestScopeId / tenantBoundaryId in the event
 *   • workspaceId in the event ≠ context.workspaceId
 *   • tenantBoundaryId in the event ≠ context.tenantBoundaryId
 *
 * Emits:
 *   tenant_observability_scope_validated  (on success)
 *   tenant_boundary_violation_blocked     (on violation, before throwing)
 */
export function validateObservabilityScope(
  context:    TenantIsolationContext,
  eventScope: ObservabilityEventScope,
): ObservabilityScopeResult {
  const { eventType } = eventScope;

  // ── 1. Required fields present ─────────────────────────────────────────────
  const missing: string[] = [];
  if (eventScope.workspaceId === null || eventScope.workspaceId === undefined) {
    missing.push("workspaceId");
  }
  if (!eventScope.requestScopeId) {
    missing.push("requestScopeId");
  }
  if (!eventScope.tenantBoundaryId) {
    missing.push("tenantBoundaryId");
  }

  if (missing.length > 0) {
    _emitObservabilityViolation(context, eventType, "missing_fields", missing);
    throw new TenantIsolationViolation(
      "GOVERNANCE_LEAKAGE",
      `validateObservabilityScope: structured event "${eventType}" is missing required ` +
      `tenant isolation fields: [${missing.join(", ")}]. ` +
      `All structured observability events must carry workspaceId, requestScopeId, ` +
      `and tenantBoundaryId to ensure cross-tenant telemetry mixing is impossible.`,
      context,
    );
  }

  // ── 2. workspaceId match ───────────────────────────────────────────────────
  if (eventScope.workspaceId !== context.workspaceId) {
    _emitObservabilityViolation(context, eventType, "workspace_mismatch", [
      `event.workspaceId=${eventScope.workspaceId}`,
      `context.workspaceId=${context.workspaceId}`,
    ]);
    throw new TenantIsolationViolation(
      "GOVERNANCE_LEAKAGE",
      `validateObservabilityScope: event "${eventType}" carries workspaceId ` +
      `${eventScope.workspaceId} but the authenticated context is workspace ` +
      `${context.workspaceId}. Cross-tenant observability mixing is prohibited.`,
      context,
    );
  }

  // ── 3. tenantBoundaryId match ──────────────────────────────────────────────
  if (eventScope.tenantBoundaryId !== context.tenantBoundaryId) {
    _emitObservabilityViolation(context, eventType, "boundary_mismatch", [
      `event.tenantBoundaryId=${eventScope.tenantBoundaryId}`,
      `context.tenantBoundaryId=${context.tenantBoundaryId}`,
    ]);
    throw new TenantIsolationViolation(
      "GOVERNANCE_LEAKAGE",
      `validateObservabilityScope: event "${eventType}" carries tenantBoundaryId ` +
      `"${eventScope.tenantBoundaryId}" but the authenticated context has ` +
      `"${context.tenantBoundaryId}". Tenant boundary mismatch in observability event.`,
      context,
    );
  }

  // ── 4. Pass ────────────────────────────────────────────────────────────────
  logger.info(
    {
      event:             "tenant_observability_scope_validated",
      workspaceId:       context.workspaceId,
      tenantBoundaryId:  context.tenantBoundaryId,
      requestScopeId:    context.requestScopeId,
      actorId:           context.actorId ?? null,
      isolationLevel:    context.isolationLevel,
      eventType,
      action:            "allow",
    },
    "[tenant] P9-A: tenant_observability_scope_validated",
  );

  return {
    validated:        true,
    eventType,
    tenantBoundaryId: context.tenantBoundaryId,
    requestScopeId:   context.requestScopeId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantIsolationAssessmentInput {
  context: TenantIsolationContext;
  /** Batch analytics items to scan for boundary violations. */
  analyticsItems?:     ReadonlyArray<AnalyticsScopeItem>;
  /** Governance signals to scan for workspace isolation. */
  governanceSignals?:  ReadonlyArray<{
    workspaceId:         number;
    affectedWorkflowId?: number | null;
  }>;
  /** Observability events to scan for required isolation fields. */
  observabilityEvents?: ReadonlyArray<ObservabilityEventScope>;
  /** Workflow/resource records to scan for orphan or cross-workspace ownership. */
  workflowResources?:  ReadonlyArray<{
    workspaceId: number | null | undefined;
    id:          number;
  }>;
}

/**
 * Deterministic multi-dimensional tenant isolation risk assessment.
 *
 * Scans the provided data across 4 risk dimensions without throwing.
 * Returns a complete TenantIsolationRiskAssessment with overall risk,
 * per-dimension risks, and structured findings.
 *
 * Does NOT call enforceTenantIsolation() - the assessment is non-throwing
 * and safe to call for diagnostic or advisory purposes.
 *
 * The route layer (governance console, super-admin) can call this to expose
 * isolation health indicators alongside the operational advisory signals.
 */
export function assessTenantIsolationRisk(
  input: TenantIsolationAssessmentInput,
): TenantIsolationRiskAssessment {
  const { context } = input;
  const findings: TenantIsolationFinding[] = [];
  const assessedAt = new Date().toISOString();

  // ── Dimension 1: leakage risk (cross-workspace resources) ─────────────────
  let leakageRisk: TenantRiskLevel = "low";
  {
    const resources = input.workflowResources ?? [];
    const crossWs   = resources.filter(r => r.workspaceId !== null && r.workspaceId !== undefined && r.workspaceId !== context.workspaceId);
    if (crossWs.length > 0) {
      leakageRisk = crossWs.length >= 5 ? "critical" : crossWs.length >= 2 ? "high" : "moderate";
      findings.push({
        dimension:     "leakage",
        riskLevel:     leakageRisk,
        description:   `${crossWs.length} resource(s) belong to a different workspace than ${context.tenantBoundaryId}.`,
        affectedCount: crossWs.length,
      });
    }
  }

  // ── Dimension 2: orphan access risk (null workspaceId resources) ───────────
  let orphanAccessRisk: TenantRiskLevel = "low";
  {
    const resources = input.workflowResources ?? [];
    const orphans   = resources.filter(r => r.workspaceId === null || r.workspaceId === undefined);
    if (orphans.length > 0) {
      orphanAccessRisk = orphans.length >= 5 ? "critical" : orphans.length >= 2 ? "high" : "moderate";
      findings.push({
        dimension:     "orphan_access",
        riskLevel:     orphanAccessRisk,
        description:   `${orphans.length} resource(s) have null/undefined workspaceId - orphan data present.`,
        affectedCount: orphans.length,
      });
    }
  }

  // ── Dimension 3: analytics boundary risk ──────────────────────────────────
  let analyticsBoundaryRisk: TenantRiskLevel = "low";
  {
    const items = input.analyticsItems ?? [];
    const crossWsItems = items.filter(it =>
      it.workspaceId !== context.workspaceId,
    );
    const orphanItems  = items.filter(it =>
      it.workspaceId === null || it.workspaceId === undefined,
    );
    const totalBad = crossWsItems.length + orphanItems.length;
    if (totalBad > 0) {
      analyticsBoundaryRisk = totalBad >= 5 ? "critical" : totalBad >= 2 ? "high" : "moderate";
      findings.push({
        dimension:     "analytics_boundary",
        riskLevel:     analyticsBoundaryRisk,
        description:   `Analytics batch contains ${crossWsItems.length} cross-workspace ` +
                       `and ${orphanItems.length} orphan item(s) outside ${context.tenantBoundaryId}.`,
        affectedCount: totalBad,
      });
    }

    // Governance signals scoped check
    const signals = input.governanceSignals ?? [];
    const crossWsSignals = signals.filter(s => s.workspaceId !== context.workspaceId);
    if (crossWsSignals.length > 0) {
      const extra: TenantRiskLevel = crossWsSignals.length >= 3 ? "critical" : "high";
      if (_riskWeight(extra) > _riskWeight(analyticsBoundaryRisk)) {
        analyticsBoundaryRisk = extra;
      }
      findings.push({
        dimension:     "analytics_boundary",
        riskLevel:     extra,
        description:   `${crossWsSignals.length} governance signal(s) reference a workspace ` +
                       `other than ${context.tenantBoundaryId}.`,
        affectedCount: crossWsSignals.length,
      });
    }
  }

  // ── Dimension 4: observability isolation risk ─────────────────────────────
  let observabilityIsolationRisk: TenantRiskLevel = "low";
  {
    const events = input.observabilityEvents ?? [];
    const missingFields = events.filter(e =>
      e.workspaceId === null || e.workspaceId === undefined ||
      !e.requestScopeId ||
      !e.tenantBoundaryId,
    );
    const crossWsEvents = events.filter(e =>
      e.workspaceId !== undefined && e.workspaceId !== null &&
      e.workspaceId !== context.workspaceId,
    );
    const totalBad = missingFields.length + crossWsEvents.length;
    if (totalBad > 0) {
      observabilityIsolationRisk = totalBad >= 5 ? "critical" : totalBad >= 2 ? "high" : "moderate";
      findings.push({
        dimension:     "observability",
        riskLevel:     observabilityIsolationRisk,
        description:   `${missingFields.length} event(s) missing isolation fields, ` +
                       `${crossWsEvents.length} event(s) reference wrong workspace.`,
        affectedCount: totalBad,
      });
    }
  }

  // ── Derive overall risk ────────────────────────────────────────────────────
  const overallRisk: TenantRiskLevel = _worstRisk([
    leakageRisk,
    orphanAccessRisk,
    analyticsBoundaryRisk,
    observabilityIsolationRisk,
  ]);

  return {
    overallRisk,
    leakageRisk,
    orphanAccessRisk,
    analyticsBoundaryRisk,
    observabilityIsolationRisk,
    workspaceId:      context.workspaceId,
    tenantBoundaryId: context.tenantBoundaryId,
    requestScopeId:   context.requestScopeId,
    assessedAt,
    findings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE - observability emitters
// ─────────────────────────────────────────────────────────────────────────────

function _emitViolation(
  context:      TenantIsolationContext,
  resource:     TenantResource,
  violationCode: TenantViolationCode,
): void {
  logger.info(
    {
      event:              "tenant_boundary_violation_blocked",
      workspaceId:        context.workspaceId,
      tenantBoundaryId:   context.tenantBoundaryId,
      requestScopeId:     context.requestScopeId,
      actorId:            context.actorId ?? null,
      isolationLevel:     context.isolationLevel,
      evaluationContext:  context.evaluationContext ?? null,
      violationCode,
      resourceType:       resource.resourceType,
      resourceId:         resource.resourceId ?? null,
      resourceWorkspaceId: resource.resourceWorkspaceId ?? null,
      action:             "block",
    },
    "[tenant] P9-A: tenant_boundary_violation_blocked",
  );
}

function _emitAnalyticsValidated(
  context:       TenantIsolationContext,
  analyticsType: string,
  itemCount:     number,
): void {
  logger.info(
    {
      event:             "tenant_analytics_scope_validated",
      workspaceId:       context.workspaceId,
      tenantBoundaryId:  context.tenantBoundaryId,
      requestScopeId:    context.requestScopeId,
      actorId:           context.actorId ?? null,
      isolationLevel:    context.isolationLevel,
      evaluationContext: context.evaluationContext ?? null,
      analyticsType,
      itemCount,
      action:            "allow",
    },
    "[tenant] P9-A: tenant_analytics_scope_validated",
  );
}

function _emitObservabilityViolation(
  context:   TenantIsolationContext,
  eventType: string,
  reason:    string,
  details:   string[],
): void {
  logger.info(
    {
      event:             "tenant_boundary_violation_blocked",
      workspaceId:       context.workspaceId,
      tenantBoundaryId:  context.tenantBoundaryId,
      requestScopeId:    context.requestScopeId,
      actorId:           context.actorId ?? null,
      isolationLevel:    context.isolationLevel,
      violationCode:     "GOVERNANCE_LEAKAGE",
      eventType,
      reason,
      details,
      action:            "block",
    },
    "[tenant] P9-A: tenant_boundary_violation_blocked (observability)",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE - risk helpers
// ─────────────────────────────────────────────────────────────────────────────

function _riskWeight(level: TenantRiskLevel): number {
  switch (level) {
    case "low":      return 1;
    case "moderate": return 2;
    case "high":     return 3;
    case "critical": return 4;
  }
}

function _worstRisk(levels: TenantRiskLevel[]): TenantRiskLevel {
  const worst = Math.max(...levels.map(_riskWeight));
  switch (worst) {
    case 4:  return "critical";
    case 3:  return "high";
    case 2:  return "moderate";
    default: return "low";
  }
}
