/**
 * P-HCM2 — HCM foundation closure smoke
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  resolveLeaveCutoverStatus,
  leaveCutoverStatusForWorkspace,
} from "../../leave-cutover-flags";

const repoRoot = resolve(__dirname, "../../../../../../");

describe("P-HCM2 HCM foundation", () => {
  it("migration 0020 adds leave_runtime_mode", () => {
    const sql = readFileSync(
      resolve(repoRoot, "lib/db/drizzle/0020_hcm_workspace_leave_runtime.sql"),
      "utf8",
    );
    expect(sql).toContain("leave_runtime_mode");
  });

  it("schema defines leaveRuntimeMode on hr_workspace_settings", () => {
    const schema = readFileSync(resolve(repoRoot, "lib/db/src/schema/hr.ts"), "utf8");
    expect(schema).toContain("leaveRuntimeMode");
    expect(schema).toContain("leave_runtime_mode");
  });

  it("employee account routes registered", () => {
    const index = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/index.ts"), "utf8");
    expect(index).toContain("hrEmployeeAccountRouter");
    const routes = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/routes/hr-employee-account.ts"),
      "utf8",
    );
    expect(routes).toContain("/hr/employees/:id/link-user");
    expect(routes).toContain("/hr/employees/:id/account");
  });

  it("canonical mode enables submit and legacy freeze without env pilot", () => {
    const status = resolveLeaveCutoverStatus(99, "canonical", {});
    expect(status.canonicalSubmit).toBe(true);
    expect(status.legacyFreeze).toBe(true);
    expect(status.leaveRuntimeMode).toBe("canonical");
    expect(leaveCutoverStatusForWorkspace(99, {}).canonicalSubmit).toBe(false);
  });

  it("transition mode enables canonical paths for all workspaces", () => {
    const status = resolveLeaveCutoverStatus(5, "transition", {});
    expect(status.canonicalSubmit).toBe(true);
    expect(status.canonicalApprove).toBe(true);
    expect(status.legacyFreeze).toBe(false);
  });

  it("hr settings PATCH accepts leaveRuntimeMode", () => {
    const hr = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/hr.ts"), "utf8");
    expect(hr).toContain("leaveRuntimeMode");
    expect(hr).toContain("legacy | transition | canonical");
  });

  it("employee detail UI includes account link card", () => {
    const page = readFileSync(
      resolve(repoRoot, "artifacts/ops-platform/src/pages/hr-employee-detail.tsx"),
      "utf8",
    );
    expect(page).toContain("EmployeeAccountCard");
    expect(page).toContain("link-user");
  });
});
