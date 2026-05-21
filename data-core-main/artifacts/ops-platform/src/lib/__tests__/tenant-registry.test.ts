/**
 * @file   src/lib/__tests__/tenant-registry.test.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *
 * Pure config/model tests for the frontend tenant registry layer.
 * All tests operate on plain in-memory data - no React, no DOM, no fetch.
 *
 * Tests:
 *   T1   TENANT_STATUS_MAP - shape and key count
 *   T2   ALL_TENANT_STATUS_KEYS - exactly 8 entries; all in TENANT_STATUS_MAP
 *   T3   WORKSPACE_OPERATIONAL_STATUS_MAP - 7 statuses; all have label+order
 *   T4   SUBSCRIPTION_STATUS_MAP - 8 statuses; all have badgeClass
 *   T5   ALL_SUBSCRIPTION_STATUS_KEYS - exactly 8; match map
 *   T6   RISK_LEVEL_MAP - 6 levels; all have dotClass
 *   T7   RISK_LEVEL_ORDER - 6 entries; matches map keys
 *   T8   PLAN_TIER_MAP - all entries have label, order, tier, badgeClass
 *   T9   TENANT_REGISTRY_SAFETY_CONTRACT - all properties are true
 *   T10  TENANT_READ_HOOK_NAMES - all start with "use"; no mutation prefix
 *   T11  TENANT_STATUS_FILTER_OPTIONS - first entry is "all statuses" empty value
 *   T12  SUBSCRIPTION_STATUS_FILTER_OPTIONS - first entry is empty value
 *   T13  RISK_LEVEL_FILTER_OPTIONS - first entry is empty value
 *   T14  TENANT_REGISTRY_TABLE_COLUMNS - at least 7 columns; all have key+label
 *   T15  TENANT_REGISTRY_EMPTY_STATE - all values are non-empty strings
 *   T16  TENANT_REGISTRY_API_PATHS - list path is /api/platform/tenants
 *   T17  TENANT_REGISTRY_API_PATHS - profile/summary are functions returning strings
 *   T18  Determinism - TENANT_STATUS_MAP order values are unique
 *   T19  No mutation wording in any map label or description
 *   T20  Safety - TENANT_REGISTRY_SAFETY_CONTRACT has exactly 10 properties
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_STATUS_MAP,
  ALL_TENANT_STATUS_KEYS,
  WORKSPACE_OPERATIONAL_STATUS_MAP,
  SUBSCRIPTION_STATUS_MAP,
  ALL_SUBSCRIPTION_STATUS_KEYS,
  RISK_LEVEL_MAP,
  RISK_LEVEL_ORDER,
  PLAN_TIER_MAP,
  TENANT_REGISTRY_SAFETY_CONTRACT,
  TENANT_READ_HOOK_NAMES,
  TENANT_STATUS_FILTER_OPTIONS,
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  RISK_LEVEL_FILTER_OPTIONS,
  TENANT_REGISTRY_TABLE_COLUMNS,
  TENANT_REGISTRY_EMPTY_STATE,
  TENANT_REGISTRY_API_PATHS,
} from "../tenant-registry-config";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - TENANT_STATUS_MAP shape
// ─────────────────────────────────────────────────────────────────────────────
describe("T1 - TENANT_STATUS_MAP: shape and key count", () => {
  const keys = Object.keys(TENANT_STATUS_MAP);

  it("has exactly 8 entries", () => expect(keys).toHaveLength(8));

  it("every entry has label, order, tier, description, badgeClass", () => {
    for (const key of keys) {
      const entry = TENANT_STATUS_MAP[key as keyof typeof TENANT_STATUS_MAP];
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.order).toBe("number");
      expect(typeof entry.tier).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.badgeClass).toBe("string");
    }
  });

  it("tier values are restricted to known tiers", () => {
    const knownTiers = new Set(["good", "attention", "critical", "muted", "neutral"]);
    for (const key of keys) {
      const entry = TENANT_STATUS_MAP[key as keyof typeof TENANT_STATUS_MAP];
      expect(knownTiers.has(entry.tier)).toBe(true);
    }
  });

  it("active status has good tier", () => {
    expect(TENANT_STATUS_MAP.active.tier).toBe("good");
  });

  it("suspended status has critical tier", () => {
    expect(TENANT_STATUS_MAP.suspended.tier).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - ALL_TENANT_STATUS_KEYS
// ─────────────────────────────────────────────────────────────────────────────
describe("T2 - ALL_TENANT_STATUS_KEYS: 8 entries; all in TENANT_STATUS_MAP", () => {
  it("has exactly 8 entries", () => expect(ALL_TENANT_STATUS_KEYS).toHaveLength(8));

  it("all entries exist in TENANT_STATUS_MAP", () => {
    for (const key of ALL_TENANT_STATUS_KEYS) {
      expect(TENANT_STATUS_MAP).toHaveProperty(key);
    }
  });

  it("contains active, suspended, archived", () => {
    expect(ALL_TENANT_STATUS_KEYS).toContain("active");
    expect(ALL_TENANT_STATUS_KEYS).toContain("suspended");
    expect(ALL_TENANT_STATUS_KEYS).toContain("archived");
  });

  it("no duplicates", () => {
    const set = new Set(ALL_TENANT_STATUS_KEYS);
    expect(set.size).toBe(ALL_TENANT_STATUS_KEYS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - WORKSPACE_OPERATIONAL_STATUS_MAP
// ─────────────────────────────────────────────────────────────────────────────
describe("T3 - WORKSPACE_OPERATIONAL_STATUS_MAP: 7 statuses; all have label+order", () => {
  const keys = Object.keys(WORKSPACE_OPERATIONAL_STATUS_MAP);

  it("has exactly 7 entries", () => expect(keys).toHaveLength(7));

  it("every entry has label, order, tier, description, badgeClass", () => {
    for (const key of keys) {
      const entry = WORKSPACE_OPERATIONAL_STATUS_MAP[key as keyof typeof WORKSPACE_OPERATIONAL_STATUS_MAP];
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.order).toBe("number");
      expect(typeof entry.tier).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.badgeClass).toBe("string");
    }
  });

  it("healthy is order 0", () => expect(WORKSPACE_OPERATIONAL_STATUS_MAP.healthy.order).toBe(0));
  it("unknown is the last entry", () => expect(WORKSPACE_OPERATIONAL_STATUS_MAP.unknown.order).toBe(6));
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - SUBSCRIPTION_STATUS_MAP
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 - SUBSCRIPTION_STATUS_MAP: 8 statuses; all have badgeClass", () => {
  const keys = Object.keys(SUBSCRIPTION_STATUS_MAP);

  it("has exactly 8 entries", () => expect(keys).toHaveLength(8));

  it("every entry has badgeClass string", () => {
    for (const key of keys) {
      const entry = SUBSCRIPTION_STATUS_MAP[key as keyof typeof SUBSCRIPTION_STATUS_MAP];
      expect(typeof entry.badgeClass).toBe("string");
      expect(entry.badgeClass.length).toBeGreaterThan(0);
    }
  });

  it("active has good tier", () => expect(SUBSCRIPTION_STATUS_MAP.active.tier).toBe("good"));
  it("unknown is present", () => expect(SUBSCRIPTION_STATUS_MAP).toHaveProperty("unknown"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - ALL_SUBSCRIPTION_STATUS_KEYS
// ─────────────────────────────────────────────────────────────────────────────
describe("T5 - ALL_SUBSCRIPTION_STATUS_KEYS: 8 entries; match map", () => {
  it("has exactly 8 entries", () => expect(ALL_SUBSCRIPTION_STATUS_KEYS).toHaveLength(8));

  it("all keys exist in SUBSCRIPTION_STATUS_MAP", () => {
    for (const key of ALL_SUBSCRIPTION_STATUS_KEYS) {
      expect(SUBSCRIPTION_STATUS_MAP).toHaveProperty(key);
    }
  });

  it("no duplicates", () => {
    const set = new Set(ALL_SUBSCRIPTION_STATUS_KEYS);
    expect(set.size).toBe(ALL_SUBSCRIPTION_STATUS_KEYS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - RISK_LEVEL_MAP
// ─────────────────────────────────────────────────────────────────────────────
describe("T6 - RISK_LEVEL_MAP: 6 levels; all have dotClass", () => {
  const keys = Object.keys(RISK_LEVEL_MAP);

  it("has exactly 6 entries", () => expect(keys).toHaveLength(6));

  it("every entry has dotClass string", () => {
    for (const key of keys) {
      const entry = RISK_LEVEL_MAP[key as keyof typeof RISK_LEVEL_MAP];
      expect(typeof entry.dotClass).toBe("string");
      expect(entry.dotClass.length).toBeGreaterThan(0);
    }
  });

  it("none has good tier", () => expect(RISK_LEVEL_MAP.none.tier).toBe("good"));
  it("critical has critical tier", () => expect(RISK_LEVEL_MAP.critical.tier).toBe("critical"));
  it("unknown is present", () => expect(RISK_LEVEL_MAP).toHaveProperty("unknown"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - RISK_LEVEL_ORDER
// ─────────────────────────────────────────────────────────────────────────────
describe("T7 - RISK_LEVEL_ORDER: 6 entries; escalates correctly", () => {
  it("has exactly 6 entries", () => expect(RISK_LEVEL_ORDER).toHaveLength(6));

  it("all entries exist in RISK_LEVEL_MAP", () => {
    for (const key of RISK_LEVEL_ORDER) {
      expect(RISK_LEVEL_MAP).toHaveProperty(key);
    }
  });

  it("order is none → low → medium → high → critical → unknown", () => {
    expect(RISK_LEVEL_ORDER[0]).toBe("none");
    expect(RISK_LEVEL_ORDER[1]).toBe("low");
    expect(RISK_LEVEL_ORDER[2]).toBe("medium");
    expect(RISK_LEVEL_ORDER[3]).toBe("high");
    expect(RISK_LEVEL_ORDER[4]).toBe("critical");
    expect(RISK_LEVEL_ORDER[5]).toBe("unknown");
  });

  it("no duplicates", () => {
    const set = new Set(RISK_LEVEL_ORDER);
    expect(set.size).toBe(RISK_LEVEL_ORDER.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - PLAN_TIER_MAP
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 - PLAN_TIER_MAP: all entries have required fields", () => {
  const keys = Object.keys(PLAN_TIER_MAP);

  it("has at least 3 entries", () => expect(keys.length).toBeGreaterThanOrEqual(3));

  it("every entry has label, order, tier, badgeClass", () => {
    for (const key of keys) {
      const entry = PLAN_TIER_MAP[key as keyof typeof PLAN_TIER_MAP];
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.order).toBe("number");
      expect(typeof entry.tier).toBe("string");
      expect(typeof entry.badgeClass).toBe("string");
    }
  });

  it("enterprise is present", () => expect(PLAN_TIER_MAP).toHaveProperty("enterprise"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - TENANT_REGISTRY_SAFETY_CONTRACT: all properties true
// ─────────────────────────────────────────────────────────────────────────────
describe("T9 - TENANT_REGISTRY_SAFETY_CONTRACT: all properties are true", () => {
  const entries = Object.entries(TENANT_REGISTRY_SAFETY_CONTRACT);

  it("every property value is true", () => {
    for (const [key, value] of entries) {
      expect(value, `${key} should be true`).toBe(true);
    }
  });

  it("readOnly is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.readOnly).toBe(true));
  it("noMutationControls is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noMutationControls).toBe(true));
  it("noTenantSuspension is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noTenantSuspension).toBe(true));
  it("noWorkspaceDeletion is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noWorkspaceDeletion).toBe(true));
  it("noSubscriptionMutation is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noSubscriptionMutation).toBe(true));
  it("noBillingActions is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noBillingActions).toBe(true));
  it("noPaymentActions is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noPaymentActions).toBe(true));
  it("noLegalConclusions is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noLegalConclusions).toBe(true));
  it("noAiSummaries is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.noAiSummaries).toBe(true));
  it("superAdminOnly is true", () => expect(TENANT_REGISTRY_SAFETY_CONTRACT.superAdminOnly).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - TENANT_READ_HOOK_NAMES: all read-only; no mutation prefix
// ─────────────────────────────────────────────────────────────────────────────
describe("T10 - TENANT_READ_HOOK_NAMES: all start with use; no mutation prefix", () => {
  const FORBIDDEN_PREFIXES = ["useMutate", "useCreate", "useUpdate", "useDelete", "usePost", "usePatch"];

  it("every hook name starts with 'use'", () => {
    for (const name of TENANT_READ_HOOK_NAMES) {
      expect(name.startsWith("use"), `${name} should start with 'use'`).toBe(true);
    }
  });

  it("no hook name has a mutation prefix", () => {
    for (const name of TENANT_READ_HOOK_NAMES) {
      for (const prefix of FORBIDDEN_PREFIXES) {
        expect(name.startsWith(prefix), `${name} must not start with '${prefix}'`).toBe(false);
      }
    }
  });

  it("has at least 3 hook names", () => expect(TENANT_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(3));
  it("includes useTenantRegistry", () => expect(TENANT_READ_HOOK_NAMES).toContain("useTenantRegistry"));
  it("includes useTenantProfile", () => expect(TENANT_READ_HOOK_NAMES).toContain("useTenantProfile"));
  it("includes useTenantSummary", () => expect(TENANT_READ_HOOK_NAMES).toContain("useTenantSummary"));
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - TENANT_STATUS_FILTER_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("T11 - TENANT_STATUS_FILTER_OPTIONS: first entry is all-statuses", () => {
  it("first entry has empty value (all statuses)", () => {
    expect(TENANT_STATUS_FILTER_OPTIONS[0]!.value).toBe("");
  });
  it("at least 8 options (including 'all')", () => {
    expect(TENANT_STATUS_FILTER_OPTIONS.length).toBeGreaterThanOrEqual(8);
  });
  it("every entry has value and label", () => {
    for (const opt of TENANT_STATUS_FILTER_OPTIONS) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
  it("active option present", () => {
    expect(TENANT_STATUS_FILTER_OPTIONS.some(o => o.value === "active")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - SUBSCRIPTION_STATUS_FILTER_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("T12 - SUBSCRIPTION_STATUS_FILTER_OPTIONS: first entry empty; covers known statuses", () => {
  it("first entry has empty value", () => {
    expect(SUBSCRIPTION_STATUS_FILTER_OPTIONS[0]!.value).toBe("");
  });
  it("contains unknown option", () => {
    expect(SUBSCRIPTION_STATUS_FILTER_OPTIONS.some(o => o.value === "unknown")).toBe(true);
  });
  it("at least 8 options (including all)", () => {
    expect(SUBSCRIPTION_STATUS_FILTER_OPTIONS.length).toBeGreaterThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - RISK_LEVEL_FILTER_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("T13 - RISK_LEVEL_FILTER_OPTIONS: first entry empty; covers all 6 levels", () => {
  it("first entry has empty value", () => {
    expect(RISK_LEVEL_FILTER_OPTIONS[0]!.value).toBe("");
  });
  it("contains critical option", () => {
    expect(RISK_LEVEL_FILTER_OPTIONS.some(o => o.value === "critical")).toBe(true);
  });
  it("non-all options count equals RISK_LEVEL_ORDER count", () => {
    const nonAll = RISK_LEVEL_FILTER_OPTIONS.filter(o => o.value !== "");
    expect(nonAll.length).toBe(RISK_LEVEL_ORDER.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - TENANT_REGISTRY_TABLE_COLUMNS
// ─────────────────────────────────────────────────────────────────────────────
describe("T14 - TENANT_REGISTRY_TABLE_COLUMNS: at least 7 cols; all have key+label", () => {
  it("has at least 7 columns", () => {
    expect(TENANT_REGISTRY_TABLE_COLUMNS.length).toBeGreaterThanOrEqual(7);
  });
  it("every column has key and label", () => {
    for (const col of TENANT_REGISTRY_TABLE_COLUMNS) {
      expect(typeof col.key).toBe("string");
      expect(typeof col.label).toBe("string");
      expect(col.key.length).toBeGreaterThan(0);
      expect(col.label.length).toBeGreaterThan(0);
    }
  });
  it("workspaceName column present", () => {
    expect(TENANT_REGISTRY_TABLE_COLUMNS.some(c => c.key === "workspaceName")).toBe(true);
  });
  it("riskLevel column present", () => {
    expect(TENANT_REGISTRY_TABLE_COLUMNS.some(c => c.key === "riskLevel")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - TENANT_REGISTRY_EMPTY_STATE
// ─────────────────────────────────────────────────────────────────────────────
describe("T15 - TENANT_REGISTRY_EMPTY_STATE: all values are non-empty strings", () => {
  const entries = Object.entries(TENANT_REGISTRY_EMPTY_STATE);

  it("has at least 10 state messages", () => expect(entries.length).toBeGreaterThanOrEqual(10));

  it("every value is a non-empty string", () => {
    for (const [key, value] of entries) {
      expect(typeof value, `${key} should be a string`).toBe("string");
      expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("noTenants message is defined", () => {
    expect(TENANT_REGISTRY_EMPTY_STATE.noTenants.length).toBeGreaterThan(0);
  });
  it("unauthorized message is defined", () => {
    expect(TENANT_REGISTRY_EMPTY_STATE.unauthorized.length).toBeGreaterThan(0);
  });
  it("noSubscription message is defined", () => {
    expect(TENANT_REGISTRY_EMPTY_STATE.noSubscription.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 - TENANT_REGISTRY_API_PATHS: list path
// ─────────────────────────────────────────────────────────────────────────────
describe("T16 - TENANT_REGISTRY_API_PATHS: list path is /api/platform/tenants", () => {
  it("list path is /api/platform/tenants", () => {
    expect(TENANT_REGISTRY_API_PATHS.list).toBe("/api/platform/tenants");
  });

  it("list path starts with /api/", () => {
    expect(TENANT_REGISTRY_API_PATHS.list.startsWith("/api/")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 - TENANT_REGISTRY_API_PATHS: profile/summary are functions
// ─────────────────────────────────────────────────────────────────────────────
describe("T17 - TENANT_REGISTRY_API_PATHS: profile/summary are functions returning strings", () => {
  it("profile is a function", () => {
    expect(typeof TENANT_REGISTRY_API_PATHS.profile).toBe("function");
  });
  it("summary is a function", () => {
    expect(typeof TENANT_REGISTRY_API_PATHS.summary).toBe("function");
  });
  it("profile('42') returns /api/platform/tenants/42", () => {
    expect(TENANT_REGISTRY_API_PATHS.profile("42")).toBe("/api/platform/tenants/42");
  });
  it("summary('42') returns /api/platform/tenants/42/summary", () => {
    expect(TENANT_REGISTRY_API_PATHS.summary("42")).toBe("/api/platform/tenants/42/summary");
  });
  it("profile path contains tenantId", () => {
    const path = TENANT_REGISTRY_API_PATHS.profile("99");
    expect(path).toContain("99");
    expect(path.startsWith("/api/")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 - Determinism: TENANT_STATUS_MAP order values are unique
// ─────────────────────────────────────────────────────────────────────────────
describe("T18 - Determinism: TENANT_STATUS_MAP order values are unique integers", () => {
  const entries = Object.entries(TENANT_STATUS_MAP);
  const orders  = entries.map(([, e]) => e.order);

  it("all order values are integers", () => {
    for (const o of orders) {
      expect(Number.isInteger(o)).toBe(true);
    }
  });

  it("all order values are unique", () => {
    const set = new Set(orders);
    expect(set.size).toBe(orders.length);
  });

  it("order values start at 0", () => {
    expect(Math.min(...orders)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T19 - No mutation wording in any map label or description
// ─────────────────────────────────────────────────────────────────────────────
describe("T19 - No mutation/enforcement wording in map labels or descriptions", () => {
  const FORBIDDEN_PHRASES = [
    "suspend tenant", "delete workspace", "cancel subscription",
    "charge", "invoice", "payment", "auto-enforce", "automatically suspend",
    "legal verdict", "regulatory filing", "submit to regulator",
    "AI verdict", "automated decision",
  ];

  function collectAllText(): string[] {
    const texts: string[] = [];
    const maps = [
      TENANT_STATUS_MAP,
      WORKSPACE_OPERATIONAL_STATUS_MAP,
      SUBSCRIPTION_STATUS_MAP,
      RISK_LEVEL_MAP,
      PLAN_TIER_MAP,
    ];
    for (const map of maps) {
      for (const entry of Object.values(map)) {
        if ("label" in entry)       texts.push((entry as { label: string }).label);
        if ("description" in entry) texts.push((entry as { description: string }).description);
      }
    }
    return texts;
  }

  const allText = collectAllText().join(" ").toLowerCase();

  it("no forbidden phrase appears in any map text", () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(allText.includes(phrase.toLowerCase()), `Found forbidden phrase: "${phrase}"`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20 - TENANT_REGISTRY_SAFETY_CONTRACT has exactly 10 properties
// ─────────────────────────────────────────────────────────────────────────────
describe("T20 - TENANT_REGISTRY_SAFETY_CONTRACT has exactly 10 properties", () => {
  const props = Object.keys(TENANT_REGISTRY_SAFETY_CONTRACT);

  it("has exactly 10 properties", () => expect(props).toHaveLength(10));

  it("no property is false or undefined", () => {
    for (const key of props) {
      expect(
        TENANT_REGISTRY_SAFETY_CONTRACT[key as keyof typeof TENANT_REGISTRY_SAFETY_CONTRACT],
        `${key} should be true`,
      ).toBe(true);
    }
  });
});
