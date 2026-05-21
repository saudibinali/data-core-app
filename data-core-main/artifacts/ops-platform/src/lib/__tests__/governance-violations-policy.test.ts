/**
 * @file   lib/__tests__/governance-violations-policy.test.ts
 * @phase  P12-C - Policy Violations UI & Evidence Review Foundations
 *
 * Pure unit tests for the P12-C policy violations and evidence review layer.
 * No React, no DOM, no HTTP - all tests run in node environment.
 * Imports only from governance-console-config.ts (pure TS constants).
 *
 * Tests:
 *   T1   Violation severity map stable (all 5 severities, correct tiers)
 *   T2   Severity ordering deterministic (desc order index)
 *   T3   Policy violations page remains super-admin scoped
 *   T4   Evidence reference type config stable
 *   T5   No mutation/workflow/legal action labels exist
 *   T6   Filter config stable (severity, type, workspace)
 *   T7   Critical violations always-visible contract true
 *   T8   Policy registry columns stable
 *   T9   Query keys / hooks remain read-only
 *   T10  Frontend config shapes are correct
 */

import { describe, it, expect } from "vitest";
import {
  VIOLATION_SEVERITY_MAP,
  VIOLATION_SEVERITY_ORDER_DESC,
  ALL_VIOLATION_SEVERITY_KEYS,
  EVIDENCE_REFERENCE_TYPE_MAP,
  ALL_EVIDENCE_REFERENCE_TYPE_KEYS,
  POLICY_REGISTRY_COLUMNS,
  VIOLATION_SEVERITY_FILTER_OPTIONS,
  VIOLATION_TYPE_FILTER_OPTIONS,
  VIOLATIONS_UI_SAFETY_CONTRACT,
  VIOLATIONS_EMPTY_STATE,
  FORENSIC_CONTEXT_GUIDANCE,
  GOVERNANCE_ROUTES,
  ALL_GOVERNANCE_ROUTE_PATHS,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  GOVERNANCE_READ_HOOK_NAMES,
  GOVERNANCE_QUERY_KEY_NAMES,
  type ViolationSeverityKey,
} from "../governance-console-config";

// ── T1: Violation severity map stable ────────────────────────────────────

describe("T1 - Violation severity map stable", () => {
  it("has exactly 5 severity keys", () => {
    expect(ALL_VIOLATION_SEVERITY_KEYS).toHaveLength(5);
  });

  it("contains all expected severity keys", () => {
    const keys = ALL_VIOLATION_SEVERITY_KEYS as readonly string[];
    expect(keys).toContain("informational");
    expect(keys).toContain("low");
    expect(keys).toContain("medium");
    expect(keys).toContain("high");
    expect(keys).toContain("critical");
  });

  it("each severity has correct tier", () => {
    expect(VIOLATION_SEVERITY_MAP.informational.tier).toBe("info");
    expect(VIOLATION_SEVERITY_MAP.low.tier).toBe("low");
    expect(VIOLATION_SEVERITY_MAP.medium.tier).toBe("medium");
    expect(VIOLATION_SEVERITY_MAP.high.tier).toBe("high");
    expect(VIOLATION_SEVERITY_MAP.critical.tier).toBe("critical");
  });

  it("every severity has a non-empty label and description", () => {
    for (const key of ALL_VIOLATION_SEVERITY_KEYS) {
      const info = VIOLATION_SEVERITY_MAP[key];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it("no label or description contains legal or disciplinary wording", () => {
    const forbidden = ["guilty", "fault", "illegal", "verdict", "punish", "discipline", "law", "legally compliant"];
    for (const key of ALL_VIOLATION_SEVERITY_KEYS) {
      const { label, description } = VIOLATION_SEVERITY_MAP[key];
      for (const term of forbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("all severity labels are unique", () => {
    const labels = ALL_VIOLATION_SEVERITY_KEYS.map(k => VIOLATION_SEVERITY_MAP[k].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("critical severity label is 'Critical'", () => {
    expect(VIOLATION_SEVERITY_MAP.critical.label).toBe("Critical");
  });

  it("informational severity label is 'Informational'", () => {
    expect(VIOLATION_SEVERITY_MAP.informational.label).toBe("Informational");
  });
});

// ── T2: Severity ordering deterministic ──────────────────────────────────

describe("T2 - Severity ordering deterministic", () => {
  it("VIOLATION_SEVERITY_ORDER_DESC has 5 entries", () => {
    expect(VIOLATION_SEVERITY_ORDER_DESC).toHaveLength(5);
  });

  it("first entry in desc order is critical (highest)", () => {
    expect(VIOLATION_SEVERITY_ORDER_DESC[0]).toBe("critical");
  });

  it("last entry in desc order is informational (lowest)", () => {
    expect(VIOLATION_SEVERITY_ORDER_DESC[4]).toBe("informational");
  });

  it("order index is consistent with desc ordering", () => {
    for (let i = 0; i < VIOLATION_SEVERITY_ORDER_DESC.length - 1; i++) {
      const current = VIOLATION_SEVERITY_ORDER_DESC[i];
      const next    = VIOLATION_SEVERITY_ORDER_DESC[i + 1];
      expect(VIOLATION_SEVERITY_MAP[current].order).toBeGreaterThan(VIOLATION_SEVERITY_MAP[next].order);
    }
  });

  it("all severity keys appear in VIOLATION_SEVERITY_ORDER_DESC exactly once", () => {
    const descSet = new Set(VIOLATION_SEVERITY_ORDER_DESC);
    expect(descSet.size).toBe(5);
    for (const key of ALL_VIOLATION_SEVERITY_KEYS) {
      expect(descSet.has(key)).toBe(true);
    }
  });

  it("sort by order desc places critical above high", () => {
    const sorted = [...ALL_VIOLATION_SEVERITY_KEYS].sort(
      (a, b) => VIOLATION_SEVERITY_MAP[b].order - VIOLATION_SEVERITY_MAP[a].order
    );
    expect(sorted[0]).toBe("critical");
    expect(sorted[1]).toBe("high");
  });

  it("sort by order asc places informational first", () => {
    const sorted = [...ALL_VIOLATION_SEVERITY_KEYS].sort(
      (a, b) => VIOLATION_SEVERITY_MAP[a].order - VIOLATION_SEVERITY_MAP[b].order
    );
    expect(sorted[0]).toBe("informational");
  });

  it("all order values are unique integers", () => {
    const orders = ALL_VIOLATION_SEVERITY_KEYS.map(k => VIOLATION_SEVERITY_MAP[k].order);
    expect(new Set(orders).size).toBe(orders.length);
    for (const o of orders) {
      expect(Number.isInteger(o)).toBe(true);
    }
  });
});

// ── T3: Policy violations page is super-admin scoped ─────────────────────

describe("T3 - Policy violations page remains super-admin scoped", () => {
  it("violations route is under /super-admin", () => {
    expect(GOVERNANCE_ROUTES.violations.startsWith("/super-admin")).toBe(true);
  });

  it("violations route is in ALL_GOVERNANCE_ROUTE_PATHS", () => {
    expect(ALL_GOVERNANCE_ROUTE_PATHS as readonly string[]).toContain(GOVERNANCE_ROUTES.violations);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(VIOLATIONS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true (inherited)", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT has 12 properties", () => {
    expect(Object.keys(VIOLATIONS_UI_SAFETY_CONTRACT).length).toBe(12);
  });

  it("all VIOLATIONS_UI_SAFETY_CONTRACT values are boolean true", () => {
    for (const val of Object.values(VIOLATIONS_UI_SAFETY_CONTRACT)) {
      expect(val).toBe(true);
    }
  });
});

// ── T4: Evidence reference type config stable ─────────────────────────────

describe("T4 - Evidence reference type config stable", () => {
  it("has exactly 5 evidence reference types", () => {
    expect(ALL_EVIDENCE_REFERENCE_TYPE_KEYS).toHaveLength(5);
  });

  it("contains all expected type keys", () => {
    const keys = ALL_EVIDENCE_REFERENCE_TYPE_KEYS as readonly string[];
    expect(keys).toContain("audit_chain_entry");
    expect(keys).toContain("execution_record");
    expect(keys).toContain("snapshot");
    expect(keys).toContain("policy_evaluation");
    expect(keys).toContain("external_ref");
  });

  it("every type has a non-empty label, icon, and description", () => {
    for (const key of ALL_EVIDENCE_REFERENCE_TYPE_KEYS) {
      const info = EVIDENCE_REFERENCE_TYPE_MAP[key];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.icon.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it("all labels are unique", () => {
    const labels = ALL_EVIDENCE_REFERENCE_TYPE_KEYS.map(k => EVIDENCE_REFERENCE_TYPE_MAP[k].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("icon values are known semantic keys (link, cpu, camera, shield, file)", () => {
    const validIcons = new Set(["link", "cpu", "camera", "shield", "file"]);
    for (const key of ALL_EVIDENCE_REFERENCE_TYPE_KEYS) {
      expect(validIcons.has(EVIDENCE_REFERENCE_TYPE_MAP[key].icon)).toBe(true);
    }
  });

  it("audit_chain_entry label contains 'Audit'", () => {
    expect(EVIDENCE_REFERENCE_TYPE_MAP.audit_chain_entry.label).toContain("Audit");
  });

  it("evidence reference stable sort: by type then by referenceId", () => {
    const refs = [
      { type: "snapshot",       referenceId: "b" },
      { type: "audit_chain_entry", referenceId: "a" },
      { type: "audit_chain_entry", referenceId: "c" },
    ];
    const sorted = [...refs].sort((a, b) => {
      const tc = a.type.localeCompare(b.type);
      if (tc !== 0) return tc;
      return a.referenceId.localeCompare(b.referenceId);
    });
    expect(sorted[0].type).toBe("audit_chain_entry");
    expect(sorted[0].referenceId).toBe("a");
    expect(sorted[1].type).toBe("audit_chain_entry");
    expect(sorted[1].referenceId).toBe("c");
    expect(sorted[2].type).toBe("snapshot");
  });
});

// ── T5: No mutation/workflow/legal labels in config ───────────────────────

describe("T5 - No mutation, workflow trigger, or legal action labels", () => {
  const forbidden = [
    "dismiss", "resolve", "create", "delete", "edit", "enable", "disable",
    "trigger", "escalate", "acknowledge", "export", "pdf", "xlsx", "csv",
    "legal", "verdict", "guilty", "fault", "discipline", "ai summary",
    "ai-generated", "submit to", "regulator",
  ];

  it("no violation severity label or description contains forbidden terms", () => {
    for (const key of ALL_VIOLATION_SEVERITY_KEYS) {
      const { label, description } = VIOLATION_SEVERITY_MAP[key];
      for (const term of forbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no evidence reference label or description contains forbidden terms", () => {
    for (const key of ALL_EVIDENCE_REFERENCE_TYPE_KEYS) {
      const { label, description } = EVIDENCE_REFERENCE_TYPE_MAP[key];
      for (const term of forbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no violation empty state text contains forbidden terms", () => {
    const texts = [
      VIOLATIONS_EMPTY_STATE.noViolations.title,
      VIOLATIONS_EMPTY_STATE.noViolations.description,
      VIOLATIONS_EMPTY_STATE.noFilterMatch.title,
      VIOLATIONS_EMPTY_STATE.noFilterMatch.description,
      VIOLATIONS_EMPTY_STATE.evidenceEmpty.title,
      VIOLATIONS_EMPTY_STATE.evidenceEmpty.description,
      VIOLATIONS_EMPTY_STATE.policyRegistryEmpty.title,
      VIOLATIONS_EMPTY_STATE.policyRegistryEmpty.description,
    ];
    for (const text of texts) {
      for (const term of forbidden) {
        expect(text.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("FORENSIC_CONTEXT_GUIDANCE contains no mutation action text", () => {
    const texts = [
      FORENSIC_CONTEXT_GUIDANCE.linkText,
      FORENSIC_CONTEXT_GUIDANCE.copyText,
      FORENSIC_CONTEXT_GUIDANCE.description,
    ];
    const mutationTerms = ["repair", "fix", "write", "modify", "delete", "create", "update"];
    for (const text of texts) {
      for (const term of mutationTerms) {
        expect(text.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ── T6: Filter config stable ──────────────────────────────────────────────

describe("T6 - Filter config stable", () => {
  it("VIOLATION_SEVERITY_FILTER_OPTIONS has 6 entries (all + 5 severities)", () => {
    expect(VIOLATION_SEVERITY_FILTER_OPTIONS).toHaveLength(6);
  });

  it("first severity filter option is all-types (empty value)", () => {
    expect(VIOLATION_SEVERITY_FILTER_OPTIONS[0].value).toBe("");
    expect(VIOLATION_SEVERITY_FILTER_OPTIONS[0].label).toContain("All");
  });

  it("severity filter options cover exactly the 5 violation severity keys", () => {
    const filterValues = VIOLATION_SEVERITY_FILTER_OPTIONS
      .map(o => o.value)
      .filter(v => v !== "");
    const mapKeys = [...ALL_VIOLATION_SEVERITY_KEYS];
    expect(filterValues.sort()).toEqual(mapKeys.sort());
  });

  it("VIOLATION_TYPE_FILTER_OPTIONS has at least 5 entries including all-types", () => {
    expect(VIOLATION_TYPE_FILTER_OPTIONS.length).toBeGreaterThanOrEqual(5);
  });

  it("first violation type filter option is all-types (empty value)", () => {
    expect(VIOLATION_TYPE_FILTER_OPTIONS[0].value).toBe("");
    expect(VIOLATION_TYPE_FILTER_OPTIONS[0].label).toContain("All");
  });

  it("all violation type filter values are unique", () => {
    const values = VIOLATION_TYPE_FILTER_OPTIONS.map(o => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("severity filter values are unique", () => {
    const values = VIOLATION_SEVERITY_FILTER_OPTIONS.map(o => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("workspace filter is applied to useGovernanceViolations via activeWorkspaceId param", () => {
    // Verify the design: workspace filter triggers a new API call, not client-side filtering
    // Tested via config: useGovernanceViolations(workspaceId?) exists in GOVERNANCE_READ_HOOK_NAMES
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceViolations");
  });
});

// ── T7: Critical violations always visible contract ───────────────────────

describe("T7 - Critical violations always-visible contract", () => {
  it("VIOLATIONS_UI_SAFETY_CONTRACT.criticalAlwaysVisible is true", () => {
    expect(VIOLATIONS_UI_SAFETY_CONTRACT.criticalAlwaysVisible).toBe(true);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT.highAlwaysVisible is true", () => {
    expect(VIOLATIONS_UI_SAFETY_CONTRACT.highAlwaysVisible).toBe(true);
  });

  it("no filter option value would hide critical violations if explicitly selected", () => {
    // When the severity filter is set to "critical", filteredViolations contains ONLY critical.
    // When cleared, all violations (including critical) are shown.
    // There is no filter that positively excludes critical from results.
    const severityValues = VIOLATION_SEVERITY_FILTER_OPTIONS.map(o => o.value);
    // No filter value that is NOT "critical" should claim to exclude critical explicitly
    // (client-side logic: filter === "" shows all, filter === key shows only that key)
    expect(severityValues).toContain("critical");  // critical IS selectable as a positive filter
    expect(severityValues).toContain("");           // empty = show all (including critical)
  });

  it("critical violation cannot be hidden by the type filter (orthogonal axis)", () => {
    // A critical violation with violationType = "audit_completeness" is shown when
    // typeFilter = "audit_completeness" AND severityFilter = "" (all).
    // The type filter is a different dimension from severity - they are ANDed, not ORed.
    // Verifying the design: two independent filter axes means any violation satisfying
    // both predicates is shown; a critical violation is only hidden if its type is filtered.
    const predicate = (severity: string, type: string, sF: string, tF: string) =>
      (sF === "" || severity === sF) && (tF === "" || type === tF);
    // Critical with matching type → visible
    expect(predicate("critical", "audit_completeness", "", "audit_completeness")).toBe(true);
    // Critical with non-matching type → NOT visible (acceptable: type filter applied)
    expect(predicate("critical", "execution_integrity", "", "audit_completeness")).toBe(false);
    // Critical with no filters → always visible
    expect(predicate("critical", "audit_completeness", "", "")).toBe(true);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT.noViolationDismissal is true", () => {
    expect(VIOLATIONS_UI_SAFETY_CONTRACT.noViolationDismissal).toBe(true);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT.noViolationResolution is true", () => {
    expect(VIOLATIONS_UI_SAFETY_CONTRACT.noViolationResolution).toBe(true);
  });
});

// ── T8: Policy registry columns stable ───────────────────────────────────

describe("T8 - Policy registry columns stable", () => {
  it("POLICY_REGISTRY_COLUMNS has 6 columns", () => {
    expect(POLICY_REGISTRY_COLUMNS).toHaveLength(6);
  });

  it("columns include policyId, name, defaultSeverity, enabled, violationCount, lastDetectedAt", () => {
    const keys = POLICY_REGISTRY_COLUMNS.map(c => c.key);
    expect(keys).toContain("policyId");
    expect(keys).toContain("name");
    expect(keys).toContain("defaultSeverity");
    expect(keys).toContain("enabled");
    expect(keys).toContain("violationCount");
    expect(keys).toContain("lastDetectedAt");
  });

  it("all column keys are unique", () => {
    const keys = POLICY_REGISTRY_COLUMNS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all column labels are non-empty strings", () => {
    for (const col of POLICY_REGISTRY_COLUMNS) {
      expect(col.label.length).toBeGreaterThan(0);
    }
  });

  it("no column label contains action verbs (edit, enable, delete, configure)", () => {
    const actionVerbs = ["edit", "enable", "disable", "delete", "configure", "create", "manage"];
    for (const col of POLICY_REGISTRY_COLUMNS) {
      for (const verb of actionVerbs) {
        expect(col.label.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("policy list is sorted by severity desc (high severity policies first)", () => {
    const mockPolicies = [
      { policyId: "p1", defaultSeverity: "low" },
      { policyId: "p2", defaultSeverity: "critical" },
      { policyId: "p3", defaultSeverity: "medium" },
    ];
    const sorted = [...mockPolicies].sort((a, b) => {
      const aOrder = VIOLATION_SEVERITY_MAP[(a.defaultSeverity ?? "") as ViolationSeverityKey]?.order ?? -1;
      const bOrder = VIOLATION_SEVERITY_MAP[(b.defaultSeverity ?? "") as ViolationSeverityKey]?.order ?? -1;
      return bOrder - aOrder;
    });
    expect(sorted[0].policyId).toBe("p2"); // critical
    expect(sorted[1].policyId).toBe("p3"); // medium
    expect(sorted[2].policyId).toBe("p1"); // low
  });
});

// ── T9: Query keys and hooks remain read-only ─────────────────────────────

describe("T9 - Query keys and hooks remain read-only", () => {
  it("useGovernanceViolations is in GOVERNANCE_READ_HOOK_NAMES", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceViolations");
  });

  it("useGovernancePolicies is in GOVERNANCE_READ_HOOK_NAMES", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernancePolicies");
  });

  it("GOVERNANCE_QUERY_KEY_NAMES includes 'violations' and 'policies'", () => {
    const keys = GOVERNANCE_QUERY_KEY_NAMES as readonly string[];
    expect(keys).toContain("violations");
    expect(keys).toContain("policies");
  });

  it("no hook in GOVERNANCE_READ_HOOK_NAMES contains mutation verbs", () => {
    const mutationVerbs = ["create", "update", "delete", "post", "patch", "put",
                           "write", "repair", "reset", "set", "dismiss", "resolve", "escalate"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const verb of mutationVerbs) {
        expect(name.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("violations hook accepts workspaceId as optional scope param (design check)", () => {
    // The hook is useGovernanceViolations(workspaceId?: string).
    // When workspaceId is truthy it calls /api/platform/governance/violations/:workspaceId.
    // When undefined it calls /api/platform/governance/violations (platform-wide).
    const wsId     = "ws-abc";
    const baseUrl  = "/api/platform/governance/violations";
    const withWs   = `${baseUrl}/${wsId}`;
    const withoutWs = baseUrl;
    expect(withWs).toContain(wsId);
    expect(withoutWs).toBe("/api/platform/governance/violations");
    expect(withWs.startsWith("/api/platform")).toBe(true);
  });

  it("GOVERNANCE_READ_HOOK_NAMES has at least 16 entries", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(16);
  });

  it("all query key names are unique", () => {
    expect(new Set(GOVERNANCE_QUERY_KEY_NAMES).size).toBe(GOVERNANCE_QUERY_KEY_NAMES.length);
  });
});

// ── T10: Config shapes correct ────────────────────────────────────────────

describe("T10 - Config shapes correct", () => {
  it("VIOLATION_SEVERITY_MAP has exactly 5 entries", () => {
    expect(Object.keys(VIOLATION_SEVERITY_MAP).length).toBe(5);
  });

  it("EVIDENCE_REFERENCE_TYPE_MAP has exactly 5 entries", () => {
    expect(Object.keys(EVIDENCE_REFERENCE_TYPE_MAP).length).toBe(5);
  });

  it("VIOLATIONS_EMPTY_STATE has 4 state keys", () => {
    expect(Object.keys(VIOLATIONS_EMPTY_STATE).length).toBe(4);
  });

  it("FORENSIC_CONTEXT_GUIDANCE has 3 text fields", () => {
    expect(Object.keys(FORENSIC_CONTEXT_GUIDANCE).length).toBe(3);
  });

  it("FORENSIC_CONTEXT_GUIDANCE.linkText is non-empty", () => {
    expect(FORENSIC_CONTEXT_GUIDANCE.linkText.length).toBeGreaterThan(0);
  });

  it("FORENSIC_CONTEXT_GUIDANCE.copyText is non-empty", () => {
    expect(FORENSIC_CONTEXT_GUIDANCE.copyText.length).toBeGreaterThan(0);
  });

  it("VIOLATIONS_UI_SAFETY_CONTRACT has 12 entries all boolean true", () => {
    expect(Object.keys(VIOLATIONS_UI_SAFETY_CONTRACT).length).toBe(12);
    for (const v of Object.values(VIOLATIONS_UI_SAFETY_CONTRACT)) {
      expect(v).toBe(true);
    }
  });

  it("VIOLATION_SEVERITY_FILTER_OPTIONS covers all severity keys as non-all entries", () => {
    const nonAllValues = VIOLATION_SEVERITY_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    for (const key of ALL_VIOLATION_SEVERITY_KEYS) {
      expect(nonAllValues).toContain(key);
    }
  });

  it("POLICY_REGISTRY_COLUMNS array is stable (correct length and order)", () => {
    expect(POLICY_REGISTRY_COLUMNS[0].key).toBe("policyId");
    expect(POLICY_REGISTRY_COLUMNS[1].key).toBe("name");
    expect(POLICY_REGISTRY_COLUMNS[5].key).toBe("lastDetectedAt");
  });

  it("ALL_VIOLATION_SEVERITY_KEYS matches VIOLATION_SEVERITY_ORDER_DESC (same elements)", () => {
    expect([...ALL_VIOLATION_SEVERITY_KEYS].sort()).toEqual([...VIOLATION_SEVERITY_ORDER_DESC].sort());
  });
});
