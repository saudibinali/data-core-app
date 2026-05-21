/**
 * HCM Wave 1 — integrated platform nucleus smoke
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { HCM_CORE_MODULE_KEYS, ERP_MODULE_KEYS_REMOVED } from "../hcm-product-constants";
import { MODULE_DEPENDENCIES } from "../module-governance-service";

const repoRoot = resolve(__dirname, "../../../../../../");

describe("HCM Wave 1 integrated platform", () => {
  it("seeds HCM core modules with payroll-scoped finance only", () => {
    const seed = readFileSync(resolve(repoRoot, "artifacts/api-server/src/seed/modules.ts"), "utf8");
    for (const key of HCM_CORE_MODULE_KEYS) {
      expect(seed).toContain(`key: "${key}"`);
    }
    for (const key of ERP_MODULE_KEYS_REMOVED) {
      expect(seed).not.toContain(`key: "${key}"`);
    }
    expect(seed).toContain('category: "hcm"');
    expect(seed).toContain("payroll-scoped finance");
  });

  it("module graph chains HCM modules to hr", () => {
    expect(MODULE_DEPENDENCIES.payroll).toEqual(["hr"]);
    expect(MODULE_DEPENDENCIES.attendance).toEqual(["hr"]);
    expect(MODULE_DEPENDENCIES["self-service"]).toEqual(["hr"]);
    expect(MODULE_DEPENDENCIES["report-center"]).toEqual(["hr"]);
  });

  it("seeds HR workflow templates for leave and payroll", () => {
    const wf = readFileSync(resolve(repoRoot, "artifacts/api-server/src/seed/workflows.ts"), "utf8");
    expect(wf).toContain("leave_request_manager_approval");
    expect(wf).toContain("leave.requested");
    expect(wf).toContain("payroll_run_review_notify");
    expect(wf).toContain("payroll.run.review");
  });

  it("registers integrated workforce reports", () => {
    const reg = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/lib/reports/report-definition-registry.ts"),
      "utf8",
    );
    expect(reg).toContain("hr.leave.requests");
    expect(reg).toContain("hr.employees.roster");
    expect(reg).not.toContain('module: "finance"');
  });

  it("App routes use HCM module keys", () => {
    const app = readFileSync(resolve(repoRoot, "artifacts/ops-platform/src/App.tsx"), "utf8");
    expect(app).toContain('moduleKey="payroll"');
    expect(app).toContain('moduleKey="attendance"');
    expect(app).toContain('moduleKey="self-service"');
    expect(app).not.toContain('path="/finance"');
  });

  it("product spec and wave checklist exist", () => {
    expect(readFileSync(resolve(repoRoot, "hcm-integrated-platform-spec.md"), "utf8")).toContain(
      "Payroll-scoped",
    );
    expect(readFileSync(resolve(repoRoot, "hcm-wave1-execution.md"), "utf8")).toContain("Wave 1");
  });
});
