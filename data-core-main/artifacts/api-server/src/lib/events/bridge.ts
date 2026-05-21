/**
 * @file        bridge.ts
 * @purpose     One-way bridge: appEventBus (canonical) → eventDispatcher (legacy).
 *
 * ── Architecture Boundary ─────────────────────────────────────────────────────
 *
 *                        ┌──────────────────────────────────────────────────┐
 *                        │             CANONICAL RUNTIME LAYER              │
 *                        │                                                  │
 *   Route / Service      │   appEventBus.emit(TypedEvent<K, Payload>)      │
 *   (new code)  ─────────▶   Typed, schema-versioned, idempotent          │
 *                        │   Listeners: activity.ts, notifications-bus.ts  │
 *                        └──────────────┬───────────────────────────────────┘
 *                                       │
 *                           ┌───────────▼─────────────────┐
 *                           │  BRIDGE LAYER (this file)   │
 *                           │  subscribeToAll → translate  │
 *                           │  TypedEvent → EventPayload  │
 *                           └───────────┬─────────────────┘
 *                                       │  (one-way forward - no reverse path)
 *                        ┌─────────────▼────────────────────────────────────┐
 *                        │         LEGACY COMPATIBILITY LAYER               │
 *                        │                                                  │
 *                        │   eventDispatcher.dispatch(EventPayload)        │
 *                        │   • Writes to workspace_event_logs (DB)         │
 *                        │   • Triggers WorkflowEngine ("*" listener)      │
 *                        └──────────────────────────────────────────────────┘
 *
 * ── Migration Direction ───────────────────────────────────────────────────────
 *   CORRECT:   appEventBus.emit() ──bridge──▶ eventDispatcher.dispatch()
 *   INCORRECT: eventDispatcher → appEventBus  (never - would create loops)
 *
 * ── What the Bridge Does ──────────────────────────────────────────────────────
 *   1. Registers a wildcard listener on appEventBus (via subscribeToAll).
 *   2. For every TypedEvent received, translates to EventPayload format.
 *   3. Awaits eventDispatcher.dispatch() - writing the event to DB and
 *      running legacy listeners (workflow engine).
 *   4. Errors in eventDispatcher are caught and logged - never propagated
 *      back to the appEventBus emit chain.
 *
 * ── Tracing fields injected (Phase 0) ────────────────────────────────────────
 *   All bridge operations log with `bridge: "bus→dispatcher"` context.
 *   The following fields are injected into EventPayload.data so they appear
 *   in workspace_event_logs.payload for cross-system tracing:
 *
 *   _busEventId:       event.id (UUID) - link back to appEventBus event
 *   _busCorrelationId: event.metadata.correlationId - distributed trace chain
 *   _requestId:        event.metadata.requestId - HTTP req.id that caused this event
 *                      (Phase 0-C fix: closes the HTTP ↔ Event boundary gap)
 *
 *   To trace a specific event end-to-end:
 *   1. pino request log:   { req.id: 42 }
 *   2. pino bridge log:    { bridge: "bus→dispatcher", eventId: "<uuid>", requestId: "42" }
 *   3. workspace_event_log: WHERE payload->>'_busEventId' = '<uuid>'
 *   4. activity_log:       WHERE bus_event_id = '<uuid>'
 *   5. notifications:      WHERE bus_event_id = '<uuid>'
 *   6. workflow_execution: WHERE trigger_event_log_id = workspace_event_logs.id
 *
 * ── Timing log (Phase 1-D) ────────────────────────────────────────────────────
 *   The bridge records dispatch duration in a debug log after every dispatch.
 *   Level: debug - high-volume, not suitable for info in production.
 *
 * ── Legacy Direct Callers - ALL MIGRATED ✅ ───────────────────────────────────
 *   All routes now use appEventBus.emit().  eventDispatcher is no longer called
 *   directly from any route handler.  The bridge is the sole caller.
 *
 * ── No-Loop Guarantee ─────────────────────────────────────────────────────────
 *   The bridge goes appEventBus → eventDispatcher ONLY.
 *   eventDispatcher has no reference to appEventBus.
 *   Legacy listeners (engine.ts) do not emit to appEventBus.
 *   Therefore: no circular event cycles are possible.
 */

import type { BaseEvent } from "@workspace/core-events";
import type { EventPayload } from "./types";
import { appEventBus } from "./app-bus";
import { eventDispatcher } from "./dispatcher";
import { logger } from "../logger";

// ── Translation ────────────────────────────────────────────────────────────────

/**
 * toEventPayload - translates a canonical TypedEvent (appEventBus format) to
 * the legacy EventPayload format (eventDispatcher format).
 *
 * ── Field mapping ────────────────────────────────────────────────────────────
 *   TypedEvent.type                       → EventPayload.event
 *   TypedEvent.module                     → EventPayload.module
 *   TypedEvent.workspace.workspaceId      → EventPayload.workspaceId
 *   TypedEvent.actor.userId (if number)   → EventPayload.triggeredBy
 *   TypedEvent.data (+ tracing fields)    → EventPayload.data
 *
 * ── Tracing fields injected into data (Phase 0) ──────────────────────────────
 *   _busEventId:        event.id (UUID) - links workspace_event_logs row back
 *                       to the appEventBus event that originated it.
 *   _busCorrelationId:  correlation ID for distributed tracing chains.
 *   _requestId:         HTTP request ID (pino-http req.id) of the originating
 *                       request.  Closes the HTTP ↔ Event boundary gap.
 *                       Source: event.metadata.requestId set by route handlers.
 *
 *   These fields are prefixed with `_` to indicate they are infrastructure
 *   metadata, not business payload.  The workflow condition evaluator
 *   ignores unknown fields - no behavioral impact.
 */
function toEventPayload(event: BaseEvent): EventPayload {
  const triggeredBy =
    typeof event.actor.userId === "number" ? event.actor.userId : undefined;

  return {
    event:       event.type,
    module:      event.module,
    workspaceId: event.workspace.workspaceId,
    triggeredBy,
    data: {
      ...event.data,
      // ── Cross-system tracing fields ──────────────────────────────────────
      // Allow connecting a workspace_event_logs row back to the appEventBus
      // event that originated it, and back to the HTTP request that caused it.
      _busEventId:       event.id,
      _busCorrelationId: event.metadata.correlationId,
      // Phase 0-C: propagate HTTP request ID from route handler emit metadata.
      // Undefined for system/background events.
      ...(event.metadata.requestId !== undefined && {
        _requestId: event.metadata.requestId,
      }),
    },
  };
}

// ── Bridge registration ────────────────────────────────────────────────────────

let bridgeRegistered = false;

/**
 * registerBridge - wire the one-way appEventBus → eventDispatcher bridge.
 *
 * Must be called exactly ONCE, after both appEventBus and eventDispatcher
 * are initialized.  The canonical place to call this is lib/events/index.ts.
 *
 * Guards:
 *   - Idempotent: calling registerBridge() more than once is a no-op (warns).
 *   - Error isolation: bridge failures never propagate to appEventBus callers.
 */
export function registerBridge(): void {
  if (bridgeRegistered) {
    logger.warn(
      { bridge: "bus→dispatcher" },
      "[bridge] registerBridge() called more than once - skipping duplicate registration",
    );
    return;
  }
  bridgeRegistered = true;

  appEventBus.subscribeToAll(async (event: BaseEvent): Promise<void> => {
    const payload = toEventPayload(event);

    // ── Trace: bridge entry ──────────────────────────────────────────────────
    logger.info(
      {
        bridge:        "bus→dispatcher",
        eventType:     event.type,
        eventId:       event.id,
        correlationId: event.metadata.correlationId,
        requestId:     event.metadata.requestId,
        workspaceId:   event.workspace.workspaceId,
        module:        event.module,
      },
      "[bridge] forwarding typed event to legacy dispatcher",
    );

    const t0 = Date.now();

    try {
      await eventDispatcher.dispatch(payload);

      // ── Trace: bridge success with timing (Phase 1-D) ───────────────────
      logger.debug(
        {
          bridge:      "bus→dispatcher",
          eventType:   event.type,
          eventId:     event.id,
          duration_ms: Date.now() - t0,
        },
        "[bridge] legacy dispatch completed",
      );
    } catch (err) {
      // ── Trace: bridge failure with timing ────────────────────────────────
      // Error is logged but NOT re-thrown - the bridge must never propagate
      // failures back into the appEventBus emit chain.
      logger.error(
        {
          bridge:      "bus→dispatcher",
          eventType:   event.type,
          eventId:     event.id,
          duration_ms: Date.now() - t0,
          err: err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
        },
        "[bridge] legacy dispatch failed - bus listeners were unaffected",
      );
    }
  });

  logger.info(
    { bridge: "bus→dispatcher" },
    "[bridge] appEventBus → eventDispatcher bridge registered",
  );
}

/**
 * isBridgeRegistered - diagnostic helper.
 * Returns true if registerBridge() has been called at least once.
 * Useful in health-check endpoints and test setup.
 */
export function isBridgeRegistered(): boolean {
  return bridgeRegistered;
}
