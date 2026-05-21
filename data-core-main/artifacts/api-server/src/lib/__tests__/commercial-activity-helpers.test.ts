/**
 * @phase P15-H - Commercial activity helpers
 */

import { describe, it, expect } from "vitest";
import {
  isCommercialActivityAction,
  buildMetadataSummary,
  toCommercialActivityItem,
} from "../commercial-activity-helpers";

describe("isCommercialActivityAction", () => {
  it("accepts known commercial prefixes", () => {
    expect(isCommercialActivityAction("commercial_invoice_created")).toBe(true);
    expect(isCommercialActivityAction("commercial_payment_verified")).toBe(true);
    expect(isCommercialActivityAction("commercial_risk_viewed")).toBe(true);
    expect(isCommercialActivityAction("commercial_access_denied")).toBe(true);
  });

  it("rejects non-commercial actions", () => {
    expect(isCommercialActivityAction("platform_user_created")).toBe(false);
    expect(isCommercialActivityAction("ticket_created")).toBe(false);
  });
});

describe("buildMetadataSummary", () => {
  it("summarizes safe fields only", () => {
    const s = buildMetadataSummary({
      result: "success",
      tenantId: 42,
      invoiceId: 7,
      password: "secret",
    });
    expect(s).toContain("result: success");
    expect(s).toContain("tenantId: 42");
    expect(s).not.toContain("secret");
  });
});

describe("toCommercialActivityItem", () => {
  it("returns slim item without raw metadata blob", () => {
    const item = toCommercialActivityItem({
      id: 1,
      actorId: 2,
      actorEmail: "a@example.com",
      actorName: "Admin",
      action: "commercial_invoice_created",
      metadata: JSON.stringify({ result: "success", tenantId: 1 }),
      createdAt: new Date("2026-05-18T10:00:00.000Z"),
    });
    expect(item.action).toBe("commercial_invoice_created");
    expect(item.actionLabel).toBeTruthy();
    expect(item.metadataSummary).toContain("success");
    expect(item).not.toHaveProperty("metadataSafe");
  });
});
