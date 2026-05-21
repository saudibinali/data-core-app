/**
 * P-PAY-MIG — Legacy payroll migration smoke
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../../../../../../");

describe("P-PAY-MIG payroll migration", () => {
  it("payroll migration service uses legacyPayrollRunId link", () => {
    const svc = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/lib/payroll/payroll-migration-service.ts"),
      "utf8",
    );
    expect(svc).toContain("legacyPayrollRunId");
    expect(svc).toContain("payroll-mig-");
  });

  it("routes registered in index", () => {
    const index = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/index.ts"), "utf8");
    expect(index).toContain("hrPayrollMigrationRouter");
    const routes = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/routes/hr-payroll-migration.ts"),
      "utf8",
    );
    expect(routes).toContain("/hr/payroll-migration/report");
  });

  it("stabilization includes payrollMigration", () => {
    const svc = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/lib/platform/platform-stabilization-service.ts"),
      "utf8",
    );
    expect(svc).toContain("payrollMigration");
  });
});
