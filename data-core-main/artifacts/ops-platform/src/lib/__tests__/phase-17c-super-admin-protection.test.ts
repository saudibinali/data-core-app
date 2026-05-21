/**
 * @phase P17-C - Super Admin Protection Policies (static / UI tests)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT,
  P17C_FORBIDDEN_UI_TERMS,
  PROTECTION_BLOCKED_REASON_MESSAGES,
  PLATFORM_ADMIN_PROTECTION_NOTICE,
  isPolicyProtectedUser,
} from "../platform-admin-protection-config";

const opsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(__dirname, "../../../../../");

function readFromOps(rel: string): string {
  return readFileSync(resolve(opsRoot, rel), "utf8");
}

function readFromRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("P17-C safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(SUPER_ADMIN_PROTECTION_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("blocked reason messages", () => {
  it("maps SELF_DISABLE_BLOCKED", () => {
    expect(PROTECTION_BLOCKED_REASON_MESSAGES.SELF_DISABLE_BLOCKED).toContain("cannot disable");
  });
});

describe("protected user UI helpers", () => {
  it("detects protected or root", () => {
    expect(isPolicyProtectedUser({ isProtected: true })).toBe(true);
    expect(isPolicyProtectedUser({ isRootOwner: true })).toBe(true);
    expect(isPolicyProtectedUser({})).toBe(false);
  });
});

describe("platform users page protection UX", () => {
  const page = readFromOps("src/pages/super-admin-platform-users.tsx");

  it("shows Protected and Root Owner badges", () => {
    expect(page).toContain("ProtectedBadge");
    expect(page).toContain("RootBadge");
    expect(page).toContain("AdminProtectionNotice");
    expect(page).toContain("user-detail-protection-notice");
  });

  it("shows protection notice text", () => {
    expect(page).toContain("PLATFORM_ADMIN_PROTECTION_NOTICE");
  });

  it("forbidden UI terms absent", () => {
    for (const term of P17C_FORBIDDEN_UI_TERMS) {
      expect(page.includes(term), term).toBe(false);
    }
  });
});

describe("backend protection module", () => {
  const evaluator = readFromRepo("artifacts/api-server/src/lib/platform-admin-protection-evaluator.ts");
  const route = readFromRepo("artifacts/api-server/src/routes/platform-admin-protection.ts");

  it("exports evaluatePlatformAdminProtection", () => {
    expect(evaluator).toContain("export function evaluatePlatformAdminProtection");
  });

  it("GET admin-protection-policy route is read-only", () => {
    expect(route).toContain("/platform/admin-protection-policy");
    expect(route).toContain("router.get");
    expect(route).not.toMatch(/router\.(patch|put)\s*\(/);
  });
});
