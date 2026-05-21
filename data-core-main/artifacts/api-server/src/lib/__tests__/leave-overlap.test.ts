import { describe, it, expect } from "vitest";
import {
  leaveOverlapErrorMessage,
  CANONICAL_ACTIVE_LEAVE_STATUSES,
  LEGACY_ACTIVE_LEAVE_STATUSES,
} from "../leave-overlap";

describe("leave-overlap", () => {
  it("defines terminal exclusions", () => {
    expect(CANONICAL_ACTIVE_LEAVE_STATUSES).not.toContain("rejected");
    expect(CANONICAL_ACTIVE_LEAVE_STATUSES).not.toContain("withdrawn");
    expect(LEGACY_ACTIVE_LEAVE_STATUSES).not.toContain("rejected");
    expect(LEGACY_ACTIVE_LEAVE_STATUSES).not.toContain("cancelled");
  });

  it("messages distinguish legacy vs canonical vs both", () => {
    expect(leaveOverlapErrorMessage([{ source: "legacy", id: 1, status: "pending" }])).toMatch(/legacy/i);
    expect(leaveOverlapErrorMessage([{ source: "canonical", id: 2, status: "pending_approval" }])).toMatch(/leave request/i);
    expect(
      leaveOverlapErrorMessage([
        { source: "legacy", id: 1, status: "pending" },
        { source: "canonical", id: 2, status: "approved" },
      ]),
    ).toMatch(/both/i);
  });
});
