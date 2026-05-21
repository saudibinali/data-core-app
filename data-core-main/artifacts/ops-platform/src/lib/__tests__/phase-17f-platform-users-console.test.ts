/**
 * @phase P17-F - Platform Users Console integration tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT,
  P17F_FORBIDDEN_UI_TERMS,
  PLATFORM_USER_DETAIL_TABS,
} from "../platform-users-console-config";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readOps(rel: string) {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("P17-F safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("console page", () => {
  const page = readOps("src/pages/super-admin-platform-users.tsx");

  it("renders unified console", () => {
    expect(page).toContain('data-testid="platform-users-page"');
    expect(page).toContain("PlatformUsersSummaryCards");
    expect(page).toContain("PlatformUsersTable");
    expect(page).toContain("PlatformUserDetailDrawer");
  });

  it("forbidden terms absent in UI components", () => {
    const ui = [
      readOps("src/components/platform-users/PlatformUsersTable.tsx"),
      readOps("src/components/platform-users/PlatformUserDetailDrawer.tsx"),
      readOps("src/components/platform-users/InvitationActivationSection.tsx"),
    ].join("\n");
    for (const term of P17F_FORBIDDEN_UI_TERMS) {
      expect(ui.includes(term), term).toBe(false);
    }
  });
});

describe("summary cards component", () => {
  const cards = readOps("src/components/platform-users/PlatformUsersSummaryCards.tsx");
  it("renders summary cards test ids", () => {
    expect(cards).toContain('data-testid="platform-users-summary-cards"');
    expect(cards).toContain('testId="summary-pending-invitations"');
    expect(cards).toContain('testId="summary-high-risk"');
  });
});

describe("main table", () => {
  const table = readOps("src/components/platform-users/PlatformUsersTable.tsx");
  it("has required columns and filters", () => {
    expect(table).toContain("Display Name");
    expect(table).toContain("Invitation");
    expect(table).toContain('data-testid="filter-protected-only"');
    expect(table).toContain('data-testid="user-overrides-count"');
    expect(table).toContain('data-testid="user-invitation-status"');
  });
});

describe("detail drawer tabs", () => {
  const drawer = readOps("src/components/platform-users/PlatformUserDetailDrawer.tsx");
  it("renders all sections", () => {
    expect(PLATFORM_USER_DETAIL_TABS.map((t) => t.id)).toEqual([
      "overview",
      "permissions",
      "protection",
      "invitations",
      "access-review",
      "audit",
    ]);
    expect(drawer).toContain('data-testid="platform-user-detail-drawer"');
    expect(drawer).toContain('data-testid="platform-user-detail-tabs"');
    expect(drawer).toContain("CustomPermissionsSection");
    expect(drawer).toContain("InvitationActivationSection");
    expect(drawer).toContain("PlatformUserAccessReviewTab");
    expect(readOps("src/components/platform-users/InvitationActivationSection.tsx")).toContain(
      "ACTIVATION_LINK_ONCE_NOTICE",
    );
  });
});

describe("navigation", () => {
  const layout = readOps("src/components/layout/super-admin-layout.tsx");
  it("includes Platform Users and Access Review in primary nav", () => {
    expect(layout).toContain('navKey: "platform-users"');
    expect(layout).toContain('navKey: "access-review"');
    expect(layout).toContain('data-testid="nav-more-dropdown"');
  });
});

describe("backend console API", () => {
  const routes = readRepo("artifacts/api-server/src/routes/platform-user-console.ts");
  it("read-only aggregation routes", () => {
    expect(routes).toContain("/platform/users/console-summary");
    expect(routes).toContain("/platform/users/:userId/console");
    expect(routes).toContain('requirePlatformPermission("platform.users.read")');
    expect(routes).not.toContain(".post(");
  });
});

describe("hooks", () => {
  const hooks = readOps("src/lib/platform-users-console-hooks.ts");
  it("unified query keys", () => {
    expect(hooks).toContain('["platform", "users", "console-summary"]');
    expect(hooks).toContain('["platform", "users", userId, "console"]');
    expect(hooks).toContain("usePlatformUserPermissions");
    expect(hooks).toContain("usePlatformAccessReviewSummary");
  });
});
