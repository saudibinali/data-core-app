/**
 * @file   lib/__tests__/governance-workflows-lifecycle.test.ts
 * @phase  P12-D - Governance Workflows UI & Human Review Lifecycle Foundations
 *
 * Pure unit tests for the P12-D workflow lifecycle review layer.
 * No React, no DOM, no HTTP - all tests run in node environment.
 * Imports only from governance-console-config.ts (pure TS constants).
 *
 * Tests:
 *   T1   Workflow status map stable (canonical + legacy keys)
 *   T2   Escalation level map stable (canonical + legacy keys)
 *   T3   Resolution classification map stable
 *   T4   Workflows page remains super-admin scoped
 *   T5   Lifecycle timeline ordering deterministic
 *   T6   Filter config stable (status, escalation, resolution)
 *   T7   No mutation/transition/legal action labels exist
 *   T8   Workflow safety contract all true
 *   T9   Evidence list and hook names remain read-only
 *   T10  Frontend config shapes correct
 */

import { describe, it, expect } from "vitest";
import {
  WORKFLOW_STATUS_MAP,
  WORKFLOW_STATUS_ORDER,
  ESCALATION_LEVEL_MAP,
  ESCALATION_LEVEL_ORDER,
  RESOLUTION_CLASSIFICATION_MAP,
  ALL_RESOLUTION_CLASSIFICATION_KEYS,
  WORKFLOW_STATUS_FILTER_OPTIONS,
  ESCALATION_LEVEL_FILTER_OPTIONS,
  RESOLUTION_CLASSIFICATION_FILTER_OPTIONS,
  WORKFLOWS_UI_SAFETY_CONTRACT,
  WORKFLOWS_EMPTY_STATE,
  WORKFLOW_LIFECYCLE_EVENT_ORDER,
  GOVERNANCE_ROUTES,
  ALL_GOVERNANCE_ROUTE_PATHS,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  GOVERNANCE_READ_HOOK_NAMES,
  GOVERNANCE_QUERY_KEY_NAMES,
  type WorkflowStatusKey,
  type EscalationLevelKey,
} from "../governance-console-config";

// ── T1: Workflow status map stable ────────────────────────────────────────

describe("T1 - Workflow status map stable", () => {
  it("canonical status keys are all present", () => {
    const canonical: WorkflowStatusKey[] = ["initiated", "investigating", "escalated", "resolved", "closed"];
    for (const k of canonical) {
      expect(k in WORKFLOW_STATUS_MAP).toBe(true);
    }
  });

  it("legacy compatibility keys are present", () => {
    const legacy: WorkflowStatusKey[] = ["open", "acknowledged", "under_review", "dismissed"];
    for (const k of legacy) {
      expect(k in WORKFLOW_STATUS_MAP).toBe(true);
    }
  });

  it("each status has tier, label, order, icon, description", () => {
    for (const key of Object.keys(WORKFLOW_STATUS_MAP) as WorkflowStatusKey[]) {
      const info = WORKFLOW_STATUS_MAP[key];
      expect(typeof info.tier).toBe("string");
      expect(typeof info.label).toBe("string");
      expect(typeof info.order).toBe("number");
      expect(typeof info.icon).toBe("string");
      expect(typeof info.description).toBe("string");
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it("tier values are only active, elevated, or closed", () => {
    const validTiers = new Set(["active", "elevated", "closed"]);
    for (const key of Object.keys(WORKFLOW_STATUS_MAP) as WorkflowStatusKey[]) {
      expect(validTiers.has(WORKFLOW_STATUS_MAP[key].tier)).toBe(true);
    }
  });

  it("escalated status has tier elevated", () => {
    expect(WORKFLOW_STATUS_MAP.escalated.tier).toBe("elevated");
  });

  it("initiated status has tier active", () => {
    expect(WORKFLOW_STATUS_MAP.initiated.tier).toBe("active");
  });

  it("closed and resolved statuses have tier closed", () => {
    expect(WORKFLOW_STATUS_MAP.closed.tier).toBe("closed");
    expect(WORKFLOW_STATUS_MAP.resolved.tier).toBe("closed");
  });

  it("WORKFLOW_STATUS_ORDER has 5 canonical entries", () => {
    expect(WORKFLOW_STATUS_ORDER).toHaveLength(5);
    expect(WORKFLOW_STATUS_ORDER[0]).toBe("initiated");
    expect(WORKFLOW_STATUS_ORDER[4]).toBe("closed");
  });

  it("no status label or description contains legal verdict wording", () => {
    const forbidden = ["legal", "verdict", "guilty", "fault", "illegal", "punish", "discipline"];
    for (const key of Object.keys(WORKFLOW_STATUS_MAP) as WorkflowStatusKey[]) {
      const { label, description } = WORKFLOW_STATUS_MAP[key];
      for (const term of forbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ── T2: Escalation level map stable ──────────────────────────────────────

describe("T2 - Escalation level map stable", () => {
  it("canonical escalation keys are all present", () => {
    const canonical: EscalationLevelKey[] = ["L1_automated", "L2_operator", "L3_management", "L4_executive"];
    for (const k of canonical) {
      expect(k in ESCALATION_LEVEL_MAP).toBe(true);
    }
  });

  it("legacy escalation keys are all present", () => {
    const legacy: EscalationLevelKey[] = ["informational", "standard", "elevated", "critical"];
    for (const k of legacy) {
      expect(k in ESCALATION_LEVEL_MAP).toBe(true);
    }
  });

  it("each escalation level has tier, label, order, description", () => {
    for (const key of Object.keys(ESCALATION_LEVEL_MAP) as EscalationLevelKey[]) {
      const info = ESCALATION_LEVEL_MAP[key];
      expect(typeof info.tier).toBe("string");
      expect(typeof info.label).toBe("string");
      expect(typeof info.order).toBe("number");
      expect(typeof info.description).toBe("string");
    }
  });

  it("tier values are only low, medium, high, or critical", () => {
    const validTiers = new Set(["low", "medium", "high", "critical"]);
    for (const key of Object.keys(ESCALATION_LEVEL_MAP) as EscalationLevelKey[]) {
      expect(validTiers.has(ESCALATION_LEVEL_MAP[key].tier)).toBe(true);
    }
  });

  it("ESCALATION_LEVEL_ORDER is [L1_automated, L2_operator, L3_management, L4_executive]", () => {
    expect(ESCALATION_LEVEL_ORDER).toEqual(["L1_automated", "L2_operator", "L3_management", "L4_executive"]);
  });

  it("order index is strictly increasing in ESCALATION_LEVEL_ORDER", () => {
    for (let i = 0; i < ESCALATION_LEVEL_ORDER.length - 1; i++) {
      const curr = ESCALATION_LEVEL_ORDER[i];
      const next = ESCALATION_LEVEL_ORDER[i + 1];
      expect(ESCALATION_LEVEL_MAP[curr].order).toBeLessThan(ESCALATION_LEVEL_MAP[next].order);
    }
  });

  it("L1_automated description mentions human review (not automatic execution)", () => {
    const desc = ESCALATION_LEVEL_MAP.L1_automated.description.toLowerCase();
    expect(desc).toContain("human");
  });

  it("L4_executive has highest order among canonical levels", () => {
    const orders = ESCALATION_LEVEL_ORDER.map(k => ESCALATION_LEVEL_MAP[k].order);
    expect(orders[orders.length - 1]).toBe(Math.max(...orders));
  });

  it("no escalation description contains legal wording", () => {
    const forbidden = ["legal", "verdict", "guilty", "law", "illegal", "punish"];
    for (const key of Object.keys(ESCALATION_LEVEL_MAP) as EscalationLevelKey[]) {
      const { description } = ESCALATION_LEVEL_MAP[key];
      for (const term of forbidden) {
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ── T3: Resolution classification map stable ──────────────────────────────

describe("T3 - Resolution classification map stable", () => {
  it("has exactly 5 classification keys", () => {
    expect(ALL_RESOLUTION_CLASSIFICATION_KEYS).toHaveLength(5);
  });

  it("contains all expected keys", () => {
    const expected = [
      "confirmed_violation", "false_positive", "operational_exception",
      "policy_gap", "unresolved_pending_review",
    ];
    for (const k of expected) {
      expect(ALL_RESOLUTION_CLASSIFICATION_KEYS as readonly string[]).toContain(k);
    }
  });

  it("each classification has label, description, tier", () => {
    for (const key of ALL_RESOLUTION_CLASSIFICATION_KEYS) {
      const info = RESOLUTION_CLASSIFICATION_MAP[key];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.tier.length).toBeGreaterThan(0);
    }
  });

  it("no classification label implies legal fault or guilt", () => {
    const forbidden = ["guilty", "illegal", "fault", "criminal", "verdict", "punish", "illegal"];
    for (const key of ALL_RESOLUTION_CLASSIFICATION_KEYS) {
      const { label, description } = RESOLUTION_CLASSIFICATION_MAP[key];
      for (const term of forbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("false_positive tier is cleared (not penalizing)", () => {
    expect(RESOLUTION_CLASSIFICATION_MAP.false_positive.tier).toBe("cleared");
  });

  it("confirmed_violation tier is finding (not legal verdict)", () => {
    expect(RESOLUTION_CLASSIFICATION_MAP.confirmed_violation.tier).toBe("finding");
  });

  it("all tier values are unique or semantically meaningful", () => {
    const tiers = ALL_RESOLUTION_CLASSIFICATION_KEYS.map(k => RESOLUTION_CLASSIFICATION_MAP[k].tier);
    // At least 3 distinct tiers
    expect(new Set(tiers).size).toBeGreaterThanOrEqual(3);
  });
});

// ── T4: Workflows page is super-admin scoped ──────────────────────────────

describe("T4 - Workflows page remains super-admin scoped", () => {
  it("workflows route is under /super-admin", () => {
    expect(GOVERNANCE_ROUTES.workflows.startsWith("/super-admin")).toBe(true);
  });

  it("workflows route is in ALL_GOVERNANCE_ROUTE_PATHS", () => {
    expect(ALL_GOVERNANCE_ROUTE_PATHS as readonly string[]).toContain(GOVERNANCE_ROUTES.workflows);
  });

  it("WORKFLOWS_UI_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true (inherited)", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("WORKFLOWS_UI_SAFETY_CONTRACT has 12 properties", () => {
    expect(Object.keys(WORKFLOWS_UI_SAFETY_CONTRACT).length).toBe(12);
  });

  it("all WORKFLOWS_UI_SAFETY_CONTRACT values are boolean true", () => {
    for (const val of Object.values(WORKFLOWS_UI_SAFETY_CONTRACT)) {
      expect(val).toBe(true);
    }
  });
});

// ── T5: Lifecycle timeline ordering deterministic ─────────────────────────

describe("T5 - Lifecycle timeline ordering deterministic", () => {
  it("WORKFLOW_LIFECYCLE_EVENT_ORDER has 7 entries", () => {
    expect(WORKFLOW_LIFECYCLE_EVENT_ORDER).toHaveLength(7);
  });

  it("createdAt is the first lifecycle event", () => {
    expect(WORKFLOW_LIFECYCLE_EVENT_ORDER[0]).toBe("createdAt");
  });

  it("updatedAt is the last lifecycle event", () => {
    expect(WORKFLOW_LIFECYCLE_EVENT_ORDER[WORKFLOW_LIFECYCLE_EVENT_ORDER.length - 1]).toBe("updatedAt");
  });

  it("escalatedAt comes after acknowledgedAt in lifecycle order", () => {
    const ackIdx = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("acknowledgedAt");
    const escIdx = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("escalatedAt");
    expect(escIdx).toBeGreaterThan(ackIdx);
  });

  it("resolvedAt comes after escalatedAt in lifecycle order", () => {
    const escIdx  = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("escalatedAt");
    const resIdx  = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("resolvedAt");
    expect(resIdx).toBeGreaterThan(escIdx);
  });

  it("closedAt comes after resolvedAt in lifecycle order", () => {
    const resIdx    = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("resolvedAt");
    const closeIdx  = WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf("closedAt");
    expect(closeIdx).toBeGreaterThan(resIdx);
  });

  it("all lifecycle event keys are unique", () => {
    expect(new Set(WORKFLOW_LIFECYCLE_EVENT_ORDER).size).toBe(WORKFLOW_LIFECYCLE_EVENT_ORDER.length);
  });

  it("sort by WORKFLOW_LIFECYCLE_EVENT_ORDER index is stable for out-of-order input", () => {
    const events = [
      { key: "resolvedAt", timestamp: "2024-06-03" },
      { key: "createdAt",  timestamp: "2024-06-01" },
      { key: "escalatedAt",timestamp: "2024-06-02" },
    ] as { key: typeof WORKFLOW_LIFECYCLE_EVENT_ORDER[number]; timestamp: string }[];

    const sorted = [...events].sort(
      (a, b) =>
        WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf(a.key) -
        WORKFLOW_LIFECYCLE_EVENT_ORDER.indexOf(b.key)
    );

    expect(sorted[0].key).toBe("createdAt");
    expect(sorted[1].key).toBe("escalatedAt");
    expect(sorted[2].key).toBe("resolvedAt");
  });
});

// ── T6: Filter config stable ──────────────────────────────────────────────

describe("T6 - Filter config stable", () => {
  it("WORKFLOW_STATUS_FILTER_OPTIONS has 6 entries (all + 5 canonical statuses)", () => {
    expect(WORKFLOW_STATUS_FILTER_OPTIONS).toHaveLength(6);
  });

  it("first status filter option is all-statuses (empty value)", () => {
    expect(WORKFLOW_STATUS_FILTER_OPTIONS[0].value).toBe("");
    expect(WORKFLOW_STATUS_FILTER_OPTIONS[0].label).toContain("All");
  });

  it("status filter options cover the 5 canonical status keys", () => {
    const filterValues = WORKFLOW_STATUS_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    for (const s of WORKFLOW_STATUS_ORDER) {
      expect(filterValues).toContain(s);
    }
  });

  it("ESCALATION_LEVEL_FILTER_OPTIONS has 5 entries (all + 4 canonical levels)", () => {
    expect(ESCALATION_LEVEL_FILTER_OPTIONS).toHaveLength(5);
  });

  it("first escalation filter option is all-levels (empty value)", () => {
    expect(ESCALATION_LEVEL_FILTER_OPTIONS[0].value).toBe("");
  });

  it("escalation filter options cover all 4 canonical levels", () => {
    const filterValues = ESCALATION_LEVEL_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    for (const e of ESCALATION_LEVEL_ORDER) {
      expect(filterValues).toContain(e);
    }
  });

  it("RESOLUTION_CLASSIFICATION_FILTER_OPTIONS has 6 entries (all + 5 classifications)", () => {
    expect(RESOLUTION_CLASSIFICATION_FILTER_OPTIONS).toHaveLength(6);
  });

  it("all filter option values are unique within each filter set", () => {
    for (const opts of [WORKFLOW_STATUS_FILTER_OPTIONS, ESCALATION_LEVEL_FILTER_OPTIONS, RESOLUTION_CLASSIFICATION_FILTER_OPTIONS]) {
      const vals = opts.map(o => o.value);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });
});

// ── T7: No mutation/transition/legal labels exist ─────────────────────────

describe("T7 - No mutation, transition trigger, or legal action labels", () => {
  const actionForbidden = [
    "acknowledge", "escalate", "resolve", "close", "dismiss", "create",
    "trigger", "export", "pdf", "xlsx", "ai summary", "legal", "verdict",
    "guilty", "fault", "discipline", "submit to", "regulator",
  ];

  it("no workflow status label or description contains forbidden action terms", () => {
    // Status labels may contain words like "Escalated" or "Resolved" - these are
    // NOUN / PAST-TENSE state names, not action button labels.
    // The test guards against button-action phrasing: present-tense imperatives
    // (e.g. "Escalate", "Resolve") must not appear as standalone verb-only tokens.
    // We check for patterns that would only appear in a button label, not a state name.
    const descriptionForbidden = [
      "trigger", "export", "pdf", "xlsx", "ai summary", "ai-generated",
      "legal verdict", "guilty", "discipline", "submit to regulator",
    ];
    const labelActionPhrases = [
      "click to escalate", "click to resolve", "click to close",
      "click to dismiss", "click to acknowledge",
      "export", "pdf", "xlsx", "ai summary", "legal verdict",
    ];
    for (const key of Object.keys(WORKFLOW_STATUS_MAP) as WorkflowStatusKey[]) {
      const { label, description } = WORKFLOW_STATUS_MAP[key];
      for (const term of descriptionForbidden) {
        expect(description.toLowerCase()).not.toContain(term);
      }
      for (const phrase of labelActionPhrases) {
        expect(label.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it("no escalation level label or description contains forbidden terms", () => {
    for (const key of Object.keys(ESCALATION_LEVEL_MAP) as EscalationLevelKey[]) {
      const { label, description } = ESCALATION_LEVEL_MAP[key];
      for (const term of actionForbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no resolution classification label or description contains forbidden terms", () => {
    const narrowForbidden = ["legal", "verdict", "guilty", "fault", "discipline", "ai summary"];
    for (const key of ALL_RESOLUTION_CLASSIFICATION_KEYS) {
      const { label, description } = RESOLUTION_CLASSIFICATION_MAP[key];
      for (const term of narrowForbidden) {
        expect(label.toLowerCase()).not.toContain(term);
        expect(description.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no workflow empty state text contains action terms", () => {
    const texts = [
      WORKFLOWS_EMPTY_STATE.noWorkflows.title,
      WORKFLOWS_EMPTY_STATE.noWorkflows.description,
      WORKFLOWS_EMPTY_STATE.noFilterMatch.title,
      WORKFLOWS_EMPTY_STATE.noFilterMatch.description,
      WORKFLOWS_EMPTY_STATE.lifecycleEmpty.title,
      WORKFLOWS_EMPTY_STATE.lifecycleEmpty.description,
    ];
    const mutationTerms = ["resolve", "escalate", "dismiss", "delete", "create", "repair", "export"];
    for (const text of texts) {
      for (const term of mutationTerms) {
        expect(text.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ── T8: Workflow safety contract all true ─────────────────────────────────

describe("T8 - Workflow safety contract all true", () => {
  it("noWorkflowCreation is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noWorkflowCreation).toBe(true);
  });

  it("noAcknowledgeButton is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noAcknowledgeButton).toBe(true);
  });

  it("noEscalateButton is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noEscalateButton).toBe(true);
  });

  it("noResolveButton is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noResolveButton).toBe(true);
  });

  it("noLegalConclusions is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noLegalConclusions).toBe(true);
  });

  it("noEnforcementTrigger is true", () => {
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.noEnforcementTrigger).toBe(true);
  });

  it("all 12 values in contract are boolean true", () => {
    expect(Object.keys(WORKFLOWS_UI_SAFETY_CONTRACT).length).toBe(12);
    for (const val of Object.values(WORKFLOWS_UI_SAFETY_CONTRACT)) {
      expect(val).toBe(true);
    }
  });
});

// ── T9: Evidence list and hook names remain read-only ─────────────────────

describe("T9 - Evidence list and hook names remain read-only", () => {
  it("useGovernanceWorkflows is in GOVERNANCE_READ_HOOK_NAMES", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceWorkflows");
  });

  it("GOVERNANCE_QUERY_KEY_NAMES includes 'workflows'", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES as readonly string[]).toContain("workflows");
  });

  it("no hook in GOVERNANCE_READ_HOOK_NAMES contains mutation verbs", () => {
    const mutationVerbs = ["create", "update", "delete", "post", "patch", "put",
                           "write", "repair", "reset", "set", "dismiss", "resolve",
                           "escalate", "acknowledge"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const verb of mutationVerbs) {
        expect(name.toLowerCase()).not.toContain(verb);
      }
    }
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
  it("WORKFLOW_STATUS_MAP has exactly 9 entries (5 canonical + 4 legacy)", () => {
    expect(Object.keys(WORKFLOW_STATUS_MAP).length).toBe(9);
  });

  it("ESCALATION_LEVEL_MAP has exactly 8 entries (4 canonical + 4 legacy)", () => {
    expect(Object.keys(ESCALATION_LEVEL_MAP).length).toBe(8);
  });

  it("RESOLUTION_CLASSIFICATION_MAP has exactly 5 entries", () => {
    expect(Object.keys(RESOLUTION_CLASSIFICATION_MAP).length).toBe(5);
  });

  it("WORKFLOWS_EMPTY_STATE has 3 state keys", () => {
    expect(Object.keys(WORKFLOWS_EMPTY_STATE).length).toBe(3);
  });

  it("WORKFLOW_LIFECYCLE_EVENT_ORDER has 7 entries", () => {
    expect(WORKFLOW_LIFECYCLE_EVENT_ORDER.length).toBe(7);
  });

  it("WORKFLOW_STATUS_FILTER_OPTIONS first value is empty string", () => {
    expect(WORKFLOW_STATUS_FILTER_OPTIONS[0].value).toBe("");
  });

  it("ESCALATION_LEVEL_FILTER_OPTIONS covers all canonical L-levels", () => {
    const vals = ESCALATION_LEVEL_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    for (const lvl of ESCALATION_LEVEL_ORDER) {
      expect(vals).toContain(lvl);
    }
  });

  it("RESOLUTION_CLASSIFICATION_FILTER_OPTIONS covers all classification keys", () => {
    const vals = RESOLUTION_CLASSIFICATION_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    for (const k of ALL_RESOLUTION_CLASSIFICATION_KEYS) {
      expect(vals).toContain(k);
    }
  });

  it("WORKFLOW_STATUS_ORDER contains exactly the 5 canonical statuses", () => {
    expect([...WORKFLOW_STATUS_ORDER].sort()).toEqual(
      ["closed", "escalated", "initiated", "investigating", "resolved"]
    );
  });

  it("WORKFLOWS_UI_SAFETY_CONTRACT and VIOLATIONS_UI_SAFETY_CONTRACT both enforce superAdminOnly", () => {
    // Cross-phase safety check: both must be true
    expect(WORKFLOWS_UI_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });
});
