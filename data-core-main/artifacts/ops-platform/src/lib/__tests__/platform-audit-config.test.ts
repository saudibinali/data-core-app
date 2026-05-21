/**
 * platform-audit-config.test.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * T10: Frontend audit safety contract all true + config stability
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_AUDIT_EVENT_CONFIG,
  PLATFORM_AUDIT_EVENT_GROUPS,
  PLATFORM_AUDIT_ACTION_CODES,
  PLATFORM_AUDIT_SEVERITY_CONFIG,
  PLATFORM_AUDIT_RESULT_CONFIG,
  PLATFORM_AUDIT_FILTER_CONFIG,
  PLATFORM_AUDIT_SAFETY_CONTRACT,
  getPlatformAuditEventConfigClient,
  isPlatformAuditEventClient,
} from "../platform-audit-config";

// ── T10: Safety contract ──────────────────────────────────────────────────────

describe("T10 - PLATFORM_AUDIT_SAFETY_CONTRACT all true", () => {
  it("has 9 safety properties", () => {
    expect(Object.keys(PLATFORM_AUDIT_SAFETY_CONTRACT)).toHaveLength(9);
  });

  it("every property is true", () => {
    for (const [key, value] of Object.entries(PLATFORM_AUDIT_SAFETY_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });

  it("specific required guarantees exist", () => {
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.readOnlyAudit).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noAuditDelete).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noAuditEdit).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noSecretMetadataDisplay).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.permissionGated).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.platformActivityOnly).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noSiemIntegration).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noExport).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.preserveBackendAuthority).toBe(true);
  });
});

// ── Event config stable ───────────────────────────────────────────────────────

describe("Event config stable", () => {
  it("contains exactly 12 known events", () => {
    expect(PLATFORM_AUDIT_ACTION_CODES).toHaveLength(12);
    expect(Object.keys(PLATFORM_AUDIT_EVENT_CONFIG)).toHaveLength(12);
  });

  it("8 event groups defined", () => {
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toHaveLength(8);
  });

  it("every event has all required fields", () => {
    for (const [code, def] of Object.entries(PLATFORM_AUDIT_EVENT_CONFIG)) {
      expect(def.actionCode).toBe(code);
      expect(def.label).toBeTruthy();
      expect(def.labelAr).toBeTruthy();
      expect(def.group).toBeTruthy();
      expect(def.severity).toMatch(/^(info|warning|critical)$/);
      expect(def.resultType).toMatch(/^(success|blocked|denied|failed)$/);
    }
  });

  it("Arabic labels contain Arabic characters", () => {
    for (const def of Object.values(PLATFORM_AUDIT_EVENT_CONFIG)) {
      expect(def.labelAr).toMatch(/[\u0600-\u06ff]/);
    }
  });
});

// ── Severity config ───────────────────────────────────────────────────────────

describe("T13 - Severity & result badges have bilingual labels", () => {
  it("severity config has all 3 severities", () => {
    expect(Object.keys(PLATFORM_AUDIT_SEVERITY_CONFIG)).toHaveLength(3);
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.info).toBeTruthy();
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.warning).toBeTruthy();
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.critical).toBeTruthy();
  });

  it("severity labels include English + Arabic", () => {
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.info.label).toBe("Info");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.info.labelAr).toBe("معلومات");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.warning.label).toBe("Warning");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.warning.labelAr).toBe("تحذير");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.critical.label).toBe("Critical");
    expect(PLATFORM_AUDIT_SEVERITY_CONFIG.critical.labelAr).toBe("حرج");
  });

  it("result config has all 4 results", () => {
    expect(Object.keys(PLATFORM_AUDIT_RESULT_CONFIG)).toHaveLength(4);
    expect(PLATFORM_AUDIT_RESULT_CONFIG.success).toBeTruthy();
    expect(PLATFORM_AUDIT_RESULT_CONFIG.blocked).toBeTruthy();
    expect(PLATFORM_AUDIT_RESULT_CONFIG.denied).toBeTruthy();
    expect(PLATFORM_AUDIT_RESULT_CONFIG.failed).toBeTruthy();
  });

  it("result labels include English + Arabic", () => {
    expect(PLATFORM_AUDIT_RESULT_CONFIG.success.label).toBe("Success");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.success.labelAr).toBe("ناجح");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.blocked.label).toBe("Blocked");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.blocked.labelAr).toBe("محظور");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.denied.label).toBe("Denied");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.denied.labelAr).toBe("مرفوض");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.failed.label).toBe("Failed");
    expect(PLATFORM_AUDIT_RESULT_CONFIG.failed.labelAr).toBe("فشل");
  });

  it("all severity badge classes are non-empty strings", () => {
    for (const cfg of Object.values(PLATFORM_AUDIT_SEVERITY_CONFIG)) {
      expect(cfg.badgeClass).toBeTruthy();
    }
  });

  it("all result badge classes are non-empty strings", () => {
    for (const cfg of Object.values(PLATFORM_AUDIT_RESULT_CONFIG)) {
      expect(cfg.badgeClass).toBeTruthy();
    }
  });
});

// ── Filter config ─────────────────────────────────────────────────────────────

describe("Filter config", () => {
  it("defaultLimit=50, maxLimit=200", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.defaultLimit).toBe(50);
    expect(PLATFORM_AUDIT_FILTER_CONFIG.maxLimit).toBe(200);
  });

  it("has group, result, severity filter options", () => {
    expect(PLATFORM_AUDIT_FILTER_CONFIG.groups.length).toBeGreaterThan(0);
    expect(PLATFORM_AUDIT_FILTER_CONFIG.results.length).toBeGreaterThan(0);
    expect(PLATFORM_AUDIT_FILTER_CONFIG.severities.length).toBeGreaterThan(0);
  });

  it("every filter option has value, label, labelAr", () => {
    for (const opt of [
      ...PLATFORM_AUDIT_FILTER_CONFIG.groups,
      ...PLATFORM_AUDIT_FILTER_CONFIG.results,
      ...PLATFORM_AUDIT_FILTER_CONFIG.severities,
    ]) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.labelAr).toBeTruthy();
      expect(opt.labelAr).toMatch(/[\u0600-\u06ff]/);
    }
  });
});

// ── Client helpers ────────────────────────────────────────────────────────────

describe("Client helpers", () => {
  it("getPlatformAuditEventConfigClient returns correct def for known code", () => {
    const def = getPlatformAuditEventConfigClient("platform_user_created");
    expect(def.actionCode).toBe("platform_user_created");
    expect(def.group).toBe("platform_user_management");
    expect(def.severity).toBe("info");
  });

  it("getPlatformAuditEventConfigClient returns fallback for unknown code", () => {
    const def = getPlatformAuditEventConfigClient("unknown_code_xyz");
    expect(def.actionCode).toBe("unknown_code_xyz");
    expect(def.labelAr).toBe("حدث غير مصنف");
    expect(def.group).toBe("platform_access");
    expect(def.severity).toBe("info");
  });

  it("isPlatformAuditEventClient returns true for known code", () => {
    expect(isPlatformAuditEventClient("protected_root_action_blocked")).toBe(true);
  });

  it("isPlatformAuditEventClient returns false for unknown code", () => {
    expect(isPlatformAuditEventClient("ghost_event")).toBe(false);
  });
});

// ── T16: No audit delete/edit/export/SIEM in config ──────────────────────────

describe("T16 - no audit delete/edit/export/SIEM in config", () => {
  it("safety contract explicitly blocks all forbidden operations", () => {
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noAuditDelete).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noAuditEdit).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noExport).toBe(true);
    expect(PLATFORM_AUDIT_SAFETY_CONTRACT.noSiemIntegration).toBe(true);
  });

  it("no mutation-related keys exist in filter config", () => {
    const filterKeys = Object.keys(PLATFORM_AUDIT_FILTER_CONFIG);
    const mutationKeys = ["delete", "edit", "export", "purge", "archive"];
    for (const mk of mutationKeys) {
      expect(filterKeys).not.toContain(mk);
    }
  });
});
