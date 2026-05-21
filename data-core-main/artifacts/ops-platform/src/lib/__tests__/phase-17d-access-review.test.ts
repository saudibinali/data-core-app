/**
 * @phase P17-D - Access Review static / UI tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ACCESS_REVIEW_SAFETY_CONTRACT,
  P17D_FORBIDDEN_UI_TERMS,
} from "../platform-access-review-config";
import { PLATFORM_PERMISSION_CODES } from "../platform-permissions-config";
import { hasPlatformPermissionClient } from "../platform-access";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readFromOps(rel: string): string {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

function readFromRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("P17-D safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(ACCESS_REVIEW_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("permissions count", () => {
  it("55 platform permission codes", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.accessReview.read");
  });

  it("platform_admin can read access review", () => {
    expect(
      hasPlatformPermissionClient({ role: "super_admin", platformRoleCode: "platform_admin" }, "platform.accessReview.read"),
    ).toBe(true);
  });
});

describe("access review page UX", () => {
  const page = readFromOps("src/pages/super-admin-access-review.tsx");

  it("renders summary cards and tables", () => {
    expect(page).toContain('data-testid="access-review-page"');
    expect(page).toContain('data-testid="access-review-summary-cards"');
    expect(page).toContain('data-testid="high-risk-users-table"');
    expect(page).toContain('data-testid="access-review-detail-drawer"');
    expect(page).toContain('data-testid="detail-effective-permissions"');
    expect(page).toContain('data-testid="audit-timeline-filters"');
  });

  it("forbidden UI terms absent", () => {
    for (const term of P17D_FORBIDDEN_UI_TERMS) {
      expect(page.includes(term), term).toBe(false);
    }
  });
});

describe("backend routes", () => {
  const routes = readFromRepo("artifacts/api-server/src/routes/platform-access-review.ts");

  it("read endpoints require accessReview.read", () => {
    expect(routes).toContain('requirePlatformPermission("platform.accessReview.read")');
    expect(routes).toContain("/platform/access-review/summary");
    expect(routes).toContain("/platform/access-review/audit-events");
  });

  it("no permission mutation from review routes", () => {
    expect(routes).not.toContain("platform.permissions.update");
    expect(routes).not.toContain("platform.users.role.update");
    expect(routes).not.toContain("platform.users.disable");
  });

  it("POST review records metadata only", () => {
    expect(routes).toContain('requirePlatformPermission("platform.accessReview.update")');
    expect(routes).toContain("platform_access_review_recorded");
  });
});
