/**
 * F1 — Security hardening unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertProductionSecrets,
  isSecurityStrict,
  isWeakJwtSecret,
  DEFAULT_JWT_SECRET,
} from "../security-config";
import { createRateLimiter } from "../ip-rate-limit";
import { checkLoginRateLimit, resetLoginRateLimitForTests } from "../login-rate-limit";
import { resolveCorsOrigin, setAllowedCorsOriginsForTests } from "../cors-settings";

describe("F1.1 JWT secret enforcement", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("rejects default JWT secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = DEFAULT_JWT_SECRET;
    expect(() => assertProductionSecrets()).toThrow(/JWT_SECRET/);
  });

  it("allows strong JWT secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(64);
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("does not enforce in development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("flags weak secrets", () => {
    expect(isWeakJwtSecret("changeme")).toBe(true);
    expect(isWeakJwtSecret("a".repeat(64))).toBe(false);
  });
});

describe("F1.3 rate limiting", () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
    process.env.SECURITY_STRICT = "true";
  });

  it("blocks login after 5 attempts per IP", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit("1.2.3.4").allowed).toBe(true);
    }
    const blocked = checkLoginRateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("is disabled when SECURITY_STRICT=false", () => {
    process.env.SECURITY_STRICT = "false";
    for (let i = 0; i < 10; i++) {
      expect(checkLoginRateLimit("9.9.9.9").allowed).toBe(true);
    }
  });

  it("generic limiter enforces burst window", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerWindow: 10,
      burstWindowMs: 1_000,
      maxBurst: 1,
    });
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });
});

describe("F1.4 CORS resolution", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.SECURITY_STRICT = "true";
    process.env.APP_URL = "https://app.example.com";
    setAllowedCorsOriginsForTests(["https://app.example.com"]);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("allows whitelisted origin in production strict mode", () => {
    const cb = vi.fn();
    resolveCorsOrigin("https://app.example.com", cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("denies unknown origin in production strict mode", () => {
    const cb = vi.fn();
    resolveCorsOrigin("https://evil.example.com", cb);
    expect(cb).toHaveBeenCalledWith(null, false);
  });

  it("allows all origins in development", () => {
    process.env.NODE_ENV = "development";
    const cb = vi.fn();
    resolveCorsOrigin("https://any.example.com", cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

describe("SECURITY_STRICT flag", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to strict when unset", () => {
    delete process.env.SECURITY_STRICT;
    expect(isSecurityStrict()).toBe(true);
  });

  it("can be disabled for rollback", () => {
    process.env.SECURITY_STRICT = "false";
    expect(isSecurityStrict()).toBe(false);
  });
});
