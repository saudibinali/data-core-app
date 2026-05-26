/**
 * F1.3 — Login brute-force mitigation: 5 attempts / 15 min / IP.
 */

import { createRateLimiter } from "./ip-rate-limit";
import { isSecurityStrict } from "./security-config";

const limiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxPerWindow: 5,
});

export function checkLoginRateLimit(clientKey: string): { allowed: boolean; retryAfterSec?: number } {
  if (!isSecurityStrict()) return { allowed: true };
  return limiter.check(clientKey);
}

export function resetLoginRateLimitForTests(): void {
  limiter.resetForTests();
}
