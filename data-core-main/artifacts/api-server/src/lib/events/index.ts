/**
 * @file        lib/events/index.ts
 * @purpose     Central entry point for the api-server event infrastructure.
 *
 * ── Architecture Overview (post-bridge, post Phase 0/1 stabilization) ─────────
 *
 *   appEventBus.emit()         ← canonical entry point for ALL new code
 *         │
 *         ├──▶ listeners/activity.ts         (activity_logs writes)
 *         │     workspaceId + busEventId now populated in every row (Phase 1-A/B)
 *         ├──▶ listeners/notifications-bus.ts (notifications + SSE)
 *         │     busEventId now populated in every row (Phase 1-C)
 *         └──▶ bridge.ts (subscribeToAll)
 *                   │
 *                   └──▶ eventDispatcher.dispatch()
 *                               │
 *                               ├──▶ workspace_event_logs (DB write)
 *                               │     _busEventId + _busCorrelationId + _requestId in payload
 *                               │     result = { listeners: [{name, success, durationMs}] }
 *                               └──▶ WorkflowEngine ("*" listener, named "WorkflowEngine")
 *                                     triggerEventLogId now populated (BS-01 fix, Phase 0-A)
 *
 *   eventDispatcher.dispatch()  ← bridge is now the sole caller
 *         │
 *         ├──▶ workspace_event_logs (DB write)
 *         └──▶ WorkflowEngine ("*" listener)
 *
 * ── What is exported ─────────────────────────────────────────────────────────
 *   appEventBus      - canonical typed EventBus (use this in all new code)
 *   EVENT_TYPES      - canonical event type constants from @workspace/core-events
 *   eventDispatcher  - legacy bus (preserved for backward compat - DO NOT USE in new code)
 *   EVENTS           - legacy event name constants (backward compat - prefer EVENT_TYPES)
 *
 * ── Side effects on import (registration order matters) ──────────────────────
 *   1. activity.ts                - registers appEventBus activity listeners (11 events)
 *   2. notifications-bus.ts       - registers appEventBus notification listeners (9 events)
 *   3. bridge.ts                  - registers wildcard appEventBus → eventDispatcher bridge
 *
 *   Registration order: domain listeners BEFORE bridge, so domain work completes
 *   before (or in parallel with) the bridge forwarding to legacy dispatch.
 *
 *   NOTE: listeners/notifications.ts was a legacy eventDispatcher listener scaffold
 *   with no active listeners (all migrated in T06-A, T06-B, T07).  It was removed
 *   in Phase 0 cleanup (0-B) - the file and its import are both gone.
 *
 * ── Source of Truth ───────────────────────────────────────────────────────────
 *   appEventBus     = canonical runtime layer - source of truth for event semantics
 *   eventDispatcher = legacy compatibility layer - persistence + workflow triggers
 *   workspace_event_logs = authoritative audit trail (written by eventDispatcher)
 *
 * ── Architecture Boundaries ───────────────────────────────────────────────────
 *   NEW CODE:   appEventBus.emit()          ← always
 *   OLD CODE:   eventDispatcher.dispatch()  ← only until migrated (see bridge.ts)
 *   NEVER:      eventDispatcher → appEventBus (reverse bridge - causes loops)
 *
 * ── Observability fields now in every event trace ─────────────────────────────
 *   activity_logs.workspaceId   - direct workspace isolation (Phase 1-A)
 *   activity_logs.busEventId    - UUID link to workspace_event_logs (Phase 1-B)
 *   notifications.busEventId    - UUID link to workspace_event_logs (Phase 1-C)
 *   workflow_executions.triggerEventLogId - FK to workspace_event_logs (Phase 0-A)
 *   workspace_event_logs.payload._requestId - HTTP req.id (Phase 0-C)
 *   workspace_event_logs.result.listeners  - named listener results (Phase 1-E)
 *
 * ── Legacy Direct Callers - ALL MIGRATED ✅ ──────────────────────────────────
 *   File              │ Event(s)                      │ Status
 *   ──────────────────│───────────────────────────────│────────────────────────
 *   forms.ts          │ FORM_SUBMITTED                │ ✅ MIGRATED (Forms Migration)
 *   tickets.ts        │ TICKET_CREATED                │ ✅ MIGRATED (T06-A)
 *   tickets.ts        │ TICKET_STATUS_CHANGED/UPDATED │ ✅ MIGRATED (T06-B / Stab.)
 *   admin.ts          │ EMPLOYEE_CREATED              │ ✅ MIGRATED (T07)
 *
 * ── Notification Migration Progress ──────────────────────────────────────────
 *   approval.created   → notifications-bus.ts ✅ ACTIVE (T04)
 *   approval.completed → notifications-bus.ts ✅ ACTIVE (T04)
 *   ticket.created     → notifications-bus.ts ✅ ACTIVE (T06-A)
 *   ticket.updated     → notifications-bus.ts ✅ ACTIVE (T06-B)
 *   ticket.status_changed → notifications-bus.ts ✅ ACTIVE (Stab.)
 *   employee.created   → notifications-bus.ts ✅ ACTIVE (T07)
 *   form.submitted     → notifications-bus.ts ✅ ACTIVE (Forms Migration)
 *   leave.requested    → notifications-bus.ts ✅ ACTIVE (Phase 1)
 *   leave.approved     → notifications-bus.ts ✅ ACTIVE (Phase 1)
 *   leave.rejected     → notifications-bus.ts ✅ ACTIVE (Phase 1)
 *   leave.withdrawn    → notifications-bus.ts ✅ ACTIVE (Phase 1)
 *
 * ── Activity Migration Progress ───────────────────────────────────────────────
 *   approval.created   → activity.ts ✅ ACTIVE (T04)
 *   approval.completed → activity.ts ✅ ACTIVE (T04)
 *   ticket.created     → activity.ts ✅ ACTIVE (T06-A)
 *   ticket.updated     → activity.ts ✅ ACTIVE (T06-B)
 *   ticket.status_changed → activity.ts ✅ ACTIVE (Stab.)
 *   employee.created   → activity.ts ✅ ACTIVE (T07)
 *   form.submitted     → activity.ts ✅ ACTIVE (Forms Migration)
 *   leave.requested    → activity.ts ✅ ACTIVE (Phase 1)
 *   leave.approved     → activity.ts ✅ ACTIVE (Phase 1)
 *   leave.rejected     → activity.ts ✅ ACTIVE (Phase 1)
 *   leave.withdrawn    → activity.ts ✅ ACTIVE (Phase 1)
 *
 * ── F7.2 Transactional outbox ─────────────────────────────────────────────────
 *   event_outbox table + publishDomainEvent() + outbox-worker (optional drain).
 *   Pilot: EVENT_OUTBOX_PUBLISH_MODE=shadow (enqueue + direct emit, drain off).
 *   Cutover: mode=outbox + migrate routes to publishDomainEvent inside transactions.
 *
 * ── Deprecation Strategy ──────────────────────────────────────────────────────
 *   Phase 1 (now):    Bridge in place. Both systems active. New code uses bus.
 *   Phase 2 (done):   Migrated tickets.ts, admin.ts, forms.ts to appEventBus.emit().
 *   Phase 3 (future): eventDispatcher becomes @internal (bridge-only caller).
 *   Phase 4 (final):  Replace EventDispatcher class with direct DB write in bridge.
 *
 * ── Migration tracking ────────────────────────────────────────────────────────
 *   See bridge.ts          for bridge architecture and migration priorities.
 *   See listeners/activity.ts for activity migration status per event.
 *   See listeners/notifications-bus.ts for notification migration status per event.
 */

// ── Legacy system - backward compat exports ───────────────────────────────────
// @deprecated Use appEventBus.emit() in all new code.
// eventDispatcher remains exported for: bridge (internal caller only).
export { eventDispatcher }               from "./dispatcher";
export { EVENTS }                        from "./types";
export type { EventPayload, EventListener, EventName } from "./types";

// ── Canonical typed bus ───────────────────────────────────────────────────────
export { appEventBus }                   from "./app-bus";
export {
  publishDomainEvent,
  enqueueEventOutbox,
  eventPublishMode,
  shouldDrainEventOutbox,
} from "./outbox";
export { EVENT_TYPES, LEGACY_EVENT_NAMES } from "@workspace/core-events";

// ── Listener registration (side effects - ORDER MATTERS) ──────────────────────

// 1. New: activity listener - registers on appEventBus (Ticket 04, Phase 1-A/B)
//    Writes activity_logs with workspaceId + busEventId for full traceability.
import { registerActivityListeners } from "./listeners/activity";
registerActivityListeners();

// 2. New: notification-bus listener - registers on appEventBus (Ticket 05, Phase 1-C)
//    Writes notifications with busEventId. Includes leave domain listeners.
import { registerNotificationBusListeners } from "./listeners/notifications-bus";
registerNotificationBusListeners();

// 2b. P20-B: attendance → minimal notifications
import { registerAttendanceBusListeners } from "./listeners/attendance-bus";
registerAttendanceBusListeners();

// 2c. P20-E: integration sync notifications
import { registerIntegrationBusListeners } from "./listeners/integration-bus";
registerIntegrationBusListeners();

// 2d. P21-C: payroll run / payslip notifications
import { registerPayrollBusListeners } from "../payroll/payroll-events";
registerPayrollBusListeners();

// 3. Bridge: appEventBus → eventDispatcher (Ticket 06 / Bridge Ticket)
//    Must be registered AFTER domain listeners (1 & 2) so domain listeners
//    run in parallel with the bridge, not after it.
//    The bridge uses subscribeToAll() - it receives every event emitted
//    to appEventBus and forwards it to eventDispatcher.dispatch().
//    Also injects _requestId from event.metadata.requestId (Phase 0-C).
import { registerBridge } from "./bridge";
registerBridge();
