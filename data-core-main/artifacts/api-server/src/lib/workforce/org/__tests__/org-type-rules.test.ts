import { describe, expect, it } from "vitest";
import {
  isValidOrgUnitType,
  normalizeOrgUnitType,
  validateOrgParentType,
} from "../org-type-rules";

describe("org-type-rules", () => {
  it("normalizes unit alias to department", () => {
    expect(normalizeOrgUnitType("unit")).toBe("department");
    expect(isValidOrgUnitType("unit")).toBe(true);
  });

  it("validates branch parent types", () => {
    expect(validateOrgParentType("branch", "company").ok).toBe(true);
    expect(validateOrgParentType("branch", "team").ok).toBe(false);
  });

  it("requires company to be root", () => {
    expect(validateOrgParentType("company", null).ok).toBe(true);
    expect(validateOrgParentType("company", "branch").ok).toBe(false);
  });
});
