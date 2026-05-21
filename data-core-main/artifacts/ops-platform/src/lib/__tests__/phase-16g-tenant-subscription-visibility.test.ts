/**
 * @phase P16-G - Tenant subscription visibility tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT,
  TENANT_SUBSCRIPTION_FORBIDDEN_UI,
  TENANT_SUBSCRIPTION_PERMISSIONS,
} from "../tenant-subscription-visibility-config";
import { tenantSubscriptionKeys } from "@/hooks/use-tenant-subscription-visibility";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT", () => {
  it("all flags are true", () => {
    for (const [key, value] of Object.entries(TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT)) {
      expect(value, key).toBe(true);
    }
  });
});

describe("tenant subscription page", () => {
  const page = read("src/pages/subscription-status.tsx");
  const app = read("src/App.tsx");
  const hooks = read("src/hooks/use-tenant-subscription-visibility.ts");
  const modules = readFileSync(
    resolve(root, "../api-server/src/seed/modules.ts"),
    "utf8",
  );

  it("registers route with tenant.subscription.read", () => {
    expect(app).toContain("/subscription/status");
    expect(app).toContain("tenant.subscription.read");
    expect(app).toContain("SubscriptionStatusPage");
    expect(app).toContain('moduleKey="subscription"');
  });

  it("navigation module seeded", () => {
    expect(modules).toContain('key: "subscription"');
    expect(modules).toContain("tenant.subscription.read");
    expect(modules).toContain("/subscription/status");
  });

  it("react query keys match contract", () => {
    expect(tenantSubscriptionKeys.summary).toEqual(["tenant", "subscription", "summary"]);
    expect(tenantSubscriptionKeys.entitlements).toEqual(["tenant", "subscription", "entitlements"]);
    expect(tenantSubscriptionKeys.quotas).toEqual(["tenant", "subscription", "quotas"]);
    expect(hooks).toContain("/tenant/subscription/summary");
    expect(hooks).toContain("/tenant/subscription/entitlements");
    expect(hooks).toContain("/tenant/subscription/quotas");
  });

  it("shows read-only banner when applicable", () => {
    expect(page).toContain('data-testid="tenant-subscription-read-only-banner"');
    expect(page).toContain("read-only mode due to subscription status");
  });

  it("embeds billing invoices on subscription page without forbidden actions", () => {
    expect(page).toContain("TenantBillingInvoicesSection");
    expect(page).toContain("canReadBilling && <TenantBillingInvoicesSection");
    expect(page).toContain("TENANT_BILLING_PERMISSIONS.INVOICES_READ");
    for (const term of TENANT_SUBSCRIPTION_FORBIDDEN_UI) {
      expect(page.includes(term)).toBe(false);
    }
  });

  it("permission gated access denied state", () => {
    expect(page).toContain("TENANT_SUBSCRIPTION_PERMISSIONS.READ");
    expect(page).toContain('data-testid="tenant-subscription-access-denied"');
  });
});

describe("api routes safety", () => {
  const routes = readFileSync(
    resolve(root, "../api-server/src/routes/tenant-subscription.ts"),
    "utf8",
  );

  it("GET-only tenant subscription routes", () => {
    expect(routes).toContain('"/tenant/subscription/summary"');
    expect(routes).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  it("uses tenant subscription permissions", () => {
    expect(routes).toContain("TENANT_SUBSCRIPTION_PERMISSIONS");
    expect(routes).toContain("PERM_READ");
    expect(routes).toContain("PERM_ENTITLEMENTS");
    expect(routes).toContain("PERM_QUOTAS");
  });
});
