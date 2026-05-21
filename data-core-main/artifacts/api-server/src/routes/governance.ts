/**
 * @file   routes/governance.ts
 * @phase  P6-D / P7-A - Governance APIs & Historical Snapshot Infrastructure
 *
 * P6-D read-only endpoints (current state):
 *   GET /governance/health   - full tenant health snapshot (compact)
 *   GET /governance/metrics  - aggregate execution metrics
 *   GET /governance/stuck    - stuck execution list
 *   GET /governance/alerts   - paginated governance alert list
 *   POST /governance/events  - dashboard observability event (log-only)
 *
 * P7-A historical snapshot endpoints:
 *   GET  /governance/snapshots                - trend data (1h/24h/7d/30d)
 *   POST /governance/snapshots/capture        - capture + persist a snapshot now
 *   GET  /governance/snapshots/chronic-alerts - alert frequency intelligence
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   P6-D endpoints: READ-ONLY - zero DB mutations.
 *   P7-A capture endpoint: APPEND-ONLY - only INSERTs new snapshot rows.
 *     • Never UPDATEs or DELETEs governance_snapshots rows.
 *     • Never mutates workflow_executions or any runtime state.
 *   P7-A read endpoints: READ-ONLY - zero DB mutations.
 *
 * ── ACCESS CONTROL ───────────────────────────────────────────────────────────
 *
 *   All endpoints require:
 *     • requireAuth           - valid JWT
 *     • requireWorkspaceAdmin - workspace admin or higher role
 *
 * ── OBSERVABILITY ─────────────────────────────────────────────────────────────
 *
 *   P6-D events: governance_api_*_requested
 *   P7-A events: governance_snapshot_captured, governance_trend_query_requested,
 *                governance_chronic_alert_detected (emitted inside the history module)
 */

import { Router, type Response } from "express";
import { db } from "@workspace/db";
import {
  requireAuth,
  requireWorkspaceAdmin,
  type AuthRequest,
} from "../middlewares/requireAuth";
import {
  evaluateTenantHealth,
  computeOperationalMetrics,
  detectStuckExecutions,
  serializeHealthResponse,
  serializeMetricsResponse,
  serializeStuckResponse,
  serializeAlertsResponse,
  GOVERNANCE_ACTION_HEALTH_REQUESTED,
  GOVERNANCE_ACTION_METRICS_REQUESTED,
  GOVERNANCE_ACTION_STUCK_REQUESTED,
  GOVERNANCE_ACTION_ALERTS_REQUESTED,
  MAX_ALERTS_PAGE,
} from "../lib/workflows/governance";
import {
  captureGovernanceSnapshot,
  querySnapshotsByRange,
  serializeSnapshotTrendResponse,
  serializeChronicAlertsResponse,
  GOVERNANCE_ACTION_TREND_QUERY_REQUESTED,
  type TrendRange,
  type StoredSnapshot,
} from "../lib/workflows/governance-history";
import {
  querySnapshotsInBucket,
  queryRollupsByRange,
  type StoredRollup,
} from "../lib/workflows/governance-rollup";
import {
  validateTrendRange,
  serializeSeverityFromSnapshots,
  serializeSeverityFromRollups,
  serializeErrorRateFromSnapshots,
  serializeErrorRateFromRollups,
  serializeBacklogsFromSnapshots,
  serializeBacklogsFromRollups,
  serializeStormsFromSnapshots,
  serializeStormsFromRollups,
  truncateTrendPoints,
  buildTrendEnvelope,
  trendLayerLabel,
  TREND_ACTION_REQUESTED,
  TREND_ACTION_RESOLVED,
  TREND_ACTION_REJECTED,
  TREND_ACTION_TRUNCATED,
  type TrendType,
  type TrendQueryContext,
} from "../lib/workflows/governance-trends";

/** Valid frontend observability actions emitted via POST /governance/events. */
const VALID_DASHBOARD_ACTIONS = new Set([
  "governance_dashboard_loaded",
  "governance_dashboard_refreshed",
  "governance_alert_viewed",
  "governance_stuck_table_viewed",
  "historical_dashboard_loaded",
  "historical_dashboard_range_changed",
  "historical_chart_rendered",
  "historical_truncation_warning_shown",
] as const);

const router = Router();

// ── GET /governance/health ────────────────────────────────────────────────────
//
// Returns a compact TenantHealthSummary for the authenticated workspace:
//   • Overall severity (healthy / warning / degraded / critical)
//   • Per-dimension indicators (executionPressure, errorConcentration, etc.)
//   • Up to 10 active governance alerts (use /governance/alerts for full list)
//   • Stuck execution count (use /governance/stuck for detail)
//   • Storm severity from the rolling-window detector
//   • Key metric summary for at-a-glance dashboard display
//
// Does NOT return raw execution rows, stepsSnapshot, context, or error fields.
//
router.get(
  "/governance/health",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const now     = new Date();
    const summary = await evaluateTenantHealth(req.workspaceId, db, now);
    const body    = serializeHealthResponse(summary);

    req.log.info(
      {
        workspaceId:      req.workspaceId,
        actorId:          req.userId,
        resultCounts:     {
          alertCount:   summary.alerts.length,
          stuckCount:   summary.stuckExecutions.length,
          stormCount:   summary.stormResult.count,
        },
        responseSeverity: summary.severity,
        action:           GOVERNANCE_ACTION_HEALTH_REQUESTED,
      },
      "[governance] P6-D: Health snapshot requested",
    );

    res.json(body);
  },
);

// ── GET /governance/metrics ───────────────────────────────────────────────────
//
// Returns an OperationalMetricsSnapshot for the authenticated workspace,
// structured for future dashboard compatibility:
//
//   counts      - execution counts by status bucket
//   backlog     - approval + delay backlog counts
//   performance - average duration + error rate
//
// Covers the last 24h for recent (terminal) counts; active executions are
// unbounded by age.
//
router.get(
  "/governance/metrics",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const now     = new Date();
    const metrics = await computeOperationalMetrics(req.workspaceId, db, now);
    const body    = serializeMetricsResponse(metrics);

    req.log.info(
      {
        workspaceId:      req.workspaceId,
        actorId:          req.userId,
        resultCounts:     {
          active:        metrics.activeExecutions,
          failed:        metrics.failedExecutions,
          waitingTotal:  metrics.waitingApprovalCount + metrics.waitingDelayCount,
          approvalBacklog: metrics.approvalBacklogCount,
          delayBacklog:    metrics.delayBacklogCount,
        },
        responseSeverity: metrics.workflowErrorRate >= 0.5 ? "critical"
                        : metrics.workflowErrorRate >= 0.2 ? "warning" : "healthy",
        action:           GOVERNANCE_ACTION_METRICS_REQUESTED,
      },
      "[governance] P6-D: Metrics requested",
    );

    res.json(body);
  },
);

// ── GET /governance/stuck ─────────────────────────────────────────────────────
//
// Returns a list of stuck executions in the authenticated workspace.
// Sorted by overdueMs descending (most overdue first).
// Capped at MAX_STUCK_RESULTS (100); truncated=true when more exist.
//
// Each entry includes:
//   executionId, workflowId, status, stuckReason, stuckDurationMs,
//   overdueMs, severity ("warning" | "critical")
//
// No raw execution context, stepsSnapshot, or error payloads are returned.
//
router.get(
  "/governance/stuck",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const now   = new Date();
    const stuck = await detectStuckExecutions(req.workspaceId, db, now);
    const body  = serializeStuckResponse(stuck, now);

    req.log.info(
      {
        workspaceId:      req.workspaceId,
        actorId:          req.userId,
        resultCounts:     {
          stuckCount: stuck.length,
          truncated:  body.truncated,
        },
        responseSeverity: stuck.length === 0      ? "healthy"
                        : stuck.length >= 5       ? "critical" : "warning",
        action:           GOVERNANCE_ACTION_STUCK_REQUESTED,
      },
      "[governance] P6-D: Stuck executions requested",
    );

    res.json(body);
  },
);

// ── GET /governance/alerts ────────────────────────────────────────────────────
//
// Returns paginated governance alerts for the authenticated workspace.
//
// Query parameters:
//   ?page=1     - page number (default: 1)
//   ?limit=20   - alerts per page (default: 20, max: 50)
//
// Each alert includes:
//   code, severity, title, description, affectedWorkflowIds,
//   affectedExecutionIds (both capped at 20), detectedAt, recommendedAction
//
// Alerts are regenerated fresh on each request from the current execution
// state - there is no alert store or persistence layer.
//
// NOTE: /governance/health also returns up to 10 alerts for convenience.
//       Use this endpoint for the full paginated list.
//
router.get(
  "/governance/alerts",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const page  = Math.max(1, Number(req.query["page"])  || 1);
    const limit = Math.min(MAX_ALERTS_PAGE, Math.max(1, Number(req.query["limit"]) || 20));

    const now     = new Date();
    const summary = await evaluateTenantHealth(req.workspaceId, db, now);
    const body    = serializeAlertsResponse(summary.alerts, page, limit, now);

    req.log.info(
      {
        workspaceId:      req.workspaceId,
        actorId:          req.userId,
        resultCounts:     {
          totalAlerts: summary.alerts.length,
          page,
          limit,
          returnedCount: body.data.length,
        },
        responseSeverity: summary.severity,
        action:           GOVERNANCE_ACTION_ALERTS_REQUESTED,
      },
      "[governance] P6-D: Alerts requested",
    );

    res.json(body);
  },
);

// ── POST /governance/events ───────────────────────────────────────────────────
//
// Log-only observability endpoint for the governance dashboard.
// Accepts frontend-emitted structured events (loaded, refreshed, etc.)
// and writes them to the structured application log.
//
// SAFETY: This endpoint makes ZERO DB writes - it only calls req.log.info.
//         It is NOT a governance mutation endpoint.
//
router.post(
  "/governance/events",
  requireAuth,
  requireWorkspaceAdmin,
  (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const { action, visibleAlertCount, visibleStuckCount, dashboardSeverity } =
      req.body as {
        action?:            string;
        visibleAlertCount?: unknown;
        visibleStuckCount?: unknown;
        dashboardSeverity?: unknown;
      };

    if (!action || !VALID_DASHBOARD_ACTIONS.has(action as never)) {
      res.status(400).json({ error: "Invalid or missing action" });
      return;
    }

    req.log.info(
      {
        workspaceId:      req.workspaceId,
        actorId:          req.userId,
        visibleAlertCount: typeof visibleAlertCount === "number" ? visibleAlertCount : 0,
        visibleStuckCount: typeof visibleStuckCount === "number" ? visibleStuckCount : 0,
        dashboardSeverity: typeof dashboardSeverity === "string" ? dashboardSeverity : "unknown",
        action,
      },
      `[governance] P6-E: Dashboard event - ${action}`,
    );

    res.status(204).send();
  },
);

// ── GET /governance/snapshots ─────────────────────────────────────────────────
//
// Returns historical governance trend data for the authenticated workspace.
//
// Query parameters:
//   ?range=24h  - time window: "1h" | "24h" | "7d" | "30d" (default: "24h")
//
// Response includes:
//   severityHistory, errorRateTrend, approvalBacklogTrend,
//   delayBacklogTrend, stuckCountTrend - all as ordered [{capturedAt, value}] arrays
//   snapshotCount, firstAt, lastAt - coverage metadata
//
// Data source: governance_snapshots table (append-only, written by capture endpoint).
// Returns empty trend arrays when no snapshots exist - not an error.
//
// READ-ONLY - zero DB mutations.
//
const VALID_TREND_RANGES = new Set<TrendRange>(["1h", "24h", "7d", "30d"]);

router.get(
  "/governance/snapshots",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const rawRange = (req.query["range"] as string | undefined) ?? "24h";
    if (!VALID_TREND_RANGES.has(rawRange as TrendRange)) {
      res.status(400).json({ error: "Invalid range. Use: 1h | 24h | 7d | 30d" });
      return;
    }
    const range = rawRange as TrendRange;

    const now       = new Date();
    const snapshots = await querySnapshotsByRange(req.workspaceId, range, db, now);
    const body      = serializeSnapshotTrendResponse(range, snapshots, now);

    req.log.info(
      {
        workspaceId:   req.workspaceId,
        actorId:       req.userId,
        trendRange:    range,
        snapshotCount: snapshots.length,
        firstAt:       body.firstAt,
        lastAt:        body.lastAt,
        action:        GOVERNANCE_ACTION_TREND_QUERY_REQUESTED,
      },
      "[governance-history] P7-A: Trend query requested",
    );

    res.json(body);
  },
);

// ── POST /governance/snapshots/capture ────────────────────────────────────────
//
// Evaluate the current tenant health and persist an immutable snapshot.
//
// This is the primary write endpoint for the snapshot pipeline.
// It calls evaluateTenantHealth() then INSERTs a new row into governance_snapshots.
//
// APPEND-ONLY GUARANTEE:
//   • Inserts exactly one new row per call.
//   • Never modifies existing snapshot rows.
//   • Never modifies workflow_executions or any runtime execution state.
//
// The governance dashboard can use this endpoint to trigger periodic captures
// from an admin-initiated action.  For automated capture at scale, a future
// background job should call this on a schedule (e.g. every 5 minutes).
//
// Returns: GovernanceCaptureResult - the newly inserted snapshot's metadata.
//
router.post(
  "/governance/snapshots/capture",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const now    = new Date();
    const result = await captureGovernanceSnapshot(req.workspaceId, db, now);

    res.status(201).json(result);
  },
);

// ── GET /governance/snapshots/chronic-alerts ──────────────────────────────────
//
// Returns alert frequency intelligence across historical snapshots.
//
// Query parameters:
//   ?range=7d  - time window: "1h" | "24h" | "7d" | "30d" (default: "7d")
//
// For each distinct GOV-* code found in any snapshot within the range:
//   code, count, totalSnapshots, frequencyPct, firstSeenAt, lastSeenAt, isChronic
//
// "isChronic" = frequencyPct >= 50% of snapshots in the range.
//
// Sorted by occurrence count descending (most frequent chronic alerts first).
// Returns empty items array when no snapshots exist - not an error.
//
// READ-ONLY - zero DB mutations.
//
router.get(
  "/governance/snapshots/chronic-alerts",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const rawRange = (req.query["range"] as string | undefined) ?? "7d";
    if (!VALID_TREND_RANGES.has(rawRange as TrendRange)) {
      res.status(400).json({ error: "Invalid range. Use: 1h | 24h | 7d | 30d" });
      return;
    }
    const range = rawRange as TrendRange;

    const now       = new Date();
    const snapshots = await querySnapshotsByRange(req.workspaceId, range, db, now);
    const body      = serializeChronicAlertsResponse(range, snapshots, now);

    if (body.chronicCount > 0) {
      req.log.warn(
        {
          workspaceId:   req.workspaceId,
          actorId:       req.userId,
          trendRange:    range,
          snapshotCount: snapshots.length,
          chronicCount:  body.chronicCount,
          alertCodes:    body.items.filter(i => i.isChronic).map(i => i.code),
          snapshotSeverity: snapshots.length > 0
            ? snapshots[snapshots.length - 1]?.severity ?? "unknown"
            : "unknown",
          capturedAt:    now.toISOString(),
          action:        "governance_chronic_alert_detected",
        },
        "[governance-history] P7-A: Chronic alerts detected in trend window",
      );
    }

    res.json(body);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// P7-D - Governance Trend APIs (query-cascade aware, read-only)
// ═══════════════════════════════════════════════════════════════════════════
//
// Four endpoints expose the internal historical analytics infrastructure as a
// safe long-term API surface:
//
//   GET /governance/trends/severity   - severity timeline
//   GET /governance/trends/error-rate - workflow error-rate timeline
//   GET /governance/trends/backlogs   - approval/delay/stuck backlog timeline
//   GET /governance/trends/storms     - alert storm frequency timeline
//
// ALL ENDPOINTS:
//   • Are READ-ONLY - zero DB mutations.
//   • Are workspace-scoped via requireWorkspaceAdmin.
//   • Accept ?range= from EXTENDED_TREND_RANGES (1h | 24h | 7d | 30d | 90d | 180d | 365d).
//   • Dispatch through the query cascade:
//       ≤ 30d  → raw governance_snapshots (5-min resolution)
//       31-90d → hourly governance_snapshot_rollups
//       91-365d→ daily governance_snapshot_rollups
//   • Return a consistent TrendEnvelope<T> regardless of storage tier.
//   • Truncate to MAX_TREND_POINTS (1000) with truncated=true in the envelope.
//
// Observability events emitted per request:
//   governance_trend_api_requested   - on entry (after validation passes)
//   governance_trend_api_resolved    - on successful response
//   governance_trend_query_rejected  - when range validation fails (400)
//   governance_trend_payload_truncated - when result exceeds MAX_TREND_POINTS
//

/**
 * Shared handler for all four governance trend endpoints.
 *
 * Encapsulates: range validation → cascade dispatch → serialization →
 * truncation → envelope → observability events.
 *
 * T is the DTO type for one data point (SeverityTrendPoint, NumericTrendPoint,
 * BacklogTrendPoint, StormTrendPoint).
 */
async function serveTrendRoute<T>(
  req:                    AuthRequest,
  res:                    Response,
  trendType:              TrendType,
  serializeFromSnapshots: (snaps: StoredSnapshot[]) => T[],
  serializeFromRollups:   (rollups: StoredRollup[]) => T[],
): Promise<void> {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }

  const rawRange = (req.query["range"] as string | undefined) ?? "30d";
  const now      = new Date();
  const validation = validateTrendRange(rawRange, now);

  if (!validation.ok) {
    req.log.warn(
      {
        workspaceId: req.workspaceId,
        actorId:     req.userId,
        trendType,
        rawRange,
        reason:      validation.reason,
        action:      TREND_ACTION_REJECTED,
      },
      "[governance-trends] P7-D: Trend query rejected - invalid range",
    );
    res.status(validation.statusCode).json({ error: validation.reason });
    return;
  }

  const ctx = validation.context;

  req.log.info(
    {
      workspaceId: req.workspaceId,
      actorId:     req.userId,
      trendType,
      range:       ctx.range,
      rangeDays:   ctx.rangeDays,
      sourceLayer: ctx.layer,
      action:      TREND_ACTION_REQUESTED,
    },
    "[governance-trends] P7-D: Trend API requested",
  );

  let points: T[];

  if (ctx.layer === "raw") {
    const snapshots = await querySnapshotsInBucket(req.workspaceId, ctx.since, ctx.until, db);
    points          = serializeFromSnapshots(snapshots);
  } else {
    const granularity = ctx.layer as "hourly" | "daily";
    const rollups     = await queryRollupsByRange(req.workspaceId, granularity, ctx.since, ctx.until, db);
    points            = serializeFromRollups(rollups);
  }

  const result   = truncateTrendPoints(points);
  const envelope = buildTrendEnvelope(ctx, result.points, result.truncated);

  if (result.truncated) {
    req.log.warn(
      {
        workspaceId:     req.workspaceId,
        actorId:         req.userId,
        trendType,
        range:           ctx.range,
        rangeDays:       ctx.rangeDays,
        sourceLayer:     ctx.layer,
        originalCount:   points.length,
        truncatedTo:     result.points.length,
        action:          TREND_ACTION_TRUNCATED,
      },
      "[governance-trends] P7-D: Trend payload truncated - result exceeded MAX_TREND_POINTS",
    );
  }

  req.log.info(
    {
      workspaceId:  req.workspaceId,
      actorId:      req.userId,
      trendType,
      range:        ctx.range,
      rangeDays:    ctx.rangeDays,
      sourceLayer:  ctx.layer,
      layerLabel:   trendLayerLabel(ctx.layer),
      resultCount:  envelope.pointCount,
      truncated:    envelope.truncated,
      action:       TREND_ACTION_RESOLVED,
    },
    "[governance-trends] P7-D: Trend API resolved",
  );

  res.json(envelope);
}

// ── GET /governance/trends/severity ──────────────────────────────────────────
//
// Returns the severity timeline for the authenticated workspace.
//
// Each data point carries:
//   timestamp   - ISO 8601 (capturedAt for raw, bucketStart for rollups)
//   severity    - "healthy" | "warning" | "degraded" | "critical"
//   sourceLayer - which storage tier served this point
//
// Severity semantics by tier:
//   raw:    exact severity at snapshot capture time
//   hourly: dominantSeverity (worst severity across all snapshots in the hour)
//   daily:  dominantSeverity (worst severity across all hourly rollups in the day)
//
// READ-ONLY - zero DB mutations.
//
router.get(
  "/governance/trends/severity",
  requireAuth,
  requireWorkspaceAdmin,
  (req: AuthRequest, res: Response) =>
    serveTrendRoute(
      req, res, "severity",
      (snaps)   => serializeSeverityFromSnapshots(snaps, "raw"),
      (rollups) => serializeSeverityFromRollups(rollups, rollups[0]?.granularity ?? "hourly"),
    ),
);

// ── GET /governance/trends/error-rate ────────────────────────────────────────
//
// Returns the workflow error-rate timeline for the authenticated workspace.
//
// Each data point carries:
//   timestamp   - ISO 8601
//   value       - workflowErrorRate [0-1] (raw) or avgErrorRate (rollup)
//   sourceLayer - which storage tier served this point
//
// READ-ONLY - zero DB mutations.
//
router.get(
  "/governance/trends/error-rate",
  requireAuth,
  requireWorkspaceAdmin,
  (req: AuthRequest, res: Response) =>
    serveTrendRoute(
      req, res, "error-rate",
      (snaps)   => serializeErrorRateFromSnapshots(snaps, "raw"),
      (rollups) => serializeErrorRateFromRollups(rollups, rollups[0]?.granularity ?? "hourly"),
    ),
);

// ── GET /governance/trends/backlogs ──────────────────────────────────────────
//
// Returns the backlog timeline (approval, delay, stuck) for the workspace.
//
// Each data point carries:
//   timestamp       - ISO 8601
//   approvalBacklog - approvalBacklogCount (raw) or avgApprovalBacklog (rollup)
//   delayBacklog    - delayBacklogCount (raw) or avgDelayBacklog (rollup)
//   stuckCount      - stuckCount (raw, exact integer) or avgStuckCount (rollup, float)
//   sourceLayer     - which storage tier served this point
//
// Note: for rollup tiers, backlog values are floating-point averages.
// Consumers should use sourceLayer to determine precision.
//
// READ-ONLY - zero DB mutations.
//
router.get(
  "/governance/trends/backlogs",
  requireAuth,
  requireWorkspaceAdmin,
  (req: AuthRequest, res: Response) =>
    serveTrendRoute(
      req, res, "backlogs",
      (snaps)   => serializeBacklogsFromSnapshots(snaps, "raw"),
      (rollups) => serializeBacklogsFromRollups(rollups, rollups[0]?.granularity ?? "hourly"),
    ),
);

// ── GET /governance/trends/storms ────────────────────────────────────────────
//
// Returns the alert storm frequency timeline for the authenticated workspace.
//
// Each data point carries:
//   timestamp        - ISO 8601
//   stormFrequency   - [0-1] fraction of the period with active storms
//                      (raw: binary 0 or 1; rollup: fractional 0-1)
//   dominantSeverity - worst severity during the period
//   sourceLayer      - which storage tier served this point
//
// READ-ONLY - zero DB mutations.
//
router.get(
  "/governance/trends/storms",
  requireAuth,
  requireWorkspaceAdmin,
  (req: AuthRequest, res: Response) =>
    serveTrendRoute(
      req, res, "storms",
      (snaps)   => serializeStormsFromSnapshots(snaps, "raw"),
      (rollups) => serializeStormsFromRollups(rollups, rollups[0]?.granularity ?? "hourly"),
    ),
);

export default router;
