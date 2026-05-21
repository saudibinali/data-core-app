/**
 * @file        app-bus.ts
 * @purpose     Application-level EventBus singleton wired to the pino logger.
 *              This is the ONE place that creates the EventBus for the api-server.
 *
 * ── Why a separate file? ──────────────────────────────────────────────────────
 *   • The default `eventBus` exported from @workspace/core-events uses `console`.
 *   • api-server must use pino for structured JSON logs (pino-http integration).
 *   • This file creates a bus with the pino adapter so all bus logs appear in
 *     the same structured stream as HTTP request logs.
 *
 * ── Import rule ───────────────────────────────────────────────────────────────
 *   All api-server code (routes, listeners, middleware) should import `appEventBus`
 *   from THIS file.  Never import the bare `eventBus` from @workspace/core-events.
 *
 * ── Relation to legacy EventDispatcher ────────────────────────────────────────
 *   The legacy `eventDispatcher` (dispatcher.ts) writes every dispatch to the
 *   `workspace_event_logs` DB table and triggers the workflow engine and legacy
 *   notification listeners.  It is NOT replaced by this file.
 *
 *   A one-way BRIDGE connects the two systems (bridge.ts):
 *     appEventBus.emit() ──bridge──▶ eventDispatcher.dispatch()
 *
 *   This means every appEventBus.emit() automatically:
 *     1. Runs typed listeners (activity.ts, notifications-bus.ts)     - new system
 *     2. Writes to workspace_event_logs                                - via bridge
 *     3. Triggers the WorkflowEngine                                   - via bridge
 *     4. Runs legacy notifications.ts listener                         - via bridge
 *
 *   DIRECTION: appEventBus → eventDispatcher ONLY (never the reverse).
 *
 *   | Concern                     | System                      | Status      |
 *   | ─────────────────────────── | ─────────────────────────── | ─────────── |
 *   | workspace_event_logs writes | eventDispatcher (via bridge) | Active     |
 *   | Legacy notification listeners| eventDispatcher (via bridge) | Active    |
 *   | WorkflowEngine triggers     | eventDispatcher (via bridge) | Active     |
 *   | Activity log creation       | appEventBus (new)            | Active     |
 *   | Notification creation + SSE | appEventBus (new)            | Active     |
 *   | Future: audit trail         | appEventBus (new)            | Planned    |
 *
 * ── Source of Truth ───────────────────────────────────────────────────────────
 *   This file creates the canonical EventBus instance.  All api-server code
 *   (routes, listeners, middleware) must import from this file or from the
 *   lib/events/index.ts barrel.  Never import the bare `eventBus` from
 *   @workspace/core-events directly - it uses console logging, not pino.
 *
 * ── Architecture boundaries ───────────────────────────────────────────────────
 *   NEW CODE  →  appEventBus.emit()          (always)
 *   OLD CODE  →  eventDispatcher.dispatch()  (until migrated, then removed)
 *   NEVER     →  eventDispatcher → appEventBus  (would cause loops)
 *
 * Future: Integrate core-audit - pass event.id and metadata.correlationId
 *   through to the audit subsystem once the audit package is available.
 */

import { createEventBus, type BusLogger } from "@workspace/core-events";
import { logger } from "../logger";

// ── Pino adapter ──────────────────────────────────────────────────────────────

/**
 * pinoAdapter - maps the EventBus BusLogger interface to pino's structured logger.
 *
 * Pino's call signature is `logger.error(obj, message)` - note that the context
 * object comes FIRST.  BusLogger uses `(message, context?)` - so we swap the
 * order here.
 *
 * All bus logs are tagged with a `bus: "appEventBus"` field for easy filtering:
 *   pino-pretty --filter 'bus === "appEventBus"'
 */
const pinoAdapter: BusLogger = {
  error: (msg, ctx) => logger.error({ bus: "appEventBus", ...ctx }, msg),
  warn:  (msg, ctx) => logger.warn( { bus: "appEventBus", ...ctx }, msg),
  debug: (msg, ctx) => logger.debug({ bus: "appEventBus", ...ctx }, msg),
};

// ── Singleton ─────────────────────────────────────────────────────────────────

/**
 * appEventBus - the primary in-process typed EventBus for the api-server.
 *
 * Usage in route handlers:
 *   import { appEventBus } from "../lib/events/app-bus";
 *   import { EVENT_TYPES } from "@workspace/core-events";
 *
 *   void appEventBus.emit({
 *     type: EVENT_TYPES.APPROVAL_CREATED,
 *     module: "approvals",
 *     workspace: { workspaceId: req.workspaceId! },
 *     actor: { userId: req.userId, role: req.userRole },
 *     metadata: { idempotencyKey: `approval-created-${approvalId}` },
 *     data: { ... },
 *   });
 *
 * Usage in listeners:
 *   import { appEventBus } from "../app-bus";
 *   appEventBus.subscribe(EVENT_TYPES.APPROVAL_CREATED, async (event) => { ... });
 *
 * Note: use `void` before the emit call in route handlers - activity creation
 * is a background side effect and must NOT block the HTTP response.
 * Errors in listeners are isolated by the bus and logged, never thrown to routes.
 */
export const appEventBus = createEventBus({
  logger: pinoAdapter,
  /**
   * verboseEmit - log a debug line for every emit.
   * Enabled in development only; disable in production to avoid log noise.
   * Set LOG_LEVEL=debug to see these in development.
   */
  verboseEmit: process.env.NODE_ENV !== "production",
});
