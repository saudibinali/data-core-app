import { describe, it, expect } from "vitest";
import { isLeaveCanonicalWriteEnvEnabled } from "../canonical-write-policy";

describe("leave canonical write policy", () => {
  it("LEAVE_CANONICAL_WRITE=false disables env gate", () => {
    expect(isLeaveCanonicalWriteEnvEnabled({ LEAVE_CANONICAL_WRITE: "false" })).toBe(false);
    expect(isLeaveCanonicalWriteEnvEnabled({})).toBe(true);
  });
});
