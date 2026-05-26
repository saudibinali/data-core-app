/**
 * In-memory rate limit for public contact form (per client IP).
 */

import { createRateLimiter } from "./ip-rate-limit";

const limiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 8,
  burstWindowMs: 60 * 1000,
  maxBurst: 2,
});

export function checkContactRateLimit(clientKey: string): { allowed: boolean; retryAfterSec?: number } {
  return limiter.check(clientKey);
}

export function resetContactRateLimitForTests(): void {
  limiter.resetForTests();
}
