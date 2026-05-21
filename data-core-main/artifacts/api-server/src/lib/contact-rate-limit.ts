/**
 * In-memory rate limit for public contact form (per client IP).
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const BURST_WINDOW_MS = 60 * 1000;
const MAX_BURST = 2;

interface Entry {
  timestamps: number[];
}

const store = new Map<string, Entry>();

function prune(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

export function checkContactRateLimit(clientKey: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let entry = store.get(clientKey);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(clientKey, entry);
  }

  entry.timestamps = prune(entry.timestamps, now);

  const recentBurst = entry.timestamps.filter((t) => now - t < BURST_WINDOW_MS);
  if (recentBurst.length >= MAX_BURST) {
    return { allowed: false, retryAfterSec: 60 };
  }

  if (entry.timestamps.length >= MAX_PER_WINDOW) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSec: Math.min(retryAfterSec, 3600) };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

export function resetContactRateLimitForTests(): void {
  store.clear();
}
