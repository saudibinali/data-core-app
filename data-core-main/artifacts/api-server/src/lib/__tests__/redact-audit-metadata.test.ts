/**
 * redact-audit-metadata.test.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * T3: redactAuditMetadata - all sensitive key patterns, recursive, case-insensitive
 */

import { describe, it, expect } from "vitest";
import {
  redactAuditMetadata,
  parseAndRedactMetadata,
  SENSITIVE_KEY_PATTERNS,
  REDACTED_VALUE,
} from "../redact-audit-metadata";

const R = REDACTED_VALUE;

// ── T3: Core redaction ────────────────────────────────────────────────────────

describe("T3 - redactAuditMetadata", () => {
  it("redacts 'password' key", () => {
    const result = redactAuditMetadata({ password: "secret123", name: "Alice" });
    expect((result as Record<string, unknown>)["password"]).toBe(R);
    expect((result as Record<string, unknown>)["name"]).toBe("Alice");
  });

  it("redacts 'token' key", () => {
    const result = redactAuditMetadata({ token: "abc123", action: "login" }) as Record<string, unknown>;
    expect(result["token"]).toBe(R);
    expect(result["action"]).toBe("login");
  });

  it("redacts 'secret' key", () => {
    const result = redactAuditMetadata({ secret: "my-secret" }) as Record<string, unknown>;
    expect(result["secret"]).toBe(R);
  });

  it("redacts 'apiKey' key (camelCase)", () => {
    const result = redactAuditMetadata({ apiKey: "key-xyz" }) as Record<string, unknown>;
    expect(result["apiKey"]).toBe(R);
  });

  it("redacts 'api_key' key (snake_case - contains 'apikey' after stripping)", () => {
    const result = redactAuditMetadata({ api_key: "key-xyz" }) as Record<string, unknown>;
    expect(result["api_key"]).toBe(R);
  });

  it("redacts 'authorization' key", () => {
    const result = redactAuditMetadata({ authorization: "Bearer abc" }) as Record<string, unknown>;
    expect(result["authorization"]).toBe(R);
  });

  it("redacts 'cookie' key", () => {
    const result = redactAuditMetadata({ cookie: "session=xyz" }) as Record<string, unknown>;
    expect(result["cookie"]).toBe(R);
  });

  it("redacts 'credential' key", () => {
    const result = redactAuditMetadata({ credential: "mycred" }) as Record<string, unknown>;
    expect(result["credential"]).toBe(R);
  });

  it("is case-insensitive - PASSWORD, Token, SECRET all redacted", () => {
    const result = redactAuditMetadata({
      PASSWORD: "x",
      Token: "y",
      SECRET: "z",
      email: "a@b.com",
    }) as Record<string, unknown>;
    expect(result["PASSWORD"]).toBe(R);
    expect(result["Token"]).toBe(R);
    expect(result["SECRET"]).toBe(R);
    expect(result["email"]).toBe("a@b.com");
  });

  it("preserves non-sensitive fields unchanged", () => {
    const result = redactAuditMetadata({
      userId: 42,
      action: "status_change",
      result: "success",
      reason: "Operational need",
      targetEmail: "user@example.com",
    }) as Record<string, unknown>;
    expect(result["userId"]).toBe(42);
    expect(result["action"]).toBe("status_change");
    expect(result["result"]).toBe("success");
    expect(result["reason"]).toBe("Operational need");
    expect(result["targetEmail"]).toBe("user@example.com");
  });

  it("recursive redaction in nested objects", () => {
    const result = redactAuditMetadata({
      actor: { id: 1, password: "nested-secret", email: "a@b.com" },
      meta: { token: "abc" },
    }) as Record<string, Record<string, unknown>>;
    expect(result["actor"]["password"]).toBe(R);
    expect(result["actor"]["email"]).toBe("a@b.com");
    expect(result["meta"]["token"]).toBe(R);
  });

  it("recursive redaction in arrays", () => {
    const result = redactAuditMetadata([
      { id: 1, secret: "s1" },
      { id: 2, secret: "s2" },
    ]) as Array<Record<string, unknown>>;
    expect(result[0]["secret"]).toBe(R);
    expect(result[1]["secret"]).toBe(R);
    expect(result[0]["id"]).toBe(1);
    expect(result[1]["id"]).toBe(2);
  });

  it("deeply nested redaction", () => {
    const result = redactAuditMetadata({
      level1: { level2: { level3: { password: "deep-secret", id: 99 } } },
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    expect(result["level1"]["level2"]["level3"]["password"]).toBe(R);
    expect(result["level1"]["level2"]["level3"]["id"]).toBe(99);
  });

  it("handles null input gracefully", () => {
    expect(redactAuditMetadata(null)).toBeNull();
    expect(redactAuditMetadata(undefined)).toBeUndefined();
  });

  it("handles primitive inputs", () => {
    expect(redactAuditMetadata("hello")).toBe("hello");
    expect(redactAuditMetadata(42)).toBe(42);
    expect(redactAuditMetadata(true)).toBe(true);
  });

  it("handles empty object", () => {
    const result = redactAuditMetadata({});
    expect(result).toEqual({});
  });

  it("SENSITIVE_KEY_PATTERNS contains all 7 patterns", () => {
    expect(SENSITIVE_KEY_PATTERNS).toContain("password");
    expect(SENSITIVE_KEY_PATTERNS).toContain("token");
    expect(SENSITIVE_KEY_PATTERNS).toContain("secret");
    expect(SENSITIVE_KEY_PATTERNS).toContain("apikey");
    expect(SENSITIVE_KEY_PATTERNS).toContain("authorization");
    expect(SENSITIVE_KEY_PATTERNS).toContain("cookie");
    expect(SENSITIVE_KEY_PATTERNS).toContain("credential");
    expect(SENSITIVE_KEY_PATTERNS).toHaveLength(7);
  });
});

// ── parseAndRedactMetadata ────────────────────────────────────────────────────

describe("parseAndRedactMetadata", () => {
  it("parses and redacts a valid JSON string", () => {
    const json = JSON.stringify({ userId: 1, password: "abc", reason: "test" });
    const result = parseAndRedactMetadata(json);
    expect(result).not.toBeNull();
    expect(result!["password"]).toBe(R);
    expect(result!["userId"]).toBe(1);
    expect(result!["reason"]).toBe("test");
  });

  it("returns null for null input", () => {
    expect(parseAndRedactMetadata(null)).toBeNull();
    expect(parseAndRedactMetadata(undefined)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseAndRedactMetadata("not-json{")).toBeNull();
    expect(parseAndRedactMetadata("{bad")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAndRedactMetadata("")).toBeNull();
  });

  it("handles nested sensitive fields in JSON string", () => {
    const json = JSON.stringify({
      actor: { id: 5, token: "secret-token" },
      targetEmail: "x@example.com",
    });
    const result = parseAndRedactMetadata(json);
    const actor = result!["actor"] as Record<string, unknown>;
    expect(actor["token"]).toBe(R);
    expect(result!["targetEmail"]).toBe("x@example.com");
  });
});
