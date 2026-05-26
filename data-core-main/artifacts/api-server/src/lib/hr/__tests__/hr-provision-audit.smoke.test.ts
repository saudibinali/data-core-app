/**
 * F4.3 — HR provision idempotency helpers (unit)
 */
import { describe, it, expect } from "vitest";
import {
  buildRequestFingerprint,
  readIdempotencyKeyFromHeaders,
  storageIdempotencyKey,
} from "../hr-provision-audit";

describe("F4.3 HR provision idempotency (unit)", () => {
  it("reads Idempotency-Key header case-insensitively", () => {
    expect(readIdempotencyKeyFromHeaders({ "idempotency-key": "abc-123" })).toBe("abc-123");
    expect(readIdempotencyKeyFromHeaders({ "Idempotency-Key": "xyz" })).toBe("xyz");
    expect(readIdempotencyKeyFromHeaders({})).toBeNull();
    expect(readIdempotencyKeyFromHeaders({ "idempotency-key": "" })).toBeNull();
  });

  it("scopes storage keys per workspace", () => {
    const k1 = storageIdempotencyKey(1, "client-key");
    const k2 = storageIdempotencyKey(2, "client-key");
    expect(k1).not.toBe(k2);
    expect(k1).toHaveLength(64);
  });

  it("builds stable request fingerprints", () => {
    const a = buildRequestFingerprint({ op: "employee_account", employeeId: 5, role: "member" });
    const b = buildRequestFingerprint({ role: "member", employeeId: 5, op: "employee_account" });
    const c = buildRequestFingerprint({ op: "employee_account", employeeId: 6, role: "member" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
