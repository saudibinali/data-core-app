/**
 * P-STA — HCM platform stabilization smoke (no ERP modules)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isLegacyPayrollFrozen } from "../infrastructure-cutover";
import { MODULE_DEPENDENCIES } from "../module-governance-service";

const repoRoot = resolve(__dirname, "../../../../../../");

describe("P-STA HCM platform stabilization", () => {
  it("ERP modules removed from seed catalog", () => {
    const seed = readFileSync(resolve(repoRoot, "artifacts/api-server/src/seed/modules.ts"), "utf8");
    expect(seed).not.toContain('key: "finance"');
    expect(seed).not.toContain('key: "procurement"');
    expect(seed).not.toContain('key: "inventory"');
    expect(seed).toContain('key: "hr"');
    expect(seed).toContain('key: "payroll"');
    expect(seed).toContain('key: "attendance"');
    expect(seed).toContain('key: "self-service"');
    expect(seed).toContain('key: "report-center"');
    expect(seed).toContain('category: "hcm"');
  });

  it("workspace stabilization route registered", () => {
    const index = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/index.ts"), "utf8");
    expect(index).toContain("workspaceStabilizationRouter");
    expect(index).not.toContain("financeCanonicalRouter");
    expect(index).not.toContain("procurementRouter");
    const routes = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/workspace-stabilization.ts"), "utf8");
    expect(routes).toContain("/workspace/stabilization");
    expect(routes).toContain("/workspace/go-live");
  });

  it("legacy payroll freeze respects env", () => {
    const prev = process.env.LEGACY_PAYROLL_FREEZE;
    process.env.LEGACY_PAYROLL_FREEZE = "false";
    expect(isLegacyPayrollFrozen(1)).toBe(false);
    process.env.LEGACY_PAYROLL_FREEZE = "true";
    process.env.PLATFORM_STABILIZATION_ALL_WORKSPACES = "true";
    expect(isLegacyPayrollFrozen(99)).toBe(true);
    process.env.LEGACY_PAYROLL_FREEZE = prev;
    delete process.env.PLATFORM_STABILIZATION_ALL_WORKSPACES;
  });

  it("module graph is HCM-only", () => {
    expect(MODULE_DEPENDENCIES.payroll).toEqual(["hr"]);
    expect(MODULE_DEPENDENCIES.attendance).toEqual(["hr"]);
    expect(MODULE_DEPENDENCIES.finance).toBeUndefined();
    expect(MODULE_DEPENDENCIES.procurement).toBeUndefined();
    expect(MODULE_DEPENDENCIES.inventory).toBeUndefined();
  });

  it("App has no ERP routes", () => {
    const app = readFileSync(resolve(repoRoot, "artifacts/ops-platform/src/App.tsx"), "utf8");
    expect(app).not.toContain('path="/finance"');
    expect(app).not.toContain('path="/procurement"');
    expect(app).not.toContain('path="/inventory"');
    expect(app).toContain("/admin/platform/stabilization");
  });
});
