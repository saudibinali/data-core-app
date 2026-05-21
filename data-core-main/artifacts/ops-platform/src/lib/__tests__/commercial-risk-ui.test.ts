/**
 * @phase P15-F - Commercial risk UI static safety
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMERCIAL_SAFETY_CONTRACT } from "../commercial-config";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("COMMERCIAL_SAFETY_CONTRACT P15-F", () => {
  it("risk read-only flags are true", () => {
    expect(COMMERCIAL_SAFETY_CONTRACT.commercialRiskReadOnly).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noAutomatedDunning).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noAutomatedRenewalActions).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noAutoStatusChanges).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.riskPermissionGated).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.auditRiskDetailViews).toBe(true);
    expect(COMMERCIAL_SAFETY_CONTRACT.noTenantCustomerActions).toBe(true);
  });

  it("every safety contract property is true", () => {
    for (const [key, value] of Object.entries(COMMERCIAL_SAFETY_CONTRACT)) {
      expect(value, `${key} must be true`).toBe(true);
    }
  });
});

describe("commercial risk UI", () => {
  const page = readSrc("pages/super-admin-commercial-risk.tsx");
  const hooks = readSrc("hooks/use-commercial-risk.ts");
  const layout = readSrc("components/layout/super-admin-layout.tsx");
  const access = readSrc("lib/platform-access.ts");

  it("page gated by commercial.risk.read", () => {
    expect(page).toContain("commercial.risk.read");
    expect(page).toContain("commercial-risk-access-denied");
    expect(page).toContain("commercial-risk-page");
  });

  it("nav item uses commercial-risk key and permission map", () => {
    expect(layout).toContain("/super-admin/commercial-risk");
    expect(layout).toContain("commercial-risk");
    expect(access).toContain('"commercial-risk":   ["commercial.risk.read"]');
  });

  it("react query keys match contract", () => {
    expect(hooks).toContain('["platform", "commercial-risk", "summary"]');
    expect(hooks).toContain('["platform", "commercial-risk", "list"');
    expect(hooks).toContain('"commercial-risk"');
  });

  it("no forbidden UI terms", () => {
    const lower = page.toLowerCase();
    for (const term of [
      "pay now",
      "stripe",
      "checkout",
      "send email",
      "auto collect",
      "payment gateway",
      "create task",
    ]) {
      expect(lower.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
