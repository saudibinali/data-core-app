import { describe, it, expect } from "vitest";
import { getLegacyAuditReport } from "../legacy-audit-inventory";
import { legacyCompatSchemaUnavailableBody } from "../schema-guard";

describe("legacy audit inventory", () => {
  it("lists all legacy surfaces", () => {
    const report = getLegacyAuditReport();
    expect(report.totalSurfaces).toBeGreaterThan(5);
    expect(report.inventory.some((i) => i.surface === "departments")).toBe(true);
  });
});

describe("schema guard", () => {
  it("returns 503 body with migration hint", () => {
    const body = legacyCompatSchemaUnavailableBody();
    expect(body.error).toBe("LEGACY_COMPAT_SCHEMA_UNAVAILABLE");
    expect(body.migrationHint).toContain("migrate-legacy-compat");
  });
});

describe("cleanup staging defaults", () => {
  it("exports staging helpers", async () => {
    const mod = await import("../cleanup-staging");
    expect(typeof mod.assertLegacyWriteAllowed).toBe("function");
    expect(typeof mod.shouldRunLegacyAdapter).toBe("function");
  });
});
