/**
 * @file   lib/tenant-admin-console-config.ts
 * @phase  P13-H - Tenant Administration Console Consolidation
 *
 * Frontend configuration for the Tenant Administration Console.
 * Provides the safety contract, tab definitions, and overview config for
 * the consolidated super-admin tenant detail view.
 *
 * SAFETY CONTRACT:
 *   - Console is super-admin only - enforced by SuperAdminRoute.
 *   - Overview tab is strictly read-only (no action buttons).
 *   - No payment, billing, invoice, charge, or tax logic.
 *   - No automatic suspension, workspace locking, or entitlement enforcement.
 *   - No email or legal notices.
 *   - No destructive tenant actions.
 *   - Each functional tab delegates to its dedicated panel with its own safety contract.
 *   - All prior P13 safety contracts remain active and enforced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Console Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

export const TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT = {
  superAdminOnly:                true,
  readOnlyOverview:              true,
  noPaymentProcessing:           true,
  noInvoiceGeneration:           true,
  noChargeCollection:            true,
  noAutoWorkspaceSuspension:     true,
  noWorkspaceLocking:            true,
  noEntitlementEnforcement:      true,
  noEmailOrLegalNotices:         true,
  noDestructiveTenantActions:    true,
  dedicatedActionsOnly:          true,
  preservesExistingSafetyContracts: true,
  contractVersion:               "1.0.0-P13-H",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Console Tabs
// ─────────────────────────────────────────────────────────────────────────────

export type ConsoleTab =
  | "overview"
  | "lifecycle"
  | "subscription"
  | "entitlements"
  | "usage"
  | "renewal"
  | "health"
  | "evaluation"
  | "commercial";

export const CONSOLE_TABS: ConsoleTab[] = [
  "overview",
  "lifecycle",
  "subscription",
  "entitlements",
  "usage",
  "renewal",
  "health",
  "evaluation",
  "commercial",
];

/** Always visible in the tab bar (permission-filtered at runtime). */
export const CONSOLE_PRIMARY_TABS: readonly ConsoleTab[] = [
  "overview",
  "lifecycle",
  "commercial",
  "subscription",
  "health",
] as const;

/**
 * Shown under the "More" dropdown (permission-filtered at runtime).
 * Future tabs not listed here but not primary are appended automatically.
 */
export const CONSOLE_MORE_TABS: readonly ConsoleTab[] = [
  "entitlements",
  "usage",
  "renewal",
  "evaluation",
] as const;

const PRIMARY_TAB_SET = new Set<ConsoleTab>(CONSOLE_PRIMARY_TABS);
const MORE_TAB_SET = new Set<ConsoleTab>(CONSOLE_MORE_TABS);

export function isConsolePrimaryTab(tab: ConsoleTab): boolean {
  return PRIMARY_TAB_SET.has(tab);
}

export function isConsoleMoreTab(tab: ConsoleTab): boolean {
  return MORE_TAB_SET.has(tab) || (!PRIMARY_TAB_SET.has(tab) && CONSOLE_TABS.includes(tab));
}

export interface PartitionedConsoleTabs {
  primaryTabs: ConsoleTab[];
  moreTabs: ConsoleTab[];
}

/** Splits permission-visible tabs into primary bar vs More menu, preserving catalog order. */
export function partitionVisibleConsoleTabs(visibleTabs: ConsoleTab[]): PartitionedConsoleTabs {
  const visible = new Set(visibleTabs);
  const primaryTabs = CONSOLE_PRIMARY_TABS.filter((t) => visible.has(t));
  const moreTabs: ConsoleTab[] = [];

  for (const tab of CONSOLE_MORE_TABS) {
    if (visible.has(tab)) moreTabs.push(tab);
  }
  for (const tab of CONSOLE_TABS) {
    if (visible.has(tab) && !PRIMARY_TAB_SET.has(tab) && !MORE_TAB_SET.has(tab)) {
      if (tab === "entitlements" && visible.has("subscription")) continue;
      moreTabs.push(tab);
    }
  }

  return { primaryTabs, moreTabs };
}

/** Deep-link alias: legacy tab ids map to unified Subscription tab. */
export function normalizeConsoleTab(tab: ConsoleTab): ConsoleTab {
  return tab === "entitlements" ? "subscription" : tab;
}

/** Hide duplicate entitlements tab when unified subscription tab is visible. */
export function dedupeConsoleTabs(tabs: ConsoleTab[]): ConsoleTab[] {
  if (tabs.includes("subscription")) {
    return tabs.filter((t) => t !== "entitlements");
  }
  return tabs;
}

export function parseConsoleTabParam(raw: string | null | undefined): ConsoleTab | null {
  if (!raw) return null;
  if (raw === "subscription_entitlements" || raw === "entitlements") return "subscription";
  return CONSOLE_TABS.includes(raw as ConsoleTab) ? (raw as ConsoleTab) : null;
}

/** All tab content region test ids - used to ensure no panel was removed. */
export const CONSOLE_TAB_CONTENT_TEST_IDS: readonly string[] = [
  "console-overview-tab",
  "console-tab-content-lifecycle",
  "console-tab-content-subscription",
  "console-tab-content-subscription-entitlements",
  "console-tab-content-entitlements",
  "console-tab-content-usage",
  "console-tab-content-renewal",
  "console-tab-content-health",
  "console-tab-content-evaluation",
  "console-tab-content-commercial",
] as const;

export interface ConsoleTabConfig {
  id:          ConsoleTab;
  label:       string;
  description: string;
  readOnly:    boolean;
  icon:        string;
  testId:      string;
}

export const CONSOLE_TAB_CONFIG: Record<ConsoleTab, ConsoleTabConfig> = {
  overview: {
    id:          "overview",
    label:       "Overview",
    description: "Read-only summary of tenant state, health, risk, and key metrics.",
    readOnly:    true,
    icon:        "LayoutDashboard",
    testId:      "console-tab-overview",
  },
  lifecycle: {
    id:          "lifecycle",
    label:       "Lifecycle",
    description: "Controlled lifecycle state transitions - activate, suspend, restore, archive.",
    readOnly:    false,
    icon:        "Activity",
    testId:      "console-tab-lifecycle",
  },
  subscription: {
    id:          "subscription",
    label:       "Subscription",
    description:
      "Commercial console — plan, subscription term, product modules, and workspace access.",
    readOnly:    false,
    icon:        "CreditCard",
    testId:      "console-tab-subscription",
  },
  entitlements: {
    id:          "entitlements",
    label:       "Entitlements",
    description: "Legacy alias — redirects to Subscription tab for product modules.",
    readOnly:    false,
    icon:        "Package",
    testId:      "console-tab-entitlements",
  },
  usage: {
    id:          "usage",
    label:       "Usage",
    description: "Read-only usage and capacity intelligence across all metrics.",
    readOnly:    true,
    icon:        "BarChart3",
    testId:      "console-tab-usage",
  },
  renewal: {
    id:          "renewal",
    label:       "Renewal",
    description: "Read-only renewal and grace period intelligence.",
    readOnly:    true,
    icon:        "RefreshCw",
    testId:      "console-tab-renewal",
  },
  health: {
    id:          "health",
    label:       "Health",
    description: "Read-only tenant health, risk signals, and operational monitoring.",
    readOnly:    true,
    icon:        "Heart",
    testId:      "console-tab-health",
  },
  evaluation: {
    id:          "evaluation",
    label:       "Evaluation",
    description: "Advisory lifecycle evaluation engine - signals, severity, review eligibility. Read-only.",
    readOnly:    true,
    icon:        "ClipboardList",
    testId:      "console-tab-evaluation",
  },
  commercial: {
    id:          "commercial",
    label:       "Commercial",
    description: "Commercial account details and billing contacts. No payment processing.",
    readOnly:    false,
    icon:        "Briefcase",
    testId:      "console-tab-commercial",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Overview card definitions
// ─────────────────────────────────────────────────────────────────────────────

export type OverviewCardId =
  | "lifecycle_state"
  | "subscription"
  | "plan"
  | "health"
  | "usage_capacity"
  | "renewal";

export const OVERVIEW_CARDS: OverviewCardId[] = [
  "lifecycle_state",
  "subscription",
  "plan",
  "health",
  "usage_capacity",
  "renewal",
];

export interface OverviewCardConfig {
  id:          OverviewCardId;
  label:       string;
  description: string;
  testId:      string;
}

export const OVERVIEW_CARD_CONFIG: Record<OverviewCardId, OverviewCardConfig> = {
  lifecycle_state: {
    id:          "lifecycle_state",
    label:       "Lifecycle State",
    description: "Current workspace operational state.",
    testId:      "overview-card-lifecycle-state",
  },
  subscription: {
    id:          "subscription",
    label:       "Subscription",
    description: "Current subscription status.",
    testId:      "overview-card-subscription",
  },
  plan: {
    id:          "plan",
    label:       "Plan",
    description: "Active billing plan.",
    testId:      "overview-card-plan",
  },
  health: {
    id:          "health",
    label:       "Health",
    description: "Derived tenant health status.",
    testId:      "overview-card-health",
  },
  usage_capacity: {
    id:          "usage_capacity",
    label:       "Usage Capacity",
    description: "Current capacity risk level.",
    testId:      "overview-card-usage-capacity",
  },
  renewal: {
    id:          "renewal",
    label:       "Renewal Urgency",
    description: "Renewal urgency level.",
    testId:      "overview-card-renewal",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Console empty/loading states
// ─────────────────────────────────────────────────────────────────────────────

export const CONSOLE_EMPTY_STATE = {
  overviewSafetyBanner: "Platform visibility only. Actions remain controlled by their dedicated sections.",
  noWarnings:           "No active warnings detected.",
  readOnlyNotice:       "Overview is read-only. Use the dedicated tabs to make controlled changes.",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dangerous wording - these strings must NOT appear in the console
// Used by tests to verify safety contract compliance.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSOLE_FORBIDDEN_WORDING = [
  "payment",
  "invoice",
  "charge",
  "billing portal",
  "tax",
  "auto-suspend",
  "auto suspend",
  "auto-lock",
  "auto lock",
  "enforce entitlement",
  "entitlement enforcement",
  "send email",
  "legal notice",
  "terminate",
  "bulk delete",
] as const;
