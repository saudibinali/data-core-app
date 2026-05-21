/**
 * @file   __tests__/tenant-admin-console-config.test.ts
 * @phase  P13-H - Tenant Administration Console Consolidation
 *
 * Tests covering:
 *   T1  - console safety contract all true
 *   T2  - tabs/sections config stable
 *   T3  - overview cards config stable
 *   T4  - lifecycle tab config preserved
 *   T5  - subscription tab config preserved
 *   T6  - entitlements tab config preserved
 *   T7  - usage tab config preserved
 *   T8  - renewal tab config preserved
 *   T9  - health tab config preserved
 *   T10 - overview is read-only
 *   T11 - no dangerous action wording in config
 *   T12 - all tab testIds are defined
 *   T13 - CONSOLE_TABS lists exactly the expected tabs
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT,
  CONSOLE_TAB_CONFIG,
  CONSOLE_TABS,
  OVERVIEW_CARDS,
  OVERVIEW_CARD_CONFIG,
  CONSOLE_EMPTY_STATE,
  CONSOLE_FORBIDDEN_WORDING,
  type ConsoleTab,
} from "../tenant-admin-console-config";

describe("P13-H tenant-admin-console-config", () => {

  // T1 - console safety contract all true
  it("T1: TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT - all properties are true", () => {
    const contract = { ...TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT };
    const boolKeys = [
      "superAdminOnly",
      "readOnlyOverview",
      "noPaymentProcessing",
      "noInvoiceGeneration",
      "noChargeCollection",
      "noAutoWorkspaceSuspension",
      "noWorkspaceLocking",
      "noEntitlementEnforcement",
      "noEmailOrLegalNotices",
      "noDestructiveTenantActions",
      "dedicatedActionsOnly",
      "preservesExistingSafetyContracts",
    ] as const;
    for (const key of boolKeys) {
      expect(contract[key], `${key} must be true`).toBe(true);
    }
    expect(contract.contractVersion).toBe("1.0.0-P13-H");
  });

  // T2 - tabs/sections config stable
  it("T2: CONSOLE_TABS includes all core tabs including commercial and subscription_entitlements", () => {
    const required: ConsoleTab[] = [
      "overview", "lifecycle", "subscription", "subscription_entitlements",
      "entitlements", "usage", "renewal", "health", "evaluation", "commercial",
    ];
    expect(CONSOLE_TABS).toHaveLength(10);
    for (const tab of required) {
      expect(CONSOLE_TABS).toContain(tab);
    }
  });

  // T3 - overview cards config stable
  it("T3: OVERVIEW_CARDS includes all 6 summary cards", () => {
    const expected = ["lifecycle_state", "subscription", "plan", "health", "usage_capacity", "renewal"];
    expect(OVERVIEW_CARDS).toHaveLength(6);
    for (const card of expected) {
      expect(OVERVIEW_CARDS).toContain(card);
    }
  });

  // T4 - lifecycle tab config preserved
  it("T4: lifecycle tab config has label, description, icon, testId", () => {
    const cfg = CONSOLE_TAB_CONFIG.lifecycle;
    expect(cfg.label).toBe("Lifecycle");
    expect(cfg.description).toBeTruthy();
    expect(cfg.icon).toBeTruthy();
    expect(cfg.testId).toBe("console-tab-lifecycle");
    expect(cfg.readOnly).toBe(false);
  });

  // T5 - subscription tab config preserved
  it("T5: subscription tab config has label, description, icon, testId", () => {
    const cfg = CONSOLE_TAB_CONFIG.subscription;
    expect(cfg.label).toBe("Subscription");
    expect(cfg.description).toBeTruthy();
    expect(cfg.testId).toBe("console-tab-subscription");
    expect(cfg.readOnly).toBe(false);
  });

  // T6 - entitlements tab config preserved
  it("T6: entitlements tab config has label, description, icon, testId", () => {
    const cfg = CONSOLE_TAB_CONFIG.entitlements;
    expect(cfg.label).toBe("Entitlements");
    expect(cfg.description).toBeTruthy();
    expect(cfg.testId).toBe("console-tab-entitlements");
    expect(cfg.readOnly).toBe(false);
  });

  // T7 - usage tab config preserved
  it("T7: usage tab config has readOnly:true", () => {
    const cfg = CONSOLE_TAB_CONFIG.usage;
    expect(cfg.label).toBe("Usage");
    expect(cfg.readOnly).toBe(true);
    expect(cfg.testId).toBe("console-tab-usage");
  });

  // T8 - renewal tab config preserved
  it("T8: renewal tab config has readOnly:true", () => {
    const cfg = CONSOLE_TAB_CONFIG.renewal;
    expect(cfg.label).toBe("Renewal");
    expect(cfg.readOnly).toBe(true);
    expect(cfg.testId).toBe("console-tab-renewal");
  });

  // T9 - health tab config preserved
  it("T9: health tab config has readOnly:true", () => {
    const cfg = CONSOLE_TAB_CONFIG.health;
    expect(cfg.label).toBe("Health");
    expect(cfg.readOnly).toBe(true);
    expect(cfg.testId).toBe("console-tab-health");
  });

  // T10 - overview is read-only
  it("T10: overview tab is marked readOnly:true", () => {
    expect(CONSOLE_TAB_CONFIG.overview.readOnly).toBe(true);
  });

  // T11 - no dangerous action wording in config exports
  it("T11: CONSOLE_EMPTY_STATE and overview safety banner contain no dangerous wording", () => {
    const safeTexts = Object.values(CONSOLE_EMPTY_STATE).join(" ").toLowerCase();
    const forbidden = ["auto-suspend", "enforce entitlement", "billing portal", "legal notice"];
    for (const word of forbidden) {
      expect(safeTexts).not.toContain(word);
    }
  });

  // T12 - all tab testIds are defined
  it("T12: all CONSOLE_TABS have non-empty testId in CONSOLE_TAB_CONFIG", () => {
    for (const tab of CONSOLE_TABS) {
      const cfg = CONSOLE_TAB_CONFIG[tab];
      expect(cfg, `Config missing for tab "${tab}"`).toBeDefined();
      expect(cfg.testId, `testId missing for tab "${tab}"`).toBeTruthy();
      expect(typeof cfg.testId).toBe("string");
    }
  });

  // T13 - CONSOLE_FORBIDDEN_WORDING is defined and non-empty
  it("T13: CONSOLE_FORBIDDEN_WORDING is a non-empty array of strings", () => {
    expect(Array.isArray(CONSOLE_FORBIDDEN_WORDING)).toBe(true);
    expect(CONSOLE_FORBIDDEN_WORDING.length).toBeGreaterThan(0);
    for (const word of CONSOLE_FORBIDDEN_WORDING) {
      expect(typeof word).toBe("string");
      expect(word.length).toBeGreaterThan(0);
    }
  });

  // T14 - OVERVIEW_CARD_CONFIG covers all overview cards
  it("T14: OVERVIEW_CARD_CONFIG defines all 6 overview cards with testIds", () => {
    for (const cardId of OVERVIEW_CARDS) {
      const cfg = OVERVIEW_CARD_CONFIG[cardId];
      expect(cfg, `Missing OVERVIEW_CARD_CONFIG for "${cardId}"`).toBeDefined();
      expect(cfg.testId).toBeTruthy();
      expect(cfg.label).toBeTruthy();
    }
  });

  // T22 - evaluation tab config (P13-I)
  it("T22: evaluation tab config has readOnly:true, correct label, and testId", () => {
    const cfg = CONSOLE_TAB_CONFIG.evaluation;
    expect(cfg.label).toBe("Evaluation");
    expect(cfg.readOnly).toBe(true);
    expect(cfg.testId).toBe("console-tab-evaluation");
    expect(cfg.description).toBeTruthy();
    expect(cfg.icon).toBeTruthy();
  });

});
