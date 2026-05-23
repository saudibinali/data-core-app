import { describe, expect, it } from "vitest";
import { BUSINESS_PROCESS_TEMPLATES, describeRoutingType } from "../process-templates";

describe("process-templates", () => {
  it("includes leave templates", () => {
    expect(BUSINESS_PROCESS_TEMPLATES.some((t) => t.code === "leave.standard")).toBe(true);
  });

  it("describes routing types", () => {
    expect(describeRoutingType("direct_manager")).toBe("Direct manager");
    expect(describeRoutingType("org_unit_head", true)).toBe("رئيس القسم");
  });
});
