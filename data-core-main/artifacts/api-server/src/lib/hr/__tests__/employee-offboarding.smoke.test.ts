/**
 * F4.5 — Offboarding flag (unit)
 */
import { describe, it, expect, afterEach } from "vitest";
import { isOffboardDeactivateEnabled } from "../employee-offboarding";

describe("F4.5 employee offboarding flag (unit)", () => {
  const prev = process.env.HR_OFFBOARD_DEACTIVATE_USER;

  afterEach(() => {
    if (prev === undefined) delete process.env.HR_OFFBOARD_DEACTIVATE_USER;
    else process.env.HR_OFFBOARD_DEACTIVATE_USER = prev;
  });

  it("is disabled by default", () => {
    delete process.env.HR_OFFBOARD_DEACTIVATE_USER;
    expect(isOffboardDeactivateEnabled()).toBe(false);
  });

  it("enables when HR_OFFBOARD_DEACTIVATE_USER=true", () => {
    process.env.HR_OFFBOARD_DEACTIVATE_USER = "true";
    expect(isOffboardDeactivateEnabled()).toBe(true);
  });
});
