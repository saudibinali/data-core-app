import { describe, it, expect } from "vitest";
import {
  validateEmployeeRowCanonical,
  validateMasterDataRowCanonical,
} from "../canonical-import-gates";

describe("canonical import gates", () => {
  it("rejects legacy department when org active", () => {
    const r = validateEmployeeRowCanonical(
      { department_name: "IT", full_name: "A" },
      { orgRuntimeMode: "active", leaveRuntimeMode: "transition" },
    );
    expect(r.errors.some((e) => e.includes("department_name"))).toBe(true);
    expect(r.errors.some((e) => e.includes("org_unit_name"))).toBe(true);
  });

  it("requires org_unit_name when org active", () => {
    const r = validateEmployeeRowCanonical(
      { full_name: "A", org_unit_name: "HQ" },
      { orgRuntimeMode: "active", leaveRuntimeMode: "transition" },
    );
    expect(r.errors).toHaveLength(0);
  });

  it("rejects legacy leave fields when leave canonical", () => {
    const r = validateEmployeeRowCanonical(
      { full_name: "A", leave_days: "5" },
      { orgRuntimeMode: "legacy", leaveRuntimeMode: "canonical" },
    );
    expect(r.errors.some((e) => e.includes("leave_days"))).toBe(true);
  });

  it("rejects forbidden master entity types", () => {
    const r = validateMasterDataRowCanonical("hr_employee_leave", {
      orgRuntimeMode: "legacy",
      leaveRuntimeMode: "canonical",
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
