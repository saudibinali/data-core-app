/**
 * @file        workflows/engine.ts
 * @purpose     WorkflowEngine - matches dispatched events to workflow definitions
 *              and creates execution records.
 *
 * ── Observability: triggerEventLogId (BS-01 fix) ──────────────────────────────
 *   The workflow_executions table has a triggerEventLogId column (FK to
 *   workspace_event_logs.id) that was NEVER populated before Phase 0.
 *
 *   This fix closes that gap:
 *     1. engine.ts registers on eventDispatcher with the EventListener signature
 *        (payload, logId) - the dispatcher passes the DB row ID as the 2nd arg.
 *     2. handleEvent() receives logId and passes it to the INSERT as triggerEventLogId.
 *     3. Every new workflow_execution now links back to the workspace_event_log
 *        row that triggered it.
 *
 *   Before this fix:
 *     SELECT * FROM workflow_executions WHERE trigger_event_log_id = X → no results
 *   After this fix:
 *     SELECT * FROM workflow_executions WHERE trigger_event_log_id = X → full trace
 *
 *   Diagnostic use cases unlocked:
 *     • "What workflows did event X trigger?"
 *       → SELECT * FROM workflow_executions WHERE trigger_event_log_id = X
 *     • "What event caused this workflow run?"
 *       → JOIN workflow_executions ON trigger_event_log_id = workspace_event_logs.id
 *     • Admin event detail page: list triggered workflows alongside event payload.
 *
 * ── Trigger matching - two-tier strategy ─────────────────────────────────────
 *
 * TIER 1 - Primary match: exact event type string (all events).
 *   Matches workflow_definitions WHERE trigger_event = payload.event.
 *   Examples:
 *     "ticket.created"   - any ticket created
 *     "approval.created" - any approval created
 *     "form.submitted"   - any generic form submission (catches ALL forms)
 *
 * TIER 2 - Secondary hint match: form.submitted events only.
 *   When payload.event = "form.submitted", also queries for definitions WHERE
 *   trigger_event = payload.data.workflowEventHint (if present).
 *   The hint value is formDefinitionsTable.workflowEvent - a routing string set
 *   at form-creation time (e.g. "hr.form.submitted", "hr.annual-leave.submitted").
 *
 *   This lets workspace admins create per-form-type workflows without requiring
 *   a separate bus event type per form.  The canonical bus event is always
 *   "form.submitted"; the hint is WorkflowEngine-only routing metadata.
 *
 *   ── Why "workflowEventHint" and not a domain event type ──────────────────
 *   Domain events (leave.requested, approval.created) have typed payloads that
 *   require structured, validated fields.  A generic form submission cannot
 *   produce those payloads.  Using a hint string keeps the bus contract clean
 *   while preserving fine-grained workflow routing flexibility.
 *
 * Deduplication: if a definition matches both tiers (unlikely but possible
 * if trigger_event = "form.submitted" AND hint = "form.submitted"), it runs
 * exactly once.  Dedup is by definition ID.
 */
import { db } from "@workspace/db";
import {
  workflowDefinitionsTable,
  workflowExecutionsTable,
} from "@workspace/db";
import { eq, and, count, gte, isNull } from "drizzle-orm";
import { logger } from "../logger";
import { eventDispatcher } from "../events/dispatcher";
import { evaluateConditions } from "./conditions";
import { executeWorkflow } from "./executor";
import { workflowScheduler } from "./scheduler";
import { createExecutionContext } from "./context";
import { computeTimeoutAt } from "./ttl";
import type { EventPayload } from "../events/types";
import type {
  WorkflowDefinitionRuntime,
  WorkflowStep,
  ConditionGroup,
} from "./types";

// ── Governance constants ───────────────────────────────────────────────────────

/**
 * P4-B: Default execution TTL - hours from trigger time to the absolute deadline.
 *
 * Every new workflow execution is given a timeout_at = now() + TTL.
 * The executor checks this at every inter-step boundary and transitions the
 * execution to status='timed_out' if the deadline has passed.
 *
 * Why 24 hours?
 *   • Short enough to surface stuck executions within one business day.
 *   • Long enough for workflows that span overnight approval windows.
 *   • Configurable: change this constant and restart - no schema migration needed.
 *
 * Note: The TTL is per-execution, not per-step.  A single 20-hour approval step
 * will consume most of the TTL budget.  Per-step timeouts are Phase 5 scope.
 */
const DEFAULT_EXECUTION_TTL_HOURS = 24;

/**
 * P3-B: Maximum workflow executions a single workspace may create per minute.
 *
 * Protects the platform from tenant-level execution storms - including
 * accidental event loops - by capping the rate at which new executions are
 * created.  If a workspace exceeds this limit, new triggers are suppressed
 * with a structured warning log rather than throwing an error.
 *
 * This is the SECOND line of defence.  The recursion chain guard (P3-C) is
 * the primary defence for event loops.  The rate limit catches abuse scenarios
 * that bypass chain propagation (e.g. indirect loops via HTTP routes).
 *
 * Default: 100 executions / minute / workspace.
 */
const MAX_EXECUTIONS_PER_MINUTE_PER_WORKSPACE = 100;

/**
 * P3-C: Maximum event chain depth before a new execution is rejected.
 *
 * The execution chain is a list of event types that directly caused this
 * execution to be triggered.  Each time a workflow step emits an event that
 * re-enters the engine (via the bus → bridge → dispatcher path), the chain
 * grows by one.
 *
 * Chain propagation mechanism:
 *   1. The engine stores the extended chain in executions.context._executionChain.
 *   2. When a step emits an event carrying _executionChain in its metadata,
 *      the bridge passes it through payload.data._executionChain to the engine.
 *   3. The engine reads it here, checks for loops, and rejects if exceeded.
 *
 * In Phase 3, only direct emissions from future "emit event" steps will carry
 * the chain.  Side-effect loops (e.g. status_update → route → bus → engine)
 * are caught by the rate limit (P3-B) until Phase 4 adds full propagation.
 *
 * Default: depth 5 (event A → B → C → D → E → blocked).
 */
const MAX_CHAIN_DEPTH = 5;

class WorkflowEngine {
  private started = false;

  /**
   * Register a wildcard event listener to catch every event dispatched through
   * eventDispatcher.  The listener receives (payload, logId) where logId is the
   * workspace_event_logs.id of the persisted event row.
   *
   * ── BS-01 fix: logId propagation ─────────────────────────────────────────
   *   Using the EventListener signature (payload, logId) instead of the bare
   *   (payload) handler that existed before.  This is the key change: logId
   *   is now forwarded to handleEvent() and written into triggerEventLogId.
   *
   *   Listener name "WorkflowEngine" is passed to eventDispatcher.on() so it
   *   appears by name in workspace_event_logs.result.listeners[].name.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    eventDispatcher.on(
      "*",
      async (payload: EventPayload, logId: number): Promise<void> => {
        await this.handleEvent(payload, logId);
      },
      "WorkflowEngine",
    );

    // P6-A: Start the delay scheduler alongside the event listener.
    // The scheduler polls the DB every 15 seconds for waiting_delay executions
    // whose wake_at has passed and resumes them via guarded acquisition.
    workflowScheduler.start();

    logger.info("Workflow Engine started - listening for events");
  }

  private async handleEvent(payload: EventPayload, triggerEventLogId: number): Promise<void> {
    // ── P3-C: Recursion / event loop guard ────────────────────────────────────
    //
    // Extract the execution chain from the event payload.  The chain is a list
    // of event types that directly caused this execution.  If the current event
    // type is already in the chain, this is a recursive loop - reject immediately.
    //
    // Chain is injected into payload.data._executionChain by workflow steps that
    // emit events (Phase 4 propagation).  In Phase 3, it is primarily populated
    // by future "emit event" step handlers.  The rate limit (P3-B below) provides
    // the backstop for indirect loops that don't carry chain metadata yet.
    const executionChain: string[] = Array.isArray(payload.data["_executionChain"])
      ? (payload.data["_executionChain"] as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    if (executionChain.includes(payload.event)) {
      logger.warn(
        {
          workspaceId:    payload.workspaceId,
          eventType:      payload.event,
          executionChain,
          rejectionReason: "event_already_in_chain",
        },
        "[governance] Recursive workflow execution rejected - event loop detected (P3-C)",
      );
      return;
    }

    if (executionChain.length >= MAX_CHAIN_DEPTH) {
      logger.warn(
        {
          workspaceId:    payload.workspaceId,
          eventType:      payload.event,
          executionChain,
          rejectionReason: "max_chain_depth_exceeded",
          maxChainDepth:  MAX_CHAIN_DEPTH,
        },
        "[governance] Workflow execution rejected - max chain depth exceeded (P3-C)",
      );
      return;
    }

    // Extended chain to store in the execution context for future propagation.
    const extendedChain = [...executionChain, payload.event];

    // ── P3-B: Workspace execution rate limit ──────────────────────────────────
    //
    // Count executions created by this workspace in the last 60 seconds.
    // If the count meets or exceeds the limit, suppress all new triggers for
    // this event dispatch without throwing - event dispatch must not crash.
    //
    // This is the backstop for indirect event loops (where workflow steps mutate
    // state that causes route handlers to emit new events without chain metadata)
    // and for genuine high-volume tenant usage that exceeds safe processing rates.
    const [rateRow] = await db
      .select({ cnt: count() })
      .from(workflowExecutionsTable)
      .where(
        and(
          eq(workflowExecutionsTable.workspaceId, payload.workspaceId),
          gte(workflowExecutionsTable.startedAt, new Date(Date.now() - 60_000)),
        ),
      );

    const recentCount = rateRow?.cnt ?? 0;
    if (recentCount >= MAX_EXECUTIONS_PER_MINUTE_PER_WORKSPACE) {
      logger.warn(
        {
          workspaceId:          payload.workspaceId,
          eventType:            payload.event,
          recentExecutionCount: recentCount,
          limitPerMinute:       MAX_EXECUTIONS_PER_MINUTE_PER_WORKSPACE,
        },
        "[governance] Workspace execution rate limit exceeded - trigger suppressed (P3-B)",
      );
      return;
    }

    // ── TIER 1: primary event type match ────────────────────────────────────
    //
    // Query: status='active' AND deleted_at IS NULL (Phase 3 governance filters).
    // Replaces the old: isActive=true filter.
    // status='active' is the authoritative lifecycle gate (P3-F).
    // deleted_at IS NULL excludes soft-deleted workflows (P3-E).
    const primaryDefs = await db
      .select()
      .from(workflowDefinitionsTable)
      .where(
        and(
          eq(workflowDefinitionsTable.workspaceId, payload.workspaceId),
          eq(workflowDefinitionsTable.triggerEvent, payload.event),
          eq(workflowDefinitionsTable.status, "active"),
          isNull(workflowDefinitionsTable.deletedAt),
        ),
      );

    // ── TIER 2: secondary hint match (form.submitted only) ──────────────────
    // Applies when forms.ts emits "form.submitted" with a workflowEventHint in
    // payload.data.  Enables per-form workflow routing without polluting
    // EventTypeMap with dynamic event names.
    let definitions = primaryDefs;
    if (payload.event === "form.submitted") {
      const hint = payload.data["workflowEventHint"];
      if (hint && typeof hint === "string") {
        const hintDefs = await db
          .select()
          .from(workflowDefinitionsTable)
          .where(
            and(
              eq(workflowDefinitionsTable.workspaceId, payload.workspaceId),
              eq(workflowDefinitionsTable.triggerEvent, hint),
              eq(workflowDefinitionsTable.status, "active"),
              isNull(workflowDefinitionsTable.deletedAt),
            ),
          );
        if (hintDefs.length > 0) {
          logger.debug(
            { hint, hintMatches: hintDefs.length, primaryMatches: primaryDefs.length },
            "[workflow-engine] form.submitted - secondary hint match",
          );
          const primaryIds = new Set(primaryDefs.map((d) => d.id));
          const newDefs = hintDefs.filter((d) => !primaryIds.has(d.id));
          definitions = [...primaryDefs, ...newDefs];
        }
      }
    }

    if (definitions.length === 0) return;

    for (const def of definitions) {
      const conditions = def.conditions as ConditionGroup | null;
      const steps = (def.steps as unknown as WorkflowStep[]) ?? [];

      if (conditions && conditions.conditions?.length > 0) {
        const passes = evaluateConditions(
          conditions,
          { ...payload.data, workspaceId: payload.workspaceId },
        );
        if (!passes) {
          logger.info(
            { workflowId: def.id, event: payload.event },
            "Workflow skipped - conditions not met",
          );
          continue;
        }
      }

      // ── P4-B: Compute execution TTL deadline ───────────────────────────────
      //
      // Every execution gets an absolute deadline set at creation time.
      // The executor checks this at every inter-step boundary (cooperative TTL).
      //
      // computeTimeoutAt(DEFAULT_EXECUTION_TTL_HOURS) → now() + 24h
      // Persisted in timeout_at column so the stuck diagnostics endpoint can
      // query:  WHERE status IN ('running','waiting_approval') AND timeout_at < now()
      const timeoutAt = computeTimeoutAt(DEFAULT_EXECUTION_TTL_HOURS);

      // ── P5-A: Deep-clone steps for immutable snapshot ─────────────────────
      //
      // WHY A DEEP CLONE:
      //   The `steps` array is parsed from JSONB and shared across all iterations
      //   of the `for (const def of definitions)` loop.  Without a deep clone,
      //   step handlers that mutate nested objects (e.g., config.recipientIds)
      //   could corrupt the steps reference used by concurrent executions.
      //
      //   structuredClone() is available in Node.js 17+ (Node 24 is used here).
      //   It deep-clones the entire WorkflowStep[] including nested config objects.
      //   No shared references remain after the clone - snapshot is fully isolated.
      //
      // WHY STORED IN THE EXECUTION RECORD (NOT IN THE ENGINE):
      //   The snapshot must survive process restarts.  Storing it in memory (the
      //   engine's in-flight map) would lose it on crash.  The DB is the only
      //   durable store.  The execution record already holds JSONB context - the
      //   steps_snapshot column follows the same pattern.
      //
      // IMMUTABILITY BY CONVENTION:
      //   steps_snapshot is written once here and never updated.  No code path
      //   in the executor or route handlers should UPDATE steps_snapshot on an
      //   existing execution row.
      const stepsSnapshot = structuredClone(steps);

      // ── Create execution record ────────────────────────────────────────────
      //
      // triggerEventLogId links this execution back to the workspace_event_logs
      // row that triggered it.  This is the BS-01 fix: the column existed in
      // the schema but was never populated.  Now it is always set.
      //
      // Diagnostic query: find all workflows triggered by a specific event:
      //   SELECT * FROM workflow_executions WHERE trigger_event_log_id = <logId>
      //
      // P5-A / P5-E: stepsSnapshot and workflowVersion are stored at INSERT time.
      //   stepsSnapshot    - frozen copy of steps at trigger time (see above).
      //   workflowVersion  - P5-E: def.version is now populated by the publish
      //                      pipeline. 0 = pre-P5-E row never re-published.
      //                      NULL fallback for legacy definitions with no version col.
      //
      const [execution] = await db
        .insert(workflowExecutionsTable)
        .values({
          workspaceId:        payload.workspaceId,
          workflowId:         def.id,
          triggerEventLogId,
          triggeredBy:        payload.triggeredBy ?? null,
          status:             "pending",
          currentStepIndex:   0,
          // P4-B: Persist the TTL deadline so it survives process restarts and
          // is queryable by the stuck diagnostics endpoint.
          timeoutAt,
          // P5-A: Immutable steps snapshot - source of truth for approval resume.
          stepsSnapshot:   stepsSnapshot as unknown as Record<string, unknown>[],
          // P5-E: Active publish version at trigger time. def.version is the
          // current version counter set by the publish transaction.
          workflowVersion: (def as unknown as { version?: number | null }).version ?? null,
          context: {
            triggerEvent:    payload.event,
            triggerData:     payload.data,
            // P3-C: store extended chain in execution context.
            // Future step handlers that emit events should read this and inject
            // it into event metadata as _executionChain so the engine can
            // continue chain tracking for child executions.
            _executionChain: extendedChain,
          } as unknown as Record<string, unknown>,
        })
        .returning({ id: workflowExecutionsTable.id });

      if (!execution) continue;

      // P4-A: Use createExecutionContext to ensure:
      //   1. triggerData is deep-cloned (immutable - no cross-step mutation).
      //   2. stepOutputs initialized empty (namespaced context isolation).
      //   3. resolvedData initialized empty (recomputed from stepOutputs by executor).
      const ctx = createExecutionContext(
        payload.event,
        payload.data,
        payload.workspaceId,
        payload.triggeredBy,
      );

      // ── P5-A: Observability - snapshot captured ────────────────────────────
      //
      // Emitted once per execution at creation time.
      // snapshotStepCount confirms the snapshot is non-empty and matches the
      // live definition's step count at trigger time.
      logger.info(
        {
          executionId:        execution.id,
          workflowId:         def.id,
          workflowKey:        def.key,
          event:              payload.event,
          triggerEventLogId,
          timeoutAt,
          ttlHours:           DEFAULT_EXECUTION_TTL_HOURS,
          // P5-A: snapshot observability fields
          snapshotPresent:    true,
          snapshotStepCount:  stepsSnapshot.length,
          workflowVersion:    (def as unknown as { version?: number | null }).version ?? null,
          action:             "execution_snapshot_created",
        },
        "[governance] P5-A: Workflow execution started - immutable steps snapshot captured",
      );

      // P4-B: Pass timeoutAt to executeWorkflow so the executor can enforce
      // the TTL at every inter-step boundary without re-querying the DB.
      // P4-C: Pass def.id (workflowId) for structured cancellation audit logs.
      // P5-F: Pass workflowVersion so approval audit records carry version linkage.
      const wfVersion = (def as unknown as { version?: number | null }).version ?? null;
      void executeWorkflow(execution.id, def.id, steps, ctx, timeoutAt, wfVersion).catch((err) => {
        logger.error(
          { err, executionId: execution.id, workflowKey: def.key },
          "Unhandled workflow execution error",
        );
      });
    }
  }
}

export const workflowEngine = new WorkflowEngine();
