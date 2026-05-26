/**
 * @package     @workspace/core-events
 * @file        bus.ts
 * @purpose     In-memory Event Bus — the runtime infrastructure for typed
 *              event publish / subscribe within a single Node.js process.
 *
 * ── What this provides ───────────────────────────────────────────────────────
 *   emit()           — publish a typed event to all matching listeners
 *   subscribe()      — register a persistent typed listener
 *   subscribeOnce()  — register a one-shot listener (auto-removes after first call)
 *   subscribeToAll() — register a wildcard listener (receives every event)
 *   unsubscribe()    — remove a listener by its SubscriptionToken
 *   stats()          — diagnostic snapshot of current registrations
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 *   No database persistence   (workspace_event_logs writes live in api-server)
 *   No retry / dead-letter    (TODO: see Future Architecture notes below)
 *   No cross-process fanout   (TODO: Redis adapter in a future ticket)
 *   No back-pressure          (TODO: queue-based adapter for high volume)
 *   No ordering guarantees    (Promise.allSettled is concurrent, not ordered)
 *
 * ── Publishing flow ───────────────────────────────────────────────────────────
 *   1. Producer calls eventBus.emit({ type, module, workspace, actor, metadata, data })
 *   2. Bus fills in `id` (UUID) and `timestamp` (UTC ISO-8601) if omitted
 *   3. Bus fills in `metadata.correlationId` and `schemaVersion` if omitted
 *   4. Bus looks up all matching listeners (specific + wildcard) in the registry
 *   5. Bus calls all listeners concurrently via Promise.allSettled
 *   6. Bus collects results — failed listeners do NOT stop others (error isolation)
 *   7. Bus returns EmitResult with timing, listener count, and any errors
 *
 * ── Listener behaviour ───────────────────────────────────────────────────────
 *   Listeners are called concurrently (not sequentially).
 *   A listener that throws or rejects does NOT affect other listeners.
 *   Errors are collected in EmitResult.errors and passed to the BusLogger.
 *   subscribeOnce() listeners are removed before they are called — this
 *   prevents duplicate calls when two emits race on the same microtask.
 *
 * ── Type safety approach ─────────────────────────────────────────────────────
 *   The subscribe<K>() signature constrains handler to TypedEventHandler<K>.
 *   The emit<K>() signature constrains input to EventInput<K>.
 *   TypeScript infers K from the `type` discriminant at each call site.
 *   Internally, handlers are stored as AnyHandler (type-erased) and the cast
 *   is safe because the bus only routes events to handlers registered for the
 *   matching type string.
 *
 * ── Future Architecture TODOs ────────────────────────────────────────────────
 *   TODO(distributed): Replace ListenerRegistry with a Redis Streams adapter.
 *     Consumer groups enable fan-out across multiple api-server replicas.
 *     Interface: same emit/subscribe API, different backing implementation.
 *
 *   TODO(persistence): Wrap emit() to write to workspace_event_logs BEFORE
 *     fanning out.  The current api-server EventDispatcher already does this.
 *     This bus intentionally does NOT do it to stay infrastructure-agnostic.
 *
 *   TODO(retry): Add exponential backoff for transient listener failures.
 *     Track retry count in a separate in-memory map, move to dead-letter
 *     after N failures.
 *
 *   TODO(dead-letter): Add a configurable dead-letter handler:
 *     options.onDeadLetter — invoked when ALL listeners for an event fail.
 *
 *   TODO(back-pressure): Replace Promise.allSettled fan-out with a task queue
 *     (e.g. BullMQ) when listener count or event volume grows significantly.
 *     The emit() API surface stays identical — only the internals change.
 *
 *   TODO(ordering): Add an option for sequential fan-out
 *     (options.fanout: "concurrent" | "sequential") for event types where
 *     listener ordering matters (e.g. audit before notification).
 */

import type {
  BaseEvent,
  ActorContext,
  EventId,
  EventMetadata,
  ISOTimestamp,
  TypedEvent,
  WorkspaceContext,
} from "./types";
import type { AnyTypedEvent, EventType, EventTypeMap } from "./constants";
import { ListenerRegistry } from "./listener-registry";
import type { AnyHandler } from "./listener-registry";

// ── UUID helper ────────────────────────────────────────────────────────────────

/**
 * generateId — lightweight UUID v4 without any Node.js/browser crypto dependency.
 *
 * Sufficient for event IDs and correlation IDs within a single process.
 * Math.random() is NOT cryptographically secure — for security-sensitive IDs
 * (session tokens, auth codes) use crypto.randomUUID() in the api-server.
 *
 * TODO: Replace with globalThis.crypto.randomUUID() once all target
 *   environments guarantee the Web Crypto API (Node 19+ / modern browsers).
 */
function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Logger interface ──────────────────────────────────────────────────────────

/**
 * BusLogger — pluggable logger interface for the EventBus.
 *
 * Allows injecting the application logger (pino, winston, etc.) rather than
 * relying on console in production.
 *
 * In api-server, inject the `logger` singleton from api-server/src/lib/logger.ts.
 * Default implementation uses console, which is acceptable for tests and dev.
 *
 * The api-server creates its own bus via createEventBus({ logger: pinoAdapter })
 * in artifacts/api-server/src/lib/events/app-bus.ts.  All api-server code imports
 * `appEventBus` from that file — never the bare `eventBus` singleton below.
 */
export interface BusLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Console-backed default logger.  Replace in production via EventBusOptions. */
const consoleLogger: BusLogger = {
  error: (msg, ctx) => console.error(`[EventBus] ${msg}`, ctx ?? ""),
  warn:  (msg, ctx) => console.warn(`[EventBus] ${msg}`, ctx ?? ""),
  debug: (msg, ctx) => console.debug(`[EventBus] ${msg}`, ctx ?? ""),
};

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * SubscriptionToken — opaque handle returned by subscribe / subscribeOnce.
 *
 * Pass to unsubscribe() to remove the listener.
 * Do NOT construct manually — always use the token returned by subscribe.
 */
export interface SubscriptionToken {
  /** Unique ID for this subscription. */
  readonly id: string;
  /** Event type this subscription is for, or "*" for wildcard. */
  readonly eventType: string;
}

/**
 * ListenerError — details of one failed listener during an emit cycle.
 */
export interface ListenerError {
  /** Subscription ID of the listener that failed. */
  listenerId: string;
  /** Event type that was being processed. */
  eventType: string;
  /** The error thrown or rejected by the listener. */
  error: Error;
}

/**
 * EmitResult — the result of an emit() call.
 *
 * Always returned — even if some listeners failed.
 * Callers may log or act on errors without disrupting the emit path.
 */
export interface EmitResult {
  /** Event type that was emitted. */
  eventType: string;
  /** The `id` assigned to the emitted event. */
  eventId: string;
  /** Total number of listeners that were invoked (specific + wildcard). */
  listenersInvoked: number;
  /** Number of listeners that completed without error. */
  listenersSucceeded: number;
  /** Errors from listeners that rejected or threw. */
  errors: ListenerError[];
  /** Elapsed milliseconds from emit() call to all listeners settling. */
  durationMs: number;
}

/**
 * BusStats — diagnostic information about the current state of the bus.
 */
export interface BusStats {
  /** Total listener count across all event types. */
  totalListeners: number;
  /** Per-event-type listener counts (includes the "*" wildcard key). */
  byEventType: Record<string, number>;
}

/**
 * EventBusOptions — constructor options for EventBus.
 */
export interface EventBusOptions {
  /**
   * Logger to use for error and debug output.
   * Defaults to console.  In production, inject the application logger.
   */
  logger?: BusLogger;

  /**
   * If true, log a debug message for every successful emit.
   * Useful in development; disable in production to reduce noise.
   * Default: false.
   */
  verboseEmit?: boolean;
}

// ── Typed handler signatures ──────────────────────────────────────────────────

/**
 * TypedEventHandler<K> — the signature of a subscriber callback for event type K.
 *
 * TypeScript infers K from the event type string passed to subscribe():
 *
 *   eventBus.subscribe("ticket.created", async (event) => {
 *     event.data.ticketId  // TypedEventHandler infers TicketCreatedPayload here
 *   });
 */
export type TypedEventHandler<K extends keyof EventTypeMap> = (
  event: TypedEvent<K, EventTypeMap[K]>,
) => Promise<void>;

/**
 * WildcardHandler — the signature of a subscriber callback registered via subscribeToAll().
 * Receives every event as a BaseEvent — narrow via event.type inside the handler.
 */
export type WildcardHandler = (event: BaseEvent) => Promise<void>;

// ── EventInput — what producers pass to emit() ────────────────────────────────

/**
 * EventInput<K> — the shape producers pass to emit().
 *
 * Intentionally omits `id` and `timestamp` (the bus fills them in).
 * `metadata` fields are all optional — the bus assigns sensible defaults.
 *
 * The `type` field is the discriminant — TypeScript infers K from it,
 * which constrains `data` to the correct payload type automatically.
 *
 * Example:
 *   await eventBus.emit({
 *     type: EVENT_TYPES.TICKET_CREATED,        // K is inferred as "ticket.created"
 *     module: "tickets",
 *     workspace: { workspaceId: req.workspaceId },
 *     actor: { userId: req.userId, role: req.userRole },
 *     metadata: {},
 *     data: { ticketId: 5, title: "Bug report", ... }, // TicketCreatedPayload
 *   });
 */
export type EventInput<K extends keyof EventTypeMap> = {
  type: K;
  module: string;
  workspace: WorkspaceContext;
  actor: ActorContext;
  metadata?: Partial<EventMetadata>;
  data: EventTypeMap[K];
  /** Optional — bus assigns a UUID v4 if omitted. */
  id?: EventId;
  /** Optional — bus assigns current UTC ISO-8601 time if omitted. */
  timestamp?: ISOTimestamp;
};

// ── EventBus ──────────────────────────────────────────────────────────────────

/**
 * EventBus — in-memory typed event publish/subscribe bus.
 *
 * Instantiate via createEventBus() or use the shared eventBus singleton.
 *
 * ── Error isolation guarantee ─────────────────────────────────────────────────
 * A failing listener NEVER blocks other listeners or causes emit() to reject.
 * emit() always resolves — check result.errors if you need failure details.
 *
 * ── Memory management ─────────────────────────────────────────────────────────
 * Always call unsubscribe() or use subscribeOnce() for short-lived handlers.
 * There is no automatic cleanup — listeners accumulate until explicitly removed.
 *
 * TODO: Add WeakRef-based listener GC for component-scoped subscriptions.
 */
export class EventBus {

  private readonly registry: ListenerRegistry;
  private readonly logger: BusLogger;
  private readonly verboseEmit: boolean;

  constructor(options: EventBusOptions = {}) {
    this.registry    = new ListenerRegistry();
    this.logger      = options.logger ?? consoleLogger;
    this.verboseEmit = options.verboseEmit ?? false;
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────

  /**
   * subscribe — register a persistent typed listener for a specific event type.
   *
   * TypeScript infers the payload type from the event type string automatically:
   *
   *   const token = eventBus.subscribe("ticket.created", async (event) => {
   *     event.data.ticketId  // number — inferred from EventTypeMap
   *   });
   *
   * @param type     The event type string (use EVENT_TYPES constants).
   * @param handler  Async callback receiving the typed event.
   * @returns        A SubscriptionToken — pass to unsubscribe() to deregister.
   */
  subscribe<K extends keyof EventTypeMap>(
    type: K,
    handler: TypedEventHandler<K>,
  ): SubscriptionToken {
    const id = generateId();

    // Wrap the typed handler into the AnyHandler signature for internal storage.
    // The cast is safe: emit() guarantees that only events of type K reach here.
    const wrapped: AnyHandler = (event) =>
      handler(event as unknown as TypedEvent<K, EventTypeMap[K]>);

    this.registry.add({
      id,
      eventType: type,
      handler: wrapped,
      registeredAt: new Date().toISOString(),
    });

    this.logger.debug("Listener registered", { eventType: type, listenerId: id });

    return { id, eventType: type };
  }

  /**
   * subscribeToAll — register a wildcard listener that receives every event.
   *
   * Use sparingly — wildcard listeners are called on every emit regardless
   * of event type.  Suitable for cross-cutting concerns: audit logging,
   * distributed tracing, metrics collection.
   *
   * @param handler  Async callback receiving a BaseEvent.
   *                 Narrow the type inside via switch(event.type).
   * @returns        SubscriptionToken with eventType: "*".
   */
  subscribeToAll(handler: WildcardHandler): SubscriptionToken {
    const id = generateId();

    this.registry.add({
      id,
      eventType: "*",
      handler,
      registeredAt: new Date().toISOString(),
    });

    this.logger.debug("Wildcard listener registered", { listenerId: id });

    return { id, eventType: "*" };
  }

  /**
   * subscribeOnce — register a one-shot listener that fires exactly once.
   *
   * The listener is automatically removed BEFORE it is called:
   *   - Concurrent emits cannot call it twice.
   *   - The listener does not need to call unsubscribe() itself.
   *
   * @param type     The event type string.
   * @param handler  Async callback — called at most once, then discarded.
   * @returns        SubscriptionToken (becomes invalid after the first call).
   */
  subscribeOnce<K extends keyof EventTypeMap>(
    type: K,
    handler: TypedEventHandler<K>,
  ): SubscriptionToken {
    const id = generateId();
    // Guard flag prevents duplicate invocations from concurrent emits.
    let consumed = false;

    const wrapped: AnyHandler = async (event) => {
      // Remove before calling — guarantees at-most-once semantics.
      if (consumed) return;
      consumed = true;
      this.registry.remove(id);
      await handler(event as unknown as TypedEvent<K, EventTypeMap[K]>);
    };

    this.registry.add({
      id,
      eventType: type,
      handler: wrapped,
      registeredAt: new Date().toISOString(),
    });

    this.logger.debug("Once listener registered", { eventType: type, listenerId: id });

    return { id, eventType: type };
  }

  // ── Unsubscribe ────────────────────────────────────────────────────────────

  /**
   * unsubscribe — remove a listener by its SubscriptionToken.
   *
   * Safe to call on an already-removed token — returns false without error.
   *
   * @param token  The token returned by subscribe / subscribeOnce / subscribeToAll.
   * @returns      true if found and removed; false if not found.
   */
  unsubscribe(token: SubscriptionToken): boolean {
    const removed = this.registry.remove(token.id);
    if (removed) {
      this.logger.debug("Listener removed", {
        eventType: token.eventType,
        listenerId: token.id,
      });
    }
    return removed;
  }

  // ── Emit ──────────────────────────────────────────────────────────────────

  /**
   * emit — publish a typed event to all matching listeners.
   *
   * The bus fills in id, timestamp, metadata.correlationId, and
   * metadata.schemaVersion if the producer omits them.
   *
   * All matching listeners (specific + wildcard) run concurrently.
   * A listener that rejects does NOT prevent other listeners from running.
   * emit() always resolves — check result.errors for failures.
   *
   * @param input  EventInput<K> — id and timestamp are optional.
   * @returns      EmitResult — always resolves, never rejects.
   *
   * Example:
   *   const result = await eventBus.emit({
   *     type: "employee.created",
   *     module: "users",
   *     workspace: { workspaceId: 1 },
   *     actor: { userId: adminId, role: "admin" },
   *     metadata: {},
   *     data: { employeeUserId: 42, employeeNumber: "EMP-001", fullName: "..." },
   *   });
   */
  async emit<K extends keyof EventTypeMap>(
    input: EventInput<K>,
  ): Promise<EmitResult> {
    const startMs = Date.now();

    // ── Fill in envelope fields the producer may have omitted ────────────────
    const eventId   = input.id ?? generateId();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const metadata: EventMetadata = {
      correlationId:  input.metadata?.correlationId ?? generateId(),
      causationId:    input.metadata?.causationId,
      schemaVersion:  input.metadata?.schemaVersion ?? 1,
      source:         input.metadata?.source,
      idempotencyKey: input.metadata?.idempotencyKey,
    };

    // Build the BaseEvent envelope (also structurally a TypedEvent<K, EventTypeMap[K]>).
    const event: BaseEvent = {
      id:        eventId,
      type:      input.type,
      module:    input.module,
      workspace: input.workspace,
      actor:     input.actor,
      metadata,
      data:      input.data as unknown as Record<string, unknown>,
      timestamp,
    };

    return this.fanOut(event, startMs);
  }

  /**
   * emitEvent — publish a fully-constructed AnyTypedEvent directly.
   *
   * Use when you already have a complete TypedEvent object (e.g. when
   * re-emitting an event from a store, or in tests with pre-built fixtures).
   *
   * Unlike emit(), this method does NOT fill in missing envelope fields —
   * the event is emitted as-is.  Ensure id and timestamp are set.
   *
   * @param event  Any typed event from the AnyTypedEvent union.
   * @returns      EmitResult — always resolves, never rejects.
   */
  async emitEvent(event: AnyTypedEvent): Promise<EmitResult> {
    const startMs = Date.now();
    // AnyTypedEvent is structurally compatible with BaseEvent at runtime.
    return this.fanOut(event as unknown as BaseEvent, startMs);
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * stats — return a diagnostic snapshot of current bus state.
   * Useful for health check endpoints and observability dashboards.
   */
  stats(): BusStats {
    const byEventType = this.registry.snapshot();
    const totalListeners = Object.values(byEventType).reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    return { totalListeners, byEventType };
  }

  /**
   * listenerCount — how many listeners are registered for a specific event type.
   * @param type  Event type string, or omit for total across all types.
   */
  listenerCount(type?: string): number {
    return this.registry.count(type);
  }

  /**
   * clearAll — remove all registered listeners.
   *
   * Primarily for use in test teardown.
   * Do NOT call in production code — it silently breaks all subscriptions.
   */
  clearAll(): void {
    this.registry.clear();
    this.logger.warn("All listeners cleared — only call this in tests");
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * fanOut — the core dispatch logic.
   *
   * Finds all listeners for the event's type string (specific + wildcard),
   * invokes them all concurrently via Promise.allSettled, and collects results.
   *
   * Error isolation: a rejected listener logs the error and adds it to
   * EmitResult.errors — it does NOT cause fanOut() to reject.
   */
  private async fanOut(event: BaseEvent, startMs: number): Promise<EmitResult> {
    const listeners = this.registry.getForEvent(event.type);

    if (this.verboseEmit) {
      this.logger.debug("Emitting event", {
        eventType:     event.type,
        eventId:       event.id,
        listenerCount: listeners.length,
        workspaceId:   event.workspace.workspaceId,
      });
    }

    if (listeners.length === 0) {
      return {
        eventType:          event.type,
        eventId:            event.id,
        listenersInvoked:   0,
        listenersSucceeded: 0,
        errors:             [],
        durationMs:         Date.now() - startMs,
      };
    }

    // Run all listeners concurrently.
    // Promise.allSettled never rejects — each result is { status, value/reason }.
    //
    // ── Global synchronous error boundary ────────────────────────────────────
    // Each handler call is wrapped in a try/catch BEFORE being passed to
    // Promise.allSettled.  Without this wrapper, a synchronous throw inside a
    // listener (e.g. `throw new Error(...)` before any `await`) would propagate
    // out of the .map() callback synchronously — Promise.allSettled would never
    // receive that array element, leaving the settled array shorter than
    // listeners[], silently skipping the error-accounting loop below.
    //
    // The wrapper converts any sync throw into a rejected Promise, which
    // Promise.allSettled handles at the correct index.  The existing error
    // logging and EmitResult.errors collection then treats it identically
    // to an async rejection.  The emit() API and EmitResult shape are unchanged.
    const settled = await Promise.allSettled(
      listeners.map((entry) => {
        try {
          return entry.handler(event);
        } catch (syncErr) {
          return Promise.reject(
            syncErr instanceof Error ? syncErr : new Error(String(syncErr)),
          );
        }
      }),
    );

    const errors: ListenerError[] = [];
    let succeeded = 0;

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      const entry  = listeners[i]!;

      if (result.status === "fulfilled") {
        succeeded++;
      } else {
        const err = result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason));

        errors.push({
          listenerId: entry.id,
          eventType:  event.type,
          error:      err,
        });

        this.logger.error("Listener failed", {
          eventType:  event.type,
          eventId:    event.id,
          listenerId: entry.id,
          error:      err.message,
          stack:      err.stack,
        });
      }
    }

    const durationMs = Date.now() - startMs;

    if (errors.length > 0 && errors.length < listeners.length) {
      this.logger.warn("Some listeners failed during emit", {
        eventType:  event.type,
        total:      listeners.length,
        failed:     errors.length,
        succeeded,
        durationMs,
      });
    } else if (errors.length > 0 && errors.length === listeners.length) {
      this.logger.error("All listeners failed during emit", {
        eventType: event.type,
        eventId:   event.id,
        total:     listeners.length,
        durationMs,
      });
    }

    return {
      eventType:          event.type,
      eventId:            event.id,
      listenersInvoked:   listeners.length,
      listenersSucceeded: succeeded,
      errors,
      durationMs,
    };
  }
}

// ── Factory & singleton ────────────────────────────────────────────────────────

/**
 * createEventBus — factory function for creating EventBus instances.
 *
 * Use for:
 *   Isolated instances in unit tests.
 *   Module-scoped buses (for domain isolation in the future).
 *   Injecting a custom logger from the api-server.
 *
 * Example in api-server:
 *   import { createEventBus } from "@workspace/core-events";
 *   import { logger } from "./lib/logger";
 *
 *   export const appEventBus = createEventBus({
 *     logger: { error: logger.error.bind(logger), warn: logger.warn.bind(logger), debug: logger.debug.bind(logger) },
 *     verboseEmit: process.env.NODE_ENV !== "production",
 *   });
 */
export function createEventBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}

/**
 * eventBus — the shared in-process singleton EventBus (console logger).
 *
 * Suitable for use in libraries, shared packages, and unit tests.
 *
 * ── Do NOT use this in api-server code ───────────────────────────────────────
 * The api-server creates its own `appEventBus` instance in
 * artifacts/api-server/src/lib/events/app-bus.ts using a pino-backed logger.
 * All api-server routes and listeners import from that file instead.
 * Using this singleton in api-server would produce unstructured console output
 * instead of the pino JSON log stream.
 */
export const eventBus: EventBus = createEventBus();
