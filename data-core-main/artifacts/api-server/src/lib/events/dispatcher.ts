/**
 * @file        dispatcher.ts
 * @purpose     Legacy EventDispatcher - persistence layer and workflow trigger.
 *
 * ── Role in the observability model ──────────────────────────────────────────
 *   Layer 2 (DB Audit Trail) - writes every event to workspace_event_logs with:
 *     • Full payload (JSONB) including _busEventId and _busCorrelationId injected
 *       by bridge.ts for cross-system correlation.
 *     • Named listener results: { listeners: [{ name, success, durationMs }] }
 *       Stored in workspace_event_logs.result JSONB - enables "which listener failed?"
 *     • Status: "completed" | "failed" (partial failure = "completed" with errors)
 *
 * ── Listener naming (Phase 1-E) ───────────────────────────────────────────────
 *   Listeners are stored with a name so workspace_event_logs.result contains
 *   human-readable diagnostic information:
 *     {
 *       listeners: [
 *         { name: "WorkflowEngine", success: true, durationMs: 12 },
 *         { name: "legacy#1", success: false, durationMs: 4, error: "..." }
 *       ]
 *     }
 *   Name is passed as the optional 3rd argument to eventDispatcher.on().
 *   Falls back to "<eventName>#<index>" if omitted (backward compatible).
 *
 * ── Caller contract ───────────────────────────────────────────────────────────
 *   NEVER import or call this from route handlers. Only callers:
 *   1. bridge.ts  - forwards typed appEventBus events to the legacy layer
 *   2. engine.ts  - registers WorkflowEngine as a wildcard listener
 *
 * ── EventListener signature ───────────────────────────────────────────────────
 *   (payload: EventPayload, logId: number) => Promise<void>
 *
 *   logId = serial PK of the workspace_event_logs row created by this dispatch.
 *   Pass to WorkflowEngine to populate triggerEventLogId (see engine.ts BS-01 fix).
 */
import { db } from "@workspace/db";
import { workspaceEventLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import type { EventPayload, EventListener } from "./types";

// ── Named listener slot ────────────────────────────────────────────────────────

interface ListenerSlot {
  /** Human-readable name for diagnostic output in workspace_event_logs.result. */
  name: string;
  fn: EventListener;
}

// ── Listener result shape ──────────────────────────────────────────────────────

interface ListenerResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

class EventDispatcher {
  private readonly listeners = new Map<string, ListenerSlot[]>();

  /**
   * Register a listener for a specific event name (or "*" for all events).
   *
   * @param eventName     Exact event name string, or "*" for wildcard (all events).
   * @param listener      Async handler receiving (payload, logId).
   * @param listenerName  Optional human-readable name for diagnostic output.
   *                      Defaults to "<eventName>#<index>" if omitted.
   *                      Used in workspace_event_logs.result.listeners[].name.
   */
  on(eventName: string, listener: EventListener, listenerName?: string): void {
    const slots = this.listeners.get(eventName) ?? [];
    const name = listenerName ?? `${eventName}#${slots.length}`;
    this.listeners.set(eventName, [...slots, { name, fn: listener }]);
  }

  /** Emit an event - logs to DB and runs registered listeners asynchronously. */
  async dispatch(payload: EventPayload): Promise<void> {
    const [log] = await db
      .insert(workspaceEventLogsTable)
      .values({
        workspaceId: payload.workspaceId,
        eventName: payload.event,
        module: payload.module,
        triggeredBy: payload.triggeredBy ?? null,
        status: "processing",
        payload: payload as unknown as Record<string, unknown>,
      })
      .returning({ id: workspaceEventLogsTable.id });

    if (!log) {
      logger.error({ event: payload.event }, "Failed to create event log entry");
      return;
    }

    const specific  = this.listeners.get(payload.event) ?? [];
    const wildcards = this.listeners.get("*") ?? [];
    const allSlots  = [...specific, ...wildcards];

    if (allSlots.length === 0) {
      await db
        .update(workspaceEventLogsTable)
        .set({ status: "completed", processedAt: new Date(), result: { listeners: [] } })
        .where(eq(workspaceEventLogsTable.id, log.id));
      return;
    }

    // ── Run all listeners concurrently, capturing named results ───────────────
    //
    // Each slot records: name, success, durationMs, and error message (if failed).
    // Stored in workspace_event_logs.result for per-listener diagnostic queries.
    //
    // Partial failure (some listeners succeeded) → status = "completed" with errors.
    // Total failure  (all listeners failed)      → status = "failed".
    //
    const results: ListenerResult[] = [];

    await Promise.allSettled(
      allSlots.map(async ({ name, fn }) => {
        const t0 = Date.now();
        try {
          await fn(payload, log.id);
          results.push({ name, success: true, durationMs: Date.now() - t0 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ name, success: false, durationMs: Date.now() - t0, error: msg });
          logger.error({ err, event: payload.event, listener: name }, "Event listener error");
        }
      }),
    );

    const failedResults = results.filter(r => !r.success);

    if (failedResults.length > 0) {
      await db
        .update(workspaceEventLogsTable)
        .set({
          status: failedResults.length === results.length ? "failed" : "completed",
          error: failedResults.map(r => `${r.name}: ${r.error ?? "unknown"}`).join("; "),
          result: { listeners: results },
          processedAt: new Date(),
        })
        .where(eq(workspaceEventLogsTable.id, log.id));
    } else {
      await db
        .update(workspaceEventLogsTable)
        .set({
          status: "completed",
          result: { listeners: results },
          processedAt: new Date(),
        })
        .where(eq(workspaceEventLogsTable.id, log.id));
    }

    logger.info(
      { event: payload.event, workspaceId: payload.workspaceId, logId: log.id },
      "Event dispatched",
    );
  }
}

export const eventDispatcher = new EventDispatcher();
