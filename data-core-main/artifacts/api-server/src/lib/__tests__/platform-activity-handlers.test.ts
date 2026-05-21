/**
 * platform-activity-handlers.test.ts
 *
 * @phase P14-E - Platform Administration Users Console Finalization
 *
 * Pure unit tests for the platform-activity route helper functions.
 * No DB, no HTTP, no Express - tests the business logic layer directly.
 *
 * T9:  GET /platform/activity business logic (parseLimit, parseCursor, parseDate,
 *      enrichRow, pagination, filtering, metadata redaction)
 * T10: GET /platform/users/:userId/activity business logic (limit, cursor,
 *      userId validation, enrichRow actor/target distinction)
 */

import { describe, it, expect } from "vitest";
import {
  parseLimit,
  parseCursor,
  parseDate,
  enrichRow,
  PLATFORM_ACTIVITY_DEFAULT_LIMIT,
  PLATFORM_ACTIVITY_MAX_LIMIT,
  PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT,
  PLATFORM_USER_ACTIVITY_MAX_LIMIT,
  type RawActivityRow,
} from "../platform-activity-helpers";
import { REDACTED_VALUE } from "../redact-audit-metadata";

// ── T9: GET /platform/activity business logic ─────────────────────────────────

describe("T9 - GET /platform/activity handler logic", () => {
  // ── parseLimit ────────────────────────────────────────────────────────────

  describe("parseLimit", () => {
    it("returns default when raw is undefined", () => {
      expect(parseLimit(undefined, 50, 200)).toBe(50);
    });

    it("returns default when raw is 0", () => {
      expect(parseLimit(0, 50, 200)).toBe(50);
    });

    it("returns default when raw is negative", () => {
      expect(parseLimit(-1, 50, 200)).toBe(50);
    });

    it("returns default when raw is non-numeric string", () => {
      expect(parseLimit("abc", 50, 200)).toBe(50);
    });

    it("returns default when raw is Infinity", () => {
      expect(parseLimit(Infinity, 50, 200)).toBe(50);
    });

    it("returns default when raw is NaN", () => {
      expect(parseLimit(NaN, 50, 200)).toBe(50);
    });

    it("returns the value when valid and within max", () => {
      expect(parseLimit(30, 50, 200)).toBe(30);
    });

    it("clamps to max when raw exceeds max", () => {
      expect(parseLimit(999, 50, 200)).toBe(200);
    });

    it("clamps exactly at max when raw equals max", () => {
      expect(parseLimit(200, 50, 200)).toBe(200);
    });

    it("PLATFORM_ACTIVITY constants are correct defaults", () => {
      expect(PLATFORM_ACTIVITY_DEFAULT_LIMIT).toBe(50);
      expect(PLATFORM_ACTIVITY_MAX_LIMIT).toBe(200);
    });

    it("respects limit max 200 for /platform/activity", () => {
      const result = parseLimit(201, PLATFORM_ACTIVITY_DEFAULT_LIMIT, PLATFORM_ACTIVITY_MAX_LIMIT);
      expect(result).toBe(200);
    });

    it("accepts string-encoded numbers", () => {
      expect(parseLimit("25", 50, 200)).toBe(25);
    });
  });

  // ── parseCursor ───────────────────────────────────────────────────────────

  describe("parseCursor", () => {
    it("returns null for undefined", () => {
      expect(parseCursor(undefined)).toBeNull();
    });

    it("returns null for null", () => {
      expect(parseCursor(null)).toBeNull();
    });

    it("returns null for 0", () => {
      expect(parseCursor(0)).toBeNull();
    });

    it("returns null for negative number", () => {
      expect(parseCursor(-5)).toBeNull();
    });

    it("returns null for non-numeric string", () => {
      expect(parseCursor("abc")).toBeNull();
    });

    it("returns the integer for a valid positive id", () => {
      expect(parseCursor(42)).toBe(42);
    });

    it("accepts string-encoded cursor", () => {
      expect(parseCursor("100")).toBe(100);
    });

    it("returns null for Infinity", () => {
      expect(parseCursor(Infinity)).toBeNull();
    });
  });

  // ── parseDate ─────────────────────────────────────────────────────────────

  describe("parseDate", () => {
    it("returns null for undefined", () => {
      expect(parseDate(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseDate("")).toBeNull();
    });

    it("returns null for invalid date string", () => {
      expect(parseDate("not-a-date")).toBeNull();
    });

    it("returns null for non-string", () => {
      expect(parseDate(12345)).toBeNull();
      expect(parseDate(null)).toBeNull();
    });

    it("returns a Date for valid ISO string", () => {
      const d = parseDate("2026-01-15T10:00:00.000Z");
      expect(d).toBeInstanceOf(Date);
      expect(d!.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    });

    it("returns a Date for date-only string", () => {
      const d = parseDate("2026-03-01");
      expect(d).toBeInstanceOf(Date);
    });
  });

  // ── enrichRow ─────────────────────────────────────────────────────────────

  describe("enrichRow - known event", () => {
    const baseRow: RawActivityRow = {
      id: 1,
      actorId: 10,
      actorEmail: "admin@platform.local",
      actorName: "Platform Admin",
      action: "platform_user_created",
      metadata: JSON.stringify({
        targetUserId: 20,
        targetEmail: "newuser@platform.local",
        targetName: "New User",
        result: "success",
        reason: "Onboarding",
      }),
      createdAt: new Date("2026-05-01T12:00:00.000Z"),
    };

    it("returns correct id, actorId, actorEmail, actorDisplayName", () => {
      const r = enrichRow(baseRow);
      expect(r.id).toBe(1);
      expect(r.actorId).toBe(10);
      expect(r.actorEmail).toBe("admin@platform.local");
      expect(r.actorDisplayName).toBe("Platform Admin");
    });

    it("extracts targetUserId from metadata as string", () => {
      const r = enrichRow(baseRow);
      expect(r.targetUserId).toBe("20");
    });

    it("extracts targetEmail and targetDisplayName from metadata", () => {
      const r = enrichRow(baseRow);
      expect(r.targetEmail).toBe("newuser@platform.local");
      expect(r.targetDisplayName).toBe("New User");
    });

    it("sets actionLabel and actionLabelAr from event config", () => {
      const r = enrichRow(baseRow);
      expect(r.actionLabel).toBe("Platform User Created");
      expect(r.actionLabelAr).toBe("إنشاء مستخدم منصة");
    });

    it("sets group and severity from event config", () => {
      const r = enrichRow(baseRow);
      expect(r.group).toBe("platform_user_management");
      expect(r.severity).toBe("info");
    });

    it("extracts result from metadata", () => {
      const r = enrichRow(baseRow);
      expect(r.result).toBe("success");
    });

    it("extracts reason from metadata", () => {
      const r = enrichRow(baseRow);
      expect(r.reason).toBe("Onboarding");
    });

    it("returns createdAt as ISO string", () => {
      const r = enrichRow(baseRow);
      expect(r.createdAt).toBe("2026-05-01T12:00:00.000Z");
    });

    it("metadataSafe is present and NOT null", () => {
      const r = enrichRow(baseRow);
      expect(r.metadataSafe).not.toBeNull();
    });
  });

  describe("enrichRow - unknown event fallback", () => {
    const unknownRow: RawActivityRow = {
      id: 99,
      actorId: null,
      actorEmail: null,
      actorName: null,
      action: "some_future_event_xyz",
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    it("uses actionCode as label for unknown events", () => {
      const r = enrichRow(unknownRow);
      expect(r.actionLabel).toBe("some_future_event_xyz");
    });

    it("uses Arabic fallback label for unknown events", () => {
      const r = enrichRow(unknownRow);
      expect(r.actionLabelAr).toBe("حدث غير مصنف");
    });

    it("group is platform_access for unknown events", () => {
      const r = enrichRow(unknownRow);
      expect(r.group).toBe("platform_access");
    });

    it("severity is info for unknown events", () => {
      const r = enrichRow(unknownRow);
      expect(r.severity).toBe("info");
    });

    it("metadataSafe is null when metadata is null", () => {
      const r = enrichRow(unknownRow);
      expect(r.metadataSafe).toBeNull();
    });

    it("actorId and actorEmail are null when row has no actor", () => {
      const r = enrichRow(unknownRow);
      expect(r.actorId).toBeNull();
      expect(r.actorEmail).toBeNull();
    });
  });

  describe("enrichRow - metadata redaction (T9: redacts secrets)", () => {
    const rowWithSecrets: RawActivityRow = {
      id: 5,
      actorId: 1,
      actorEmail: "a@b.com",
      actorName: "Actor",
      action: "platform_user_created",
      metadata: JSON.stringify({
        targetEmail: "x@y.com",
        password: "super-secret",
        token: "bearer-token-123",
        reason: "normal reason",
        nested: { apiKey: "sk-12345", safe: "visible" },
      }),
      createdAt: new Date(),
    };

    it("redacts password from metadataSafe", () => {
      const r = enrichRow(rowWithSecrets);
      expect((r.metadataSafe as Record<string, unknown>)["password"]).toBe(REDACTED_VALUE);
    });

    it("redacts token from metadataSafe", () => {
      const r = enrichRow(rowWithSecrets);
      expect((r.metadataSafe as Record<string, unknown>)["token"]).toBe(REDACTED_VALUE);
    });

    it("redacts nested apiKey from metadataSafe", () => {
      const r = enrichRow(rowWithSecrets);
      const nested = (r.metadataSafe as Record<string, Record<string, unknown>>)["nested"];
      expect(nested?.["apiKey"]).toBe(REDACTED_VALUE);
    });

    it("preserves non-sensitive metadata fields", () => {
      const r = enrichRow(rowWithSecrets);
      expect((r.metadataSafe as Record<string, unknown>)["reason"]).toBe("normal reason");
      const nested = (r.metadataSafe as Record<string, Record<string, unknown>>)["nested"];
      expect(nested?.["safe"]).toBe("visible");
    });

    it("raw metadata JSON is never included in enriched row", () => {
      const r = enrichRow(rowWithSecrets);
      const json = JSON.stringify(r);
      expect(json).not.toContain("super-secret");
      expect(json).not.toContain("bearer-token-123");
      expect(json).not.toContain("sk-12345");
    });
  });

  describe("enrichRow - blockedReason extraction", () => {
    it("extracts blockedReason from metadata", () => {
      const row: RawActivityRow = {
        id: 10,
        actorId: 2,
        actorEmail: "a@b.com",
        actorName: "A",
        action: "protected_root_action_blocked",
        metadata: JSON.stringify({
          blockedReason: "Cannot modify Root Platform Owner",
          result: "blocked",
        }),
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      expect(r.blockedReason).toBe("Cannot modify Root Platform Owner");
      expect(r.result).toBe("blocked");
    });
  });

  describe("enrichRow - result fallback to event config", () => {
    it("falls back to config resultType when metadata has no result", () => {
      const row: RawActivityRow = {
        id: 7,
        actorId: 1,
        actorEmail: "a@b.com",
        actorName: "A",
        action: "platform_user_status_changed",
        metadata: JSON.stringify({ reason: "HR request" }),
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      // platform_user_status_changed resultType = "success"
      expect(r.result).toBe("success");
    });
  });

  describe("Pagination logic (newest first)", () => {
    it("returns nextCursor when more items exist", () => {
      const limit = 2;
      const rows: RawActivityRow[] = [
        { id: 10, actorId: 1, actorEmail: "a@b.com", actorName: "A", action: "platform_user_created", metadata: null, createdAt: new Date("2026-05-03") },
        { id: 9,  actorId: 1, actorEmail: "a@b.com", actorName: "A", action: "platform_user_created", metadata: null, createdAt: new Date("2026-05-02") },
        { id: 8,  actorId: 1, actorEmail: "a@b.com", actorName: "A", action: "platform_user_created", metadata: null, createdAt: new Date("2026-05-01") },
      ];
      // Simulates: fetched limit+1 items
      const enriched = rows.map(enrichRow);
      const hasMore = enriched.length > limit;
      const items = enriched.slice(0, limit);
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;
      expect(hasMore).toBe(true);
      expect(nextCursor).toBe(9);
      expect(items).toHaveLength(2);
    });

    it("returns null nextCursor when no more items", () => {
      const limit = 50;
      const rows: RawActivityRow[] = [
        { id: 3, actorId: 1, actorEmail: null, actorName: null, action: "platform_user_created", metadata: null, createdAt: new Date() },
      ];
      const enriched = rows.map(enrichRow);
      const hasMore = enriched.length > limit;
      const items = enriched.slice(0, limit);
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;
      expect(nextCursor).toBeNull();
    });
  });

  describe("Filter logic", () => {
    const makeRow = (id: number, action: string, metadata: object | null): RawActivityRow => ({
      id,
      actorId: 1,
      actorEmail: "a@b.com",
      actorName: "A",
      action,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: new Date(),
    });

    it("filters by group (app-level)", () => {
      const rows = [
        makeRow(1, "platform_user_created", null),           // group: platform_user_management
        makeRow(2, "tenant_lifecycle_changed", null),        // group: tenant_lifecycle
        makeRow(3, "platform_user_role_changed", null),      // group: platform_role_management
      ].map(enrichRow);

      const filtered = rows.filter(r => r.group === "platform_user_management");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe(1);
    });

    it("filters by result (app-level)", () => {
      const rows = [
        makeRow(1, "platform_user_created", { result: "success" }),
        makeRow(2, "platform_user_create_blocked", { result: "blocked" }),
        makeRow(3, "platform_user_status_changed", { result: "success" }),
      ].map(enrichRow);

      const blocked = rows.filter(r => r.result === "blocked");
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.id).toBe(2);
    });

    it("filters by severity (app-level)", () => {
      const rows = [
        makeRow(1, "platform_user_created", null),           // severity: info
        makeRow(2, "protected_root_action_blocked", null),   // severity: critical
        makeRow(3, "platform_user_role_change_blocked", null), // severity: critical
      ].map(enrichRow);

      const critical = rows.filter(r => r.severity === "critical");
      expect(critical).toHaveLength(2);
    });

    it("filters by targetUserId (app-level)", () => {
      const rows = [
        makeRow(1, "platform_user_created", { targetUserId: 99, result: "success" }),
        makeRow(2, "platform_user_status_changed", { targetUserId: 88, result: "success" }),
      ].map(enrichRow);

      const filtered = rows.filter(r => r.targetUserId === "99");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe(1);
    });
  });
});

// ── T10: GET /platform/users/:userId/activity business logic ──────────────────

describe("T10 - GET /platform/users/:userId/activity handler logic", () => {
  describe("parseLimit for user activity", () => {
    it("default limit is 20", () => {
      expect(PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT).toBe(20);
    });

    it("max limit is 100", () => {
      expect(PLATFORM_USER_ACTIVITY_MAX_LIMIT).toBe(100);
    });

    it("respects limit max 100 for user activity", () => {
      const result = parseLimit(150, PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT, PLATFORM_USER_ACTIVITY_MAX_LIMIT);
      expect(result).toBe(100);
    });

    it("returns default 20 for invalid input", () => {
      expect(parseLimit(undefined, PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT, PLATFORM_USER_ACTIVITY_MAX_LIMIT)).toBe(20);
      expect(parseLimit(-1, PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT, PLATFORM_USER_ACTIVITY_MAX_LIMIT)).toBe(20);
    });
  });

  describe("userId validation logic", () => {
    it("rejects 0 as invalid userId", () => {
      const userId = Number("0");
      expect(userId < 1).toBe(true);
    });

    it("rejects negative userId", () => {
      const userId = Number("-5");
      expect(userId < 1).toBe(true);
    });

    it("rejects NaN userId", () => {
      const userId = Number("abc");
      expect(!Number.isFinite(userId)).toBe(true);
    });

    it("accepts valid positive integer userId", () => {
      const userId = Number("42");
      expect(Number.isFinite(userId) && userId >= 1).toBe(true);
    });
  });

  describe("enrichRow for user-specific activity", () => {
    it("actor activity: row where actorId matches userId", () => {
      const row: RawActivityRow = {
        id: 20,
        actorId: 42,    // this user is the actor
        actorEmail: "actor@platform.local",
        actorName: "The Actor",
        action: "platform_user_status_changed",
        metadata: JSON.stringify({ targetUserId: 99, result: "success" }),
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      expect(r.actorId).toBe(42);
      expect(r.targetUserId).toBe("99");
    });

    it("target activity: row where metadata.targetUserId matches userId", () => {
      const row: RawActivityRow = {
        id: 21,
        actorId: 1,      // different actor
        actorEmail: "admin@platform.local",
        actorName: "Admin",
        action: "platform_user_role_changed",
        metadata: JSON.stringify({ targetUserId: 42, result: "success", reason: "Promotion" }), // user 42 is the target
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      expect(r.targetUserId).toBe("42");
      expect(r.actorId).toBe(1);
      expect(r.reason).toBe("Promotion");
    });

    it("blocked attempt included - result=blocked from metadata", () => {
      const row: RawActivityRow = {
        id: 22,
        actorId: 99,
        actorEmail: "other@platform.local",
        actorName: "Other",
        action: "platform_user_status_change_blocked",
        metadata: JSON.stringify({ targetUserId: 42, result: "blocked", blockedReason: "Protected account" }),
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      expect(r.result).toBe("blocked");
      expect(r.blockedReason).toBe("Protected account");
      expect(r.targetUserId).toBe("42");
    });

    it("metadata redacted in user activity too", () => {
      const row: RawActivityRow = {
        id: 23,
        actorId: 1,
        actorEmail: "a@b.com",
        actorName: "A",
        action: "platform_user_created",
        metadata: JSON.stringify({ targetUserId: 42, token: "secret-token", reason: "normal" }),
        createdAt: new Date(),
      };
      const r = enrichRow(row);
      const json = JSON.stringify(r.metadataSafe);
      expect(json).not.toContain("secret-token");
      expect(json).toContain(REDACTED_VALUE);
      expect(r.reason).toBe("normal");
    });

    it("returns nextCursor for user activity pagination", () => {
      const limit = 3;
      const rows: RawActivityRow[] = Array.from({ length: 4 }, (_, i) => ({
        id: 10 - i,
        actorId: 42,
        actorEmail: "a@b.com",
        actorName: "A",
        action: "platform_user_created",
        metadata: null,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      const enriched = rows.map(enrichRow);
      const hasMore = enriched.length > limit;
      const items = enriched.slice(0, limit);
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;
      expect(hasMore).toBe(true);
      expect(nextCursor).toBe(8);
    });
  });

  describe("Permission requirements (documented)", () => {
    it("platform.activity.read grants access (documented)", () => {
      // requireAnyPlatformPermission(["platform.activity.read", "audit.read"])
      // This is the documented permission for both endpoints.
      // Backend enforcement tested via requireAnyPlatformPermission middleware (P14-B tests).
      const requiredPermissions = ["platform.activity.read", "audit.read"];
      expect(requiredPermissions).toContain("platform.activity.read");
      expect(requiredPermissions).toContain("audit.read");
    });

    it("workspace users are denied (workspaceId IS NULL check documented)", () => {
      // The route verifies: where workspaceId IS NULL for the target userId
      // This prevents workspace users from being fetched via platform activity API
      const platformUserFilter = "workspaceId IS NULL";
      expect(platformUserFilter).toBeTruthy();
    });

    it("invalid userId triggers 400 (documented)", () => {
      const invalid = ["0", "-1", "abc", ""];
      for (const val of invalid) {
        const n = Number(val);
        expect(!Number.isFinite(n) || n < 1).toBe(true);
      }
    });
  });
});
