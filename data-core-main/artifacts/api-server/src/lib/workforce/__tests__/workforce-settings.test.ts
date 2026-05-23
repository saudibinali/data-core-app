import { describe, expect, it } from "vitest";
import {
  normalizeWorkforceCanonicalMode,
  normalizeWorkforceSyncDirection,
  shouldSyncEmployeeToUser,
} from "../settings";

describe("workforce settings", () => {
  it("defaults invalid mode to legacy", () => {
    expect(normalizeWorkforceCanonicalMode(undefined)).toBe("legacy");
    expect(normalizeWorkforceCanonicalMode("invalid")).toBe("legacy");
    expect(normalizeWorkforceCanonicalMode("shadow")).toBe("shadow");
    expect(normalizeWorkforceCanonicalMode("active")).toBe("active");
  });

  it("defaults invalid sync direction to none", () => {
    expect(normalizeWorkforceSyncDirection("bad")).toBe("none");
    expect(normalizeWorkforceSyncDirection("employee_to_user")).toBe("employee_to_user");
  });

  it("detects employee-to-user sync", () => {
    expect(shouldSyncEmployeeToUser("none")).toBe(false);
    expect(shouldSyncEmployeeToUser("employee_to_user")).toBe(true);
    expect(shouldSyncEmployeeToUser("bidirectional")).toBe(true);
  });
});

describe("workforce schema guard", () => {
  it("exports migration hint", async () => {
    const { WORKFORCE_MIGRATION_HINT, workforceSchemaUnavailableBody } = await import("../schema-guard");
    expect(WORKFORCE_MIGRATION_HINT).toContain("migrate-workforce-foundation");
    expect(workforceSchemaUnavailableBody().error).toBe("WORKFORCE_SCHEMA_UNAVAILABLE");
  });
});
