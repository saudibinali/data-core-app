/**
 * @file   src/lib/__tests__/governance-evidence-packages.test.ts
 * @phase  P12-G - Evidence Packages UI & Controlled Package Review Foundations
 *
 * Pure node-environment tests.
 * Imports ONLY from governance-console-config.ts - no React, no DOM, no hooks.
 *
 * T1    evidence package scope map stable
 * T2    evidence section map stable
 * T3    package integrity status map stable
 * T4    evidence packages page super-admin scoped
 * T5    section coverage ordering deterministic
 * T6    missing sections always visible
 * T7    compromised packages always visible
 * T8    no generate/export/verify/legal/notarize labels
 * T9    evidence package safety contract true
 * T10   hooks remain read-only
 * T11   filters config stable
 * T12   config shapes correct
 */

import { describe, it, expect } from "vitest";
import {
  EVIDENCE_PACKAGE_SCOPE_MAP,
  EVIDENCE_PACKAGE_SCOPE_ORDER,
  EVIDENCE_SECTION_MAP,
  EVIDENCE_SECTION_ORDER,
  PACKAGE_INTEGRITY_STATUS_MAP,
  PACKAGE_INTEGRITY_STATUS_ORDER,
  EVIDENCE_SCOPE_FILTER_OPTIONS,
  EVIDENCE_INTEGRITY_FILTER_OPTIONS,
  EVIDENCE_PACKAGE_SAFETY_CONTRACT,
  EVIDENCE_PACKAGE_EMPTY_STATE,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  GOVERNANCE_READ_HOOK_NAMES,
  type EvidencePackageScopeKey,
  type EvidenceSectionKey,
  type PackageIntegrityStatusKey,
} from "../governance-console-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Evidence package scope map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - Evidence package scope map stable", () => {
  it("has exactly 6 scopes", () => {
    expect(Object.keys(EVIDENCE_PACKAGE_SCOPE_MAP).length).toBe(6);
  });

  it("EVIDENCE_PACKAGE_SCOPE_ORDER has 6 entries matching map keys", () => {
    expect(EVIDENCE_PACKAGE_SCOPE_ORDER.length).toBe(6);
    for (const key of EVIDENCE_PACKAGE_SCOPE_ORDER) {
      expect(EVIDENCE_PACKAGE_SCOPE_MAP).toHaveProperty(key);
    }
  });

  it("canonical scope keys present", () => {
    const required: EvidencePackageScopeKey[] = [
      "platform", "workspace", "entity", "violation", "workflow", "readiness",
    ];
    for (const k of required) {
      expect(EVIDENCE_PACKAGE_SCOPE_MAP).toHaveProperty(k);
    }
  });

  it("every scope has label, description, order, tier, displayHint", () => {
    for (const key of EVIDENCE_PACKAGE_SCOPE_ORDER) {
      const s = EVIDENCE_PACKAGE_SCOPE_MAP[key];
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
      expect(typeof s.order).toBe("number");
      expect(typeof s.tier).toBe("string");
      expect(typeof s.displayHint).toBe("string");
    }
  });

  it("order values are unique spanning 0..5", () => {
    const orders = EVIDENCE_PACKAGE_SCOPE_ORDER.map(k => EVIDENCE_PACKAGE_SCOPE_MAP[k].order);
    expect(new Set(orders).size).toBe(6);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(5);
  });

  it("EVIDENCE_PACKAGE_SCOPE_ORDER is ascending by order", () => {
    for (let i = 1; i < EVIDENCE_PACKAGE_SCOPE_ORDER.length; i++) {
      const prev = EVIDENCE_PACKAGE_SCOPE_MAP[EVIDENCE_PACKAGE_SCOPE_ORDER[i - 1]].order;
      const curr = EVIDENCE_PACKAGE_SCOPE_MAP[EVIDENCE_PACKAGE_SCOPE_ORDER[i]].order;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("no scope description or displayHint contains export or legal wording", () => {
    const forbidden = ["export to", "pdf export", "legal verdict", "legally binding", "submit to regulator"];
    for (const key of EVIDENCE_PACKAGE_SCOPE_ORDER) {
      const s = EVIDENCE_PACKAGE_SCOPE_MAP[key];
      const text = `${s.description} ${s.displayHint}`.toLowerCase();
      for (const term of forbidden) {
        expect(text).not.toContain(term);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Evidence section map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - Evidence section map stable", () => {
  it("has exactly 7 sections", () => {
    expect(Object.keys(EVIDENCE_SECTION_MAP).length).toBe(7);
  });

  it("EVIDENCE_SECTION_ORDER has 7 entries matching map keys", () => {
    expect(EVIDENCE_SECTION_ORDER.length).toBe(7);
    for (const key of EVIDENCE_SECTION_ORDER) {
      expect(EVIDENCE_SECTION_MAP).toHaveProperty(key);
    }
  });

  it("canonical section keys present", () => {
    const required: EvidenceSectionKey[] = [
      "audit_integrity", "policy_violations", "workflow_lifecycle",
      "governance_analytics", "topology_readiness", "forensic_timeline", "boundary_summary",
    ];
    for (const k of required) {
      expect(EVIDENCE_SECTION_MAP).toHaveProperty(k);
    }
  });

  it("every section has label, description, order, expectedSourceLayer, reviewMeaning", () => {
    for (const key of EVIDENCE_SECTION_ORDER) {
      const s = EVIDENCE_SECTION_MAP[key];
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
      expect(typeof s.order).toBe("number");
      expect(typeof s.expectedSourceLayer).toBe("string");
      expect(s.expectedSourceLayer.length).toBeGreaterThan(0);
      expect(typeof s.reviewMeaning).toBe("string");
      expect(s.reviewMeaning.length).toBeGreaterThan(0);
    }
  });

  it("order values are unique spanning 0..6", () => {
    const orders = EVIDENCE_SECTION_ORDER.map(k => EVIDENCE_SECTION_MAP[k].order);
    expect(new Set(orders).size).toBe(7);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(6);
  });

  it("EVIDENCE_SECTION_ORDER is ascending by order", () => {
    for (let i = 1; i < EVIDENCE_SECTION_ORDER.length; i++) {
      const prev = EVIDENCE_SECTION_MAP[EVIDENCE_SECTION_ORDER[i - 1]].order;
      const curr = EVIDENCE_SECTION_MAP[EVIDENCE_SECTION_ORDER[i]].order;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("audit_integrity is order 0 and has expectedSourceLayer=audit_integrity", () => {
    expect(EVIDENCE_SECTION_MAP.audit_integrity.order).toBe(0);
    expect(EVIDENCE_SECTION_MAP.audit_integrity.expectedSourceLayer).toBe("audit_integrity");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Package integrity status map stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - Package integrity status map stable", () => {
  it("has exactly 5 statuses", () => {
    expect(Object.keys(PACKAGE_INTEGRITY_STATUS_MAP).length).toBe(5);
  });

  it("PACKAGE_INTEGRITY_STATUS_ORDER has 5 entries", () => {
    expect(PACKAGE_INTEGRITY_STATUS_ORDER.length).toBe(5);
    for (const key of PACKAGE_INTEGRITY_STATUS_ORDER) {
      expect(PACKAGE_INTEGRITY_STATUS_MAP).toHaveProperty(key);
    }
  });

  it("canonical status keys present", () => {
    const required: PackageIntegrityStatusKey[] =
      ["verified", "warning", "incomplete", "compromised", "unknown"];
    for (const k of required) {
      expect(PACKAGE_INTEGRITY_STATUS_MAP).toHaveProperty(k);
    }
  });

  it("every status has tier, label, description, badgeClass, order", () => {
    for (const key of PACKAGE_INTEGRITY_STATUS_ORDER) {
      const s = PACKAGE_INTEGRITY_STATUS_MAP[key];
      expect(typeof s.tier).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.badgeClass).toBe("string");
      expect(typeof s.order).toBe("number");
    }
  });

  it("verified has tier=good, compromised has tier=critical", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.verified.tier).toBe("good");
    expect(PACKAGE_INTEGRITY_STATUS_MAP.compromised.tier).toBe("critical");
  });

  it("compromised description says visibility only - no fix/repair wording", () => {
    const desc = PACKAGE_INTEGRITY_STATUS_MAP.compromised.description.toLowerCase();
    expect(desc).not.toContain("auto-repair");
    expect(desc).not.toContain("automatically repair");
    expect(desc).not.toContain("repair action");
    expect(desc).toContain("visibility");
  });

  it("badgeClass for compromised contains red colour tokens", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.compromised.badgeClass).toContain("red");
  });

  it("badgeClass for verified contains emerald colour tokens", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.verified.badgeClass).toContain("emerald");
  });

  it("order values are unique spanning 0..4", () => {
    const orders = PACKAGE_INTEGRITY_STATUS_ORDER.map(k => PACKAGE_INTEGRITY_STATUS_MAP[k].order);
    expect(new Set(orders).size).toBe(5);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Evidence packages page super-admin scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - Evidence packages page super-admin scoped", () => {
  it("EVIDENCE_PACKAGE_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("base GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("base contract readOnly and noMutationControls remain true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.readOnly).toBe(true);
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noMutationControls).toBe(true);
  });

  it("base contract noExportRendering is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noExportRendering).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Section coverage ordering deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - Section coverage ordering deterministic", () => {
  it("EVIDENCE_SECTION_ORDER is a readonly tuple of 7 unique keys", () => {
    expect(EVIDENCE_SECTION_ORDER.length).toBe(7);
    expect(new Set(EVIDENCE_SECTION_ORDER).size).toBe(7);
  });

  it("each section index matches its .order property", () => {
    EVIDENCE_SECTION_ORDER.forEach((key, idx) => {
      expect(EVIDENCE_SECTION_MAP[key].order).toBe(idx);
    });
  });

  it("canonical section order sequence is correct", () => {
    expect(EVIDENCE_SECTION_ORDER[0]).toBe("audit_integrity");
    expect(EVIDENCE_SECTION_ORDER[1]).toBe("policy_violations");
    expect(EVIDENCE_SECTION_ORDER[2]).toBe("workflow_lifecycle");
    expect(EVIDENCE_SECTION_ORDER[3]).toBe("governance_analytics");
    expect(EVIDENCE_SECTION_ORDER[4]).toBe("topology_readiness");
    expect(EVIDENCE_SECTION_ORDER[5]).toBe("forensic_timeline");
    expect(EVIDENCE_SECTION_ORDER[6]).toBe("boundary_summary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Missing sections always visible
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - Missing sections always visible (config supports it)", () => {
  it("all 7 sections are in the canonical order - none hidden by default", () => {
    expect(EVIDENCE_SECTION_ORDER.length).toBe(7);
  });

  it("every section has a reviewMeaning that describes its visibility purpose", () => {
    for (const key of EVIDENCE_SECTION_ORDER) {
      expect(EVIDENCE_SECTION_MAP[key].reviewMeaning.length).toBeGreaterThan(10);
    }
  });

  it("no section description hides absence - sections not 'optional' or 'hidden'", () => {
    for (const key of EVIDENCE_SECTION_ORDER) {
      const desc = EVIDENCE_SECTION_MAP[key].description.toLowerCase();
      expect(desc).not.toContain("optional section");
      expect(desc).not.toContain("hidden when");
    }
  });

  it("EVIDENCE_PACKAGE_EMPTY_STATE.noSectionData is defined with title and description", () => {
    expect(typeof EVIDENCE_PACKAGE_EMPTY_STATE.noSectionData.title).toBe("string");
    expect(typeof EVIDENCE_PACKAGE_EMPTY_STATE.noSectionData.description).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Compromised packages always visible
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - Compromised packages always visible (config)", () => {
  it("compromised tier=critical - highest severity integrity status", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.compromised.tier).toBe("critical");
  });

  it("compromised order=3 - second to last (before unknown)", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.compromised.order).toBe(3);
  });

  it("badgeClass for compromised uses red tokens - always visible colour", () => {
    const cls = PACKAGE_INTEGRITY_STATUS_MAP.compromised.badgeClass;
    expect(cls).toContain("red");
  });

  it("warning tier=attention - elevated visibility", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.warning.tier).toBe("attention");
  });

  it("incomplete tier=neutral - always rendered (not hidden)", () => {
    expect(PACKAGE_INTEGRITY_STATUS_MAP.incomplete.tier).toBe("neutral");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - No generate/export/verify/legal/notarize labels
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - No generate/export/verify/legal/notarize labels", () => {
  // Phrase-level patterns - single words like "export" may appear in scope labels
  const forbidden = [
    "generate package", "generate evidence",
    "pdf export", "xlsx export", "export to file",
    "verify package", "repair package", "repair integrity",
    "legal verdict", "legally binding",
    "notarize", "blockchain",
    "submit to regulator", "regulator submission",
    "ai summary", "ai-generated",
  ];

  it("no scope description or displayHint contains forbidden phrases", () => {
    for (const key of EVIDENCE_PACKAGE_SCOPE_ORDER) {
      const s = EVIDENCE_PACKAGE_SCOPE_MAP[key];
      const text = `${s.description} ${s.displayHint}`.toLowerCase();
      for (const term of forbidden) {
        expect(text).not.toContain(term);
      }
    }
  });

  it("no section description or reviewMeaning contains forbidden phrases", () => {
    for (const key of EVIDENCE_SECTION_ORDER) {
      const s = EVIDENCE_SECTION_MAP[key];
      const text = `${s.description} ${s.reviewMeaning}`.toLowerCase();
      for (const term of forbidden) {
        expect(text).not.toContain(term);
      }
    }
  });

  it("no integrity status label or description contains forbidden phrases", () => {
    for (const key of PACKAGE_INTEGRITY_STATUS_ORDER) {
      const s = PACKAGE_INTEGRITY_STATUS_MAP[key];
      const text = `${s.label} ${s.description}`.toLowerCase();
      for (const term of forbidden) {
        expect(text).not.toContain(term);
      }
    }
  });

  it("EVIDENCE_PACKAGE_SAFETY_CONTRACT contains no generate/export/legal keys that are false", () => {
    const c = EVIDENCE_PACKAGE_SAFETY_CONTRACT;
    expect(c.noPackageGeneration).toBe(true);
    expect(c.noExportRendering).toBe(true);
    expect(c.noExternalSubmission).toBe(true);
    expect(c.noLegalConclusions).toBe(true);
    expect(c.noNotarization).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Evidence package safety contract true
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - Evidence package safety contract all true", () => {
  it("EVIDENCE_PACKAGE_SAFETY_CONTRACT has exactly 10 properties, all true", () => {
    const keys = Object.keys(EVIDENCE_PACKAGE_SAFETY_CONTRACT) as (keyof typeof EVIDENCE_PACKAGE_SAFETY_CONTRACT)[];
    expect(keys.length).toBe(10);
    for (const key of keys) {
      expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT[key]).toBe(true);
    }
  });

  it("required contract keys present and true", () => {
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noPackageGeneration).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noExportRendering).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noExternalSubmission).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noVerifyRepairAction).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noNotarization).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noAiSummaries).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noLegalConclusions).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noDownloadButtons).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
    expect(EVIDENCE_PACKAGE_SAFETY_CONTRACT.noPackageMutation).toBe(true);
  });

  it("all values are booleans", () => {
    for (const val of Object.values(EVIDENCE_PACKAGE_SAFETY_CONTRACT)) {
      expect(typeof val).toBe("boolean");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Hooks remain read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - Governance read hook names remain read-only", () => {
  it("GOVERNANCE_READ_HOOK_NAMES has at least 16 entries", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(16);
  });

  it("evidence hooks present: useGovernanceEvidencePackages, useGovernanceEvidenceReadiness", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceEvidencePackages");
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceEvidenceReadiness");
  });

  it("no hook name starts with a mutation prefix", () => {
    const prefixes = ["useMutate", "useCreate", "useDelete", "useUpdate", "usePost"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const prefix of prefixes) {
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
// T11 - Filters config stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T11 - Filters config stable", () => {
  it("EVIDENCE_SCOPE_FILTER_OPTIONS has 7 entries (empty + 6 scopes)", () => {
    expect(EVIDENCE_SCOPE_FILTER_OPTIONS.length).toBe(7);
  });

  it("first scope filter option is 'All Scopes' with empty value", () => {
    expect(EVIDENCE_SCOPE_FILTER_OPTIONS[0].value).toBe("");
    expect(EVIDENCE_SCOPE_FILTER_OPTIONS[0].label).toBe("All Scopes");
  });

  it("scope filter contains all 6 canonical scope values", () => {
    const values = EVIDENCE_SCOPE_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    const required: EvidencePackageScopeKey[] = ["platform", "workspace", "entity", "violation", "workflow", "readiness"];
    for (const k of required) {
      expect(values).toContain(k);
    }
  });

  it("EVIDENCE_INTEGRITY_FILTER_OPTIONS has 6 entries (empty + 5 statuses)", () => {
    expect(EVIDENCE_INTEGRITY_FILTER_OPTIONS.length).toBe(6);
  });

  it("first integrity filter option is 'All Statuses' with empty value", () => {
    expect(EVIDENCE_INTEGRITY_FILTER_OPTIONS[0].value).toBe("");
    expect(EVIDENCE_INTEGRITY_FILTER_OPTIONS[0].label).toBe("All Statuses");
  });

  it("integrity filter contains all 5 canonical status values", () => {
    const values = EVIDENCE_INTEGRITY_FILTER_OPTIONS.map(o => o.value).filter(v => v !== "");
    const required: PackageIntegrityStatusKey[] = ["verified", "warning", "incomplete", "compromised", "unknown"];
    for (const k of required) {
      expect(values).toContain(k);
    }
  });

  it("all filter option values and labels are non-empty strings (excluding the blank 'all' entry)", () => {
    for (const opt of [...EVIDENCE_SCOPE_FILTER_OPTIONS, ...EVIDENCE_INTEGRITY_FILTER_OPTIONS]) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - Config shapes correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T12 - Config shapes correct", () => {
  it("EVIDENCE_PACKAGE_SCOPE_MAP sample has correct shape", () => {
    const s = EVIDENCE_PACKAGE_SCOPE_MAP.platform;
    expect(s).toHaveProperty("label");
    expect(s).toHaveProperty("order");
    expect(s).toHaveProperty("tier");
    expect(s).toHaveProperty("description");
    expect(s).toHaveProperty("displayHint");
  });

  it("EVIDENCE_SECTION_MAP sample has correct shape", () => {
    const s = EVIDENCE_SECTION_MAP.audit_integrity;
    expect(s).toHaveProperty("label");
    expect(s).toHaveProperty("order");
    expect(s).toHaveProperty("description");
    expect(s).toHaveProperty("expectedSourceLayer");
    expect(s).toHaveProperty("reviewMeaning");
  });

  it("PACKAGE_INTEGRITY_STATUS_MAP sample has correct shape", () => {
    const s = PACKAGE_INTEGRITY_STATUS_MAP.compromised;
    expect(s).toHaveProperty("tier");
    expect(s).toHaveProperty("label");
    expect(s).toHaveProperty("description");
    expect(s).toHaveProperty("badgeClass");
    expect(s).toHaveProperty("order");
  });

  it("EVIDENCE_PACKAGE_SAFETY_CONTRACT is plain object of booleans", () => {
    expect(typeof EVIDENCE_PACKAGE_SAFETY_CONTRACT).toBe("object");
    for (const val of Object.values(EVIDENCE_PACKAGE_SAFETY_CONTRACT)) {
      expect(typeof val).toBe("boolean");
    }
  });

  it("EVIDENCE_PACKAGE_EMPTY_STATE has 4 entries each with title and description", () => {
    const entries = Object.values(EVIDENCE_PACKAGE_EMPTY_STATE);
    expect(entries.length).toBe(4);
    for (const e of entries) {
      expect(typeof e.title).toBe("string");
      expect(typeof e.description).toBe("string");
    }
  });

  it("EVIDENCE_SECTION_ORDER and EVIDENCE_PACKAGE_SCOPE_ORDER are non-empty tuples", () => {
    expect(EVIDENCE_SECTION_ORDER.length).toBeGreaterThan(0);
    expect(EVIDENCE_PACKAGE_SCOPE_ORDER.length).toBeGreaterThan(0);
  });

  it("PACKAGE_INTEGRITY_STATUS_ORDER is a non-empty tuple", () => {
    expect(PACKAGE_INTEGRITY_STATUS_ORDER.length).toBeGreaterThan(0);
  });

  it("all filter options arrays are non-empty", () => {
    expect(EVIDENCE_SCOPE_FILTER_OPTIONS.length).toBeGreaterThan(0);
    expect(EVIDENCE_INTEGRITY_FILTER_OPTIONS.length).toBeGreaterThan(0);
  });
});
