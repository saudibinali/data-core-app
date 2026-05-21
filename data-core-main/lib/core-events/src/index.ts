/**
 * @workspace/core-events
 *
 * Public surface of the core-events package.
 *
 * Exports:
 *   types.ts     — BaseEvent, EventMetadata, ActorContext, WorkspaceContext,
 *                  TypedEvent, EventListenerFn, EventRegistryEntry, primitives
 *   events.ts    — Typed payload interfaces + TypedEvent aliases per domain
 *   constants.ts — EVENT_TYPES constant, EventTypeMap, AnyTypedEvent union,
 *                  LEGACY_EVENT_NAMES cross-reference
 *   bus.ts       — EventBus class, createEventBus(), eventBus singleton,
 *                  SubscriptionToken, EmitResult, TypedEventHandler, EventInput
 *
 * ── Domain events in this package ────────────────────────────────────────────
 *   Tickets:      ticket.created, ticket.updated, ticket.status_changed
 *   Forms:        form.submitted
 *   Approvals:    approval.created, approval.completed
 *   HR Leave:     leave.requested, leave.approved, leave.rejected,
 *                 leave.cancelled, leave.withdrawn, leave.balance_adjusted
 *   HR Employees: employee.created
 *
 * ── What is NOT exported ──────────────────────────────────────────────────────
 *   listener-registry.ts  — internal implementation detail of EventBus
 *                           (ListenerRegistry, AnyHandler, ListenerEntry are private)
 *
 *   notification.created  — removed (infrastructure event, not domain event)
 *   workflow.executed     — removed (meta event, loop risk via bridge → WorkflowEngine)
 */

// ── Base event system ─────────────────────────────────────────────────────────
export type {
  ISOTimestamp,
  EventId,
  WorkspaceId,
  UserId,
  EventMetadata,
  ActorContext,
  WorkspaceContext,
  BaseEvent,
  TypedEvent,
  EventListenerFn,
  EventRegistryEntry,
} from "./types";

// ── Domain event payloads & typed event aliases ───────────────────────────────
export type {
  TicketCreatedPayload,
  TicketCreatedEvent,
  TicketUpdatedPayload,
  TicketUpdatedEvent,
  TicketStatusChangedPayload,
  TicketStatusChangedEvent,
  FormSubmittedPayload,
  FormSubmittedEvent,
  ApprovalCreatedPayload,
  ApprovalCreatedEvent,
  ApprovalCompletedPayload,
  ApprovalCompletedEvent,
  // ── Leave domain (Phase 0 taxonomy) ─────────────────────────────────────────
  LeaveRequestedPayload,
  LeaveRequestedEvent,
  LeaveApprovedPayload,
  LeaveApprovedEvent,
  LeaveRejectedPayload,
  LeaveRejectedEvent,
  LeaveCancelledPayload,
  LeaveCancelledEvent,
  LeaveWithdrawnPayload,
  LeaveWithdrawnEvent,
  LeaveBalanceAdjustedPayload,
  LeaveBalanceAdjustedEvent,
  AttendanceRawReceivedPayload,
  AttendanceRawReceivedEvent,
  AttendanceEventNormalizedPayload,
  AttendanceEventNormalizedEvent,
  AttendanceDayCalculatedPayload,
  AttendanceDayCalculatedEvent,
  AttendanceSyncFailedPayload,
  AttendanceSyncFailedEvent,
  AttendanceSyncCompletedPayload,
  AttendanceSyncCompletedEvent,
  AttendanceIntegrationDisabledPayload,
  AttendanceIntegrationDisabledEvent,
  // ── HR employees ─────────────────────────────────────────────────────────────
  EmployeeCreatedPayload,
  EmployeeCreatedEvent,
} from "./events";

// ── Event type constants & map ────────────────────────────────────────────────
export { EVENT_TYPES, LEGACY_EVENT_NAMES } from "./constants";
export type {
  EventType,
  EventTypeMap,
  AnyTypedEvent,
  IsEventTypeFn,
} from "./constants";

// ── Event Bus — runtime infrastructure ───────────────────────────────────────
export { eventBus, createEventBus, EventBus } from "./bus";
export type {
  BusLogger,
  SubscriptionToken,
  ListenerError,
  EmitResult,
  BusStats,
  EventBusOptions,
  EventInput,
  TypedEventHandler,
  WildcardHandler,
} from "./bus";
