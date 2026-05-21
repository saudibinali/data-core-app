/**
 * @phase P16-G - Tenant subscription visibility helpers
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeTenantReadOnlyReason,
  utcDaysFromToday,
  tenantRecommendedStatusLabel,
} from "../tenant-subscription-visibility";
import { TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT } from "../tenant-subscription-config";

describe("tenant-subscription visibility helpers", () => {
  it("sanitizes internal collection reasons", () => {
    expect(sanitizeTenantReadOnlyReason("Outstanding collection follow-up")).toBeNull();
    expect(sanitizeTenantReadOnlyReason("Subscription ended")).toBe("Subscription ended");
  });

  it("computes days until/past end", () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    const iso = future.toISOString().slice(0, 10);
    expect(utcDaysFromToday(iso).daysUntilEnd).toBe(10);
    expect(utcDaysFromToday(iso).daysPastEnd).toBeNull();
  });

  it("maps recommended status for tenant display", () => {
    expect(tenantRecommendedStatusLabel("grace_period")).toBe("Grace period");
    expect(tenantRecommendedStatusLabel("no_change")).toBeNull();
  });

  it("safety contract all true", () => {
    for (const [k, v] of Object.entries(TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});
