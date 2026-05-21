/**
 * @phase P17-F - Platform user console aggregation
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT } from "../platform-user-console-config";

describe("P17-F safety contract", () => {
  it("all flags true", () => {
    for (const [k, v] of Object.entries(PLATFORM_USERS_CONSOLE_SAFETY_CONTRACT)) {
      expect(v, k).toBe(true);
    }
  });
});

describe("console routes", () => {
  it("read-only GET endpoints", () => {
    const routes = readFileSync(
      resolve(__dirname, "../../routes/platform-user-console.ts"),
      "utf8",
    );
    expect(routes).toContain("/platform/users/console-summary");
    expect(routes).toContain("router.get");
    expect(routes).not.toContain("router.post");
    expect(routes).not.toContain("router.patch");
    expect(routes).not.toContain("router.delete");
  });
});
