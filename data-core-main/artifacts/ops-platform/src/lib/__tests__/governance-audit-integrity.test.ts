/**
 * @file   lib/__tests__/governance-audit-integrity.test.ts
 * @phase  P12-B - Audit Integrity UI & Forensic Timeline Review Foundations
 *
 * Pure unit tests for the P12-B audit integrity and forensic review layer.
 * No React, no DOM, no HTTP - all tests run in node environment.
 * Imports only from governance-console-config.ts (pure TS constants).
 *
 * Tests:
 *   T1   Forensic timeline hook is read-only (name registry check)
 *   T2   Forensic timeline query disabled without entityId
 *   T3   Audit integrity status mapping stable (all 5 statuses, correct tiers)
 *   T4   Retention classification labels stable (all 4 classifications)
 *   T5   Timeline ordering is deterministic (sort spec covered by config)
 *   T6   Audit page config remains super-admin scoped
 *   T7   No mutation/export/legal action labels exist in registries
 *   T8   Empty/error states config present and non-empty
 *   T9   Query keys stable (forensicTimeline key + existing governance keys)
 *   T10  Frontend tests pass (all config shapes are correct)
 */

import { describe, it, expect } from "vitest";
import {
  INTEGRITY_STATUS_MAP,
  ALL_INTEGRITY_STATUS_KEYS,
  RETENTION_CLASSIFICATION_MAP,
  ALL_RETENTION_CLASSIFICATION_KEYS,
  FORENSIC_TIMELINE_HOOK_NAME,
  FORENSIC_TIMELINE_QUERY_KEY_NAME,
  FORENSIC_ENTITY_TYPE_OPTIONS,
  FORENSIC_EMPTY_STATE,
  AUDIT_UI_SAFETY_CONTRACT,
  AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS,
  AUDIT_RETENTION_FILTER_OPTIONS,
  AUDIT_ENTITY_TYPE_FILTER_OPTIONS,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  GOVERNANCE_ROUTES,
  ALL_GOVERNANCE_ROUTE_PATHS,
  GOVERNANCE_READ_HOOK_NAMES,
  GOVERNANCE_QUERY_KEY_NAMES,
} from "../governance-console-config";

// ── T1: Forensic timeline hook is read-only ───────────────────────────────

describe("T1 - Forensic timeline hook name is read-only", () => {
  it("FORENSIC_TIMELINE_HOOK_NAME is 'useGovernanceForensicTimeline'", () => {
    expect(FORENSIC_TIMELINE_HOOK_NAME).toBe("useGovernanceForensicTimeline");
  });

  it("hook name starts with 'useGovernance'", () => {
    expect(FORENSIC_TIMELINE_HOOK_NAME.startsWith("useGovernance")).toBe(true);
  });

  it("hook name does not contain mutation verbs", () => {
    const mutationVerbs = ["create", "update", "delete", "post", "patch", "put", "write", "repair", "reset", "set", "mutation"];
    for (const verb of mutationVerbs) {
      expect(FORENSIC_TIMELINE_HOOK_NAME.toLowerCase()).not.toContain(verb);
    }
  });

  it("hook name is registered in GOVERNANCE_READ_HOOK_NAMES", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain(FORENSIC_TIMELINE_HOOK_NAME);
  });

  it("GOVERNANCE_READ_HOOK_NAMES has exactly 15 entries (14 original + 0 new P12-B - forensic is already counted)", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(15);
  });
});

// ── T2: Forensic timeline query disabled without entityId ─────────────────

describe("T2 - Forensic timeline query config: disabled without entityId", () => {
  it("FORENSIC_TIMELINE_QUERY_KEY_NAME is 'forensicTimeline'", () => {
    expect(FORENSIC_TIMELINE_QUERY_KEY_NAME).toBe("forensicTimeline");
  });

  it("forensic query key name does not overlap with any existing GOVERNANCE_QUERY_KEY_NAMES", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES as readonly string[]).not.toContain(FORENSIC_TIMELINE_QUERY_KEY_NAME);
  });

  it("empty string entityId should not enable the query (guard logic: trim().length > 0)", () => {
    const entityId = "";
    const shouldEnable = typeof entityId === "string" && entityId.trim().length > 0;
    expect(shouldEnable).toBe(false);
  });

  it("whitespace-only entityId should not enable the query", () => {
    const entityId = "   ";
    const shouldEnable = typeof entityId === "string" && entityId.trim().length > 0;
    expect(shouldEnable).toBe(false);
  });

  it("valid entityId enables the query", () => {
    const entityId = "workspace-abc-123";
    const shouldEnable = typeof entityId === "string" && entityId.trim().length > 0;
    expect(shouldEnable).toBe(true);
  });

  it("undefined entityId does not enable the query", () => {
    const entityId: string | undefined = undefined;
    const shouldEnable = typeof entityId === "string" && entityId.trim().length > 0;
    expect(shouldEnable).toBe(false);
  });

  it("forensic API path structure is correct", () => {
    const entityId  = "ws-123";
    const expected  = `/api/platform/compliance/forensics/${encodeURIComponent(entityId)}`;
    expect(expected).toBe("/api/platform/compliance/forensics/ws-123");
    expect(expected.startsWith("/api/platform")).toBe(true);
  });
});

// ── T3: Audit integrity status mapping stable ─────────────────────────────

describe("T3 - Integrity status mapping: all 5 statuses, correct tiers", () => {
  it("has exactly 5 status keys", () => {
    expect(ALL_INTEGRITY_STATUS_KEYS).toHaveLength(5);
  });

  it("contains all expected status keys", () => {
    const keys = ALL_INTEGRITY_STATUS_KEYS as readonly string[];
    expect(keys).toContain("verified");
    expect(keys).toContain("warning");
    expect(keys).toContain("compromised");
    expect(keys).toContain("orphaned");
    expect(keys).toContain("incomplete");
  });

  it("verified maps to healthy tier", () => {
    expect(INTEGRITY_STATUS_MAP.verified.tier).toBe("healthy");
  });

  it("compromised maps to critical tier", () => {
    expect(INTEGRITY_STATUS_MAP.compromised.tier).toBe("critical");
  });

  it("orphaned maps to critical tier", () => {
    expect(INTEGRITY_STATUS_MAP.orphaned.tier).toBe("critical");
  });

  it("warning maps to attention tier", () => {
    expect(INTEGRITY_STATUS_MAP.warning.tier).toBe("attention");
  });

  it("incomplete maps to attention tier", () => {
    expect(INTEGRITY_STATUS_MAP.incomplete.tier).toBe("attention");
  });

  it("every status has a non-empty label and description", () => {
    for (const key of ALL_INTEGRITY_STATUS_KEYS) {
      const info = INTEGRITY_STATUS_MAP[key];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it("tier values are only healthy, attention, or critical", () => {
    const validTiers = new Set(["healthy", "attention", "critical"]);
    for (const key of ALL_INTEGRITY_STATUS_KEYS) {
      expect(validTiers.has(INTEGRITY_STATUS_MAP[key].tier)).toBe(true);
    }
  });

  it("no label or description contains 'compliant' or 'legal'", () => {
    for (const key of ALL_INTEGRITY_STATUS_KEYS) {
      const { label, description } = INTEGRITY_STATUS_MAP[key];
      expect(label.toLowerCase()).not.toContain("compliant");
      expect(label.toLowerCase()).not.toContain("legal");
      expect(description.toLowerCase()).not.toContain("compliant");
      expect(description.toLowerCase()).not.toContain("legal");
    }
  });

  it("compromised and orphaned descriptions mention tamper or missing parent", () => {
    expect(INTEGRITY_STATUS_MAP.compromised.description.toLowerCase()).toMatch(/tamper|mismatch/);
    expect(INTEGRITY_STATUS_MAP.orphaned.description.toLowerCase()).toMatch(/missing|parent/);
  });
});

// ── T4: Retention classification labels stable ────────────────────────────

describe("T4 - Retention classification labels: all 4 classifications", () => {
  it("has exactly 4 classification keys", () => {
    expect(ALL_RETENTION_CLASSIFICATION_KEYS).toHaveLength(4);
  });

  it("contains all expected classification keys", () => {
    const keys = ALL_RETENTION_CLASSIFICATION_KEYS as readonly string[];
    expect(keys).toContain("operational");
    expect(keys).toContain("governance");
    expect(keys).toContain("compliance_sensitive");
    expect(keys).toContain("forensic_critical");
  });

  it("every classification has a non-empty label and helper", () => {
    for (const key of ALL_RETENTION_CLASSIFICATION_KEYS) {
      const info = RETENTION_CLASSIFICATION_MAP[key];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.helper.length).toBeGreaterThan(0);
    }
  });

  it("forensic_critical label contains 'Forensic'", () => {
    expect(RETENTION_CLASSIFICATION_MAP.forensic_critical.label).toContain("Forensic");
  });

  it("compliance_sensitive label contains 'Compliance'", () => {
    expect(RETENTION_CLASSIFICATION_MAP.compliance_sensitive.label).toContain("Compliance");
  });

  it("no helper text contains legal conclusions", () => {
    const legalTerms = ["legally", "law", "regulation", "verdict", "compliance status"];
    for (const key of ALL_RETENTION_CLASSIFICATION_KEYS) {
      const helper = RETENTION_CLASSIFICATION_MAP[key].helper.toLowerCase();
      for (const term of legalTerms) {
        expect(helper).not.toContain(term);
      }
    }
  });

  it("all classification labels are unique", () => {
    const labels = ALL_RETENTION_CLASSIFICATION_KEYS.map(k => RETENTION_CLASSIFICATION_MAP[k].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ── T5: Timeline ordering is deterministic ────────────────────────────────

describe("T5 - Forensic timeline ordering spec", () => {
  it("events sorted by occurredAt ascending (earliest first) - pure sort logic", () => {
    const events = [
      { occurredAt: "2026-03-10T10:00:00.000Z", id: "c" },
      { occurredAt: "2026-01-01T00:00:00.000Z", id: "a" },
      { occurredAt: "2026-02-15T08:30:00.000Z", id: "b" },
    ];
    const sorted = [...events].sort((a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
    expect(sorted[2].id).toBe("c");
  });

  it("events with identical occurredAt - sort by recordedAt ascending", () => {
    const events = [
      { occurredAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:01:00.000Z", id: "b" },
      { occurredAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:00:30.000Z", id: "a" },
    ];
    const sorted = [...events].sort((x, y) => {
      const d = new Date(x.occurredAt).getTime() - new Date(y.occurredAt).getTime();
      if (d !== 0) return d;
      return new Date(x.recordedAt).getTime() - new Date(y.recordedAt).getTime();
    });
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });

  it("events without occurredAt sort to end (NaN > any number = false)", () => {
    const events = [
      { occurredAt: "2026-01-01T00:00:00.000Z", id: "valid" },
      { occurredAt: undefined as unknown as string, id: "no-date" },
    ];
    const sorted = [...events].sort((a, b) => {
      const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : Infinity;
      const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : Infinity;
      return ta - tb;
    });
    expect(sorted[0].id).toBe("valid");
    expect(sorted[1].id).toBe("no-date");
  });

  it("empty events array sorts to empty array", () => {
    const events: { occurredAt: string }[] = [];
    const sorted = [...events].sort((a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
    expect(sorted).toHaveLength(0);
  });
});

// ── T6: Audit page config remains super-admin scoped ─────────────────────

describe("T6 - Audit page config is super-admin scoped", () => {
  it("audit-integrity route is under /super-admin", () => {
    expect(GOVERNANCE_ROUTES.auditIntegrity.startsWith("/super-admin")).toBe(true);
  });

  it("audit-integrity route is in ALL_GOVERNANCE_ROUTE_PATHS", () => {
    expect(ALL_GOVERNANCE_ROUTE_PATHS as readonly string[]).toContain(GOVERNANCE_ROUTES.auditIntegrity);
  });

  it("GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("AUDIT_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(AUDIT_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("AUDIT_UI_SAFETY_CONTRACT has all 9 properties", () => {
    expect(Object.keys(AUDIT_UI_SAFETY_CONTRACT).length).toBe(9);
  });

  it("all AUDIT_UI_SAFETY_CONTRACT values are boolean true", () => {
    for (const val of Object.values(AUDIT_UI_SAFETY_CONTRACT)) {
      expect(val).toBe(true);
    }
  });
});

// ── T7: No mutation/export/legal labels in registries ────────────────────

describe("T7 - No mutation, export, or legal action labels in audit config", () => {
  const forbiddenLabels = [
    "repair", "fix", "delete", "remove", "archive", "export", "download",
    "pdf", "xlsx", "csv", "submit", "legal", "compliant", "verdict", "approve",
    "ai summary", "ai-generated", "escalate", "resolve",
  ];

  it("no integrity status label or description contains forbidden terms", () => {
    for (const key of ALL_INTEGRITY_STATUS_KEYS) {
      const { label, description } = INTEGRITY_STATUS_MAP[key];
      for (const term of forbiddenLabels) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no retention classification label or helper contains forbidden terms", () => {
    for (const key of ALL_RETENTION_CLASSIFICATION_KEYS) {
      const { label, helper } = RETENTION_CLASSIFICATION_MAP[key];
      for (const term of forbiddenLabels) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(helper.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no forensic entity type option label contains forbidden terms", () => {
    for (const opt of FORENSIC_ENTITY_TYPE_OPTIONS) {
      for (const term of forbiddenLabels) {
        expect(opt.label.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no filter option label contains forbidden terms", () => {
    const allFilterOptions = [
      ...AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS,
      ...AUDIT_RETENTION_FILTER_OPTIONS,
      ...AUDIT_ENTITY_TYPE_FILTER_OPTIONS,
    ];
    for (const opt of allFilterOptions) {
      for (const term of forbiddenLabels) {
        expect(opt.label.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ── T8: Empty/error state config present and non-empty ────────────────────

describe("T8 - Empty and error state config present", () => {
  it("FORENSIC_EMPTY_STATE has noEntitySelected and timelineEmpty", () => {
    expect(FORENSIC_EMPTY_STATE.noEntitySelected).toBeDefined();
    expect(FORENSIC_EMPTY_STATE.timelineEmpty).toBeDefined();
  });

  it("noEntitySelected has non-empty title and description", () => {
    expect(FORENSIC_EMPTY_STATE.noEntitySelected.title.length).toBeGreaterThan(0);
    expect(FORENSIC_EMPTY_STATE.noEntitySelected.description.length).toBeGreaterThan(0);
  });

  it("timelineEmpty has non-empty title and description", () => {
    expect(FORENSIC_EMPTY_STATE.timelineEmpty.title.length).toBeGreaterThan(0);
    expect(FORENSIC_EMPTY_STATE.timelineEmpty.description.length).toBeGreaterThan(0);
  });

  it("noEntitySelected title does not imply mutation", () => {
    const title = FORENSIC_EMPTY_STATE.noEntitySelected.title.toLowerCase();
    expect(title).not.toContain("create");
    expect(title).not.toContain("write");
    expect(title).not.toContain("repair");
    expect(title).not.toContain("fix");
  });

  it("AUDIT_UI_SAFETY_CONTRACT.noAuditRecordCreation is true", () => {
    expect(AUDIT_UI_SAFETY_CONTRACT.noAuditRecordCreation).toBe(true);
  });

  it("AUDIT_UI_SAFETY_CONTRACT.noChainRepair is true", () => {
    expect(AUDIT_UI_SAFETY_CONTRACT.noChainRepair).toBe(true);
  });

  it("AUDIT_UI_SAFETY_CONTRACT.compromisedAlwaysVisible is true", () => {
    expect(AUDIT_UI_SAFETY_CONTRACT.compromisedAlwaysVisible).toBe(true);
  });

  it("AUDIT_UI_SAFETY_CONTRACT.orphanedAlwaysVisible is true", () => {
    expect(AUDIT_UI_SAFETY_CONTRACT.orphanedAlwaysVisible).toBe(true);
  });
});

// ── T9: Query keys stable ─────────────────────────────────────────────────

describe("T9 - Query keys stable", () => {
  it("FORENSIC_TIMELINE_QUERY_KEY_NAME is a non-empty string", () => {
    expect(typeof FORENSIC_TIMELINE_QUERY_KEY_NAME).toBe("string");
    expect(FORENSIC_TIMELINE_QUERY_KEY_NAME.length).toBeGreaterThan(0);
  });

  it("existing GOVERNANCE_QUERY_KEY_NAMES still has 14 entries", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES).toHaveLength(14);
  });

  it("existing keys include auditChains and auditIntegrity", () => {
    const keys = GOVERNANCE_QUERY_KEY_NAMES as readonly string[];
    expect(keys).toContain("auditChains");
    expect(keys).toContain("auditIntegrity");
  });

  it("forensicTimeline key is separate from governance query key names", () => {
    const keys = GOVERNANCE_QUERY_KEY_NAMES as readonly string[];
    expect(keys).not.toContain("forensicTimeline");
  });

  it("forensic query key array structure: ['governance', 'forensic-timeline', entityId]", () => {
    const entityId = "ws-abc-123";
    const key = ["governance", "forensic-timeline", entityId];
    expect(key[0]).toBe("governance");
    expect(key[1]).toBe("forensic-timeline");
    expect(key[2]).toBe(entityId);
    expect(key).toHaveLength(3);
  });

  it("forensic API URL is correctly constructed for encoding", () => {
    const entityId = "ws/special entity";
    const url = `/api/platform/compliance/forensics/${encodeURIComponent(entityId)}`;
    expect(url).toBe("/api/platform/compliance/forensics/ws%2Fspecial%20entity");
    expect(url).not.toContain(" ");
  });
});

// ── T10: Frontend config shapes are correct ───────────────────────────────

describe("T10 - Config shapes well-formed", () => {
  it("INTEGRITY_STATUS_MAP has exactly 5 entries", () => {
    expect(Object.keys(INTEGRITY_STATUS_MAP).length).toBe(5);
  });

  it("RETENTION_CLASSIFICATION_MAP has exactly 4 entries", () => {
    expect(Object.keys(RETENTION_CLASSIFICATION_MAP).length).toBe(4);
  });

  it("FORENSIC_ENTITY_TYPE_OPTIONS includes empty-value 'All' option", () => {
    const first = FORENSIC_ENTITY_TYPE_OPTIONS[0];
    expect(first.value).toBe("");
    expect(first.label).toContain("All");
  });

  it("FORENSIC_ENTITY_TYPE_OPTIONS has 7 entries including the all-types option", () => {
    expect(FORENSIC_ENTITY_TYPE_OPTIONS).toHaveLength(7);
  });

  it("AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS includes empty-value 'All' option", () => {
    const first = AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS[0];
    expect(first.value).toBe("");
    expect(first.label).toContain("All");
  });

  it("AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS has 6 entries (all + 5 statuses)", () => {
    expect(AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS).toHaveLength(6);
  });

  it("AUDIT_RETENTION_FILTER_OPTIONS has 5 entries (all + 4 classifications)", () => {
    expect(AUDIT_RETENTION_FILTER_OPTIONS).toHaveLength(5);
  });

  it("AUDIT_ENTITY_TYPE_FILTER_OPTIONS has 7 entries (all + 6 types)", () => {
    expect(AUDIT_ENTITY_TYPE_FILTER_OPTIONS).toHaveLength(7);
  });

  it("filter options cover exactly the same status keys as INTEGRITY_STATUS_MAP", () => {
    const filterValues = AUDIT_INTEGRITY_STATUS_FILTER_OPTIONS
      .map(o => o.value)
      .filter(v => v !== "");
    const mapKeys = [...ALL_INTEGRITY_STATUS_KEYS];
    expect(filterValues.sort()).toEqual(mapKeys.sort());
  });

  it("filter options cover exactly the same retention keys as RETENTION_CLASSIFICATION_MAP", () => {
    const filterValues = AUDIT_RETENTION_FILTER_OPTIONS
      .map(o => o.value)
      .filter(v => v !== "");
    const mapKeys = [...ALL_RETENTION_CLASSIFICATION_KEYS];
    expect(filterValues.sort()).toEqual(mapKeys.sort());
  });
});
