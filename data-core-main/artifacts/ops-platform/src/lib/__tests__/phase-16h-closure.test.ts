/**
 * @phase P16-H - Phase 16 closure verification (no new product features)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PLATFORM_PERMISSION_CODES } from "../platform-permissions-config";

const repoRoot = resolve(__dirname, "../../../../../");

function readRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const FORBIDDEN_PRODUCT_TERMS = [
  "Pay Now",
  "Upgrade Plan",
  "Stripe checkout",
  "auto suspend",
  "Block Login",
  "Delete Workspace",
  "automated dunning",
];

describe("P16-H closure artifacts", () => {
  it("documentation exists with required sections", () => {
    const docPath = resolve(repoRoot, "docs/subscription-entitlement-control.md");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    for (const section of [
      "## Overview",
      "## Architecture",
      "## Subscription lifecycle",
      "## Entitlement model",
      "## Quota model",
      "## Grace / suspension policy",
      "## Read-only workspace enforcement",
      "## Super Admin Subscription Console",
      "## Tenant subscription visibility",
      "## Permissions",
      "## APIs overview",
      "## Audit events",
      "## Safety boundaries",
      "## Known limitations",
      "## Future phases",
    ]) {
      expect(doc).toContain(section);
    }
  });

  it("all P16 phase reports exist", () => {
    for (const phase of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const p = resolve(repoRoot, `workflow-phase-16${phase}-report.txt`);
      expect(existsSync(p), `missing workflow-phase-16${phase}-report.txt`).toBe(true);
    }
  });

  it("platform permission count remains 45 (P16 closure)", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
    expect(PLATFORM_PERMISSION_CODES).toContain("platform.workspaceAccess.evaluate");
  });
});

describe("P16 safety boundary scan (subscription UI)", () => {
  const subscriptionDir = resolve(repoRoot, "artifacts/ops-platform/src/components/subscription");
  const files = [
    "SubscriptionConsole.tsx",
    "SubscriptionStatePanel.tsx",
    "EntitlementsFeaturesPanel.tsx",
    "LimitsQuotasPanel.tsx",
    "GraceSuspensionPolicyPanel.tsx",
    "WorkspaceAccessControlPanel.tsx",
  ];

  it("subscription components avoid forbidden product terms", () => {
    const bundle = files
      .map((f) => readFileSync(resolve(subscriptionDir, f), "utf8"))
      .join("\n");
    for (const term of FORBIDDEN_PRODUCT_TERMS) {
      expect(bundle.includes(term)).toBe(false);
    }
  });
});

describe("tenant subscription routes are read-only", () => {
  it("no tenant subscription mutations", () => {
    const routes = readRepo("artifacts/api-server/src/routes/tenant-subscription.ts");
    expect(routes).toMatch(/router\.get\(/);
    expect(routes).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });
});

describe("automatic enforcement flags", () => {
  it("policy evaluator disallows automatic apply", () => {
    const evalSrc = readRepo(
      "artifacts/api-server/src/lib/workspace-subscription-policy-evaluator.ts",
    );
    expect(evalSrc).toContain("isAutomaticAllowed: false");
  });

  it("commercial workspace evaluator is manual only", () => {
    const evalSrc = readRepo(
      "artifacts/api-server/src/lib/commercial-workspace-enforcement-evaluator.ts",
    );
    expect(evalSrc).toContain("isAutomaticAllowed: false");
    expect(evalSrc).toContain("manualApplyOnly: true");
  });
});


