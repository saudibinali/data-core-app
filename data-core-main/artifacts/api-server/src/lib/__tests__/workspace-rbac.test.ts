import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "@workspace/core-permissions";

describe("F2.4 evaluatePolicy", () => {
  it("grants legacy admin bypass when not strict", () => {
    const result = evaluatePolicy(
      {
        actor: { userId: 1, workspaceId: 1, role: "admin" },
        permission: "tickets.view" as never,
      },
      { strictWorkspaceRbac: false },
    );
    expect(result.granted).toBe(true);
  });

  it("denies admin without bundle permission in strict mode", () => {
    const result = evaluatePolicy(
      {
        actor: { userId: 1, workspaceId: 1, role: "admin" },
        permission: "nonexistent.permission" as never,
      },
      { strictWorkspaceRbac: true },
    );
    expect(result.granted).toBe(false);
  });

  it("grants member via custom permissions", () => {
    const result = evaluatePolicy(
      {
        actor: { userId: 2, workspaceId: 1, role: "member" },
        permission: "tickets.view" as never,
      },
      { customPermissions: ["tickets.view"], strictWorkspaceRbac: true },
    );
    expect(result.granted).toBe(true);
  });
});
