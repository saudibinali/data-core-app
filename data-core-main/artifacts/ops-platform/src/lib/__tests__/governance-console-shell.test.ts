/**
 * @file   lib/__tests__/governance-console-shell.test.ts
 * @phase  P12-A - Governance Dashboard Shell & Navigation Foundations
 *
 * Pure unit tests for the governance console shell layer.
 * No React, no DOM, no HTTP - all tests run in node environment.
 * Imports only from governance-console-config.ts (pure TS constants).
 *
 * Tests:
 *   T1   Governance nav items are present and super-admin scoped
 *   T2   Governance nav items are absent from platform nav
 *   T3   Governance routes are all under /super-admin/governance prefix
 *   T4   Route count matches nav label count (7 sections)
 *   T5   Query key name registry covers all 14 expected keys
 *   T6   Read-only hook names registry has no mutation indicators
 *   T7   All governance API paths start with /api/platform
 *   T8   Safety contract declares no mutation / no enforcement / super-admin-only
 *   T9   Governance routes do not overlap with platform nav paths
 *   T10  Config constants are frozen / immutable (all values are const tuples)
 */

import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_ROUTES,
  ALL_GOVERNANCE_ROUTE_PATHS,
  GOVERNANCE_NAV_LABELS,
  GOVERNANCE_QUERY_KEY_NAMES,
  GOVERNANCE_READ_HOOK_NAMES,
  GOVERNANCE_API_PATHS,
  GOVERNANCE_CONSOLE_SAFETY_CONTRACT,
  PLATFORM_NAV_PATHS,
} from "../governance-console-config";

// ── T1: Governance nav items are present and super-admin scoped ───────────

describe("T1 - Governance nav routes are present and super-admin scoped", () => {
  it("ALL_GOVERNANCE_ROUTE_PATHS has exactly 7 entries", () => {
    expect(ALL_GOVERNANCE_ROUTE_PATHS).toHaveLength(7);
  });

  it("every route path starts with /super-admin/governance", () => {
    for (const path of ALL_GOVERNANCE_ROUTE_PATHS) {
      expect(path.startsWith("/super-admin/governance")).toBe(true);
    }
  });

  it("all route paths are unique", () => {
    const unique = new Set(ALL_GOVERNANCE_ROUTE_PATHS);
    expect(unique.size).toBe(ALL_GOVERNANCE_ROUTE_PATHS.length);
  });

  it("overview route is the exact path /super-admin/governance", () => {
    expect(GOVERNANCE_ROUTES.overview).toBe("/super-admin/governance");
  });

  it("GOVERNANCE_ROUTES has all expected named keys", () => {
    expect(GOVERNANCE_ROUTES.overview).toBeDefined();
    expect(GOVERNANCE_ROUTES.auditIntegrity).toBeDefined();
    expect(GOVERNANCE_ROUTES.violations).toBeDefined();
    expect(GOVERNANCE_ROUTES.workflows).toBeDefined();
    expect(GOVERNANCE_ROUTES.analytics).toBeDefined();
    expect(GOVERNANCE_ROUTES.topology).toBeDefined();
    expect(GOVERNANCE_ROUTES.evidencePackages).toBeDefined();
  });
});

// ── T2: Governance nav items do not appear in platform nav ────────────────

describe("T2 - Governance paths are absent from platform nav paths", () => {
  it("platform nav paths do not contain /governance", () => {
    for (const path of PLATFORM_NAV_PATHS) {
      expect(path.includes("/governance")).toBe(false);
    }
  });

  it("platform nav has exactly 5 top-level paths", () => {
    expect(PLATFORM_NAV_PATHS).toHaveLength(5);
  });

  it("platform nav includes /super-admin exactly once (overview)", () => {
    const exact = PLATFORM_NAV_PATHS.filter(p => p === "/super-admin");
    expect(exact).toHaveLength(1);
  });
});

// ── T3: Governance routes are all under /super-admin prefix ───────────────

describe("T3 - Route path structure: all under /super-admin", () => {
  it("every governance route starts with /super-admin", () => {
    for (const path of ALL_GOVERNANCE_ROUTE_PATHS) {
      expect(path.startsWith("/super-admin")).toBe(true);
    }
  });

  it("sub-section routes have at least 3 path segments", () => {
    const subRoutes = ALL_GOVERNANCE_ROUTE_PATHS.filter(p => p !== "/super-admin/governance");
    for (const route of subRoutes) {
      const segments = route.split("/").filter(Boolean);
      expect(segments.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("audit-integrity route contains 'audit-integrity'", () => {
    expect(GOVERNANCE_ROUTES.auditIntegrity).toContain("audit-integrity");
  });

  it("evidence-packages route contains 'evidence-packages'", () => {
    expect(GOVERNANCE_ROUTES.evidencePackages).toContain("evidence-packages");
  });
});

// ── T4: Route count matches nav label count ───────────────────────────────

describe("T4 - Route count matches nav label count (7 sections)", () => {
  it("GOVERNANCE_NAV_LABELS has exactly 7 entries", () => {
    expect(GOVERNANCE_NAV_LABELS).toHaveLength(7);
  });

  it("nav labels count equals route paths count", () => {
    expect(GOVERNANCE_NAV_LABELS.length).toBe(ALL_GOVERNANCE_ROUTE_PATHS.length);
  });

  it("nav labels include all expected section names", () => {
    const labels = GOVERNANCE_NAV_LABELS as readonly string[];
    expect(labels).toContain("Overview");
    expect(labels).toContain("Audit Integrity");
    expect(labels).toContain("Policy Violations");
    expect(labels).toContain("Workflows");
    expect(labels).toContain("Analytics");
    expect(labels).toContain("Topology & Readiness");
    expect(labels).toContain("Evidence Packages");
  });

  it("all nav labels are unique", () => {
    const unique = new Set(GOVERNANCE_NAV_LABELS);
    expect(unique.size).toBe(GOVERNANCE_NAV_LABELS.length);
  });
});

// ── T5: Query key name registry covers all 14 expected keys ──────────────

describe("T5 - Query key name registry", () => {
  it("has exactly 14 query key names", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES).toHaveLength(14);
  });

  it("includes 'readiness' key", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES as readonly string[]).toContain("readiness");
  });

  it("includes 'auditChains' key", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES as readonly string[]).toContain("auditChains");
  });

  it("includes 'evidencePackages' and 'evidenceReadiness' keys", () => {
    const keys = GOVERNANCE_QUERY_KEY_NAMES as readonly string[];
    expect(keys).toContain("evidencePackages");
    expect(keys).toContain("evidenceReadiness");
  });

  it("includes 'topologySnapshot' key", () => {
    expect(GOVERNANCE_QUERY_KEY_NAMES as readonly string[]).toContain("topologySnapshot");
  });

  it("all query key names are unique", () => {
    const unique = new Set(GOVERNANCE_QUERY_KEY_NAMES);
    expect(unique.size).toBe(GOVERNANCE_QUERY_KEY_NAMES.length);
  });
});

// ── T6: Read-only hook names registry has no mutation indicators ──────────

describe("T6 - Read-only hook names registry", () => {
  it("has at least 15 read hook names (16 after P12-B forensic hook added)", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES.length).toBeGreaterThanOrEqual(15);
  });

  it("no hook name contains 'Mutation'", () => {
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      expect(name.toLowerCase()).not.toContain("mutation");
    }
  });

  it("no hook name contains mutation-indicative verbs", () => {
    const mutationVerbs = ["create", "update", "delete", "post", "patch", "put", "write", "reset", "set"];
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      for (const verb of mutationVerbs) {
        expect(name.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("all hook names start with 'useGovernance'", () => {
    for (const name of GOVERNANCE_READ_HOOK_NAMES) {
      expect(name.startsWith("useGovernance")).toBe(true);
    }
  });

  it("includes useGovernanceOverview composite hook", () => {
    expect(GOVERNANCE_READ_HOOK_NAMES as readonly string[]).toContain("useGovernanceOverview");
  });

  it("all hook names are unique", () => {
    const unique = new Set(GOVERNANCE_READ_HOOK_NAMES);
    expect(unique.size).toBe(GOVERNANCE_READ_HOOK_NAMES.length);
  });
});

// ── T7: All governance API paths start with /api/platform ────────────────

describe("T7 - Governance API path structure", () => {
  it("all API paths start with /api/platform", () => {
    for (const [, path] of Object.entries(GOVERNANCE_API_PATHS)) {
      expect(path.startsWith("/api/platform")).toBe(true);
    }
  });

  it("has 16 API path entries covering all governance routes", () => {
    expect(Object.keys(GOVERNANCE_API_PATHS).length).toBe(16);
  });

  it("audit chain path contains 'audit-chains'", () => {
    expect(GOVERNANCE_API_PATHS.auditChains).toContain("audit-chains");
  });

  it("evidence packages path contains 'evidence-packages'", () => {
    expect(GOVERNANCE_API_PATHS.evidencePackages).toContain("evidence-packages");
  });

  it("topology diff path is POST-capable (contains 'diff')", () => {
    expect(GOVERNANCE_API_PATHS.topologyDiff).toContain("diff");
  });

  it("all API paths are unique", () => {
    const paths = Object.values(GOVERNANCE_API_PATHS);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });
});

// ── T8: Safety contract declares correct invariants ───────────────────────

describe("T8 - Governance console safety contract", () => {
  it("readOnly is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.readOnly).toBe(true);
  });

  it("noMutationControls is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noMutationControls).toBe(true);
  });

  it("noAutoEnforcement is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noAutoEnforcement).toBe(true);
  });

  it("noExportRendering is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noExportRendering).toBe(true);
  });

  it("noExternalSubmission is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noExternalSubmission).toBe(true);
  });

  it("noAiSummaries is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.noAiSummaries).toBe(true);
  });

  it("superAdminOnly is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.superAdminOnly).toBe(true);
  });

  it("allRoutesUnderSuperAdmin is true", () => {
    expect(GOVERNANCE_CONSOLE_SAFETY_CONTRACT.allRoutesUnderSuperAdmin).toBe(true);
  });

  it("all 8 safety contract properties are defined", () => {
    const props = Object.keys(GOVERNANCE_CONSOLE_SAFETY_CONTRACT);
    expect(props.length).toBe(8);
  });
});

// ── T9: Governance routes do not overlap with platform nav paths ──────────

describe("T9 - No overlap between governance routes and platform nav", () => {
  it("no governance route equals any platform nav path", () => {
    const platformSet = new Set<string>(PLATFORM_NAV_PATHS);
    for (const gPath of ALL_GOVERNANCE_ROUTE_PATHS) {
      expect(platformSet.has(gPath)).toBe(false);
    }
  });

  it("no platform nav path starts with /super-admin/governance", () => {
    for (const pPath of PLATFORM_NAV_PATHS) {
      expect(pPath.startsWith("/super-admin/governance")).toBe(false);
    }
  });

  it("combined route set has 7 + 5 = 12 unique paths", () => {
    const combined = new Set([...ALL_GOVERNANCE_ROUTE_PATHS, ...PLATFORM_NAV_PATHS]);
    expect(combined.size).toBe(12);
  });
});

// ── T10: Config constants are stable (const tuples) ──────────────────────

describe("T10 - Config constants are stable and well-formed", () => {
  it("GOVERNANCE_ROUTES object has exactly 7 entries", () => {
    expect(Object.keys(GOVERNANCE_ROUTES).length).toBe(7);
  });

  it("GOVERNANCE_QUERY_KEY_NAMES is an array (const tuple)", () => {
    expect(Array.isArray(GOVERNANCE_QUERY_KEY_NAMES)).toBe(true);
  });

  it("GOVERNANCE_READ_HOOK_NAMES is an array", () => {
    expect(Array.isArray(GOVERNANCE_READ_HOOK_NAMES)).toBe(true);
  });

  it("GOVERNANCE_NAV_LABELS is an array", () => {
    expect(Array.isArray(GOVERNANCE_NAV_LABELS)).toBe(true);
  });

  it("GOVERNANCE_CONSOLE_SAFETY_CONTRACT is an object with boolean values only", () => {
    for (const value of Object.values(GOVERNANCE_CONSOLE_SAFETY_CONTRACT)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("ALL_GOVERNANCE_ROUTE_PATHS contains the same paths as GOVERNANCE_ROUTES values", () => {
    const fromRoutes = Object.values(GOVERNANCE_ROUTES).sort();
    const fromAll   = [...ALL_GOVERNANCE_ROUTE_PATHS].sort();
    expect(fromAll).toEqual(fromRoutes);
  });

  it("no route path contains whitespace", () => {
    for (const path of ALL_GOVERNANCE_ROUTE_PATHS) {
      expect(/\s/.test(path)).toBe(false);
    }
  });

  it("no route path ends with a trailing slash", () => {
    for (const path of ALL_GOVERNANCE_ROUTE_PATHS) {
      expect(path.endsWith("/")).toBe(false);
    }
  });
});
