/**
 * Generic in-memory sliding-window rate limiter (F1.3 pattern).
 */

export interface RateLimitConfig {
  windowMs: number;
  maxPerWindow: number;
  burstWindowMs?: number;
  maxBurst?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

export interface RateLimiter {
  check(clientKey: string): RateLimitResult;
  resetForTests(): void;
}

function prune(timestamps: number[], windowMs: number, now: number): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const store = new Map<string, { timestamps: number[] }>();

  return {
    check(clientKey: string): RateLimitResult {
      const now = Date.now();
      let entry = store.get(clientKey);
      if (!entry) {
        entry = { timestamps: [] };
        store.set(clientKey, entry);
      }

      entry.timestamps = prune(entry.timestamps, config.windowMs, now);

      if (config.burstWindowMs != null && config.maxBurst != null) {
        const recentBurst = entry.timestamps.filter((t) => now - t < config.burstWindowMs!);
        if (recentBurst.length >= config.maxBurst) {
          return { allowed: false, retryAfterSec: Math.ceil(config.burstWindowMs / 1000) };
        }
      }

      if (entry.timestamps.length >= config.maxPerWindow) {
        const oldest = entry.timestamps[0] ?? now;
        const retryAfterSec = Math.ceil((config.windowMs - (now - oldest)) / 1000);
        return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
      }

      entry.timestamps.push(now);
      return { allowed: true };
    },

    resetForTests(): void {
      store.clear();
    },
  };
}
