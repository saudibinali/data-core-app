/**
 * platform-audit-events.test.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * T1: PLATFORM_AUDIT_EVENT_CONFIG stable - 12 known events, all required fields
 * T2: Unknown event fallback safe - label = actionCode, group = platform_access
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_AUDIT_EVENT_CONFIG,
  PLATFORM_AUDIT_EVENT_GROUPS,
  PLATFORM_AUDIT_ACTION_CODES,
  getPlatformAuditEventConfig,
  getPlatformAuditSeverity,
  isPlatformAuditEvent,
} from "../platform-audit-events";

// ── T1: Event config stable ───────────────────────────────────────────────────

describe("T1 - PLATFORM_AUDIT_EVENT_CONFIG stable", () => {
  it("audit catalog length matches config entries", () => {
    const count = PLATFORM_AUDIT_ACTION_CODES.length;
    expect(Object.keys(PLATFORM_AUDIT_EVENT_CONFIG)).toHaveLength(count);
    expect(new Set(PLATFORM_AUDIT_ACTION_CODES).size).toBe(count);
  });

  it("every event has all required fields", () => {
    for (const [code, def] of Object.entries(PLATFORM_AUDIT_EVENT_CONFIG)) {
      expect(def.actionCode, `${code}.actionCode`).toBe(code);
      expect(def.label, `${code}.label`).toBeTruthy();
      expect(def.labelAr, `${code}.labelAr`).toBeTruthy();
      expect(def.group, `${code}.group`).toBeTruthy();
      expect(def.severity, `${code}.severity`).toMatch(/^(info|warning|critical)$/);
      expect(def.resultType, `${code}.resultType`).toMatch(/^(success|blocked|denied|failed)$/);
      expect(def.description, `${code}.description`).toBeTruthy();
    }
  });

  it("all core known action codes are present", () => {
    const expected = [
      "platform_user_created",
      "platform_user_create_blocked",
      "platform_user_status_changed",
      "platform_user_status_change_blocked",
      "platform_user_role_changed",
      "platform_user_role_change_blocked",
      "platform_permission_denied",
      "protected_root_action_blocked",
      "platform_user_access_policy_violation",
      "tenant_lifecycle_changed",
      "tenant_subscription_updated",
      "tenant_entitlement_override_updated",
    ];
    for (const code of expected) {
      expect(PLATFORM_AUDIT_EVENT_CONFIG, `missing: ${code}`).toHaveProperty(code);
    }
  });

  it("10 event groups defined", () => {
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toHaveLength(10);
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("platform_user_management");
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("root_protection");
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("tenant_lifecycle");
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("platform_access");
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("tenant_quota");
  });

  it("_blocked events are blocked/denied resultType", () => {
    const blocked = Object.values(PLATFORM_AUDIT_EVENT_CONFIG).filter((e) =>
      e.actionCode.includes("blocked"),
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const e of blocked) {
      expect(e.resultType).toMatch(/^(blocked|denied)$/);
    }
  });

  it("_blocked events have warning or critical severity", () => {
    const blocked = Object.values(PLATFORM_AUDIT_EVENT_CONFIG).filter((e) =>
      e.actionCode.includes("blocked"),
    );
    for (const e of blocked) {
      expect(e.severity).toMatch(/^(warning|critical)$/);
    }
  });

  it("root_protection event is critical severity", () => {
    const e = PLATFORM_AUDIT_EVENT_CONFIG["protected_root_action_blocked"]!;
    expect(e.severity).toBe("critical");
    expect(e.group).toBe("root_protection");
    expect(e.resultType).toBe("blocked");
  });

  it("platform_permission_denied is in platform_permission_denial group", () => {
    const e = PLATFORM_AUDIT_EVENT_CONFIG["platform_permission_denied"]!;
    expect(e.group).toBe("platform_permission_denial");
    expect(e.resultType).toBe("denied");
  });

  it("Arabic labels contain Arabic characters", () => {
    for (const def of Object.values(PLATFORM_AUDIT_EVENT_CONFIG)) {
      expect(def.labelAr).toMatch(/[\u0600-\u06ff]/);
    }
  });
});

// ── T2: Unknown event fallback safe ───────────────────────────────────────────

describe("T2 - unknown event fallback safe", () => {
  it("getPlatformAuditEventConfig returns fallback for unknown actionCode", () => {
    const def = getPlatformAuditEventConfig("some_unknown_event_xyz");
    expect(def.actionCode).toBe("some_unknown_event_xyz");
    expect(def.label).toBe("some_unknown_event_xyz"); // label = actionCode
    expect(def.labelAr).toBe("حدث غير مصنف");
    expect(def.group).toBe("platform_access");
    expect(def.severity).toBe("info");
  });

  it("fallback does not throw even for empty string", () => {
    expect(() => getPlatformAuditEventConfig("")).not.toThrow();
    const def = getPlatformAuditEventConfig("");
    expect(def).toBeTruthy();
  });

  it("getPlatformAuditSeverity returns info for unknown events", () => {
    expect(getPlatformAuditSeverity("totally_unknown_event")).toBe("info");
  });

  it("getPlatformAuditSeverity returns correct value for known events", () => {
    expect(getPlatformAuditSeverity("protected_root_action_blocked")).toBe("critical");
    expect(getPlatformAuditSeverity("platform_user_created")).toBe("info");
    expect(getPlatformAuditSeverity("platform_user_role_changed")).toBe("warning");
  });

  it("isPlatformAuditEvent returns true for known events", () => {
    expect(isPlatformAuditEvent("platform_user_created")).toBe(true);
    expect(isPlatformAuditEvent("protected_root_action_blocked")).toBe(true);
  });

  it("isPlatformAuditEvent returns false for unknown events", () => {
    expect(isPlatformAuditEvent("unknown_event_xyz")).toBe(false);
    expect(isPlatformAuditEvent("")).toBe(false);
  });

  it("fallback is stable - same input always produces same output", () => {
    const a = getPlatformAuditEventConfig("repeat_event");
    const b = getPlatformAuditEventConfig("repeat_event");
    expect(a.actionCode).toBe(b.actionCode);
    expect(a.group).toBe(b.group);
    expect(a.severity).toBe(b.severity);
  });
});
