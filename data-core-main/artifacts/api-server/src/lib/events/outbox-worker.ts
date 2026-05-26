/**
 * F7.2 — Poll event_outbox and publish to appEventBus (no Redis).
 */
import { logger } from "../logger";
import { processEventOutboxBatch, shouldDrainEventOutbox } from "./outbox";

const INTERVAL_MS = Number(process.env.EVENT_OUTBOX_POLL_MS ?? 5_000);
let handle: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function startEventOutboxWorker(): void {
  if (!shouldDrainEventOutbox()) {
    logger.info("Event outbox worker disabled (EVENT_OUTBOX_PUBLISH_MODE=direct and EVENT_OUTBOX_DRAIN unset)");
    return;
  }
  if (handle) return;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const n = await processEventOutboxBatch();
      if (n > 0) {
        logger.debug({ processed: n }, "event outbox batch drained");
      }
    } catch (err) {
      logger.warn({ err }, "event outbox worker tick failed");
    } finally {
      ticking = false;
    }
  };

  void tick();
  handle = setInterval(() => void tick(), INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "Event outbox worker started");
}

export function stopEventOutboxWorker(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
