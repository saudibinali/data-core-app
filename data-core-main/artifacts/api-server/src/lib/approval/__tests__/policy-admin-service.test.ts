import { describe, expect, it } from "vitest";
import {
  validateApprovalPolicyPatch,
  APPROVAL_ROUTING_TYPES,
} from "../policy-admin-service";

describe("validateApprovalPolicyPatch", () => {
  it("accepts valid routing and timeout", () => {
    expect(validateApprovalPolicyPatch({ routingType: "direct_manager", timeoutHours: 48 })).toBeNull();
  });

  it("rejects unknown routing", () => {
    expect(validateApprovalPolicyPatch({ routingType: "unknown" })).toContain("routingType");
  });

  it("rejects chain depth out of range", () => {
    expect(validateApprovalPolicyPatch({ chainDepth: 9 })).toContain("chainDepth");
  });

  it("exports routing types for UI", () => {
    expect(APPROVAL_ROUTING_TYPES).toContain("manager_chain");
  });
});
