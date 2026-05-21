import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspaceEventLogsTable,
  platformEventRegistryTable,
  activityLogsTable,
  notificationsTable,
  workflowExecutionsTable,
  workflowDefinitionsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count, sql, or, gte, lte } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
} from "../middlewares/requireAuth";

/**
 * Event Diagnostics Routes
 *
 * ── Audit trail vs diagnostics ────────────────────────────────────────────────
 *   activity_logs  = Layer 3: human-readable "who did what" audit trail for UI.
 *   workspace_event_logs = Layer 4: technical event store for diagnostics.
 *   These routes are diagnostics APIs - they expose workspace_event_logs with
 *   enrichments that cross-reference the audit trail and notification layers.
 *   They are NOT replacements for the activity feed or notification history.
 *
 * ── Why enrichment happens server-side ───────────────────────────────────────
 *   Three separate tables need to be cross-referenced by busEventId (a UUID
 *   stored in workspace_event_logs.payload->>'_busEventId').  Doing this
 *   server-side in a single request with Promise.all() is cheaper than 3+
 *   client round-trips and avoids exposing raw JSONB payload internals to
 *   the client layer.
 *
 * ── Why raw payloads are minimized in list views ─────────────────────────────
 *   payload and result columns are JSONB and can be large (full event context).
 *   List endpoints omit them to keep response sizes manageable and avoid
 *   serializing megabytes of data for paginated views.  Detail endpoints
 *   return the full payload + result for a single row only.
 */

const router: IRouter = Router();

// ── GET /events/registry ──────────────────────────────────────────────────────

router.get(
  "/events/registry",
  requireAuth,
  requireWorkspaceAdmin,
  async (_req, res): Promise<void> => {
    const registry = await db
      .select()
      .from(platformEventRegistryTable)
      .orderBy(platformEventRegistryTable.module, platformEventRegistryTable.eventName);
    res.json(registry);
  },
);

// ── GET /events ───────────────────────────────────────────────────────────────

router.get(
  "/events",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const page  = Math.max(1, Number(req.query["page"])  || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 50));
    const offset = (page - 1) * limit;

    const { module, status, eventName } = req.query as Record<string, string | undefined>;

    const conditions = [eq(workspaceEventLogsTable.workspaceId, req.workspaceId)];
    if (module)    conditions.push(eq(workspaceEventLogsTable.module,    module));
    if (status)    conditions.push(eq(workspaceEventLogsTable.status,    status));
    if (eventName) conditions.push(eq(workspaceEventLogsTable.eventName, eventName));

    const where = and(...conditions);

    const [totalRow] = await db
      .select({ count: count() })
      .from(workspaceEventLogsTable)
      .where(where);

    // Omit payload/result in list view - can be large JSONB.
    const rows = await db
      .select({
        id:              workspaceEventLogsTable.id,
        workspaceId:     workspaceEventLogsTable.workspaceId,
        eventName:       workspaceEventLogsTable.eventName,
        module:          workspaceEventLogsTable.module,
        triggeredBy:     workspaceEventLogsTable.triggeredBy,
        triggeredByName: sql<string | null>`${usersTable.fullName}`,
        status:          workspaceEventLogsTable.status,
        error:           workspaceEventLogsTable.error,
        retryCount:      workspaceEventLogsTable.retryCount,
        createdAt:       workspaceEventLogsTable.createdAt,
        processedAt:     workspaceEventLogsTable.processedAt,
      })
      .from(workspaceEventLogsTable)
      .leftJoin(usersTable, eq(workspaceEventLogsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(desc(workspaceEventLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      data:  rows,
      total: totalRow?.count ?? 0,
      page,
      limit,
    });
  },
);

// ── GET /events/failed ────────────────────────────────────────────────────────
//
// IMPORTANT: This route MUST be registered before GET /events/:id to prevent
// Express from matching "failed" as the :id parameter.
//
// Returns two categories:
//   - fully_failed    - status = 'failed' (all listeners threw, or dispatch itself failed)
//   - partial_failure - status = 'completed' but ≥1 listener reported success = false
//
// Detection of partial failures uses a JSON path query on the result JSONB:
//   EXISTS (SELECT 1 FROM jsonb_array_elements(result->'listeners') AS l
//           WHERE (l->>'success')::boolean = false)

router.get(
  "/events/failed",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const page    = Math.max(1, Number(req.query["page"])  || 1);
    const limit   = Math.min(100, Math.max(1, Number(req.query["limit"]) || 50));
    const offset  = (page - 1) * limit;

    const { eventName, module, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    // Base workspace isolation + failure filter.
    // partial_failure: status = completed but at least one listener failed.
    const failureWhere = or(
      eq(workspaceEventLogsTable.status, "failed"),
      sql`(
        ${workspaceEventLogsTable.status} = 'completed'
        AND ${workspaceEventLogsTable.result} IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(${workspaceEventLogsTable.result}->'listeners') AS l
          WHERE (l->>'success')::boolean = false
        )
      )`,
    );

    const conditions = [
      eq(workspaceEventLogsTable.workspaceId, req.workspaceId),
      failureWhere!,
    ];

    if (eventName) conditions.push(eq(workspaceEventLogsTable.eventName, eventName));
    if (module)    conditions.push(eq(workspaceEventLogsTable.module,    module));
    if (dateFrom)  conditions.push(gte(workspaceEventLogsTable.createdAt, new Date(dateFrom)));
    if (dateTo)    conditions.push(lte(workspaceEventLogsTable.createdAt, new Date(dateTo)));

    const where = and(...conditions);

    const [totalRow] = await db
      .select({ count: count() })
      .from(workspaceEventLogsTable)
      .where(where);

    const rows = await db
      .select({
        id:              workspaceEventLogsTable.id,
        workspaceId:     workspaceEventLogsTable.workspaceId,
        eventName:       workspaceEventLogsTable.eventName,
        module:          workspaceEventLogsTable.module,
        triggeredBy:     workspaceEventLogsTable.triggeredBy,
        triggeredByName: sql<string | null>`${usersTable.fullName}`,
        status:          workspaceEventLogsTable.status,
        error:           workspaceEventLogsTable.error,
        retryCount:      workspaceEventLogsTable.retryCount,
        createdAt:       workspaceEventLogsTable.createdAt,
        processedAt:     workspaceEventLogsTable.processedAt,
        // Include listener summary for triage - not the full payload.
        listenerSummary: sql<Array<{ name: string; success: boolean; durationMs: number; error?: string }> | null>`
          ${workspaceEventLogsTable.result}->'listeners'
        `,
        // Computed failure category for client rendering.
        failureKind: sql<"fully_failed" | "partial_failure">`
          CASE
            WHEN ${workspaceEventLogsTable.status} = 'failed' THEN 'fully_failed'
            ELSE 'partial_failure'
          END
        `,
        failedListenerCount: sql<number>`
          COALESCE((
            SELECT count(*)::int
            FROM jsonb_array_elements(${workspaceEventLogsTable.result}->'listeners') AS l
            WHERE (l->>'success')::boolean = false
          ), 0)
        `,
      })
      .from(workspaceEventLogsTable)
      .leftJoin(usersTable, eq(workspaceEventLogsTable.triggeredBy, usersTable.id))
      .where(where)
      .orderBy(desc(workspaceEventLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      data:  rows,
      total: totalRow?.count ?? 0,
      page,
      limit,
    });
  },
);

// ── GET /events/:id ───────────────────────────────────────────────────────────
//
// Full event detail with cross-table enrichments.
//
// ── Enrichment strategy ───────────────────────────────────────────────────────
//   1. Fetch the event row (single indexed lookup by id + workspace_id).
//   2. Extract busEventId from payload->>'_busEventId' (set by bridge.ts).
//   3. Three parallel queries (Promise.all - no N+1):
//      A. activity_logs WHERE bus_event_id = busEventId    (idx_activity_bus_event_id)
//      B. notifications WHERE bus_event_id = busEventId    (idx_notifications_bus_event_id)
//      C. workflow_executions WHERE trigger_event_log_id = id  (idx_wf_exec_trigger)
//   4. Derived diagnostics computed from result.listeners array in-process.
//
// ── Why raw payloads are returned here ───────────────────────────────────────
//   This is a single-row detail endpoint accessed during debugging, not a list.
//   Full payload + result are returned intentionally so the admin can inspect
//   the complete event context without making additional API calls.

router.get(
  "/events/:id",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid event ID" });
      return;
    }

    // Step 1: Fetch the event with workspace isolation.
    const [event] = await db
      .select({
        id:              workspaceEventLogsTable.id,
        workspaceId:     workspaceEventLogsTable.workspaceId,
        eventName:       workspaceEventLogsTable.eventName,
        module:          workspaceEventLogsTable.module,
        triggeredBy:     workspaceEventLogsTable.triggeredBy,
        triggeredByName: sql<string | null>`${usersTable.fullName}`,
        status:          workspaceEventLogsTable.status,
        payload:         workspaceEventLogsTable.payload,
        result:          workspaceEventLogsTable.result,
        error:           workspaceEventLogsTable.error,
        retryCount:      workspaceEventLogsTable.retryCount,
        createdAt:       workspaceEventLogsTable.createdAt,
        processedAt:     workspaceEventLogsTable.processedAt,
      })
      .from(workspaceEventLogsTable)
      .leftJoin(usersTable, eq(workspaceEventLogsTable.triggeredBy, usersTable.id))
      .where(
        and(
          eq(workspaceEventLogsTable.id,          id),
          eq(workspaceEventLogsTable.workspaceId, req.workspaceId),
        ),
      );

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    // Step 2: Extract the bus event UUID from the payload (injected by bridge.ts).
    const payload     = event.payload as Record<string, unknown> | null;
    const busEventId  = typeof payload?._busEventId === "string" ? payload._busEventId : null;
    const requestId   = typeof payload?._requestId  === "string" ? payload._requestId  : null;

    // Step 3: Parallel enrichment queries - no sequential N+1.
    const [activityRows, notificationRows, workflowRows] = await Promise.all([
      // A) Activity log rows created by this event (via bus_event_id).
      busEventId
        ? db
            .select({
              id:        activityLogsTable.id,
              action:    activityLogsTable.action,
              metadata:  activityLogsTable.metadata,
              userId:    activityLogsTable.userId,
              userName:  sql<string | null>`u.full_name`,
              createdAt: activityLogsTable.createdAt,
            })
            .from(activityLogsTable)
            .leftJoin(
              sql`${usersTable} AS u`,
              sql`${activityLogsTable.userId} = u.id`,
            )
            .where(eq(activityLogsTable.busEventId, busEventId))
            .limit(50)
        : Promise.resolve([]),

      // B) Notifications created by this event (via bus_event_id).
      busEventId
        ? db
            .select({
              id:        notificationsTable.id,
              userId:    notificationsTable.userId,
              type:      notificationsTable.type,
              title:     notificationsTable.title,
              isRead:    notificationsTable.isRead,
              createdAt: notificationsTable.createdAt,
            })
            .from(notificationsTable)
            .where(eq(notificationsTable.busEventId, busEventId))
            .limit(50)
        : Promise.resolve([]),

      // C) Workflow executions triggered by this event log row (via FK).
      db
        .select({
          id:           workflowExecutionsTable.id,
          workflowId:   workflowExecutionsTable.workflowId,
          workflowName: sql<string | null>`${workflowDefinitionsTable.name}`,
          workflowKey:  sql<string | null>`${workflowDefinitionsTable.key}`,
          status:       workflowExecutionsTable.status,
          startedAt:    workflowExecutionsTable.startedAt,
          completedAt:  workflowExecutionsTable.completedAt,
          error:        workflowExecutionsTable.error,
        })
        .from(workflowExecutionsTable)
        .leftJoin(
          workflowDefinitionsTable,
          eq(workflowExecutionsTable.workflowId, workflowDefinitionsTable.id),
        )
        .where(eq(workflowExecutionsTable.triggerEventLogId, id))
        .limit(20),
    ]);

    // Step 4: Compute diagnostics from result.listeners (in-process, no extra query).
    const listeners = (event.result as Record<string, unknown> | null)?.["listeners"];
    const listenerArr = Array.isArray(listeners) ? listeners as Array<{
      name: string; success: boolean; durationMs: number; error?: string;
    }> : [];

    const totalListenerDuration  = listenerArr.reduce((s, l) => s + (l.durationMs ?? 0), 0);
    const failedListenersCount   = listenerArr.filter(l => !l.success).length;

    res.json({
      event: {
        ...event,
        // Surface correlation IDs at the top level for easy access.
        busEventId,
        requestId,
      },
      enrichments: {
        activity:          activityRows,
        notifications:     notificationRows,
        workflowExecutions: workflowRows,
      },
      diagnostics: {
        totalListenerDuration,
        failedListenersCount,
        listenerCount:     listenerArr.length,
        notificationsCount: notificationRows.length,
        activityCount:     activityRows.length,
        workflowCount:     workflowRows.length,
      },
    });
  },
);

export default router;
