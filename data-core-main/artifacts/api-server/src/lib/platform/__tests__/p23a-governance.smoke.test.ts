/**
 * P23-A — Smoke-style checks for platform governance helpers (no DB required)
 */
import { describe, it, expect } from "vitest";
import { MODULE_DEPENDENCIES, moduleGovernanceService } from "../module-governance-service";
import {
  PLATFORM_ROLE_PERMISSION_MATRIX,
  type PlatformPermissionCode,
} from "../../platform-permissions";

describe("P23-A module governance dependencies", () => {
  it("declares payroll and finance dependent on hr", () => {
    expect(MODULE_DEPENDENCIES.payroll).toContain("hr");
    expect(MODULE_DEPENDENCIES.finance).toContain("hr");
  });

  it("exposes moduleGovernanceService singleton", () => {
    expect(moduleGovernanceService).toBeDefined();
    expect(typeof moduleGovernanceService.setModuleEnabled).toBe("function");
  });
});

describe("P23-A platform RBAC matrix", () => {
  it("includes new governance permission codes for platform_admin", () => {
    const set = PLATFORM_ROLE_PERMISSION_MATRIX.platform_admin;
    const codes: PlatformPermissionCode[] = [
      "platform.governance.ops.read",
      "platform.modules.govern",
      "platform.support.session.start",
      "platform.support.session.end",
    ];
    for (const c of codes) {
      expect(set.has(c), `missing ${c}`).toBe(true);
    }
  });

  it("grants support_admin governance read and support session permissions", () => {
    const s = PLATFORM_ROLE_PERMISSION_MATRIX.support_admin;
    expect(s.has("platform.governance.ops.read")).toBe(true);
    expect(s.has("platform.support.session.start")).toBe(true);
    expect(s.has("platform.support.session.end")).toBe(true);
    expect(s.has("platform.modules.govern")).toBe(false);
  });

  it("does not grant workspace_support elevated governance exports", () => {
    const w = PLATFORM_ROLE_PERMISSION_MATRIX.workspace_support;
    expect(w.has("platform.governance.ops.read")).toBe(false);
  });
});
