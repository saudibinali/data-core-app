/**
 * F4.6 — Provision candidates listing (unit)
 */
import { describe, it, expect } from "vitest";
import { buildPreview } from "../employee-user-provisioning";

describe("F4.6 provision preview builder (unit)", () => {
  it("blocks terminal employees from provisioning", () => {
    const preview = buildPreview({
      id: 1,
      userId: null,
      employeeNumber: "EMP-1",
      firstName: "A",
      lastName: "B",
      fullName: "A B",
      email: null,
      phoneNumber: null,
      status: "terminated",
      orgUnitId: null,
      orgUnitName: null,
      jobTitleName: null,
      position: null,
      managerName: null,
    } as Parameters<typeof buildPreview>[0]);

    expect(preview.canProvision).toBe(false);
    expect(preview.blockReason).toContain("terminated");
  });
});
