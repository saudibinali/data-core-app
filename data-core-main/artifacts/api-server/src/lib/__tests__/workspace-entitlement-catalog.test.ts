/**
 * @phase P16-B - Entitlement catalog
 */

import { describe, it, expect } from "vitest";
import {
  ENTITLEMENT_MODULE_KEYS,
  ENTITLEMENT_FEATURE_CATALOG,
  buildEntitlementCatalogPayload,
  featureBelongsToModule,
  isCoreModule,
} from "../workspace-entitlement-catalog";

describe("workspace-entitlement-catalog", () => {
  it("contains required modules including core", () => {
    expect(ENTITLEMENT_MODULE_KEYS).toContain("core");
    expect(ENTITLEMENT_MODULE_KEYS).toContain("hr");
    expect(ENTITLEMENT_MODULE_KEYS).toContain("payroll");
    expect(ENTITLEMENT_MODULE_KEYS.length).toBeGreaterThanOrEqual(18);
  });

  it("catalog payload includes modules with features", () => {
    const payload = buildEntitlementCatalogPayload();
    expect(payload.modules.length).toBe(ENTITLEMENT_MODULE_KEYS.length);
    const hr = payload.modules.find((m) => m.key === "hr");
    expect(hr?.features.some((f) => f.key === "hr.employee_profiles")).toBe(true);
  });

  it("feature must belong to module", () => {
    expect(featureBelongsToModule("hr.employee_profiles", "hr")).toBe(true);
    expect(featureBelongsToModule("hr.employee_profiles", "payroll")).toBe(false);
  });

  it("core module is always core", () => {
    expect(isCoreModule("core")).toBe(true);
    expect(isCoreModule("hr")).toBe(false);
  });

  it("feature catalog entries reference valid modules", () => {
    for (const feat of ENTITLEMENT_FEATURE_CATALOG) {
      expect(ENTITLEMENT_MODULE_KEYS).toContain(feat.moduleKey);
    }
  });
});
