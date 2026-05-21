/**
 * @package     @workspace/core-events
 * @file        listener-registry.ts
 * @purpose     Lightweight in-memory listener registry — the internal data
 *              structure that backs the EventBus.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * A thin Map wrapper that stores handler functions keyed by event type string.
 * It has no knowledge of typed payloads — type safety lives in bus.ts.
 * The registry operates purely on erased `AnyHandler` functions.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * • Not a queue — emit is synchronous fan-out, not enqueue/dequeue
 * • Not persistent — all registrations live in process memory
 * • Not distributed — single-process only in this implementation
 *
 * ── Lifecycle ────────────────────────────────────────────────────────────────
 *   subscribe()      → ListenerRegistry.add()
 *   unsubscribe()    → ListenerRegistry.remove()
 *   emit() fan-out   → ListenerRegistry.getForEvent()
 *   shutdown/test    → ListenerRegistry.clear()
 *
 * ── Internal-only ────────────────────────────────────────────────────────────
 * This module is NOT re-exported from index.ts.
 * Only bus.ts imports it — it is an implementation detail.
 *
 * ── TODO: Distributed extension point ────────────────────────────────────────
 * When moving to Redis Streams / Kafka / BullMQ, replace `ListenerRegistry`
 * with a network-backed registry adapter.  The `EventBus` class in bus.ts
 * receives the registry via constructor injection, making the swap transparent
 * to all subscriber call sites.
 */

import type { BaseEvent } from "./types";

// ── Internal handler type (type-erased) ───────────────────────────────────────

/**
 * AnyHandler — the erased handler signature stored inside the registry.
 *
 * All type information is stripped here.  The EventBus restores type safety
 * at the subscribe/emit boundary using TypeScript generics.
 *
 * The handler receives a `BaseEvent` reference — it is always structurally
 * a `TypedEvent<K, EventTypeMap[K]>` at runtime because the EventBus only
 * routes events to handlers registered for the matching type string.
 */
export type AnyHandler = (event: BaseEvent) => Promise<void>;

// ── Listener entry ─────────────────────────────────────────────────────────────

/**
 * ListenerEntry — one registered listener slot in the registry.
 *
 * Immutable after creation.  The `id` is the handle used for unsubscription.
 */
export interface ListenerEntry {
  /** Unique ID for this subscription — used as the unsubscription handle. */
  readonly id: string;

  /** The event type this listener is registered for, or "*" for wildcard. */
  readonly eventType: string;

  /** The actual handler function to call. */
  readonly handler: AnyHandler;

  /** Wall-clock time when this listener was registered. */
  readonly registeredAt: string;
}

// ── Snapshot type ─────────────────────────────────────────────────────────────

/** Diagnostic snapshot: maps each registered event type to listener count. */
export type RegistrySnapshot = Record<string, number>;

// ── ListenerRegistry ──────────────────────────────────────────────────────────

/**
 * ListenerRegistry — the backing store for all EventBus subscriptions.
 *
 * Each event type key maps to an ordered array of listener entries.
 * The wildcard key "*" maps to listeners that receive every event.
 *
 * Thread safety: JavaScript is single-threaded — no locking is needed.
 * Concurrent async emissions share the same microtask queue safely.
 */
export class ListenerRegistry {

  /**
   * Internal storage.
   * Keys: event type strings (e.g. "ticket.created") or "*" for wildcard.
   * Values: ordered array of listener entries for that key.
   */
  private readonly map = new Map<string, ListenerEntry[]>();

  // ── Mutation ───────────────────────────────────────────────────────────────

  /**
   * Register a new listener entry.
   *
   * @param entry  The listener entry to store.  Must have a unique `id`.
   */
  add(entry: ListenerEntry): void {
    const existing = this.map.get(entry.eventType) ?? [];
    this.map.set(entry.eventType, [...existing, entry]);
  }

  /**
   * Remove a listener by its subscription ID.
   *
   * Searches across all event type buckets.
   *
   * @param id   The subscription ID returned when subscribing.
   * @returns    `true` if the listener was found and removed; `false` if not found.
   */
  remove(id: string): boolean {
    for (const [eventType, entries] of this.map.entries()) {
      const next = entries.filter((e) => e.id !== id);
      if (next.length < entries.length) {
        if (next.length === 0) {
          this.map.delete(eventType);
        } else {
          this.map.set(eventType, next);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Remove all listeners across all event types.
   * Primarily used in tests to reset state between test cases.
   */
  clear(): void {
    this.map.clear();
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Get all listeners that should be called when `eventType` is emitted.
   *
   * Returns the union of:
   *   1. Listeners registered for the exact event type string.
   *   2. Wildcard ("*") listeners registered via `subscribeToAll()`.
   *
   * Order: specific listeners first, then wildcard listeners.
   * This ordering is stable and predictable.
   *
   * @param eventType  The event type string being emitted.
   * @returns          Ordered array of matching listener entries.
   */
  getForEvent(eventType: string): ListenerEntry[] {
    const specific = this.map.get(eventType) ?? [];
    const wildcard = this.map.get("*") ?? [];
    return [...specific, ...wildcard];
  }

  /**
   * Count registered listeners.
   *
   * @param eventType  If provided, count only listeners for that type.
   *                   If omitted, return the total across all event types.
   * @returns          Listener count.
   */
  count(eventType?: string): number {
    if (eventType !== undefined) {
      return (this.map.get(eventType) ?? []).length;
    }
    let total = 0;
    for (const entries of this.map.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * Diagnostic snapshot of all registered listeners.
   * Returns a plain object mapping each event type to its listener count.
   * Useful for health checks and debugging.
   */
  snapshot(): RegistrySnapshot {
    const result: RegistrySnapshot = {};
    for (const [type, entries] of this.map.entries()) {
      result[type] = entries.length;
    }
    return result;
  }
}
