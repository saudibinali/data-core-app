/**
 * @file   src/lib/__tests__/governance-topology-readiness.test.ts
 * @phase  P12-F - Governance Topology & Readiness UI Foundations
 *
 * Pure node-environment tests.
 * Imports ONLY from governance-console-config.ts - no React, no DOM, no hooks.
 *
 * T1    topology layer map stable
 * T2    boundary status map stable
 * T3    readiness dimension map stable
 * T4    readiness status map stable
 * T5    topology/readiness pages super-admin scoped
 * T6    dependency map ordering deterministic
 * T7    boundary table critical warnings always visible
 * T8    readiness grid blocked/partial prominence stable
 * T9    no mutation/export/legal/fix labels exist
 * T10   topology/readiness safety contracts true
 * T11   hooks remain read-only
 * T12   config shapes correct (shape integrity)
 */

import { describe, it, expect } from "vitest";
import {
  TOPOLOGY_LAYER_MAP,
  TOPOLOGY_LAYER_ORDER,
  BOUNDARY_STATUS_MAP,
  BOUNDARY_STATUS_ORDER,
  READINESS_DIMENSION_MAP,
  READINESS_DIMENSION_ORDER,
  READINESS_STATUS_MAP,
  TOPOLOGY_UI_SAFETY_CONTRACT,
  READINESS_UI_SAFETY_CONTRACT,
  TOPOLOGY_EMPTY_STATE,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  GOVERNANCE_READ_HOOK_NAMES,
  type TopologyLayerKey,
  type BoundaryStatusKey,
  type ReadinessDimensionKey,
  type ReadinessStatusKey,
} from "../governance-console-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Topology layer map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - Topology layer map stable", () => {
  it("has exactly 7 layers", () => {
    expect(Object.keys(TOPOLOGY_LAYER_MAP).length).toBe(7);
  });

  it("TOPOLOGY_LAYER_ORDER has 7 entries matching map keys", () => {
    expect(TOPOLOGY_LAYER_ORDER.length).toBe(7);
    for (const key of TOPOLOGY_LAYER_ORDER) {
      expect(TOPOLOGY_LAYER_MAP).toHaveProperty(key);
    }
  });

  it("canonical layer keys present", () => {
    const required: TopologyLayerKey[] = [
      "audit_integrity", "policy_governance", "workflow_governance",
      "analytics_intelligence", "topology_readiness", "evidence_packaging", "frontend_console",
    ];
    for (const k of required) {
      expect(TOPOLOGY_LAYER_MAP).toHaveProperty(k);
    }
  });

  it("every layer has label, description, order, expectedBoundary, dependencyDirection, tier", () => {
    for (const key of TOPOLOGY_LAYER_ORDER) {
      const l = TOPOLOGY_LAYER_MAP[key];
      expect(typeof l.label).toBe("string");
      expect(l.label.length).toBeGreaterThan(0);
      expect(typeof l.description).toBe("string");
      expect(typeof l.order).toBe("number");
      expect(typeof l.expectedBoundary).toBe("string");
      expect(typeof l.dependencyDirection).toBe("string");
      expect(typeof l.tier).toBe("string");
    }
  });

  it("order values are unique spanning 0..6", () => {
    const orders = TOPOLOGY_LAYER_ORDER.map(k => TOPOLOGY_LAYER_MAP[k].order);
    expect(new Set(orders).size).toBe(7);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(6);
  });

  it("audit_integrity is order 0 (foundation), frontend_console is order 6 (presentation)", () => {
    expect(TOPOLOGY_LAYER_MAP.audit_integrity.order).toBe(0);
    expect(TOPOLOGY_LAYER_MAP.frontend_console.order).toBe(6);
  });

  it("TOPOLOGY_LAYER_ORDER is strictly ascending by order value", () => {
    for (let i = 1; i < TOPOLOGY_LAYER_ORDER.length; i++) {
      const prev = TOPOLOGY_LAYER_MAP[TOPOLOGY_LAYER_ORDER[i - 1]].order;
      const curr = TOPOLOGY_LAYER_MAP[TOPOLOGY_LAYER_ORDER[i]].order;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("no layer description contains mutation or enforcement wording", () => {
    const forbidden = ["mutate", "enforce", "auto-fix", "trigger action", "legal verdict", "export"];
    for (const key of TOPOLOGY_LAYER_ORDER) {
      const desc = TOPOLOGY_LAYER_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(desc).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Boundary status map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - Boundary status map stable", () => {
  it("has exactly 7 statuses", () => {
    expect(Object.keys(BOUNDARY_STATUS_MAP).length).toBe(7);
  });

  it("BOUNDARY_STATUS_ORDER has 7 entries matching map keys", () => {
    expect(BOUNDARY_STATUS_ORDER.length).toBe(7);
    for (const key of BOUNDARY_STATUS_ORDER) {
      expect(BOUNDARY_STATUS_MAP).toHaveProperty(key);
    }
  });

  it("canonical keys present", () => {
    const required: BoundaryStatusKey[] = [
      "isolated", "read_only", "append_only", "human_governed",
      "warning", "leak_detected", "unknown",
    ];
    for (const k of required) {
      expect(BOUNDARY_STATUS_MAP).toHaveProperty(k);
    }
  });

  it("every status has tier, label, description, badgeClass, order", () => {
    for (const key of BOUNDARY_STATUS_ORDER) {
      const s = BOUNDARY_STATUS_MAP[key];
      expect(typeof s.tier).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
      expect(typeof s.badgeClass).toBe("string");
      expect(typeof s.order).toBe("number");
    }
  });

  it("leak_detected has tier=critical (highest severity)", () => {
    expect(BOUNDARY_STATUS_MAP.leak_detected.tier).toBe("critical");
  });

  it("isolated, read_only, human_governed have tier=good", () => {
    expect(BOUNDARY_STATUS_MAP.isolated.tier).toBe("good");
    expect(BOUNDARY_STATUS_MAP.read_only.tier).toBe("good");
    expect(BOUNDARY_STATUS_MAP.human_governed.tier).toBe("good");
  });

  it("leak_detected description says visibility only - no automated-correction wording", () => {
    const desc = BOUNDARY_STATUS_MAP.leak_detected.description.toLowerCase();
    // Must not claim to auto-correct boundaries
    expect(desc).not.toContain("automatically corrects");
    expect(desc).not.toContain("auto-remediate");
    expect(desc).not.toContain("automated fix");
    // Should mention visibility
    expect(desc).toContain("visibility");
  });

  it("order values are unique spanning 0..6", () => {
    const orders = BOUNDARY_STATUS_ORDER.map(k => BOUNDARY_STATUS_MAP[k].order);
    expect(new Set(orders).size).toBe(7);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Readiness dimension map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - Readiness dimension map stable", () => {
  it("has exactly 8 dimensions", () => {
    expect(Object.keys(READINESS_DIMENSION_MAP).length).toBe(8);
  });

  it("READINESS_DIMENSION_ORDER has 8 entries matching map keys", () => {
    expect(READINESS_DIMENSION_ORDER.length).toBe(8);
    for (const key of READINESS_DIMENSION_ORDER) {
      expect(READINESS_DIMENSION_MAP).toHaveProperty(key);
    }
  });

  it("canonical keys present", () => {
    const required: ReadinessDimensionKey[] = [
      "audit_integrity", "policy_coverage", "workflow_maturity", "analytics_visibility",
      "topology_clarity", "evidence_packaging", "export_readiness", "frontend_operability",
    ];
    for (const k of required) {
      expect(READINESS_DIMENSION_MAP).toHaveProperty(k);
    }
  });

  it("every dimension has label, description, order, expectedInputs, outputMeaning", () => {
    for (const key of READINESS_DIMENSION_ORDER) {
      const d = READINESS_DIMENSION_MAP[key];
      expect(typeof d.label).toBe("string");
      expect(d.label.length).toBeGreaterThan(0);
      expect(typeof d.description).toBe("string");
      expect(typeof d.order).toBe("number");
      expect(typeof d.expectedInputs).toBe("string");
      expect(d.expectedInputs.length).toBeGreaterThan(0);
      expect(typeof d.outputMeaning).toBe("string");
      expect(d.outputMeaning.length).toBeGreaterThan(0);
    }
  });

  it("order values are unique spanning 0..7", () => {
    const orders = READINESS_DIMENSION_ORDER.map(k => READINESS_DIMENSION_MAP[k].order);
    expect(new Set(orders).size).toBe(8);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(7);
  });

  it("READINESS_DIMENSION_ORDER is ascending by order value", () => {
    for (let i = 1; i < READINESS_DIMENSION_ORDER.length; i++) {
      const prev = READINESS_DIMENSION_MAP[READINESS_DIMENSION_ORDER[i - 1]].order;
      const curr = READINESS_DIMENSION_MAP[READINESS_DIMENSION_ORDER[i]].order;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("no description contains business valuation or legal compliance verdict wording", () => {
    const forbidden = [
      "legal verdict", "legal compliance", "business valuation",
      "financial risk", "regulatory verdict", "penalty",
    ];
    for (const key of READINESS_DIMENSION_ORDER) {
      const desc = READINESS_DIMENSION_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(desc).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Readiness status map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - Readiness status map stable", () => {
  it("has exactly 4 statuses", () => {
    expect(Object.keys(READINESS_STATUS_MAP).length).toBe(4);
  });

  it("canonical keys present: ready, partial, blocked, unknown", () => {
    const required: ReadinessStatusKey[] = ["ready", "partial", "blocked", "unknown"];
    for (const k of required) {
      expect(READINESS_STATUS_MAP).toHaveProperty(k);
    }
  });

  it("every status has tier, label, description, badgeClass, order", () => {
    const keys = Object.keys(READINESS_STATUS_MAP) as ReadinessStatusKey[];
    for (const key of keys) {
      const s = READINESS_STATUS_MAP[key];
      expect(typeof s.tier).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.badgeClass).toBe("string");
      expect(typeof s.order).toBe("number");
    }
  });

  it("ready has tier=good, blocked has tier=critical", () => {
    expect(READINESS_STATUS_MAP.ready.tier).toBe("good");
    expect(READINESS_STATUS_MAP.blocked.tier).toBe("critical");
  });

  it("partial has tier=attention", () => {
    expect(READINESS_STATUS_MAP.partial.tier).toBe("attention");
  });

  it("order values are unique spanning 0..3", () => {
    const orders = (Object.keys(READINESS_STATUS_MAP) as ReadinessStatusKey[]).map(
      k => READINESS_STATUS_MAP[k].order
    );
    expect(new Set(orders).size).toBe(4);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Topology/readiness pages super-admin scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - Topology/readiness pages super-admin scoped", () => {
  it("TOPOLOGY_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("READINESS_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(READINESS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("base GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("base contract readOnly and noMutationControls remain true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.readOnly).toBe(true);
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noMutationControls).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Dependency map ordering deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - Dependency map ordering deterministic", () => {
  it("TOPOLOGY_LAYER_ORDER is a readonly tuple of 7 unique keys", () => {
    expect(TOPOLOGY_LAYER_ORDER.length).toBe(7);
    expect(new Set(TOPOLOGY_LAYER_ORDER).size).toBe(7);
  });

  it("layer order matches expected canonical dependency sequence", () => {
    expect(TOPOLOGY_LAYER_ORDER[0]).toBe("audit_integrity");
    expect(TOPOLOGY_LAYER_ORDER[1]).toBe("policy_governance");
    expect(TOPOLOGY_LAYER_ORDER[2]).toBe("workflow_governance");
    expect(TOPOLOGY_LAYER_ORDER[3]).toBe("analytics_intelligence");
    expect(TOPOLOGY_LAYER_ORDER[4]).toBe("topology_readiness");
    expect(TOPOLOGY_LAYER_ORDER[5]).toBe("evidence_packaging");
    expect(TOPOLOGY_LAYER_ORDER[6]).toBe("frontend_console");
  });

  it("each layer order index matches its .order property value", () => {
    TOPOLOGY_LAYER_ORDER.forEach((key, idx) => {
      expect(TOPOLOGY_LAYER_MAP[key].order).toBe(idx);
    });
  });

  it("READINESS_DIMENSION_ORDER is a readonly tuple of 8 unique keys", () => {
    expect(READINESS_DIMENSION_ORDER.length).toBe(8);
    expect(new Set(READINESS_DIMENSION_ORDER).size).toBe(8);
  });

  it("each dimension order index matches its .order property value", () => {
    READINESS_DIMENSION_ORDER.forEach((key, idx) => {
      expect(READINESS_DIMENSION_MAP[key].order).toBe(idx);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Boundary table critical warnings always visible
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - Boundary table critical warnings always visible", () => {
  it("leak_detected has order=5 (second to last - but sorts first in table)", () => {
    // In the config, leak_detected order=5 is about display tier ranking.
    // The component sorts it first (priority = -100). This test validates
    // the config tier correctly identifies it as critical.
    expect(BOUNDARY_STATUS_MAP.leak_detected.tier).toBe("critical");
  });

  it("warning has tier=attention (visible but not critical)", () => {
    expect(BOUNDARY_STATUS_MAP.warning.tier).toBe("attention");
  });

  it("good-tier statuses: isolated, read_only, human_governed", () => {
    const goodStatuses = BOUNDARY_STATUS_ORDER.filter(
      k => BOUNDARY_STATUS_MAP[k].tier === "good"
    );
    expect(goodStatuses).toContain("isolated");
    expect(goodStatuses).toContain("read_only");
    expect(goodStatuses).toContain("human_governed");
  });

  it("badgeClass for leak_detected contains red colour tokens", () => {
    const cls = BOUNDARY_STATUS_MAP.leak_detected.badgeClass;
    expect(cls).toContain("red");
  });

  it("badgeClass for warning contains amber colour tokens", () => {
    const cls = BOUNDARY_STATUS_MAP.warning.badgeClass;
    expect(cls).toContain("amber");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Readiness grid blocked/partial prominence stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - Readiness grid blocked/partial prominence stable", () => {
  it("blocked status has tier=critical", () => {
    expect(READINESS_STATUS_MAP.blocked.tier).toBe("critical");
  });

  it("partial status has tier=attention", () => {
    expect(READINESS_STATUS_MAP.partial.tier).toBe("attention");
  });

  it("badgeClass for blocked contains red colour tokens", () => {
    const cls = READINESS_STATUS_MAP.blocked.badgeClass;
    expect(cls).toContain("red");
  });

  it("badgeClass for partial contains amber colour tokens", () => {
    const cls = READINESS_STATUS_MAP.partial.badgeClass;
    expect(cls).toContain("amber");
  });

  it("badgeClass for ready contains emerald colour tokens", () => {
    const cls = READINESS_STATUS_MAP.ready.badgeClass;
    expect(cls).toContain("emerald");
  });

  it("blocked description does not imply auto-remediation", () => {
    const desc = READINESS_STATUS_MAP.blocked.description.toLowerCase();
    expect(desc).not.toContain("auto");
    expect(desc).not.toContain("automatically");
    expect(desc).not.toContain("remediat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No mutation/export/legal/fix labels exist
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - No mutation, export, legal, or auto-fix labels", () => {
  // Phrase-level patterns only - single words like "export" or "trigger" may appear
  // legitimately in dimension/layer names, so we test for full forbidden phrases.
  const forbidden = [
    "auto-fix control", "auto-remediate", "automated fix",
    "pdf export", "xlsx export", "export to file",
    "legal verdict", "legally binding", "guilty",
    "trigger enforcement", "enforcement action",
    "ai summary", "ai-generated", "ai explanation",
    "submit to regulator", "regulator submission",
  ];

  it("no topology layer label or description contains forbidden terms", () => {
    for (const key of TOPOLOGY_LAYER_ORDER) {
      const label = TOPOLOGY_LAYER_MAP[key].label.toLowerCase();
      const desc  = TOPOLOGY_LAYER_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
        expect(desc).not.toContain(term);
      }
    }
  });

  it("no boundary status label or description contains forbidden terms", () => {
    for (const key of BOUNDARY_STATUS_ORDER) {
      const label = BOUNDARY_STATUS_MAP[key].label.toLowerCase();
      const desc  = BOUNDARY_STATUS_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
        expect(desc).not.toContain(term);
      }
    }
  });

  it("no readiness dimension label or description contains forbidden terms", () => {
    for (const key of READINESS_DIMENSION_ORDER) {
      const label = READINESS_DIMENSION_MAP[key].label.toLowerCase();
      const desc  = READINESS_DIMENSION_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
        expect(desc).not.toContain(term);
      }
    }
  });

  it("no readiness status label or description contains forbidden terms", () => {
    for (const key of ["ready", "partial", "blocked", "unknown"] as ReadinessStatusKey[]) {
      const label = READINESS_STATUS_MAP[key].label.toLowerCase();
      const desc  = READINESS_STATUS_MAP[key].description.toLowerCase();
      for (const term of forbidden) {
        expect(label).not.toContain(term);
        expect(desc).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Topology/readiness safety contracts true
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - Safety contracts all true", () => {
  it("TOPOLOGY_UI_SAFETY_CONTRACT has exactly 10 properties, all true", () => {
    const keys = Object.keys(TOPOLOGY_UI_SAFETY_CONTRACT) as (keyof typeof TOPOLOGY_UI_SAFETY_CONTRACT)[];
    expect(keys.length).toBe(10);
    for (const key of keys) {
      expect(TOPOLOGY_UI_SAFETY_CONTRACT[key]).toBe(true);
    }
  });

  it("READINESS_UI_SAFETY_CONTRACT has exactly 10 properties, all true", () => {
    const keys = Object.keys(READINESS_UI_SAFETY_CONTRACT) as (keyof typeof READINESS_UI_SAFETY_CONTRACT)[];
    expect(keys.length).toBe(10);
    for (const key of keys) {
      expect(READINESS_UI_SAFETY_CONTRACT[key]).toBe(true);
    }
  });

  it("TOPOLOGY_UI_SAFETY_CONTRACT required keys present and true", () => {
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noTopologyMutation).toBe(true);
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noBoundaryAutoFix).toBe(true);
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noSnapshotPersistence).toBe(true);
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noDiffExecution).toBe(true);
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noExportRendering).toBe(true);
    expect(TOPOLOGY_UI_SAFETY_CONTRACT.noLegalConclusions).toBe(true);
  });

  it("READINESS_UI_SAFETY_CONTRACT required keys present and true", () => {
    expect(READINESS_UI_SAFETY_CONTRACT.noReadinessOverride).toBe(true);
    expect(READINESS_UI_SAFETY_CONTRACT.noAutoRemediation).toBe(true);
    expect(READINESS_UI_SAFETY_CONTRACT.noSnapshotPersistence).toBe(true);
    expect(READINESS_UI_SAFETY_CONTRACT.noExportRendering).toBe(true);
    expect(READINESS_UI_SAFETY_CONTRACT.noLegalConclusions).toBe(true);
    expect(READINESS_UI_SAFETY_CONTRACT.noBusinessValuation).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - Hooks remain read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - Governance read hook names remain read-only", () => {
  it("GOVERNANCE_READ_HOOK_NAMES has at least 16 entries", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(16);
  });

  it("required topology/readiness hooks present", () => {
    const required = [
      "useGovernanceTopology",
      "useGovernanceTopologyBoundaries",
      "useGovernanceReadiness",
      "useGovernanceTopologySnapshot",
    ];
    for (const name of required) {
      expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain(name);
    }
  });

  it("no hook name starts with a mutation prefix", () => {
    const mutationPrefixes = ["useMutate", "useCreate", "useDelete", "useUpdate", "usePost"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const prefix of mutationPrefixes) {
        expect(name.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("all hook names start with 'useGovernance'", () => {
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      expect(name.startsWith("useGovernance")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - Config shapes correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - Config shapes correct", () => {
  it("TOPOLOGY_LAYER_MAP is a plain object with correct shape", () => {
    const sample = TOPOLOGY_LAYER_MAP.audit_integrity;
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("order");
    expect(sample).toHaveProperty("tier");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("expectedBoundary");
    expect(sample).toHaveProperty("dependencyDirection");
  });

  it("BOUNDARY_STATUS_MAP sample has correct shape", () => {
    const sample = BOUNDARY_STATUS_MAP.leak_detected;
    expect(sample).toHaveProperty("tier");
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("badgeClass");
    expect(sample).toHaveProperty("order");
  });

  it("READINESS_DIMENSION_MAP sample has correct shape", () => {
    const sample = READINESS_DIMENSION_MAP.audit_integrity;
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("order");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("expectedInputs");
    expect(sample).toHaveProperty("outputMeaning");
  });

  it("READINESS_STATUS_MAP sample has correct shape", () => {
    const sample = READINESS_STATUS_MAP.blocked;
    expect(sample).toHaveProperty("tier");
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("description");
    expect(sample).toHaveProperty("badgeClass");
    expect(sample).toHaveProperty("order");
  });

  it("TOPOLOGY_EMPTY_STATE has 4 entries with title and description", () => {
    const entries = Object.values(TOPOLOGY_EMPTY_STATE);
    expect(entries.length).toBe(4);
    for (const e of entries) {
      expect(typeof e.title).toBe("string");
      expect(typeof e.description).toBe("string");
    }
  });

  it("TOPOLOGY_UI_SAFETY_CONTRACT is a plain object with all boolean values", () => {
    for (const val of Object.values(TOPOLOGY_UI_SAFETY_CONTRACT)) {
      expect(typeof val).toBe("boolean");
    }
  });

  it("READINESS_UI_SAFETY_CONTRACT is a plain object with all boolean values", () => {
    for (const val of Object.values(READINESS_UI_SAFETY_CONTRACT)) {
      expect(typeof val).toBe("boolean");
    }
  });

  it("TOPOLOGY_LAYER_ORDER and READINESS_DIMENSION_ORDER are non-empty tuples", () => {
    expect(TOPOLOGY_LAYER_ORDER.length).toBeGreaterThan(0);
    expect(READINESS_DIMENSION_ORDER.length).toBeGreaterThan(0);
  });
});
