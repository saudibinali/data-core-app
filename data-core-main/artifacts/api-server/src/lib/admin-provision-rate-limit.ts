/**
 * F1.3 — Per-admin rate limit for user provisioning POST endpoints.
 */

import type { Response, NextFunction } from "express";
import { createRateLimiter } from "./ip-rate-limit";
import { isSecurityStrict } from "./security-config";
import type { AuthRequest } from "../middlewares/requireAuth";

const limiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxPerWindow: 30,
});

export function checkAdminProvisionRateLimit(adminUserId: number): { allowed: boolean; retryAfterSec?: number } {
  if (!isSecurityStrict()) return { allowed: true };
  return limiter.check(`admin:${adminUserId}`);
}

export function resetAdminProvisionRateLimitForTests(): void {
  limiter.resetForTests();
}

export function requireAdminProvisionRateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rate = checkAdminProvisionRateLimit(req.userId);
  if (!rate.allowed) {
    res.status(429).json({
      error: "Too many provisioning requests. Please try again later.",
      code: "RATE_LIMITED",
      retryAfterSec: rate.retryAfterSec,
    });
    return;
  }

  next();
}
