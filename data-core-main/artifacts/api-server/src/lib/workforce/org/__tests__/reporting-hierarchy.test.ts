import { describe, expect, it } from "vitest";
import { wouldCreateManagerCycle } from "../reporting-hierarchy-service";

describe("wouldCreateManagerCycle", () => {
  const employees = [
    { id: 1, directManagerId: 2 },
    { id: 2, directManagerId: 3 },
    { id: 3, directManagerId: null },
  ];

  it("detects self-manager", () => {
    expect(wouldCreateManagerCycle(1, 1, employees)).toBe(true);
  });

  it("detects upward cycle", () => {
    expect(wouldCreateManagerCycle(3, 1, employees)).toBe(true);
  });

  it("allows valid manager assignment", () => {
    expect(wouldCreateManagerCycle(1, 3, employees)).toBe(false);
  });
});
