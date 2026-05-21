/**
 * @package     @workspace/core-events
 * @file        types.ts
 * @purpose     Base event system architecture — canonical type contracts for
 *              the platform-wide event bus.
 *
 * ── Ownership ────────────────────────────────────────────────────────────────
 * Platform Core.  No module should redefine these base shapes.
 * Domain-specific payloads live in events.ts (same package).
 * The runtime dispatcher lives in artifacts/api-server/src/lib/events/.
 *
 * ── Event Lifecycle ───────────────────────────────────────────────────────────
 *   1. Producer (route handler / service) creates a TypedEvent<T>
 *   2. Dispatcher assigns `id`, `timestamp`, persists to workspace_event_logs
 *   3. Registered listeners receive (event, logId) and act asynchronously
 *   4. Dispatcher marks log entry completed/failed
 *
 * ── Extensibility ─────────────────────────────────────────────────────────────
 *   • Add new payload types in events.ts
 *   • Register new event type strings in constants.ts EventTypeMap
 *   • Dispatcher and listener contracts never change — only payloads grow
 *
 * ── Conflict note (Ticket 03) ────────────────────────────────────────────────
 *   The existing api-server EventPayload uses `event` for the event name and
 *   lacks `id`, `metadata`, and structured `actor`/`workspace` contexts.
 *   These canonical types intentionally differ; migration is a future ticket.
 */

// ── Primitive aliases ─────────────────────────────────────────────────────────

/** ISO-8601 datetime string.  All timestamps in the event system use this format. */
export type ISOTimestamp = string;

/** UUID v4 string — used for event `id`, `correlationId`, `causationId`. */
export type EventId = string;

/** Positive integer — primary key of a workspace row. */
export type WorkspaceId = number;

/** Positive integer — primary key of a user row.  Undefined for system events. */
export type UserId = number | undefined;

// ── EventMetadata ─────────────────────────────────────────────────────────────

/**
 * EventMetadata — envelope metadata that travels with every event.
 *
 * Provides the infrastructure primitives for:
 *   • Distributed tracing (correlationId chains)
 *   • Causation tracking (which event triggered this one)
 *   • Schema evolution (schemaVersion lets consumers handle old payloads)
 *   • Idempotency (idempotencyKey prevents duplicate processing)
 *
 * Publishing responsibility: the dispatcher assigns `correlationId` and
 *   `timestamp` if the producer omits them.  Producers should set
 *   `causationId` when an event is triggered by another event.
 */
export interface EventMetadata {
  /**
   * UUID that links a chain of causally related events.
   * When event A causes event B, both share the same correlationId.
   * Assigned by the dispatcher if the producer does not provide one.
   */
  correlationId: EventId;

  /**
   * ID of the event that directly caused this event.
   * Omit for events triggered by human actions (no prior event in the chain).
   * Example: a workflow.executed event sets causationId = the triggering event's id.
   */
  causationId?: EventId;

  /**
   * Integer schema version of the payload.
   * Increment when making breaking changes to a payload interface.
   * Consumers can branch on schemaVersion to handle old payloads gracefully.
   * Default: 1
   */
  schemaVersion: number;

  /**
   * Service or module that emitted the event.
   * Useful when multiple services can produce the same event type.
   * Example: "api-server", "worker", "scheduler"
   */
  source?: string;

  /**
   * Optional key for at-most-once delivery guarantees.
   * The dispatcher can skip re-processing if this key was already seen.
   * Useful for retried HTTP requests.
   */
  idempotencyKey?: string;

  /**
   * HTTP request ID from pino-http (req.id) of the request that caused this event.
   * Stored as a string because pino assigns serial integer IDs, converted at emit time.
   * Links this event back to the originating HTTP request in pino logs.
   *
   * Trace path:
   *   pino-http log { req.id } → event.metadata.requestId
   *   → workspace_event_logs.payload._requestId (via bridge injection)
   * This closes the HTTP ↔ Event boundary gap for structured log correlation.
   *
   * Set by all canonical route handlers that call appEventBus.emit().
   * Undefined for system-initiated events (scheduler, seed, background jobs).
   */
  requestId?: string;
}

// ── ActorContext ──────────────────────────────────────────────────────────────

/**
 * ActorContext — who or what triggered the event.
 *
 * Publishing responsibility: populated by requireAuth middleware data.
 * For scheduled/system events, all fields are undefined.
 *
 * Future: add `impersonatedBy` for admin-on-behalf-of scenarios.
 */
export interface ActorContext {
  /**
   * DB user ID of the person who triggered the action.
   * Undefined for background jobs, scheduled tasks, and system events.
   */
  userId?: UserId;

  /**
   * Role of the actor at the time the event was fired.
   * Captured here so audit logs remain accurate even if the role changes later.
   */
  role?: string;

  /**
   * Session identifier — correlates events from the same login session.
   * Useful for detecting unusual patterns (many events from one session).
   */
  sessionId?: string;

  /**
   * IP address of the actor at the time of the action.
   * Captured for security-sensitive events (login, password change, etc.).
   * Must be anonymized if stored long-term for GDPR compliance.
   */
  ipAddress?: string;
}

// ── WorkspaceContext ──────────────────────────────────────────────────────────

/**
 * WorkspaceContext — workspace isolation context.
 *
 * Every event is strictly workspace-scoped.  The dispatcher MUST reject events
 * without a valid workspaceId (super_admin system events are the only exception).
 *
 * Future: add `plan` (workspace subscription tier) to enable tier-based routing.
 */
export interface WorkspaceContext {
  /**
   * Primary key of the workspace this event belongs to.
   * Mandatory for all business events; undefined only for platform-level events.
   */
  workspaceId: WorkspaceId;

  /**
   * Human-readable workspace slug captured at emit time.
   * Stable even if the slug is later changed.  Used in notification links and logs.
   */
  workspaceSlug?: string;
}

// ── BaseEvent ─────────────────────────────────────────────────────────────────

/**
 * BaseEvent — the canonical envelope every platform event must satisfy.
 *
 * Changes from the existing api-server EventPayload (migration target):
 *   • `id`        — added (UUID assigned by dispatcher; enables deduplication)
 *   • `type`      — renamed from `event` (clearer semantics, matches TypeScript conventions)
 *   • `workspace` — replaces top-level `workspaceId` with structured WorkspaceContext
 *   • `actor`     — replaces top-level `triggeredBy: number` with structured ActorContext
 *   • `metadata`  — new (correlationId, causationId, schemaVersion, source)
 *   • `timestamp` — was optional, is now mandatory (dispatcher always sets it)
 *
 * Consumers pattern-match on `type` to narrow to a TypedEvent<T>.
 * Use the EventTypeMap in constants.ts for the full discriminated union.
 */
export interface BaseEvent {
  /**
   * UUID v4 assigned by the dispatcher at emit time.
   * Stored in workspace_event_logs.id alongside a serial PK.
   * Stable across retries — use `metadata.idempotencyKey` for dedup.
   */
  id: EventId;

  /**
   * Dot-namespaced event type string.  See naming convention in README.
   * Convention:  entity.action  (e.g. "ticket.created", "leave.requested")
   * Compound:    entity.sub_action  snake_case  (e.g. "ticket.status_changed")
   */
  type: string;

  /**
   * Module that owns this event.
   * Examples: "tickets", "hr", "approvals", "forms", "system"
   * Must match the module registered in platform_event_registry.
   */
  module: string;

  /** Workspace isolation context — always present for business events. */
  workspace: WorkspaceContext;

  /** Actor who triggered the event — empty object for system events. */
  actor: ActorContext;

  /** Envelope metadata — correlationId, causation, schema version. */
  metadata: EventMetadata;

  /**
   * Event-specific payload.  Always narrow via the EventTypeMap discriminated union
   * or a type guard — never access fields directly on `data: Record<string, unknown>`.
   */
  data: Record<string, unknown>;

  /**
   * ISO-8601 timestamp set by the dispatcher at emit time.
   * Always in UTC.  Mandatory — the dispatcher fills this in if omitted.
   */
  timestamp: ISOTimestamp;
}

// ── TypedEvent<T> ─────────────────────────────────────────────────────────────

/**
 * TypedEvent<TType, TData> — a BaseEvent with a known type string and strongly
 * typed data payload.
 *
 * Usage:
 *   type TicketCreatedEvent = TypedEvent<"ticket.created", TicketCreatedPayload>;
 *
 * Consumers receive a BaseEvent and narrow to TypedEvent via a type guard or
 * a switch on `event.type`:
 *
 *   if (event.type === "ticket.created") {
 *     // event is now TypedEvent<"ticket.created", TicketCreatedPayload>
 *     const { ticketId, title } = event.data;
 *   }
 */
export type TypedEvent<
  TType extends string,
  TData extends object,
> = Omit<BaseEvent, "type" | "data"> & {
  type: TType;
  data: TData;
};

// ── Listener contract ─────────────────────────────────────────────────────────

/**
 * EventListenerFn — the signature every registered listener must implement.
 *
 * @param event   The BaseEvent envelope (narrow via type guard inside the function).
 * @param logId   DB serial ID of the persisted workspace_event_logs row.
 *                Use this to correlate listener results back to the log entry.
 *
 * Publishing responsibility: the dispatcher calls all registered listeners
 * after persisting the event.  Listeners run concurrently via Promise.allSettled.
 * A listener MUST NOT throw — catch internally and log errors.
 */
export type EventListenerFn = (
  event: BaseEvent,
  logId: number,
) => Promise<void>;

// ── Registry entry ────────────────────────────────────────────────────────────

/**
 * EventRegistryEntry — metadata stored in platform_event_registry.
 *
 * Used by:
 *   • Workflow builder UI — shows available trigger event types
 *   • Condition evaluator — knows which fields each event exposes
 *   • Admin event log UI — displays human-readable event labels
 */
export interface EventRegistryEntry {
  id: number;
  /** Matches BaseEvent.type exactly. */
  eventType: string;
  module: string;
  label: string;
  labelAr?: string;
  description?: string;
  descriptionAr?: string;
  /** Field descriptor list for condition builder UI (EventFieldDef[]). */
  fieldSchema: unknown;
}
