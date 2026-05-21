import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workflowDefinitionsTable,
  workflowDefinitionVersionsTable,
  workflowExecutionsTable,
  workflowExecutionStepsTable,
  workflowTasksTable,
  workflowApprovalsTable,
  workspaceEventLogsTable,
  usersTable,
  governanceSnapshotRollupsTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, or, gte, lte, isNull, lt, isNotNull, not, inArray } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
  requireSuperAdmin,
  requirePermission,
} from "../middlewares/requireAuth";
import { isTerminalStatus, isExecutionTimedOut, computeOverdueMs, TERMINAL_STATUSES } from "../lib/workflows/ttl";
import { validateWorkflow } from "../lib/workflows/validator";
import {
  analyzeTopology,
  extractWorkflowTopology,
  computeTopologyAnalytics,
} from "../lib/workflows/topology";
import { analyzeDependencies }          from "../lib/workflows/dependency";
import {
  computeOperationalCorrelation,
  ZERO_HISTORICAL,
  type HistoricalOperationalData,
} from "../lib/workflows/operational-correlation";
import {
  computeWorkflowForecast,
  type ForecastDataPoint,
} from "../lib/workflows/trend-forecast";
import {
  computeComparativeIntelligence,
  type WorkflowIntelligenceSnapshot,
} from "../lib/workflows/comparative-intelligence";
import {
  generateGovernanceSignals,
  type WorkflowForecastSummary,
} from "../lib/workflows/governance-signals";
import {
  buildTenantIsolationContext,
  validateAnalyticsScope,
  assessTenantIsolationRisk,
  TenantIsolationViolation,
} from "../lib/workflows/tenant-isolation";
import {
  evaluateWorkloadContainment,
} from "../lib/workflows/workload-partition";
import {
  buildTenantGovernanceView,
  computeSchedulerFairnessStatus,
  computePartitionPressureSummary,
  classifyIsolationHealth,
  emitPartitionOverviewEvent,
  emitFairnessVisibilityEvent,
  emitIsolationHealthEvent,
} from "../lib/workflows/tenant-governance";
import { resumeExecution, rejectExecution } from "../lib/workflows/executor";

/**
 * Workflow Routes - definitions, executions, tasks.
 *
 * ── Diagnostics ownership ────────────────────────────────────────────────────
 *   GET /workflows/executions*  are Phase 2 diagnostics endpoints.
 *   They expose workflow execution traces, linked event logs, and step
 *   timelines for operational debugging and admin visibility.
 *
 * ── Timeline reconstruction strategy ────────────────────────────────────────
 *   Execution timeline = ordered workflow_execution_steps, augmented with
 *   computed durationMs = EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000.
 *   Steps are returned in stepIndex order (not insertion order) to guarantee
 *   correct timeline display even if steps are inserted out of order by the engine.
 *
 * ── Why raw context JSONB is excluded from list views ────────────────────────
 *   workflow_executions.context stores the full event payload + step outputs
 *   and grows unbounded.  List endpoints omit it to keep response sizes
 *   predictable.  The detail endpoint returns it for single-row debugging.
 *
 * ── Route ordering constraint ────────────────────────────────────────────────
 *   GET /workflows/executions*  routes MUST be registered before
 *   GET /workflows/:id  - otherwise Express matches "executions" as the :id
 *   parameter and the request never reaches the executions handler.
 */

const router: IRouter = Router();

function wsCond(req: AuthRequest) {
  return eq(workflowDefinitionsTable.workspaceId, req.workspaceId!);
}

// ── GET /workflows ────────────────────────────────────────────────────────────

router.get(
  "/workflows",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const rows = await db
      .select({
        id:            workflowDefinitionsTable.id,
        workspaceId:   workflowDefinitionsTable.workspaceId,
        key:           workflowDefinitionsTable.key,
        name:          workflowDefinitionsTable.name,
        nameAr:        workflowDefinitionsTable.nameAr,
        description:   workflowDefinitionsTable.description,
        descriptionAr: workflowDefinitionsTable.descriptionAr,
        module:        workflowDefinitionsTable.module,
        triggerEvent:  workflowDefinitionsTable.triggerEvent,
        isActive:      workflowDefinitionsTable.isActive,
        status:        workflowDefinitionsTable.status,
        conditions:    workflowDefinitionsTable.conditions,
        steps:         workflowDefinitionsTable.steps,
        createdAt:     workflowDefinitionsTable.createdAt,
        updatedAt:     workflowDefinitionsTable.updatedAt,
        archivedAt:    workflowDefinitionsTable.archivedAt,
        deletedAt:     workflowDefinitionsTable.deletedAt,
        executionCount: sql<number>`(
          select count(*)::int from workflow_executions
          where workflow_id = ${workflowDefinitionsTable.id}
        )`,
        lastExecutedAt: sql<string | null>`(
          select started_at from workflow_executions
          where workflow_id = ${workflowDefinitionsTable.id}
          order by started_at desc limit 1
        )`,
      })
      .from(workflowDefinitionsTable)
      // P3-E: Exclude soft-deleted workflows from list view.
      // Soft-deleted rows have deletedAt set by DELETE /workflows/:id.
      .where(and(wsCond(req), isNull(workflowDefinitionsTable.deletedAt)))
      .orderBy(workflowDefinitionsTable.createdAt);

    res.json(rows);
  },
);

// ── POST /workflows ───────────────────────────────────────────────────────────

router.post(
  "/workflows",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const { name, nameAr, description, descriptionAr, module: mod, triggerEvent, conditions, steps, isActive } =
      req.body as Record<string, unknown>;

    if (!name || !triggerEvent || !mod) {
      res.status(400).json({ error: "name, triggerEvent, and module are required" });
      return;
    }

    const key = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);

    const [wf] = await db
      .insert(workflowDefinitionsTable)
      .values({
        workspaceId:   req.workspaceId,
        key,
        name:          String(name),
        nameAr:        nameAr        ? String(nameAr)        : null,
        description:   description   ? String(description)   : null,
        descriptionAr: descriptionAr ? String(descriptionAr) : null,
        module:        String(mod),
        triggerEvent:  String(triggerEvent),
        conditions:    (conditions ?? []) as unknown as Record<string, unknown>,
        steps:         (steps ?? [])      as unknown as Record<string, unknown>[],
        // P3-F: New workflows start as 'draft'.
        // Admins must explicitly POST /workflows/:id/activate after reviewing
        // the governance validation results.  Draft workflows are ignored by
        // the workflow engine - they will not fire on any trigger event.
        isActive: false,
        status:   "draft",
        createdBy: req.userId ?? null,
      })
      .returning();

    res.status(201).json(wf);
  },
);

// ── GET /workflows/comparative (P8-E) ─────────────────────────────────────────
//
// Cross-workflow comparative intelligence for the authenticated workspace.
// Runs the full P8-A → P8-D pipeline per workflow and feeds all results into
// the P8-E comparative engine to produce:
//   • comparativeRiskScore (0-100) per workflow
//   • workspaceRank (1 = highest risk)
//   • operationalPriority (informational/watch/elevated/urgent/critical)
//   • trendDirection and fragilityLevel from P8-C / P8-D
//   • WorkspaceHotspotConcentration analytics
//
// READ-ONLY: never mutates workflow definitions or governance history.
// Registered BEFORE GET /workflows/executions/* and GET /workflows/:id.

router.get(
  "/workflows/comparative",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    // ── P9-A: Build formal tenant isolation context ────────────────────────────
    let isoCtx: ReturnType<typeof buildTenantIsolationContext>;
    try {
      isoCtx = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        actorId:           req.userId,
        evaluationContext: "comparative-intelligence",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }

    // ── 1. Fetch all active workflow definitions in the workspace ──────────────
    const wfRows = await db
      .select({
        id:          workflowDefinitionsTable.id,
        name:        workflowDefinitionsTable.name,
        version:     workflowDefinitionsTable.version,
        steps:       workflowDefinitionsTable.steps,
        workspaceId: workflowDefinitionsTable.workspaceId,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ))
      .orderBy(workflowDefinitionsTable.id)
      .limit(200);

    // ── P9-A: Validate analytics scope - all rows must belong to this workspace ─
    try {
      validateAnalyticsScope(
        isoCtx,
        wfRows.map(r => ({ workspaceId: r.workspaceId, itemId: r.id })),
        "comparative_intelligence",
      );
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }

    if (wfRows.length === 0) {
      res.json({
        workspaceId:          req.workspaceId,
        totalWorkflows:       0,
        rankedWorkflows:      [],
        hotspotConcentration: {
          dominantWorkflowCount:       0,
          concentrationRatio:          0,
          chronicHotspotWorkflowCount: 0,
          criticallyDegradingCount:    0,
          urgentOrCriticalCount:       0,
          topRiskWorkflowId:           null,
          topRiskScore:                0,
        },
        computedAt: new Date().toISOString(),
      });
      return;
    }

    // ── 2. Fetch workspace-level historical data ONCE (same for all workflows) ─
    const lookbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rollupRows = await db
      .select({
        snapshotCount:      governanceSnapshotRollupsTable.snapshotCount,
        avgErrorRate:       governanceSnapshotRollupsTable.avgErrorRate,
        avgApprovalBacklog: governanceSnapshotRollupsTable.avgApprovalBacklog,
        avgDelayBacklog:    governanceSnapshotRollupsTable.avgDelayBacklog,
        avgStuckCount:      governanceSnapshotRollupsTable.avgStuckCount,
        stormFrequency:     governanceSnapshotRollupsTable.stormFrequency,
        bucketStart:        governanceSnapshotRollupsTable.bucketStart,
      })
      .from(governanceSnapshotRollupsTable)
      .where(and(
        eq(governanceSnapshotRollupsTable.workspaceId, req.workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, "hourly"),
        gte(governanceSnapshotRollupsTable.bucketStart, lookbackStart),
      ))
      .orderBy(governanceSnapshotRollupsTable.bucketStart)
      .limit(200);

    // Aggregate the rollup rows into one HistoricalOperationalData summary (P8-C style)
    let historical: HistoricalOperationalData;
    if (rollupRows.length === 0) {
      historical = ZERO_HISTORICAL;
    } else {
      const totalSnaps  = rollupRows.reduce((a, r) => a + r.snapshotCount, 0);
      const avgErr      = rollupRows.reduce((a, r) => a + r.avgErrorRate, 0)       / rollupRows.length;
      const avgApproval = rollupRows.reduce((a, r) => a + r.avgApprovalBacklog, 0) / rollupRows.length;
      const avgDelay    = rollupRows.reduce((a, r) => a + r.avgDelayBacklog, 0)    / rollupRows.length;
      const avgStuck    = rollupRows.reduce((a, r) => a + r.avgStuckCount, 0)      / rollupRows.length;
      const avgStorm    = rollupRows.reduce((a, r) => a + r.stormFrequency, 0)     / rollupRows.length;
      historical = {
        snapshotCount:      totalSnaps,
        avgErrorRate:       avgErr,
        avgApprovalBacklog: avgApproval,
        avgDelayBacklog:    avgDelay,
        avgStuckCount:      avgStuck,
        stormFrequency:     avgStorm,
        chronicAlertCodes:  [],
        dominantSeverity:   avgErr > 0.5 ? "critical" : avgErr > 0.2 ? "degraded" : avgErr > 0.05 ? "warning" : "healthy",
      };
    }

    // P8-D data points for forecast (same rollup rows, oldest first)
    const forecastDataPoints: ForecastDataPoint[] = rollupRows.map(r => ({
      avgErrorRate:       r.avgErrorRate,
      avgApprovalBacklog: r.avgApprovalBacklog,
      avgDelayBacklog:    r.avgDelayBacklog,
      avgStuckCount:      r.avgStuckCount,
      stormFrequency:     r.stormFrequency,
      snapshotCount:      r.snapshotCount,
    }));

    // ── 3. Build WorkflowIntelligenceSnapshot[] - one per workflow ─────────────
    const snapshots: WorkflowIntelligenceSnapshot[] = wfRows.map(wf => {
      const steps  = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];

      // P8-A: topology analytics
      const topoGraph = extractWorkflowTopology(steps);
      const analytics = computeTopologyAnalytics(topoGraph, steps);

      // P8-B: dependency + structural complexity
      const depResult = analyzeDependencies(steps, {
        workflowId:      wf.id,
        workspaceId:     req.workspaceId!,
        workflowVersion: wf.version ?? undefined,
      });
      const structuralComplexity = depResult.pressure.operationalComplexityScore;

      // P8-C: operational correlation
      const corr = computeOperationalCorrelation(depResult, analytics, historical, {
        workflowId:      wf.id,
        workspaceId:     req.workspaceId!,
        workflowVersion: wf.version ?? undefined,
      });

      // P8-D: trend forecast (7-day window)
      const forecast = computeWorkflowForecast(
        {
          dataPoints:           forecastDataPoints,
          forecastWindowDays:   7,
          structuralComplexity,
          approvalDensity:      analytics.approvalDensity,
          delayDensity:         analytics.delayDensity,
        },
        {
          workflowId:      wf.id,
          workspaceId:     req.workspaceId!,
          workflowVersion: wf.version ?? undefined,
        },
      );

      return {
        workflowId:                wf.id,
        workflowName:              wf.name,
        stepCount:                 steps.length,
        runtimeWeightedComplexity: corr.correlation.runtimeWeightedComplexity,
        structuralComplexity,
        fragilityLevel:            corr.fragilityIndex.level,
        hotspotCount:              corr.correlation.chronicOperationalHotspots.length,
        projectedComplexity:       forecast.projectedComplexity,
        trendDirection:            forecast.trendDirection,
        confidenceLevel:           forecast.confidenceLevel,
      };
    });

    // ── 4. Run P8-E comparative engine ─────────────────────────────────────────
    const result = computeComparativeIntelligence(
      { snapshots },
      { workspaceId: req.workspaceId },
    );

    req.log.info(
      {
        event:                "workflow_comparative_ranking_requested",
        workspaceId:          req.workspaceId,
        totalWorkflows:       result.totalWorkflows,
        dominantWorkflows:    result.hotspotConcentration.dominantWorkflowCount,
        urgentOrCritical:     result.hotspotConcentration.urgentOrCriticalCount,
        topRiskWorkflowId:    result.hotspotConcentration.topRiskWorkflowId,
        actorId:              req.userId,
      },
      "GET /workflows/comparative",
    );

    res.json({
      workspaceId:          req.workspaceId,
      totalWorkflows:       result.totalWorkflows,
      rankedWorkflows:      result.rankedWorkflows,
      hotspotConcentration: result.hotspotConcentration,
      computedAt:           new Date().toISOString(),
    });
  },
);

// ── GET /workflows/governance/signals (P8-F) ──────────────────────────────────
//
// Proactive governance advisory signals for the authenticated workspace.
// Runs the full P8-A → P8-D pipeline per workflow (same as /comparative),
// additionally captures projectedStormRisk/projectedBacklogPressure from
// P8-D, then feeds all results into the P8-E comparative engine and the
// P8-F governance-signal engine.
//
// Returns:
//   • GovernanceSignal[] - deterministic per-workflow and workspace signals
//   • advisoryLevel       - worst severity across all signals
//   • totalSignals / deduplicatedCount - signal health analytics
//
// READ-ONLY: advisory-only, never mutates definitions, never blocks executions.
// Registered BEFORE GET /workflows/executions/* and GET /workflows/:id.

router.get(
  "/workflows/governance/signals",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    // ── P9-A: Build formal tenant isolation context ────────────────────────────
    let isoCtxGov: ReturnType<typeof buildTenantIsolationContext>;
    try {
      isoCtxGov = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        actorId:           req.userId,
        evaluationContext: "governance-signals",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }

    // ── 1. Fetch active workflow definitions ───────────────────────────────────
    const wfRows = await db
      .select({
        id:          workflowDefinitionsTable.id,
        name:        workflowDefinitionsTable.name,
        version:     workflowDefinitionsTable.version,
        steps:       workflowDefinitionsTable.steps,
        workspaceId: workflowDefinitionsTable.workspaceId,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ))
      .orderBy(workflowDefinitionsTable.id)
      .limit(200);

    // ── P9-A: Validate analytics scope ────────────────────────────────────────
    try {
      validateAnalyticsScope(
        isoCtxGov,
        wfRows.map(r => ({ workspaceId: r.workspaceId, itemId: r.id })),
        "governance_signals",
      );
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }

    if (wfRows.length === 0) {
      res.json({
        workspaceId:       req.workspaceId,
        signals:           [],
        advisoryLevel:     "informational",
        totalSignals:      0,
        deduplicatedCount: 0,
        evaluatedAt:       new Date().toISOString(),
      });
      return;
    }

    // ── 2. Fetch shared historical rollup data (ONCE for all workflows) ────────
    const lookbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rollupRows = await db
      .select({
        snapshotCount:      governanceSnapshotRollupsTable.snapshotCount,
        avgErrorRate:       governanceSnapshotRollupsTable.avgErrorRate,
        avgApprovalBacklog: governanceSnapshotRollupsTable.avgApprovalBacklog,
        avgDelayBacklog:    governanceSnapshotRollupsTable.avgDelayBacklog,
        avgStuckCount:      governanceSnapshotRollupsTable.avgStuckCount,
        stormFrequency:     governanceSnapshotRollupsTable.stormFrequency,
        bucketStart:        governanceSnapshotRollupsTable.bucketStart,
      })
      .from(governanceSnapshotRollupsTable)
      .where(and(
        eq(governanceSnapshotRollupsTable.workspaceId, req.workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, "hourly"),
        gte(governanceSnapshotRollupsTable.bucketStart, lookbackStart),
      ))
      .orderBy(governanceSnapshotRollupsTable.bucketStart)
      .limit(200);

    // Aggregate rollups into HistoricalOperationalData
    let historical: HistoricalOperationalData;
    if (rollupRows.length === 0) {
      historical = ZERO_HISTORICAL;
    } else {
      const totalSnaps  = rollupRows.reduce((a, r) => a + r.snapshotCount, 0);
      const avgErr      = rollupRows.reduce((a, r) => a + r.avgErrorRate, 0)       / rollupRows.length;
      const avgApproval = rollupRows.reduce((a, r) => a + r.avgApprovalBacklog, 0) / rollupRows.length;
      const avgDelay    = rollupRows.reduce((a, r) => a + r.avgDelayBacklog, 0)    / rollupRows.length;
      const avgStuck    = rollupRows.reduce((a, r) => a + r.avgStuckCount, 0)      / rollupRows.length;
      const avgStorm    = rollupRows.reduce((a, r) => a + r.stormFrequency, 0)     / rollupRows.length;
      historical = {
        snapshotCount:      totalSnaps,
        avgErrorRate:       avgErr,
        avgApprovalBacklog: avgApproval,
        avgDelayBacklog:    avgDelay,
        avgStuckCount:      avgStuck,
        stormFrequency:     avgStorm,
        chronicAlertCodes:  [],
        dominantSeverity:   avgErr > 0.5 ? "critical" : avgErr > 0.2 ? "degraded" : avgErr > 0.05 ? "warning" : "healthy",
      };
    }

    const forecastDataPoints: ForecastDataPoint[] = rollupRows.map(r => ({
      avgErrorRate:       r.avgErrorRate,
      avgApprovalBacklog: r.avgApprovalBacklog,
      avgDelayBacklog:    r.avgDelayBacklog,
      avgStuckCount:      r.avgStuckCount,
      stormFrequency:     r.stormFrequency,
      snapshotCount:      r.snapshotCount,
    }));

    // ── 3. Per-workflow P8-A → P8-D pipeline + capture forecast summaries ─────
    const snapshots: WorkflowIntelligenceSnapshot[] = [];
    const forecastSummaries: WorkflowForecastSummary[] = [];

    for (const wf of wfRows) {
      const steps  = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];

      const topoGraph = extractWorkflowTopology(steps);
      const analytics = computeTopologyAnalytics(topoGraph, steps);

      const depResult = analyzeDependencies(steps, {
        workflowId:      wf.id,
        workspaceId:     req.workspaceId!,
        workflowVersion: wf.version ?? undefined,
      });
      const structuralComplexity = depResult.pressure.operationalComplexityScore;

      const corr = computeOperationalCorrelation(depResult, analytics, historical, {
        workflowId:      wf.id,
        workspaceId:     req.workspaceId!,
        workflowVersion: wf.version ?? undefined,
      });

      const forecast = computeWorkflowForecast(
        {
          dataPoints:           forecastDataPoints,
          forecastWindowDays:   7,
          structuralComplexity,
          approvalDensity:      analytics.approvalDensity,
          delayDensity:         analytics.delayDensity,
        },
        {
          workflowId:      wf.id,
          workspaceId:     req.workspaceId!,
          workflowVersion: wf.version ?? undefined,
        },
      );

      snapshots.push({
        workflowId:                wf.id,
        workflowName:              wf.name,
        stepCount:                 steps.length,
        runtimeWeightedComplexity: corr.correlation.runtimeWeightedComplexity,
        structuralComplexity,
        fragilityLevel:            corr.fragilityIndex.level,
        hotspotCount:              corr.correlation.chronicOperationalHotspots.length,
        projectedComplexity:       forecast.projectedComplexity,
        trendDirection:            forecast.trendDirection,
        confidenceLevel:           forecast.confidenceLevel,
      });

      forecastSummaries.push({
        workflowId:               wf.id,
        projectedStormRisk:       forecast.projectedStormRisk,
        projectedBacklogPressure: forecast.projectedBacklogPressure,
      });
    }

    // ── 4. P8-E: rank all workflows comparatively ──────────────────────────────
    const comparative = computeComparativeIntelligence(
      { snapshots },
      { workspaceId: req.workspaceId },
    );

    // ── 5. P8-F: generate governance advisory signals ─────────────────────────
    const signalResult = generateGovernanceSignals(
      {
        rankedWorkflows:      comparative.rankedWorkflows,
        hotspotConcentration: comparative.hotspotConcentration,
        workspaceId:          req.workspaceId,
        totalWorkflows:       comparative.totalWorkflows,
        workflowForecasts:    forecastSummaries,
      },
      { evaluationId: `ws-${req.workspaceId}-${Date.now()}` },
    );

    req.log.info(
      {
        event:             "workflow_governance_signals_requested",
        workspaceId:       req.workspaceId,
        totalSignals:      signalResult.totalSignals,
        deduplicatedCount: signalResult.deduplicatedCount,
        advisoryLevel:     signalResult.advisoryLevel,
        actorId:           req.userId,
      },
      "GET /workflows/governance/signals",
    );

    res.json({
      workspaceId:       req.workspaceId,
      signals:           signalResult.signals,
      advisoryLevel:     signalResult.advisoryLevel,
      totalSignals:      signalResult.totalSignals,
      deduplicatedCount: signalResult.deduplicatedCount,
      evaluatedAt:       signalResult.evaluatedAt,
    });
  },
);

// ── GET /workflows/governance/tenant-overview (P9-C) ─────────────────────────
//
// Full tenant governance view for the authenticated workspace.
//
// Composes: P9-A isolation context + isolation risk assessment,
//           P9-B workload partition, P9-C governance view engine.
//
// The response is advisory-only: it describes the workspace's current
// operational posture without modifying any scheduler state.
//
// Emits: tenant_governance_view_generated (from engine)

router.get(
  "/workflows/governance/tenant-overview",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    // ── Build P9-A isolation context - fails closed on boundary breach ────────
    let isoContext;
    try {
      isoContext = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        evaluationContext: "tenant-overview",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: "Tenant isolation violation", code: e.code });
        return;
      }
      throw e;
    }

    // ── Query active + delayed execution counts ───────────────────────────────
    const [counts] = await db
      .select({
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId));

    const activeExecutionCount  = Number(counts?.activeExecutionCount  ?? 0);
    const delayedExecutionCount = Number(counts?.delayedExecutionCount ?? 0);

    // ── Sample recent executions for isolation risk assessment ────────────────
    const execSample = await db
      .select({ id: workflowExecutionsTable.id, workspaceId: workflowExecutionsTable.workspaceId })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId))
      .orderBy(desc(workflowExecutionsTable.id))
      .limit(10);

    // ── Validate analytics scope on the sampled rows (throws on violation) ────
    try {
      validateAnalyticsScope(
        isoContext,
        execSample.map(e => ({ workspaceId: e.workspaceId, itemId: e.id })),
        "tenant_overview",
      );
    } catch (scopeErr) {
      req.log.warn(
        { event: "tenant_overview_scope_violation", workspaceId: req.workspaceId },
        "[governance] P9-C: analytics scope violation in tenant-overview",
      );
    }

    // ── P9-B workload partition ────────────────────────────────────────────────
    const partition = evaluateWorkloadContainment({ workspaceId: req.workspaceId, activeExecutionCount, delayedExecutionCount });

    // ── P9-A isolation risk assessment ────────────────────────────────────────
    const isolationRisk = assessTenantIsolationRisk({
      context:           isoContext,
      workflowResources: execSample.map(e => ({ id: e.id, workspaceId: e.workspaceId })),
    });

    // ── P9-C governance view ──────────────────────────────────────────────────
    const view = buildTenantGovernanceView({ isoContext, partition, isolationRisk });

    req.log.info(
      {
        event:         "GET /workflows/governance/tenant-overview",
        workspaceId:   req.workspaceId,
        requestScopeId: isoContext.requestScopeId,
        isolationHealth: view.isolationHealth,
        containmentStatus: view.containmentStatus,
        actorId:       req.userId,
      },
      "GET /workflows/governance/tenant-overview",
    );

    res.json(view);
  },
);

// ── GET /workflows/governance/workload-partition (P9-C) ──────────────────────
//
// Returns the P9-B workload partition summary for the authenticated workspace.
// Lighter than tenant-overview - no isolation risk assessment.
//
// Emits: tenant_partition_overview_requested

router.get(
  "/workflows/governance/workload-partition",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    let isoContext;
    try {
      isoContext = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        evaluationContext: "workload-partition",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: "Tenant isolation violation", code: e.code });
        return;
      }
      throw e;
    }

    const [counts] = await db
      .select({
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId));

    const activeExecutionCount  = Number(counts?.activeExecutionCount  ?? 0);
    const delayedExecutionCount = Number(counts?.delayedExecutionCount ?? 0);

    const partition    = evaluateWorkloadContainment({ workspaceId: req.workspaceId, activeExecutionCount, delayedExecutionCount });
    const pressure     = computePartitionPressureSummary(partition);
    const fairness     = computeSchedulerFairnessStatus(partition);

    emitPartitionOverviewEvent(
      req.workspaceId,
      isoContext.requestScopeId,
      pressure.total,
      "healthy",
      fairness.fairnessLevel,
      partition.containmentStatus,
    );

    res.json({
      workspaceId:        req.workspaceId,
      requestScopeId:     isoContext.requestScopeId,
      partitionId:        partition.partitionId,
      containmentStatus:  partition.containmentStatus,
      pressureSummary:    pressure,
      fairnessStatus:     fairness,
      evaluatedAt:        partition.evaluatedAt,
    });
  },
);

// ── GET /workflows/governance/fairness-status (P9-C) ─────────────────────────
//
// Returns the scheduler fairness advisory status for the workspace.
// Exposes the workspace's scheduler weight + noisy-tenant detection results.
//
// Emits: tenant_fairness_visibility_accessed

router.get(
  "/workflows/governance/fairness-status",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    let isoContext;
    try {
      isoContext = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        evaluationContext: "fairness-status",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: "Tenant isolation violation", code: e.code });
        return;
      }
      throw e;
    }

    const [counts] = await db
      .select({
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId));

    const activeExecutionCount  = Number(counts?.activeExecutionCount  ?? 0);
    const delayedExecutionCount = Number(counts?.delayedExecutionCount ?? 0);

    const partition   = evaluateWorkloadContainment({ workspaceId: req.workspaceId, activeExecutionCount, delayedExecutionCount });
    const fairness    = computeSchedulerFairnessStatus(partition);
    const pressure    = computePartitionPressureSummary(partition);

    emitFairnessVisibilityEvent(
      req.workspaceId,
      isoContext.requestScopeId,
      pressure.total,
      "healthy",
      fairness.fairnessLevel,
      partition.containmentStatus,
    );

    res.json({
      workspaceId:        req.workspaceId,
      requestScopeId:     isoContext.requestScopeId,
      fairnessStatus:     fairness,
      containmentStatus:  partition.containmentStatus,
      pressureTotal:      pressure.total,
      evaluatedAt:        partition.evaluatedAt,
    });
  },
);

// ── GET /workflows/governance/isolation-health (P9-C) ────────────────────────
//
// Returns the tenant isolation health assessment for the workspace.
// Samples recent executions and validates workspace boundary integrity
// via the P9-A assessTenantIsolationRisk() engine.
//
// Emits: tenant_isolation_health_evaluated

router.get(
  "/workflows/governance/isolation-health",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    let isoContext;
    try {
      isoContext = buildTenantIsolationContext({
        workspaceId:       req.workspaceId,
        evaluationContext: "isolation-health",
      });
    } catch (e) {
      if (e instanceof TenantIsolationViolation) {
        res.status(403).json({ error: "Tenant isolation violation", code: e.code });
        return;
      }
      throw e;
    }

    // ── Sample recent executions for boundary validation ─────────────────────
    const execSample = await db
      .select({ id: workflowExecutionsTable.id, workspaceId: workflowExecutionsTable.workspaceId })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId))
      .orderBy(desc(workflowExecutionsTable.id))
      .limit(20);

    // ── P9-B partition (for pressure + fairness to include in event) ──────────
    const [counts] = await db
      .select({
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, req.workspaceId));

    const activeExecutionCount  = Number(counts?.activeExecutionCount  ?? 0);
    const delayedExecutionCount = Number(counts?.delayedExecutionCount ?? 0);
    const partition    = evaluateWorkloadContainment({ workspaceId: req.workspaceId, activeExecutionCount, delayedExecutionCount });
    const pressure     = computePartitionPressureSummary(partition);
    const fairness     = computeSchedulerFairnessStatus(partition);

    // ── P9-A risk assessment over the sampled executions ─────────────────────
    const isolationRisk  = assessTenantIsolationRisk({
      context:           isoContext,
      workflowResources: execSample.map(e => ({ id: e.id, workspaceId: e.workspaceId })),
    });
    const isolationHealth = classifyIsolationHealth(isolationRisk.overallRisk);

    emitIsolationHealthEvent(
      req.workspaceId,
      isoContext.requestScopeId,
      pressure.total,
      isolationHealth,
      fairness.fairnessLevel,
      partition.containmentStatus,
    );

    res.json({
      workspaceId:        req.workspaceId,
      requestScopeId:     isoContext.requestScopeId,
      isolationHealth,
      overallRisk:        isolationRisk.overallRisk,
      leakageRisk:        isolationRisk.leakageRisk,
      orphanAccessRisk:   isolationRisk.orphanAccessRisk,
      analyticsBoundaryRisk: isolationRisk.analyticsBoundaryRisk,
      observabilityIsolationRisk: isolationRisk.observabilityIsolationRisk,
      findings:           isolationRisk.findings,
      sampledExecutions:  execSample.length,
      evaluatedAt:        isolationRisk.assessedAt,
    });
  },
);

// ── GET /workflows/executions/failed ─────────────────────────────────────────
//
// IMPORTANT: Registered before GET /workflows/executions and GET /workflows/:id
// to prevent Express matching "executions" and "failed" as :id parameters.
//
// Returns failed workflow executions only (status = 'failed').
// Includes the last failed step for quick triage.
//
// A workflow execution is "failed" when the engine sets status = 'failed'
// (either a step threw an unrecoverable error or a guard condition failed).

router.get(
  "/workflows/executions/failed",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const page    = Math.max(1, Number(req.query["page"])  || 1);
    const limit   = Math.min(100, Math.max(1, Number(req.query["limit"]) || 30));
    const offset  = (page - 1) * limit;

    const { workflowId, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    const conds = [
      eq(workflowExecutionsTable.workspaceId, req.workspaceId),
      or(
        eq(workflowExecutionsTable.status, "failed"),
        eq(workflowExecutionsTable.status, "error"),
      )!,
    ];

    if (workflowId) conds.push(eq(workflowExecutionsTable.workflowId, parseInt(workflowId, 10)));
    if (dateFrom)   conds.push(gte(workflowExecutionsTable.startedAt, new Date(dateFrom)));
    if (dateTo)     conds.push(lte(workflowExecutionsTable.startedAt, new Date(dateTo)));

    const where = and(...conds);

    const [totalRow] = await db
      .select({ count: count() })
      .from(workflowExecutionsTable)
      .where(where);

    const rows = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        module:           workflowDefinitionsTable.module,
        triggerEvent:     workflowDefinitionsTable.triggerEvent,
        triggerEventLogId: workflowExecutionsTable.triggerEventLogId,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
        timeoutAt:        workflowExecutionsTable.timeoutAt,
        cancelRequested:  workflowExecutionsTable.cancelRequested,
        // Computed execution duration in milliseconds (null if still running).
        durationMs: sql<number | null>`
          CASE
            WHEN ${workflowExecutionsTable.completedAt} IS NOT NULL
            THEN EXTRACT(EPOCH FROM (${workflowExecutionsTable.completedAt} - ${workflowExecutionsTable.startedAt})) * 1000
            ELSE NULL
          END
        `,
        // Last failed step - pulled inline to avoid N+1 on list view.
        lastFailedStep: sql<{ stepIndex: number; stepName: string; stepType: string; error: string | null } | null>`
          (
            SELECT jsonb_build_object(
              'stepIndex', s.step_index,
              'stepName',  s.step_name,
              'stepType',  s.step_type,
              'error',     s.error
            )
            FROM workflow_execution_steps s
            WHERE s.execution_id = ${workflowExecutionsTable.id}
              AND s.status IN ('failed', 'error')
            ORDER BY s.step_index DESC
            LIMIT 1
          )
        `,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(desc(workflowExecutionsTable.startedAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, total: totalRow?.count ?? 0, page, limit });
  },
);

// ── GET /workflows/executions/stuck ──────────────────────────────────────────
//
// P4-B: Stuck execution diagnostics.
//
// Returns executions that are actively "stuck" - still in a non-terminal status
// (running or waiting_approval) but have exceeded their timeout_at deadline.
//
// These are candidates for admin review and/or force-timeout via:
//   POST /workflows/executions/:id/timeout
//
// IMPORTANT: Registered BEFORE GET /workflows/executions/:id to prevent Express
// from matching "stuck" as the :id parameter.
//
// Filters:
//   ?workflowId=<id>          - narrow to a single workflow definition
//   ?overdueMinutes=<n>       - only include executions overdue by at least N minutes
//
// Response per row:
//   id, workflowId, workflowName, workflowKey, workspaceId, triggerEvent,
//   status, currentStepIndex, startedAt, timeoutAt, overdueMs
//
// Note: Legacy executions with timeout_at = NULL are excluded from stuck results
// (they have no deadline, so they cannot be "stuck" by the TTL definition).
// They may still be manually terminated via the admin force-timeout action.

router.get(
  "/workflows/executions/stuck",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const { workflowId, overdueMinutes } =
      req.query as Record<string, string | undefined>;

    const now = new Date();

    const conds = [
      eq(workflowExecutionsTable.workspaceId, req.workspaceId),
      // Only non-terminal statuses: running or waiting_approval.
      or(
        eq(workflowExecutionsTable.status, "running"),
        eq(workflowExecutionsTable.status, "waiting_approval"),
      )!,
      // Only executions that have a deadline set (timeout_at IS NOT NULL).
      // Legacy rows (timeout_at = NULL) are excluded: they have no deadline.
      isNotNull(workflowExecutionsTable.timeoutAt),
      // Core stuck condition: deadline has passed.
      lt(workflowExecutionsTable.timeoutAt, now),
    ];

    // Optional: filter by workflowId.
    if (workflowId) {
      conds.push(eq(workflowExecutionsTable.workflowId, parseInt(workflowId, 10)));
    }

    // Optional: only include executions overdue by at least N minutes.
    // Computed as: now - overdueMinutes >= timeout_at, i.e., timeout_at <= now - N minutes.
    if (overdueMinutes) {
      const thresholdMs = parseInt(overdueMinutes, 10) * 60 * 1000;
      if (!isNaN(thresholdMs) && thresholdMs > 0) {
        const cutoff = new Date(now.getTime() - thresholdMs);
        conds.push(lte(workflowExecutionsTable.timeoutAt, cutoff));
      }
    }

    const where = and(...conds);

    const rows = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        module:           workflowDefinitionsTable.module,
        triggerEvent:     workflowDefinitionsTable.triggerEvent,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        startedAt:        workflowExecutionsTable.startedAt,
        timeoutAt:        workflowExecutionsTable.timeoutAt,
        cancelRequested:  workflowExecutionsTable.cancelRequested,
        // Computed overdue duration: how long past the deadline this execution is.
        // Exposed so the frontend can show "overdue by X minutes" without JS math.
        overdueMs: sql<number>`
          EXTRACT(EPOCH FROM (NOW() - ${workflowExecutionsTable.timeoutAt})) * 1000
        `,
        triggeredBy:     workflowExecutionsTable.triggeredBy,
        triggeredByName: sql<string | null>`${usersTable.fullName}`,
        error:           workflowExecutionsTable.error,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(workflowExecutionsTable.timeoutAt); // oldest deadline first (most urgent)

    res.json({ data: rows, total: rows.length, asOf: now.toISOString() });
  },
);

// ── GET /workflows/executions ─────────────────────────────────────────────────
//
// IMPORTANT: Registered before GET /workflows/:id (and after /failed and /stuck above).
//
// Cross-workflow executions list with extended filters.
// Lighter than /workflow-executions - no context JSONB, adds triggerEventName
// and computed durationMs.

router.get(
  "/workflows/executions",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const page   = Math.max(1, Number(req.query["page"])  || 1);
    const limit  = Math.min(100, Math.max(1, Number(req.query["limit"]) || 30));
    const offset = (page - 1) * limit;

    const { status, workflowId, triggeredBy, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    const conds = [eq(workflowExecutionsTable.workspaceId, req.workspaceId)];

    if (status)      conds.push(eq(workflowExecutionsTable.status,      status));
    if (workflowId)  conds.push(eq(workflowExecutionsTable.workflowId,  parseInt(workflowId,  10)));
    if (triggeredBy) conds.push(eq(workflowExecutionsTable.triggeredBy, parseInt(triggeredBy, 10)));
    if (dateFrom)    conds.push(gte(workflowExecutionsTable.startedAt,  new Date(dateFrom)));
    if (dateTo)      conds.push(lte(workflowExecutionsTable.startedAt,  new Date(dateTo)));

    const where = and(...conds);

    const [totalRow] = await db
      .select({ count: count() })
      .from(workflowExecutionsTable)
      .where(where);

    const rows = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        module:           workflowDefinitionsTable.module,
        triggerEventLogId: workflowExecutionsTable.triggerEventLogId,
        // Trigger event name from workspace_event_logs (FK lookup, single row).
        triggerEventName: sql<string | null>`${workspaceEventLogsTable.eventName}`,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
        timeoutAt:        workflowExecutionsTable.timeoutAt,
        cancelRequested:  workflowExecutionsTable.cancelRequested,
        durationMs: sql<number | null>`
          CASE
            WHEN ${workflowExecutionsTable.completedAt} IS NOT NULL
            THEN EXTRACT(EPOCH FROM (${workflowExecutionsTable.completedAt} - ${workflowExecutionsTable.startedAt})) * 1000
            ELSE NULL
          END
        `,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(workspaceEventLogsTable,  eq(workflowExecutionsTable.triggerEventLogId, workspaceEventLogsTable.id))
      .leftJoin(usersTable,               eq(workflowExecutionsTable.triggeredBy,        usersTable.id))
      .where(where)
      .orderBy(desc(workflowExecutionsTable.startedAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, total: totalRow?.count ?? 0, page, limit });
  },
);

// ── GET /workflows/executions/:id ─────────────────────────────────────────────
//
// Full execution detail with step timeline and linked event log.
//
// ── Timeline reconstruction ───────────────────────────────────────────────────
//   Steps are sorted by stepIndex (not DB insertion order).  Each step has a
//   computed durationMs for performance analysis.  Sensitive fields in input/
//   output (passwords, tokens) are NOT redacted here - these APIs are admin-
//   only and the raw data is needed for debugging.  If PII redaction is
//   required in future, add a redact() pass over input/output before responding.
//
// ── Why event log is included ────────────────────────────────────────────────
//   The linked workspace_event_log gives the full trigger context (payload,
//   requestId, busEventId) without requiring a second client request.
//   Only key fields are returned - not the full payload - to keep the
//   response focused.

router.get(
  "/workflows/executions/:id",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Parallel fetch: execution details + execution steps.
    const [execRows, steps] = await Promise.all([
      db
        .select({
          // ── Execution core ─────────────────────────────────────────────────
          id:               workflowExecutionsTable.id,
          workspaceId:      workflowExecutionsTable.workspaceId,
          workflowId:       workflowExecutionsTable.workflowId,
          workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
          workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
          workflowModule:   workflowDefinitionsTable.module,
          workflowTriggerEvent: workflowDefinitionsTable.triggerEvent,
          // ── Execution status ───────────────────────────────────────────────
          status:           workflowExecutionsTable.status,
          currentStepIndex: workflowExecutionsTable.currentStepIndex,
          totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
          error:            workflowExecutionsTable.error,
          startedAt:        workflowExecutionsTable.startedAt,
          completedAt:      workflowExecutionsTable.completedAt,
          timeoutAt:        workflowExecutionsTable.timeoutAt,
          cancelRequested:  workflowExecutionsTable.cancelRequested,
          durationMs: sql<number | null>`
            CASE
              WHEN ${workflowExecutionsTable.completedAt} IS NOT NULL
              THEN EXTRACT(EPOCH FROM (${workflowExecutionsTable.completedAt} - ${workflowExecutionsTable.startedAt})) * 1000
              ELSE NULL
            END
          `,
          // ── Trigger user ───────────────────────────────────────────────────
          triggeredBy:      workflowExecutionsTable.triggeredBy,
          triggeredByName:  sql<string | null>`${usersTable.fullName}`,
          // ── Trigger event (linked workspace_event_log) ─────────────────────
          triggerEventLogId:   workflowExecutionsTable.triggerEventLogId,
          triggerEventName:    sql<string | null>`${workspaceEventLogsTable.eventName}`,
          triggerEventModule:  sql<string | null>`${workspaceEventLogsTable.module}`,
          triggerEventStatus:  sql<string | null>`${workspaceEventLogsTable.status}`,
          triggerEventCreatedAt: sql<string | null>`${workspaceEventLogsTable.createdAt}`,
          // Surface correlation IDs from trigger event payload for debugging.
          triggerBusEventId: sql<string | null>`${workspaceEventLogsTable.payload}->>'_busEventId'`,
          triggerRequestId:  sql<string | null>`${workspaceEventLogsTable.payload}->>'_requestId'`,
          // ── P5-A: Snapshot diagnostics ─────────────────────────────────────
          // workflowVersion: the definition version active when this execution
          //   was triggered.  NULL until P7-A adds versioning to definitions.
          // snapshotPresent: true if this execution has an immutable steps
          //   snapshot (all executions created after P5-A deployment).
          //   false for legacy executions (created before P5-A) - these use the
          //   live definition on resume and may be subject to definition drift.
          // IMPORTANT: steps_snapshot itself is NOT returned here to avoid
          //   bloating the response payload (can be KBs per execution).
          //   Admins who need the raw snapshot can query the DB directly.
          workflowVersion: workflowExecutionsTable.workflowVersion,
          snapshotPresent: sql<boolean>`${workflowExecutionsTable.stepsSnapshot} IS NOT NULL`,
        })
        .from(workflowExecutionsTable)
        .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
        .leftJoin(workspaceEventLogsTable,  eq(workflowExecutionsTable.triggerEventLogId, workspaceEventLogsTable.id))
        .leftJoin(usersTable,               eq(workflowExecutionsTable.triggeredBy,        usersTable.id))
        .where(
          and(
            eq(workflowExecutionsTable.id,          id),
            eq(workflowExecutionsTable.workspaceId, req.workspaceId),
          ),
        ),

      db
        .select({
          id:          workflowExecutionStepsTable.id,
          stepIndex:   workflowExecutionStepsTable.stepIndex,
          stepType:    workflowExecutionStepsTable.stepType,
          stepName:    workflowExecutionStepsTable.stepName,
          status:      workflowExecutionStepsTable.status,
          input:       workflowExecutionStepsTable.input,
          output:      workflowExecutionStepsTable.output,
          error:       workflowExecutionStepsTable.error,
          startedAt:   workflowExecutionStepsTable.startedAt,
          completedAt: workflowExecutionStepsTable.completedAt,
          durationMs: sql<number | null>`
            CASE
              WHEN ${workflowExecutionStepsTable.completedAt} IS NOT NULL
                AND ${workflowExecutionStepsTable.startedAt} IS NOT NULL
              THEN EXTRACT(EPOCH FROM (${workflowExecutionStepsTable.completedAt} - ${workflowExecutionStepsTable.startedAt})) * 1000
              ELSE NULL
            END
          `,
        })
        .from(workflowExecutionStepsTable)
        .where(eq(workflowExecutionStepsTable.executionId, id))
        .orderBy(workflowExecutionStepsTable.stepIndex),
    ]);

    const execution = execRows[0];
    if (!execution) { res.status(404).json({ error: "Execution not found" }); return; }

    res.json({ execution, steps });
  },
);

// ── POST /workflows/executions/:id/timeout ───────────────────────────────────
//
// P4-B: Admin force-timeout action.
//
// Transitions a stuck execution to status='timed_out' immediately, without
// waiting for the cooperative inter-step check to fire.  Intended for:
//   • Executions stuck in 'waiting_approval' (approval never resolves).
//   • Executions in 'running' that appear to have hung (long step, DB timeout, etc).
//   • Executions where the inter-step check can't fire (no next step will start).
//
// Requires: super_admin role.  This is an irreversible admin action - terminal
// status cannot be undone.  The execution row is preserved (no hard delete).
//
// Rejected (422) if the execution is already in a terminal status:
//   completed, failed, error, timed_out, cancelled.
//
// Audit: All force-timeout actions are logged with structured pino entries
// including executionId, workflowId, workspaceId, actor (adminId), and overdueMs.
//
// IMPORTANT: Registered BEFORE GET /workflows/:id to prevent Express from
// matching "executions" as the :id parameter.  (/:id/timeout path is distinct
// from the /:id GET, but registering after /workflows/:id is safer.)

router.post(
  "/workflows/executions/:id/timeout",
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid execution ID" }); return; }

    // Fetch the execution - super_admin can act across all workspaces.
    const [existing] = await db
      .select({
        id:          workflowExecutionsTable.id,
        workspaceId: workflowExecutionsTable.workspaceId,
        workflowId:  workflowExecutionsTable.workflowId,
        status:      workflowExecutionsTable.status,
        timeoutAt:   workflowExecutionsTable.timeoutAt,
        startedAt:   workflowExecutionsTable.startedAt,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Execution not found" });
      return;
    }

    // Reject if already terminal - no further status transitions allowed.
    if (isTerminalStatus(existing.status)) {
      res.status(422).json({
        error:          `Execution is already in terminal status '${existing.status}'. Cannot force-timeout a completed execution.`,
        code:           "EXECUTION_ALREADY_TERMINAL",
        currentStatus:  existing.status,
        executionId:    id,
      });
      return;
    }

    const now = new Date();

    // ── P4-D: Guarded force-timeout UPDATE ──────────────────────────────────
    //
    // WHERE status NOT IN TERMINAL prevents overwriting a terminal state that
    // the executor may have set between the pre-flight SELECT above and this UPDATE.
    //
    // Race scenario:
    //   t=0  GET existing → status='running'  (non-terminal, pre-flight passes)
    //   t=1  Executor: last step completes, sets status='completed'
    //   t=2  This UPDATE fires (blind) → status='timed_out' overwrites 'completed'
    //
    // With the WHERE guard:
    //   t=2  UPDATE WHERE NOT terminal → .returning() empty → race detected → 409
    //
    // Why 409 CONFLICT (not 422):
    //   422 = client sent an invalid request that can never succeed.
    //   409 = client's request was valid at the time of the pre-flight check,
    //         but a concurrent operation won the race.  The caller can retry
    //         or inspect the current state.
    const [updated] = await db
      .update(workflowExecutionsTable)
      .set({
        status:      "timed_out",
        completedAt: now,
      })
      .where(
        and(
          eq(workflowExecutionsTable.id, id),
          not(inArray(workflowExecutionsTable.status, [...TERMINAL_STATUSES])),
        ),
      )
      .returning();

    if (!updated) {
      // The executor transitioned this execution to a terminal state between
      // the pre-flight SELECT and this UPDATE.  Log the race and return 409.
      req.log.warn(
        {
          executionId:          id,
          workflowId:           existing.workflowId,
          workspaceId:          existing.workspaceId,
          adminId:              req.userId,
          previousStatus:       existing.status,
          attemptedTransition:  "?→timed_out",
          action:               "transition_race_lost",
        },
        "[governance] P4-D: force-timeout lost race - execution already in terminal state (P4-D)",
      );
      res.status(409).json({
        error:       "Execution transitioned to a terminal state before force-timeout could be applied. Please re-fetch the current status.",
        code:        "TRANSITION_RACE_LOST",
        executionId: id,
      });
      return;
    }

    const overdueMs = computeOverdueMs(existing.timeoutAt, now);

    // Structured audit log - always written, regardless of whether timeoutAt was set.
    req.log.warn(
      {
        executionId:    id,
        workflowId:     existing.workflowId,
        workspaceId:    existing.workspaceId,
        adminId:        req.userId,
        previousStatus: existing.status,
        timeoutAt:      existing.timeoutAt,
        overdueMs,
        forcedAt:       now.toISOString(),
        action:         "admin_force_timeout",
      },
      "[governance] Execution force-timed-out by super_admin (P4-B)",
    );

    res.json({
      executionId:    updated.id,
      workflowId:     updated.workflowId,
      workspaceId:    updated.workspaceId,
      previousStatus: existing.status,
      status:         "timed_out",
      completedAt:    updated.completedAt,
      timeoutAt:      existing.timeoutAt,
      overdueMs,
    });
  },
);

// ── POST /workflows/executions/:id/cancel ────────────────────────────────────
//
// P4-C: Cooperative cancellation - sets cancel_requested = true on the execution.
//
// The route handler does NOT directly set status='cancelled'.  Instead it sets
// the cancel_requested flag so the executor can transition status at the next
// inter-step boundary, after the current step safely completes.
//
// WHY FLAG-BASED (NOT DIRECT STATUS MUTATION):
//   If this route set status='cancelled' directly while a step is executing,
//   the executor's next UPDATE (currentStepIndex, or the completion UPDATE)
//   would overwrite it - losing the cancelled status.  The flag model ensures
//   the executor is the sole owner of status transitions.  P4-D will add
//   WHERE status='running' guards to resolve the underlying race entirely.
//
// WHY THE RESPONSE IS IMMEDIATE:
//   The caller receives { cancelRequested: true } immediately, without waiting
//   for the execution to actually reach 'cancelled'.  The caller should poll
//   GET /executions/:id to observe the final cancelled status.
//
// Permissions:
//   requireAuth + requirePermission("workflow.manage")
//   Scoped to the caller's workspace - cannot cancel executions from other
//   workspaces (unlike POST /timeout which is super_admin across all workspaces).
//
// Rejection cases:
//   404 - execution not found (or belongs to a different workspace)
//   422 - execution is already in a terminal status (isTerminalStatus check)
//   409 - cancel has already been requested (cancel_requested = true)
//         Returns CANCEL_ALREADY_REQUESTED to distinguish from 422.
//
// Audit:
//   Structured req.log.warn() entry with executionId, workflowId, workspaceId,
//   cancelledBy (req.userId), and action: 'cancel_requested'.
//   The executor emits a second log with action: 'execution_cancelled' when
//   it actually transitions the status at the inter-step boundary.

router.post(
  "/workflows/executions/:id/cancel",
  requireAuth,
  requirePermission("workflow.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid execution ID" }); return; }

    // Fetch the execution - scoped to caller's workspace for isolation.
    const [existing] = await db
      .select({
        id:              workflowExecutionsTable.id,
        workspaceId:     workflowExecutionsTable.workspaceId,
        workflowId:      workflowExecutionsTable.workflowId,
        status:          workflowExecutionsTable.status,
        cancelRequested: workflowExecutionsTable.cancelRequested,
        timeoutAt:       workflowExecutionsTable.timeoutAt,
      })
      .from(workflowExecutionsTable)
      .where(
        and(
          eq(workflowExecutionsTable.id,          id),
          eq(workflowExecutionsTable.workspaceId, req.workspaceId),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Execution not found" });
      return;
    }

    // Reject if already terminal - no further transitions allowed.
    if (isTerminalStatus(existing.status)) {
      res.status(422).json({
        error:         `Execution is already in terminal status '${existing.status}'. Cannot cancel a completed execution.`,
        code:          "EXECUTION_ALREADY_TERMINAL",
        currentStatus: existing.status,
        executionId:   id,
      });
      return;
    }

    // Reject duplicate cancellation requests - cancel_requested is already set.
    // This prevents confusing double-signals and gives operators clear feedback.
    if (existing.cancelRequested) {
      res.status(409).json({
        error:         "Cancellation has already been requested for this execution.",
        code:          "CANCEL_ALREADY_REQUESTED",
        currentStatus: existing.status,
        executionId:   id,
      });
      return;
    }

    const requestedAt = new Date();

    // ── P4-D: Guarded cancel flag UPDATE ────────────────────────────────────
    //
    // WHERE cancel_requested=false AND status NOT terminal prevents:
    //   a) Setting the flag twice (duplicate cancel requests that bypass the
    //      pre-flight cancelRequested check above due to concurrent requests).
    //   b) Setting the flag on an execution that became terminal between the
    //      pre-flight SELECT and this UPDATE (executor race).
    //
    // If .returning() is empty, we re-fetch to determine the exact cause and
    // return the most specific error code.
    //
    // Why re-fetch on race (not use existing):
    //   The 'existing' snapshot was taken before the UPDATE attempt.  By the
    //   time .returning() is empty, the actual current state may differ.
    //   Re-fetching gives the caller accurate current-state information.
    const [flagged] = await db
      .update(workflowExecutionsTable)
      .set({ cancelRequested: true })
      .where(
        and(
          eq(workflowExecutionsTable.id,               id),
          eq(workflowExecutionsTable.cancelRequested,  false),
          not(inArray(workflowExecutionsTable.status,  [...TERMINAL_STATUSES])),
        ),
      )
      .returning({ id: workflowExecutionsTable.id });

    if (!flagged) {
      // Race: the execution transitioned to terminal or was already cancel-flagged
      // between the pre-flight SELECT and this UPDATE.  Re-fetch for accuracy.
      const [current] = await db
        .select({
          status:          workflowExecutionsTable.status,
          cancelRequested: workflowExecutionsTable.cancelRequested,
        })
        .from(workflowExecutionsTable)
        .where(eq(workflowExecutionsTable.id, id));

      req.log.warn(
        {
          executionId:          id,
          workflowId:           existing.workflowId,
          workspaceId:          existing.workspaceId,
          cancelledBy:          req.userId,
          previousStatus:       existing.status,
          currentStatus:        current?.status,
          attemptedTransition:  "set cancel_requested=true",
          action:               "transition_race_lost",
        },
        "[governance] P4-D: cancel flag UPDATE lost race - execution state changed concurrently (P4-D)",
      );

      if (!current || isTerminalStatus(current.status)) {
        res.status(422).json({
          error:         `Execution is already in terminal status '${current?.status ?? "unknown"}'. Cannot cancel a completed execution.`,
          code:          "EXECUTION_ALREADY_TERMINAL",
          currentStatus: current?.status,
          executionId:   id,
        });
      } else if (current.cancelRequested) {
        res.status(409).json({
          error:         "Cancellation has already been requested for this execution.",
          code:          "CANCEL_ALREADY_REQUESTED",
          currentStatus: current.status,
          executionId:   id,
        });
      } else {
        res.status(409).json({
          error:       "Execution state changed concurrently before the cancel flag could be set. Please retry.",
          code:        "TRANSITION_RACE_LOST",
          executionId: id,
        });
      }
      return;
    }

    // Audit log: record who requested the cancellation and when.
    // The executor's P4-C log (action: 'execution_cancelled') records when it
    // actually fires.  Together these two log entries form a complete audit trail.
    req.log.warn(
      {
        executionId:   id,
        workflowId:    existing.workflowId,
        workspaceId:   existing.workspaceId,
        cancelledBy:   req.userId,
        currentStatus: existing.status,
        timeoutAt:     existing.timeoutAt,
        requestedAt:   requestedAt.toISOString(),
        action:        "cancel_requested",
      },
      "[governance] Workflow execution cancellation requested (P4-C)",
    );

    res.json({
      executionId:     id,
      workflowId:      existing.workflowId,
      previousStatus:  existing.status,
      cancelRequested: true,
      requestedAt:     requestedAt.toISOString(),
    });
  },
);

// ── POST /workflows/:id/validate (P3-A, P3-F) ────────────────────────────────
//
// Runs the governance validator against the workflow's steps + triggerEvent.
// Returns structured errors (block activation) and warnings (informational).
//
// This is a read-only endpoint - it does NOT change the workflow's status.
// Use POST /workflows/:id/activate to validate AND activate in one step.
//
// Registered BEFORE GET /workflows/:id to prevent "validate" matching as :id.

router.post(
  "/workflows/:id/validate",
  requireAuth,
  requirePermission(req => ["workflow.manage", `workflows.${req.params["id"]}.manage`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [wf] = await db
      .select({
        id:           workflowDefinitionsTable.id,
        status:       workflowDefinitionsTable.status,
        triggerEvent: workflowDefinitionsTable.triggerEvent,
        steps:        workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    const result = validateWorkflow(
      wf.steps as unknown[],
      wf.triggerEvent,
    );

    // P5-D: Emit structured observability log for the validation result.
    req.log.info(
      {
        event:            "workflow_validation_completed",
        workflowId:       wf.id,
        workspaceId:      req.workspaceId,
        valid:            result.valid,
        errorCount:       result.errors.length,
        warningCount:     result.warnings.length,
        noticeCount:      result.notices.length,
        estimatedMetrics: result.estimatedMetrics,
        errorCodes:       result.errors.map(e => e.code),
        warningCodes:     result.warnings.map(w => w.code),
      },
      "[governance] Workflow validation completed (dry-run)",
    );

    if (!result.valid) {
      req.log.warn(
        {
          event:      "workflow_validation_failed",
          workflowId: wf.id,
          workspaceId: req.workspaceId,
          errorCount: result.errors.length,
          errorCodes: result.errors.map(e => e.code),
        },
        "[governance] Workflow failed governance validation (dry-run, no status change)",
      );
    }

    res.json({
      workflowId: wf.id,
      status:     wf.status,
      ...result,
    });
  },
);

// ── GET /workflows/:id/versions (P5-E) ───────────────────────────────────────
//
// Returns the immutable version history for a workflow definition.
// Each row represents one publish event - who published, when, with what notes,
// and when (if ever) it was superseded by a newer publish.
//
// Registered BEFORE GET /workflows/:id to avoid "versions" matching as :id.

router.get(
  "/workflows/:id/versions",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Verify definition exists in this workspace.
    const [wf] = await db
      .select({ id: workflowDefinitionsTable.id, name: workflowDefinitionsTable.name })
      .from(workflowDefinitionsTable)
      .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    const versions = await db
      .select({
        id:               workflowDefinitionVersionsTable.id,
        definitionId:     workflowDefinitionVersionsTable.definitionId,
        version:          workflowDefinitionVersionsTable.version,
        triggerEvent:     workflowDefinitionVersionsTable.triggerEvent,
        name:             workflowDefinitionVersionsTable.name,
        nameAr:           workflowDefinitionVersionsTable.nameAr,
        changeNotes:      workflowDefinitionVersionsTable.changeNotes,
        publishedBy:      workflowDefinitionVersionsTable.publishedBy,
        publishedByName:  sql<string | null>`${usersTable.fullName}`,
        publishedAt:      workflowDefinitionVersionsTable.publishedAt,
        deactivatedAt:    workflowDefinitionVersionsTable.deactivatedAt,
        deactivatedBy:    workflowDefinitionVersionsTable.deactivatedBy,
        validationSummary: workflowDefinitionVersionsTable.validationSummary,
        stepCount:        sql<number>`jsonb_array_length(${workflowDefinitionVersionsTable.steps})`,
      })
      .from(workflowDefinitionVersionsTable)
      .leftJoin(usersTable, eq(workflowDefinitionVersionsTable.publishedBy, usersTable.id))
      .where(and(
        eq(workflowDefinitionVersionsTable.definitionId, id),
        eq(workflowDefinitionVersionsTable.workspaceId, req.workspaceId!),
      ))
      .orderBy(desc(workflowDefinitionVersionsTable.version));

    res.json({ workflowId: id, workflowName: wf.name, versions });
  },
);

// ── POST /workflows/:id/activate (P3-F, P5-E) ────────────────────────────────
//
// P5-E: Activation is now the "publish" operation.  It is no longer a simple
// status toggle - it is an atomic governance transaction that:
//   1. Validates the workflow against all structural + governance rules.
//   2. Writes an IMMUTABLE version row to workflow_definition_versions.
//   3. Closes the previous version row (deactivatedAt=now) if one exists.
//   4. Updates the definition atomically (version++, currentVersionId, publishedAt).
//
// This turns every activation into an auditable, immutable publish artifact.
// The version history is append-only - version rows are never deleted.
//
// Key invariants after P5-E:
//   • A workflow cannot be published if validation errors exist (unchanged from P3-F).
//   • Every published version has a permanent attribution (publishedBy, publishedAt).
//   • The definition.version counter tells you how many times it has been published.
//   • engine.ts populates workflowVersion on new executions from definition.version.
//
// Optional request body:
//   { changeNotes?: string }  - admin-provided description of what changed.
//
// If validation fails the workflow stays in its current status and the caller
// receives a 422 with structured errors listing which step types are blocked.
//
// Idempotent: activating an already-active workflow succeeds with a 200 and
// a note indicating the workflow is already active.
//
// Registered BEFORE GET /workflows/:id (same reason as validate above).

router.post(
  "/workflows/:id/activate",
  requireAuth,
  requirePermission(req => ["workflow.manage", `workflows.${req.params["id"]}.manage`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // P5-E: Optional publish metadata from request body.
    const changeNotes = typeof (req.body as Record<string, unknown>)["changeNotes"] === "string"
      ? String((req.body as Record<string, unknown>)["changeNotes"]).trim() || null
      : null;

    const [wf] = await db
      .select({
        id:               workflowDefinitionsTable.id,
        status:           workflowDefinitionsTable.status,
        triggerEvent:     workflowDefinitionsTable.triggerEvent,
        steps:            workflowDefinitionsTable.steps,
        conditions:       workflowDefinitionsTable.conditions,
        name:             workflowDefinitionsTable.name,
        nameAr:           workflowDefinitionsTable.nameAr,
        version:          workflowDefinitionsTable.version,
        currentVersionId: workflowDefinitionsTable.currentVersionId,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    // Idempotent: already active → return immediately with validation result.
    if (wf.status === "active") {
      const result = validateWorkflow(wf.steps as unknown[], wf.triggerEvent);
      res.json({
        workflowId:   wf.id,
        status:       "active",
        alreadyActive: true,
        version:      wf.version,
        ...result,
      });
      return;
    }

    // ── P5-D / P5-E: Run governance validation before publishing ─────────────
    const result = validateWorkflow(wf.steps as unknown[], wf.triggerEvent);

    // P5-E: Emit workflow_publish_started observability event.
    req.log.info(
      {
        event:            "workflow_publish_started",
        workflowId:       wf.id,
        workspaceId:      req.workspaceId,
        publishedBy:      req.userId,
        hasChangeNotes:   changeNotes !== null,
        valid:            result.valid,
        errorCount:       result.errors.length,
        warningCount:     result.warnings.length,
        noticeCount:      result.notices.length,
        estimatedMetrics: result.estimatedMetrics,
        errorCodes:       result.errors.map(e => e.code),
        warningCodes:     result.warnings.map(w => w.code),
      },
      "[governance] Workflow publish started",
    );

    if (!result.valid) {
      // Validation failed - do NOT publish. No version row written.
      req.log.warn(
        {
          event:       "workflow_publish_blocked",
          workflowId:  wf.id,
          workspaceId: req.workspaceId,
          publishedBy: req.userId,
          errorCount:  result.errors.length,
          errorCodes:  result.errors.map(e => e.code),
        },
        "[governance] Workflow publish blocked - governance validation failed",
      );
      res.status(422).json({
        error:      "Workflow failed governance validation. Fix all errors before publishing.",
        workflowId: wf.id,
        ...result,
      });
      return;
    }

    // ── P5-E: Atomic publish transaction ─────────────────────────────────────
    //
    // TRANSACTION STEPS:
    //   1. Read current version counter from definition (re-read inside tx for safety).
    //   2. Close the previous active version row if it exists.
    //   3. INSERT the new immutable version row.
    //   4. UPDATE the definition: status, version, currentVersionId, publishedAt, publishedBy.
    //
    // ATOMICITY GUARANTEE:
    //   The version INSERT and the definition UPDATE are a single unit.
    //   If either fails (e.g. constraint violation), the entire transaction rolls back.
    //   The UNIQUE(definition_id, version) constraint protects against concurrent publishes.

    const now = new Date();
    const newVersion = (wf.version ?? 0) + 1;

    const publishedVersion = await db.transaction(async (tx) => {
      // Step 1: Close the previous active version row if one exists.
      if (wf.currentVersionId !== null && wf.currentVersionId !== undefined) {
        await tx
          .update(workflowDefinitionVersionsTable)
          .set({
            deactivatedAt: now,
            deactivatedBy: req.userId ?? null,
          })
          .where(and(
            eq(workflowDefinitionVersionsTable.id, wf.currentVersionId),
            eq(workflowDefinitionVersionsTable.workspaceId, req.workspaceId!),
          ));
      }

      // Step 2: INSERT the new immutable version row.
      const [versionRow] = await tx
        .insert(workflowDefinitionVersionsTable)
        .values({
          definitionId:      id,
          workspaceId:       req.workspaceId!,
          version:           newVersion,
          steps:             wf.steps as unknown as Record<string, unknown>[],
          conditions:        wf.conditions as unknown as Record<string, unknown>,
          triggerEvent:      wf.triggerEvent,
          name:              wf.name,
          nameAr:            wf.nameAr ?? null,
          publishedBy:       req.userId ?? null,
          publishedAt:       now,
          changeNotes:       changeNotes,
          validationSummary: {
            valid:            result.valid,
            errorCount:       result.errors.length,
            warningCount:     result.warnings.length,
            noticeCount:      result.notices.length,
            errorCodes:       result.errors.map(e => e.code),
            warningCodes:     result.warnings.map(w => w.code),
            estimatedMetrics: result.estimatedMetrics,
            capturedAt:       now.toISOString(),
          } as unknown as Record<string, unknown>,
        })
        .returning();

      if (!versionRow) throw new Error("Version row INSERT failed");

      // Step 3: UPDATE the definition with new version metadata.
      const [activated] = await tx
        .update(workflowDefinitionsTable)
        .set({
          status:           "active",
          isActive:         true,
          version:          newVersion,
          currentVersionId: versionRow.id,
          publishedAt:      now,
          publishedBy:      req.userId ?? null,
        })
        .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)))
        .returning();

      if (!activated) throw new Error("Definition UPDATE failed");

      return { versionRow, activated };
    });

    // P5-E: Emit workflow_publish_completed observability event.
    req.log.info(
      {
        event:            "workflow_publish_completed",
        workflowId:       publishedVersion.activated.id,
        workspaceId:      req.workspaceId,
        publishedBy:      req.userId,
        version:          newVersion,
        versionId:        publishedVersion.versionRow.id,
        warningCount:     result.warnings.length,
        noticeCount:      result.notices.length,
        warningCodes:     result.warnings.map(w => w.code),
        estimatedMetrics: result.estimatedMetrics,
        changeNotes:      changeNotes,
      },
      "[governance] Workflow published successfully - immutable version record created",
    );

    res.json({
      workflowId:   publishedVersion.activated.id,
      status:       publishedVersion.activated.status,
      version:      newVersion,
      versionId:    publishedVersion.versionRow.id,
      publishedAt:  now.toISOString(),
      publishedBy:  req.userId ?? null,
      changeNotes:  changeNotes,
      ...result,
    });
  },
);

// ── GET /workflows/:id/forecast (P8-D) ────────────────────────────────────────
//
// Deterministic operational trend forecast for a workflow definition.
// Queries historical governance rollup data, builds a time-series of
// ForecastDataPoints, and runs the P8-D projection engine to produce:
//   • projectedComplexity (0-100) - rWC at end of forecast window
//   • projectedFragility (0-1)    - projected fragility index
//   • projectedBacklogPressure    - projected approval+delay pressure
//   • projectedStormRisk          - projected storm frequency
//   • trendDirection              - improving / stable / degrading / critically_degrading
//   • confidenceLevel             - low / moderate / high
//   • per-metric projections with slope + volatility details
//
// READ-ONLY: never mutates governance history, triggers alerts, or invokes execution.
// Registered BEFORE GET /workflows/:id/operational and GET /workflows/:id.

router.get(
  "/workflows/:id/forecast",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Parse query params
    const rawWindow      = parseInt(String(req.query["window"] ?? "7"), 10);
    const forecastWindow = isNaN(rawWindow) ? 7 : Math.min(90, Math.max(1, rawWindow));
    const granularity    = String(req.query["granularity"] ?? "daily") === "hourly" ? "hourly" : "daily";

    // Fetch workflow definition
    const [wf] = await db
      .select({
        id:      workflowDefinitionsTable.id,
        name:    workflowDefinitionsTable.name,
        version: workflowDefinitionsTable.version,
        steps:   workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    // Determine rollup query window
    const lookbackDays  = granularity === "daily" ? 30 : 7;
    const lookbackStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Fetch governance rollup rows ordered ASC (oldest first → index 0)
    const rollupRows = await db
      .select({
        snapshotCount:      governanceSnapshotRollupsTable.snapshotCount,
        avgErrorRate:       governanceSnapshotRollupsTable.avgErrorRate,
        avgApprovalBacklog: governanceSnapshotRollupsTable.avgApprovalBacklog,
        avgDelayBacklog:    governanceSnapshotRollupsTable.avgDelayBacklog,
        avgStuckCount:      governanceSnapshotRollupsTable.avgStuckCount,
        stormFrequency:     governanceSnapshotRollupsTable.stormFrequency,
      })
      .from(governanceSnapshotRollupsTable)
      .where(and(
        eq(governanceSnapshotRollupsTable.workspaceId, req.workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, granularity),
        gte(governanceSnapshotRollupsTable.bucketStart, lookbackStart),
      ))
      .orderBy(governanceSnapshotRollupsTable.bucketStart)  // ASC: oldest first
      .limit(200);

    // Map rollup rows → ForecastDataPoint[] (oldest first)
    const dataPoints: ForecastDataPoint[] = rollupRows.map(r => ({
      avgErrorRate:       r.avgErrorRate,
      avgApprovalBacklog: r.avgApprovalBacklog,
      avgDelayBacklog:    r.avgDelayBacklog,
      avgStuckCount:      r.avgStuckCount,
      stormFrequency:     r.stormFrequency,
      snapshotCount:      r.snapshotCount,
    }));

    // Run P8-B static dependency analysis for structural complexity
    const steps     = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];
    const depResult = analyzeDependencies(steps, {
      workflowId:      wf.id,
      workspaceId:     req.workspaceId,
      workflowVersion: wf.version ?? undefined,
    });

    // Run P8-A for density parameters
    const topoGraph = extractWorkflowTopology(steps);
    const analytics = computeTopologyAnalytics(topoGraph, steps);

    // Run P8-D forecast engine
    const forecast = computeWorkflowForecast(
      {
        dataPoints,
        forecastWindowDays:   forecastWindow,
        structuralComplexity: depResult.pressure.operationalComplexityScore,
        approvalDensity:      analytics.approvalDensity,
        delayDensity:         analytics.delayDensity,
      },
      {
        workflowId:      wf.id,
        workspaceId:     req.workspaceId,
        workflowVersion: wf.version ?? undefined,
      },
    );

    req.log.info(
      {
        event:                "workflow_forecast_requested",
        workflowId:           wf.id,
        workspaceId:          req.workspaceId,
        forecastWindowDays:   forecastWindow,
        granularity,
        dataPointsUsed:       dataPoints.length,
        projectedComplexity:  forecast.projectedComplexity,
        projectedFragility:   forecast.projectedFragility,
        trendDirection:       forecast.trendDirection,
        confidenceLevel:      forecast.confidenceLevel,
        projectionMethod:     forecast.projectionMethod,
        actorId:              req.userId,
      },
      "GET /workflows/:id/forecast",
    );

    res.json({
      workflowId:        wf.id,
      workflowName:      wf.name,
      stepCount:         steps.length,
      granularity,
      lookbackDays,
      dataPointsUsed:    dataPoints.length,
      forecast,
    });
  },
);

// ── GET /workflows/:id/operational (P8-C) ─────────────────────────────────────
//
// Runtime-weighted operational intelligence for a workflow definition.
// Correlates P8-B static dependency analysis with aggregated historical
// governance snapshot data (from the rollup table) to produce:
//   • 5 runtime pressure metrics
//   • runtimeWeightedComplexity (0-100)
//   • correlationClassification (structural vs operational 2×2 matrix)
//   • chronicOperationalHotspots (named hotspot categories)
//   • OperationalFragilityIndex (level + structural/runtime/chronicity)
//
// READ-ONLY: never mutates governance history, workflow definitions, or DB.
// Registered BEFORE GET /workflows/:id/dependency and GET /workflows/:id.

router.get(
  "/workflows/:id/operational",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Fetch workflow definition
    const [wf] = await db
      .select({
        id:      workflowDefinitionsTable.id,
        name:    workflowDefinitionsTable.name,
        version: workflowDefinitionsTable.version,
        steps:   workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    // Fetch last 7 days of hourly rollups for this workspace
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rollups = await db
      .select({
        snapshotCount:      governanceSnapshotRollupsTable.snapshotCount,
        avgErrorRate:       governanceSnapshotRollupsTable.avgErrorRate,
        avgApprovalBacklog: governanceSnapshotRollupsTable.avgApprovalBacklog,
        avgDelayBacklog:    governanceSnapshotRollupsTable.avgDelayBacklog,
        avgStuckCount:      governanceSnapshotRollupsTable.avgStuckCount,
        stormFrequency:     governanceSnapshotRollupsTable.stormFrequency,
        chronicAlertCodes:  governanceSnapshotRollupsTable.chronicAlertCodes,
        dominantSeverity:   governanceSnapshotRollupsTable.dominantSeverity,
      })
      .from(governanceSnapshotRollupsTable)
      .where(and(
        eq(governanceSnapshotRollupsTable.workspaceId, req.workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, "hourly"),
        gte(governanceSnapshotRollupsTable.bucketStart, sevenDaysAgo),
      ))
      .orderBy(desc(governanceSnapshotRollupsTable.bucketStart))
      .limit(200);

    // Aggregate rollup data into HistoricalOperationalData
    let historical: HistoricalOperationalData;
    if (rollups.length >= 1) {
      const n             = rollups.length;
      const totalSnapshots = rollups.reduce((a, r) => a + r.snapshotCount, 0);
      const avgErrRate    = rollups.reduce((a, r) => a + r.avgErrorRate, 0) / n;
      const avgApproval   = rollups.reduce((a, r) => a + r.avgApprovalBacklog, 0) / n;
      const avgDelay      = rollups.reduce((a, r) => a + r.avgDelayBacklog, 0) / n;
      const avgStuck      = rollups.reduce((a, r) => a + r.avgStuckCount, 0) / n;
      const avgStorm      = rollups.reduce((a, r) => a + r.stormFrequency, 0) / n;

      // Collect all chronic alert codes across rollups (deduped)
      const chronicSet = new Set<string>();
      for (const r of rollups) {
        if (Array.isArray(r.chronicAlertCodes)) {
          for (const code of r.chronicAlertCodes) chronicSet.add(code);
        }
      }

      // Worst dominantSeverity across rollups
      const severityRank: Record<string, number> = {
        critical: 4, degraded: 3, warning: 2, healthy: 1,
      };
      let worstSeverity = "healthy";
      for (const r of rollups) {
        if ((severityRank[r.dominantSeverity] ?? 0) > (severityRank[worstSeverity] ?? 0)) {
          worstSeverity = r.dominantSeverity;
        }
      }
      const validSeverities = ["healthy", "warning", "degraded", "critical"] as const;
      const domSev = validSeverities.includes(worstSeverity as typeof validSeverities[number])
        ? (worstSeverity as typeof validSeverities[number])
        : "healthy";

      historical = {
        snapshotCount:      totalSnapshots,
        avgErrorRate:       avgErrRate,
        avgApprovalBacklog: avgApproval,
        avgDelayBacklog:    avgDelay,
        avgStuckCount:      avgStuck,
        stormFrequency:     avgStorm,
        chronicAlertCodes:  [...chronicSet],
        dominantSeverity:   domSev,
      };
    } else {
      historical = ZERO_HISTORICAL;
    }

    // Run static dependency analysis (P8-B)
    const steps     = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];
    const depResult = analyzeDependencies(steps, {
      workflowId:      wf.id,
      workspaceId:     req.workspaceId,
      workflowVersion: wf.version ?? undefined,
    });

    // Run P8-A analytics (needed by correlation engine)
    const topoGraph = extractWorkflowTopology(steps);
    const analytics = computeTopologyAnalytics(topoGraph, steps);

    // Run P8-C correlation
    const correlationResult = computeOperationalCorrelation(depResult, analytics, historical, {
      workflowId:      wf.id,
      workspaceId:     req.workspaceId,
      workflowVersion: wf.version ?? undefined,
    });

    req.log.info(
      {
        event:                    "workflow_operational_requested",
        workflowId:               wf.id,
        workspaceId:              req.workspaceId,
        runtimeWeightedComplexity: correlationResult.correlation.runtimeWeightedComplexity,
        fragilityLevel:           correlationResult.fragilityIndex.level,
        hotspotCount:             correlationResult.correlation.chronicOperationalHotspots.length,
        snapshotCount:            historical.snapshotCount,
        actorId:                  req.userId,
      },
      "GET /workflows/:id/operational",
    );

    res.json({
      workflowId:   wf.id,
      workflowName: wf.name,
      stepCount:    steps.length,
      correlation:  correlationResult.correlation,
      fragility:    correlationResult.fragilityIndex,
      historical: {
        snapshotCount:    historical.snapshotCount,
        dominantSeverity: historical.dominantSeverity,
        windowDays:       7,
      },
    });
  },
);

// ── GET /workflows/:id/dependency (P8-B) ──────────────────────────────────────
//
// Dependency intelligence analysis for a workflow definition.
// Builds on top of the P8-A topology graph to expose convergence nodes,
// divergence nodes, bottleneck scoring, execution-pressure estimates, and
// a dependency risk assessment.
//
// READ-ONLY: never mutates the workflow, never triggers execution, never
// invokes the scheduler or executor.
//
// Registered BEFORE GET /workflows/:id to prevent "dependency" matching as :id.

router.get(
  "/workflows/:id/dependency",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [wf] = await db
      .select({
        id:      workflowDefinitionsTable.id,
        name:    workflowDefinitionsTable.name,
        version: workflowDefinitionsTable.version,
        steps:   workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    const steps  = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];
    const result = analyzeDependencies(steps, {
      workflowId:      wf.id,
      workspaceId:     req.workspaceId,
      workflowVersion: wf.version ?? undefined,
    });

    req.log.info(
      {
        event:           "workflow_dependency_requested",
        workflowId:      wf.id,
        workspaceId:     req.workspaceId,
        convergenceCount: result.dependencyGraph.convergenceNodes.length,
        bottleneckCount:  result.dependencyGraph.bottleneckNodes.length,
        complexityScore:  result.pressure.operationalComplexityScore,
        riskLevel:        result.risk.level,
        actorId:          req.userId,
      },
      "GET /workflows/:id/dependency",
    );

    res.json({
      workflowId:      wf.id,
      workflowName:    wf.name,
      stepCount:       steps.length,
      dependencyGraph: result.dependencyGraph,
      pressure:        result.pressure,
      risk:            result.risk,
    });
  },
);

// ── GET /workflows/:id/topology (P8-A) ────────────────────────────────────────
//
// Static topology analysis for a workflow definition.
// Extracts the node/edge graph, classifies node sets (branching, approval,
// delay, unreachable, isolated), computes structural complexity analytics,
// and returns a deterministic risk assessment.
//
// READ-ONLY: never mutates the workflow, never triggers execution, never
// invokes the scheduler or executor.
//
// Registered BEFORE GET /workflows/:id to prevent "topology" matching as :id.

router.get(
  "/workflows/:id/topology",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [wf] = await db
      .select({
        id:      workflowDefinitionsTable.id,
        name:    workflowDefinitionsTable.name,
        version: workflowDefinitionsTable.version,
        steps:   workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

    const steps   = Array.isArray(wf.steps) ? (wf.steps as unknown[]) : [];
    const result  = analyzeTopology(steps, {
      workflowId:      wf.id,
      workspaceId:     req.workspaceId,
      workflowVersion: wf.version ?? undefined,
    });

    req.log.info(
      {
        event:        "workflow_topology_requested",
        workflowId:   wf.id,
        workspaceId:  req.workspaceId,
        nodeCount:    result.analytics.nodeCount,
        riskLevel:    result.risk.level,
        actorId:      req.userId,
      },
      "GET /workflows/:id/topology",
    );

    res.json({
      workflowId:   wf.id,
      workflowName: wf.name,
      stepCount:    steps.length,
      graph:        result.graph,
      analytics:    result.analytics,
      risk:         result.risk,
    });
  },
);

// ── GET /workflows/:id - requires "workflow.view" OR "workflows.<id>.view" ───

router.get(
  "/workflows/:id",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [workflow] = await db
      .select({
        id:            workflowDefinitionsTable.id,
        workspaceId:   workflowDefinitionsTable.workspaceId,
        key:           workflowDefinitionsTable.key,
        name:          workflowDefinitionsTable.name,
        nameAr:        workflowDefinitionsTable.nameAr,
        description:   workflowDefinitionsTable.description,
        descriptionAr: workflowDefinitionsTable.descriptionAr,
        module:        workflowDefinitionsTable.module,
        triggerEvent:  workflowDefinitionsTable.triggerEvent,
        isActive:      workflowDefinitionsTable.isActive,
        status:        workflowDefinitionsTable.status,
        conditions:    workflowDefinitionsTable.conditions,
        steps:         workflowDefinitionsTable.steps,
        createdAt:     workflowDefinitionsTable.createdAt,
        updatedAt:     workflowDefinitionsTable.updatedAt,
        archivedAt:    workflowDefinitionsTable.archivedAt,
        deletedAt:     workflowDefinitionsTable.deletedAt,
        executionCount: sql<number>`(
          select count(*)::int from workflow_executions
          where workflow_id = ${workflowDefinitionsTable.id}
        )`,
        lastExecutedAt: sql<string | null>`(
          select started_at from workflow_executions
          where workflow_id = ${workflowDefinitionsTable.id}
          order by started_at desc limit 1
        )`,
      })
      .from(workflowDefinitionsTable)
      .where(and(
        eq(workflowDefinitionsTable.id, id),
        wsCond(req),
        isNull(workflowDefinitionsTable.deletedAt),
      ));

    if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }

    const recentExecutions = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        context:          workflowExecutionsTable.context,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(eq(workflowExecutionsTable.workflowId, id))
      .orderBy(desc(workflowExecutionsTable.startedAt))
      .limit(10);

    res.json({ workflow, recentExecutions });
  },
);

// ── PATCH /workflows/:id (P3-F: immutable active guard) ──────────────────────
//
// Editing an active workflow is blocked to prevent runtime inconsistencies.
// The engine loads steps at execution time from the DB; changing steps under
// a running workflow can corrupt in-progress executions or silently break
// expected automation behavior.
//
// To edit an active workflow:
//   1. PATCH /workflows/:id/... is NOT available.
//   2. The admin must deactivate the workflow (set status='deprecated'),
//      edit it, then POST /workflows/:id/activate to re-validate and re-publish.
//
// Only 'draft' and 'deprecated' workflows are editable.
// Soft-deleted (archived) workflows are also immutable.

router.patch(
  "/workflows/:id",
  requireAuth,
  requirePermission(req => ["workflow.manage", `workflows.${req.params["id"]}.manage`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // P3-F: Check current status before allowing edits.
    const [existing] = await db
      .select({ status: workflowDefinitionsTable.status, deletedAt: workflowDefinitionsTable.deletedAt })
      .from(workflowDefinitionsTable)
      .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)));

    if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }

    if (existing.deletedAt !== null) {
      res.status(422).json({
        error: "Cannot edit an archived workflow. Archived workflows are immutable to preserve execution history.",
        code:  "WORKFLOW_ARCHIVED",
      });
      return;
    }

    if (existing.status === "active") {
      res.status(422).json({
        error: "Cannot edit an active workflow. Deactivate it first (status: deprecated), then re-activate after editing.",
        code:  "WORKFLOW_IMMUTABLE_ACTIVE",
        hint:  "PATCH the workflow with { status: 'deprecated' } to deactivate, then edit and POST /activate to re-publish.",
      });
      return;
    }

    const { name, nameAr, description, descriptionAr, status, conditions, steps } =
      req.body as Record<string, unknown>;

    const updates: Partial<{
      name: string; nameAr: string | null; description: string | null;
      descriptionAr: string | null; status: string; isActive: boolean;
      conditions: unknown; steps: unknown;
    }> = {};

    if (name          !== undefined) updates.name          = String(name);
    if (nameAr        !== undefined) updates.nameAr        = nameAr        ? String(nameAr)        : null;
    if (description   !== undefined) updates.description   = description   ? String(description)   : null;
    if (descriptionAr !== undefined) updates.descriptionAr = descriptionAr ? String(descriptionAr) : null;
    if (conditions    !== undefined) updates.conditions    = conditions;
    if (steps         !== undefined) updates.steps         = steps;

    // Allow transitioning from 'active' → 'deprecated' (deactivation).
    // Allow transitioning from 'draft' → 'deprecated' (manual deprecation).
    // Block any other status transitions via PATCH - use /activate for 'active'.
    if (status !== undefined) {
      const allowedTransitions: Record<string, string[]> = {
        draft:       ["deprecated"],
        deprecated:  ["draft"],
        active:      ["deprecated"],
        archived:    [],
      };
      const allowed = allowedTransitions[existing.status] ?? [];
      if (!allowed.includes(String(status))) {
        res.status(422).json({
          error: `Cannot transition from '${existing.status}' to '${String(status)}'. Use POST /activate to publish, or set status='deprecated' to deactivate.`,
          code:  "INVALID_STATUS_TRANSITION",
        });
        return;
      }
      updates.status   = String(status);
      updates.isActive = String(status) === "active";
      // Sync isActive off when transitioning away from active.
      if (String(status) === "deprecated") updates.isActive = false;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    // P5-E: When transitioning to 'deprecated', we need to close the active
    // version row inside a transaction to maintain the active-version invariant:
    //   status!='active' ↔ currentVersionId IS NULL ↔ no open version row.
    const isDeprecation = updates.status === "deprecated";

    let updated: typeof workflowDefinitionsTable.$inferSelect | undefined;

    if (isDeprecation) {
      // Re-read currentVersionId inside the transaction to be safe.
      const [current] = await db
        .select({
          currentVersionId: workflowDefinitionsTable.currentVersionId,
          version:          workflowDefinitionsTable.version,
        })
        .from(workflowDefinitionsTable)
        .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)));

      updated = await db.transaction(async (tx) => {
        // Close the active version row (deactivated_at, deactivated_by).
        if (current?.currentVersionId) {
          await tx
            .update(workflowDefinitionVersionsTable)
            .set({
              deactivatedAt: new Date(),
              deactivatedBy: req.userId ?? null,
            })
            .where(and(
              eq(workflowDefinitionVersionsTable.id, current.currentVersionId),
              eq(workflowDefinitionVersionsTable.workspaceId, req.workspaceId!),
            ));
        }

        // Update the definition: clear currentVersionId, set deprecated.
        const [row] = await tx
          .update(workflowDefinitionsTable)
          .set({
            ...(updates as any),
            currentVersionId: null,
          })
          .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)))
          .returning();

        return row;
      });

      if (!updated) { res.status(404).json({ error: "Workflow not found" }); return; }

      // P5-E: Emit workflow_deprecated observability event.
      req.log.info(
        {
          event:       "workflow_deprecated",
          workflowId:  id,
          workspaceId: req.workspaceId,
          deprecatedBy: req.userId,
          version:     current?.version ?? null,
          versionId:   current?.currentVersionId ?? null,
        },
        "[governance] Workflow deprecated - active version closed",
      );
    } else {
      const [row] = await db
        .update(workflowDefinitionsTable)
        .set(updates as any)
        .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)))
        .returning();
      updated = row;
      if (!updated) { res.status(404).json({ error: "Workflow not found" }); return; }
    }

    res.json(updated);
  },
);

// ── DELETE /workflows/:id (P3-E: soft delete) ────────────────────────────────
//
// Workflows are NEVER hard-deleted.  Hard deletion would destroy execution
// history records (workflowId FK → cascade) which is audit data.
//
// Soft delete sets:
//   status    = 'archived'
//   isActive  = false
//   deletedAt = now()
//   archivedAt = now()
//
// Soft-deleted workflows:
//   - Are excluded from GET /workflows and GET /workflows/:id list queries.
//   - Are excluded from the engine's trigger query (deletedAt IS NULL filter).
//   - Retain all execution history rows (no cascade on workflowId).
//   - Cannot be edited or re-activated (immutable once archived).
//
// Idempotent: deleting an already-archived workflow returns 204 without error.

router.delete(
  "/workflows/:id",
  requireAuth,
  requirePermission(req => ["workflow.manage", `workflows.${req.params["id"]}.manage`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Check if the workflow exists (including already-archived ones for idempotency).
    const [existing] = await db
      .select({ id: workflowDefinitionsTable.id, deletedAt: workflowDefinitionsTable.deletedAt })
      .from(workflowDefinitionsTable)
      .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)));

    if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }

    // Idempotent: already archived → return 204 without re-updating.
    if (existing.deletedAt !== null) {
      res.sendStatus(204);
      return;
    }

    // Soft delete: mark as archived, do NOT remove the row.
    const now = new Date();
    await db
      .update(workflowDefinitionsTable)
      .set({
        status:     "archived",
        isActive:   false,
        deletedAt:  now,
        archivedAt: now,
      })
      .where(and(eq(workflowDefinitionsTable.id, id), wsCond(req)));

    res.sendStatus(204);
  },
);

// ── GET /workflows/:id/executions ─────────────────────────────────────────────

router.get(
  "/workflows/:id/executions",
  requireAuth,
  requirePermission(req => ["workflow.view", `workflows.${req.params["id"]}.view`]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id     = parseInt(String(req.params.id ?? ""), 10);
    const page   = Math.max(1, Number(req.query["page"])  || 1);
    const limit  = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
    const offset = (page - 1) * limit;

    const where = and(
      eq(workflowExecutionsTable.workflowId,  id),
      eq(workflowExecutionsTable.workspaceId, req.workspaceId),
    );

    const [totalRow] = await db.select({ count: count() }).from(workflowExecutionsTable).where(where);

    const rows = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        context:          workflowExecutionsTable.context,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(desc(workflowExecutionsTable.startedAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, total: totalRow?.count ?? 0, page, limit });
  },
);

// ── GET /workflow-executions ──────────────────────────────────────────────────
// Legacy flat path - kept for backward compat.

router.get(
  "/workflow-executions",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const page   = Math.max(1, Number(req.query["page"])  || 1);
    const limit  = Math.min(100, Math.max(1, Number(req.query["limit"]) || 30));
    const offset = (page - 1) * limit;
    const status = req.query["status"] as string | undefined;

    const conds = [eq(workflowExecutionsTable.workspaceId, req.workspaceId)];
    if (status) conds.push(eq(workflowExecutionsTable.status, status));
    const where = and(...conds);

    const [totalRow] = await db.select({ count: count() }).from(workflowExecutionsTable).where(where);

    const rows = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        context:          workflowExecutionsTable.context,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(desc(workflowExecutionsTable.startedAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, total: totalRow?.count ?? 0, page, limit });
  },
);

// ── GET /workflow-executions/:id/steps ────────────────────────────────────────
// Legacy flat path - kept for backward compat.

router.get(
  "/workflow-executions/:id/steps",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [execution] = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        workflowName:     sql<string | null>`${workflowDefinitionsTable.name}`,
        workflowKey:      sql<string | null>`${workflowDefinitionsTable.key}`,
        triggeredBy:      workflowExecutionsTable.triggeredBy,
        triggeredByName:  sql<string | null>`${usersTable.fullName}`,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        totalSteps:       sql<number>`jsonb_array_length(${workflowDefinitionsTable.steps})`,
        context:          workflowExecutionsTable.context,
        error:            workflowExecutionsTable.error,
        startedAt:        workflowExecutionsTable.startedAt,
        completedAt:      workflowExecutionsTable.completedAt,
      })
      .from(workflowExecutionsTable)
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id))
      .leftJoin(usersTable, eq(workflowExecutionsTable.triggeredBy, usersTable.id))
      .where(
        and(
          eq(workflowExecutionsTable.id,          id),
          eq(workflowExecutionsTable.workspaceId, req.workspaceId),
        ),
      );

    if (!execution) { res.status(404).json({ error: "Execution not found" }); return; }

    const steps = await db
      .select()
      .from(workflowExecutionStepsTable)
      .where(eq(workflowExecutionStepsTable.executionId, id))
      .orderBy(workflowExecutionStepsTable.stepIndex);

    res.json({ execution, steps });
  },
);

// ── GET /workflow-tasks ───────────────────────────────────────────────────────

router.get(
  "/workflow-tasks",
  requireAuth,
  requirePermission("workflow.view"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const status     = req.query["status"]     as string | undefined;
    const assigneeId = req.query["assigneeId"] as string | undefined;

    const conds = [eq(workflowTasksTable.workspaceId, req.workspaceId)];
    if (status)     conds.push(eq(workflowTasksTable.status, status));
    if (assigneeId) conds.push(eq(workflowTasksTable.assigneeId, parseInt(assigneeId, 10)));

    const rows = await db
      .select({
        id:           workflowTasksTable.id,
        workspaceId:  workflowTasksTable.workspaceId,
        executionId:  workflowTasksTable.executionId,
        workflowName: sql<string | null>`${workflowDefinitionsTable.name}`,
        stepIndex:    workflowTasksTable.stepIndex,
        title:        workflowTasksTable.title,
        description:  workflowTasksTable.description,
        assigneeId:   workflowTasksTable.assigneeId,
        assigneeName: sql<string | null>`${usersTable.fullName}`,
        dueDate:      workflowTasksTable.dueDate,
        priority:     workflowTasksTable.priority,
        status:       workflowTasksTable.status,
        createdAt:    workflowTasksTable.createdAt,
        completedAt:  workflowTasksTable.completedAt,
      })
      .from(workflowTasksTable)
      .leftJoin(workflowExecutionsTable,  eq(workflowTasksTable.executionId,     workflowExecutionsTable.id))
      .leftJoin(workflowDefinitionsTable, eq(workflowExecutionsTable.workflowId,  workflowDefinitionsTable.id))
      .leftJoin(usersTable,               eq(workflowTasksTable.assigneeId,       usersTable.id))
      .where(and(...conds))
      .orderBy(desc(workflowTasksTable.createdAt));

    res.json(rows);
  },
);

// ── POST /workflows/executions/:id/approve ───────────────────────────────────
//
// P4-E: Approve a workflow execution that is paused at an approval step.
//
// Flow:
//   1. Validate execution exists and belongs to caller's workspace.
//   2. Validate status is 'waiting_approval' (422 if not).
//   3. Check no existing approval record for this (executionId, stepIndex) (409).
//   4. Call resumeExecution() - performs guarded waiting_approval→running UPDATE.
//   5. If guarded UPDATE wins → approval record inserted, loop re-entered.
//   6. Respond immediately with { executionId, approved: true, resumeStarted: true }.
//      Caller polls GET /executions/:id to observe status changes.
//
// Permissions: requireAuth + requirePermission("workflow.manage")
// Scope: workspace-isolated (cannot approve executions from other workspaces).

router.post(
  "/workflows/executions/:id/approve",
  requireAuth,
  requirePermission("workflow.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid execution ID" }); return; }

    const { notes } = req.body as { notes?: string };

    // ── Validate execution (workspace-scoped) ──────────────────────────────
    //
    // P5-F: Also fetch timeoutAt + workflowVersion for TTL pre-check and
    // version linkage in the response.
    const [existing] = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        cancelRequested:  workflowExecutionsTable.cancelRequested,
        timeoutAt:        workflowExecutionsTable.timeoutAt,
        workflowVersion:  workflowExecutionsTable.workflowVersion,
      })
      .from(workflowExecutionsTable)
      .where(and(
        eq(workflowExecutionsTable.id,          id),
        eq(workflowExecutionsTable.workspaceId, req.workspaceId),
      ));

    if (!existing) {
      res.status(404).json({ error: "Execution not found" }); return;
    }

    if (isTerminalStatus(existing.status)) {
      res.status(422).json({
        error:         `Execution is already in terminal status '${existing.status}'.`,
        code:          "EXECUTION_ALREADY_TERMINAL",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    if (existing.status !== "waiting_approval") {
      res.status(422).json({
        error:         `Execution is in status '${existing.status}', not 'waiting_approval'.`,
        code:          "EXECUTION_NOT_WAITING_APPROVAL",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    if (existing.cancelRequested) {
      res.status(409).json({
        error:         "Cancellation has been requested for this execution. Cannot approve a cancelled execution.",
        code:          "EXECUTION_CANCEL_REQUESTED",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    // ── P5-F: TTL expiry pre-check ─────────────────────────────────────────
    //
    // Reject the approval at the route layer if the deadline has already passed.
    // The executor enforces this too, but catching it here provides a cleaner
    // HTTP 422 response and avoids a full context-rebuild round-trip.
    if (isExecutionTimedOut(existing.timeoutAt)) {
      req.log.warn(
        {
          executionId:   id,
          workflowId:    existing.workflowId,
          workspaceId:   existing.workspaceId,
          workflowVersion: existing.workflowVersion ?? null,
          approvedBy:    req.userId,
          timeoutAt:     existing.timeoutAt,
          action:        "approval_resume_blocked_ttl_expired",
        },
        "[governance] P5-F: Approve request rejected - execution TTL expired (route pre-check)",
      );
      res.status(422).json({
        error:       "The execution deadline has passed. This approval can no longer be processed.",
        code:        "EXECUTION_TTL_EXPIRED",
        executionId: id,
        timeoutAt:   existing.timeoutAt?.toISOString() ?? null,
      }); return;
    }

    // ── Check for existing approval decision on this step (pre-flight) ─────
    // This is an optimization for a better error message.
    // The guarded UPDATE in resumeExecution() is the actual atomicity gate.
    const [existingDecision] = await db
      .select({ id: workflowApprovalsTable.id, action: workflowApprovalsTable.action })
      .from(workflowApprovalsTable)
      .where(and(
        eq(workflowApprovalsTable.executionId, id),
        eq(workflowApprovalsTable.stepIndex,   existing.currentStepIndex),
      ));

    if (existingDecision) {
      // P5-F: Structured audit event for replay prevention detection.
      req.log.warn(
        {
          executionId:     id,
          workflowId:      existing.workflowId,
          workspaceId:     existing.workspaceId,
          workflowVersion: existing.workflowVersion ?? null,
          approvedBy:      req.userId,
          existingAction:  existingDecision.action,
          existingId:      existingDecision.id,
          stepIndex:       existing.currentStepIndex,
          action:          "approval_replay_prevented",
        },
        "[governance] P5-F: Duplicate approval attempt blocked - decision already recorded",
      );
      res.status(409).json({
        error:      `This approval step has already been decided (action: '${existingDecision.action}').`,
        code:       "APPROVAL_ALREADY_DECIDED",
        action:     existingDecision.action,
        stepIndex:  existing.currentStepIndex,
        executionId: id,
      }); return;
    }

    // ── Call resumeExecution (guarded transition + context rebuild + loop) ─
    const result = await resumeExecution(id, req.userId!, notes);

    if (!result.success) {
      // Map resumeExecution result codes to HTTP responses.
      if (result.code === "EXECUTION_ALREADY_TERMINAL") {
        res.status(422).json({
          error:       "Execution reached a terminal state before approval could be applied.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      if (result.code === "EXECUTION_CANCEL_REQUESTED") {
        res.status(409).json({
          error:       "Cancellation was requested for this execution. Cannot approve.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      if (result.code === "EXECUTION_TTL_EXPIRED") {
        res.status(422).json({
          error:       "The execution deadline passed between the pre-check and the guarded transition. Please check the current execution status.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      // TRANSITION_RACE_LOST - concurrent approve/reject/timeout won the race.
      res.status(409).json({
        error:       "A concurrent operation changed the execution state before the approval could be applied. Please re-fetch the current status.",
        code:        result.code ?? "TRANSITION_RACE_LOST",
        executionId: id,
      }); return;
    }

    req.log.info(
      {
        executionId:     id,
        workflowId:      existing.workflowId,
        workspaceId:     existing.workspaceId,
        workflowVersion: existing.workflowVersion ?? null,
        approvedBy:      req.userId,
        stepIndex:       existing.currentStepIndex,
        notes,
        action:          "execution_approved",
      },
      "[governance] P5-F: Workflow execution approved via API",
    );

    res.json({
      executionId:       id,
      workflowId:        existing.workflowId,
      workflowVersion:   existing.workflowVersion ?? null,
      previousStatus:    "waiting_approval",
      approvalStepIndex: result.approvalStepIndex,
      approved:          true,
      resumeStarted:     true,
      approvedAt:        new Date().toISOString(),
    });
  },
);

// ── POST /workflows/executions/:id/reject ────────────────────────────────────
//
// P4-E: Reject a workflow execution paused at an approval step.
//
// Flow:
//   1. Validate execution exists and belongs to caller's workspace.
//   2. Validate status is 'waiting_approval' (422 if not).
//   3. Check no existing approval decision for this step (409).
//   4. Call rejectExecution() - performs guarded waiting_approval→failed UPDATE.
//   5. If guarded UPDATE wins → approval record inserted (action='rejected').
//   6. Respond with { executionId, rejected: true, status: 'failed' }.
//
// WHY status='failed' (NOT A NEW 'rejected' STATUS):
//   'failed' already covers "could not complete" semantics.  No new terminal
//   status, no schema changes beyond the workflow_approvals record.
//   The rejection reason is stored in workflow_executions.error and in the
//   workflow_approvals row (action='rejected', notes).
//
// Permissions: requireAuth + requirePermission("workflow.manage")
// Scope: workspace-isolated.

router.post(
  "/workflows/executions/:id/reject",
  requireAuth,
  requirePermission("workflow.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid execution ID" }); return; }

    const { notes } = req.body as { notes?: string };

    // ── Validate execution (workspace-scoped) ──────────────────────────────
    //
    // P5-F: Also fetch timeoutAt, cancelRequested, workflowVersion for TTL
    // pre-check, cancel check, and version linkage in the response.
    const [existing] = await db
      .select({
        id:               workflowExecutionsTable.id,
        workspaceId:      workflowExecutionsTable.workspaceId,
        workflowId:       workflowExecutionsTable.workflowId,
        status:           workflowExecutionsTable.status,
        currentStepIndex: workflowExecutionsTable.currentStepIndex,
        cancelRequested:  workflowExecutionsTable.cancelRequested,
        timeoutAt:        workflowExecutionsTable.timeoutAt,
        workflowVersion:  workflowExecutionsTable.workflowVersion,
      })
      .from(workflowExecutionsTable)
      .where(and(
        eq(workflowExecutionsTable.id,          id),
        eq(workflowExecutionsTable.workspaceId, req.workspaceId),
      ));

    if (!existing) {
      res.status(404).json({ error: "Execution not found" }); return;
    }

    if (isTerminalStatus(existing.status)) {
      res.status(422).json({
        error:         `Execution is already in terminal status '${existing.status}'.`,
        code:          "EXECUTION_ALREADY_TERMINAL",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    if (existing.status !== "waiting_approval") {
      res.status(422).json({
        error:         `Execution is in status '${existing.status}', not 'waiting_approval'.`,
        code:          "EXECUTION_NOT_WAITING_APPROVAL",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    // P5-F: Reject if cancellation was already requested.
    if (existing.cancelRequested) {
      res.status(409).json({
        error:         "Cancellation has been requested for this execution. Cannot reject a cancelled execution.",
        code:          "EXECUTION_CANCEL_REQUESTED",
        currentStatus: existing.status,
        executionId:   id,
      }); return;
    }

    // ── P5-F: TTL expiry pre-check ─────────────────────────────────────────
    if (isExecutionTimedOut(existing.timeoutAt)) {
      req.log.warn(
        {
          executionId:     id,
          workflowId:      existing.workflowId,
          workspaceId:     existing.workspaceId,
          workflowVersion: existing.workflowVersion ?? null,
          rejectedBy:      req.userId,
          timeoutAt:       existing.timeoutAt,
          action:          "approval_rejection_blocked_ttl_expired",
        },
        "[governance] P5-F: Reject request refused - execution TTL expired (route pre-check)",
      );
      res.status(422).json({
        error:       "The execution deadline has passed. This rejection can no longer be processed.",
        code:        "EXECUTION_TTL_EXPIRED",
        executionId: id,
        timeoutAt:   existing.timeoutAt?.toISOString() ?? null,
      }); return;
    }

    // ── Check for existing approval decision on this step (pre-flight) ─────
    const [existingDecision] = await db
      .select({ id: workflowApprovalsTable.id, action: workflowApprovalsTable.action })
      .from(workflowApprovalsTable)
      .where(and(
        eq(workflowApprovalsTable.executionId, id),
        eq(workflowApprovalsTable.stepIndex,   existing.currentStepIndex),
      ));

    if (existingDecision) {
      // P5-F: Structured audit event for replay prevention detection.
      req.log.warn(
        {
          executionId:     id,
          workflowId:      existing.workflowId,
          workspaceId:     existing.workspaceId,
          workflowVersion: existing.workflowVersion ?? null,
          rejectedBy:      req.userId,
          existingAction:  existingDecision.action,
          existingId:      existingDecision.id,
          stepIndex:       existing.currentStepIndex,
          action:          "approval_replay_prevented",
        },
        "[governance] P5-F: Duplicate rejection attempt blocked - decision already recorded",
      );
      res.status(409).json({
        error:       `This approval step has already been decided (action: '${existingDecision.action}').`,
        code:        "APPROVAL_ALREADY_DECIDED",
        action:      existingDecision.action,
        stepIndex:   existing.currentStepIndex,
        executionId: id,
      }); return;
    }

    // ── Call rejectExecution (guarded transition) ──────────────────────────
    const result = await rejectExecution(id, req.userId!, notes);

    if (!result.success) {
      if (result.code === "EXECUTION_ALREADY_TERMINAL") {
        res.status(422).json({
          error:       "Execution reached a terminal state before rejection could be applied.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      if (result.code === "EXECUTION_TTL_EXPIRED") {
        res.status(422).json({
          error:       "The execution deadline passed between the pre-check and the guarded transition. Please check the current execution status.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      if (result.code === "EXECUTION_CANCEL_REQUESTED") {
        res.status(409).json({
          error:       "Cancellation was requested for this execution. Cannot reject.",
          code:        result.code,
          executionId: id,
        }); return;
      }
      res.status(409).json({
        error:       "A concurrent operation changed the execution state before rejection could be applied.",
        code:        result.code ?? "TRANSITION_RACE_LOST",
        executionId: id,
      }); return;
    }

    req.log.warn(
      {
        executionId:     id,
        workflowId:      existing.workflowId,
        workspaceId:     existing.workspaceId,
        workflowVersion: existing.workflowVersion ?? null,
        rejectedBy:      req.userId,
        stepIndex:       existing.currentStepIndex,
        notes,
        action:          "execution_rejected",
      },
      "[governance] P5-F: Workflow execution rejected via API",
    );

    res.json({
      executionId:       id,
      workflowId:        existing.workflowId,
      workflowVersion:   existing.workflowVersion ?? null,
      previousStatus:    "waiting_approval",
      approvalStepIndex: result.approvalStepIndex,
      rejected:          true,
      status:            "failed",
      rejectedAt:        new Date().toISOString(),
      notes:             notes ?? null,
    });
  },
);

// ── GET /workflows/executions/:id/approvals ───────────────────────────────────
//
// P4-E: Returns all approval decisions recorded for a specific execution.
// Useful for audit trail display in the UI and for operational debugging.
//
// Permissions: requireAuth (any workspace member can view approval history).
// Scope: workspace-isolated.

router.get(
  "/workflows/executions/:id/approvals",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid execution ID" }); return; }

    // Validate execution belongs to this workspace.
    const [execution] = await db
      .select({ id: workflowExecutionsTable.id })
      .from(workflowExecutionsTable)
      .where(and(
        eq(workflowExecutionsTable.id,          id),
        eq(workflowExecutionsTable.workspaceId, req.workspaceId),
      ));

    if (!execution) {
      res.status(404).json({ error: "Execution not found" }); return;
    }

    const approvals = await db
      .select({
        id:         workflowApprovalsTable.id,
        stepIndex:  workflowApprovalsTable.stepIndex,
        stepName:   workflowApprovalsTable.stepName,
        action:     workflowApprovalsTable.action,
        notes:      workflowApprovalsTable.notes,
        decidedAt:  workflowApprovalsTable.decidedAt,
        decidedBy: {
          id:       usersTable.id,
          fullName: usersTable.fullName,
        },
      })
      .from(workflowApprovalsTable)
      .leftJoin(usersTable, eq(workflowApprovalsTable.decidedBy, usersTable.id))
      .where(eq(workflowApprovalsTable.executionId, id))
      .orderBy(workflowApprovalsTable.decidedAt);

    res.json({ executionId: id, approvals });
  },
);

// ── PATCH /workflow-tasks/:id ─────────────────────────────────────────────────

router.patch(
  "/workflow-tasks/:id",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { status } = req.body as { status?: string };
    if (!status) { res.status(400).json({ error: "status is required" }); return; }

    const completedAt = ["completed", "cancelled"].includes(status) ? new Date() : null;

    const [updated] = await db
      .update(workflowTasksTable)
      .set({ status, ...(completedAt ? { completedAt } : {}) })
      .where(
        and(
          eq(workflowTasksTable.id,          id),
          eq(workflowTasksTable.workspaceId, req.workspaceId),
        ),
      )
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  },
);

export default router;
