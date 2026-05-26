import { describe, it, expect } from "vitest";
import {
  isPayrollCutoverEnabledForWorkspace,
  isPayrollCutoverFlagEnabled,
  isPayrollPilotWorkspace,
  payrollCutoverStatusForWorkspace,
} from "../payroll-cutover-flags";

describe("payroll cutover flags", () => {
  const env = {
    PAYROLL_CANONICAL_WRITE: "true",
    LEGACY_PAYROLL_FREEZE: "true",
    PAYROLL_CUTOVER_PILOT_WORKSPACE_ID: "42",
  };

  it("parses global flags", () => {
    expect(isPayrollCutoverFlagEnabled("payrollCanonicalWrite", env)).toBe(true);
    expect(isPayrollCutoverFlagEnabled("legacyPayrollFreeze", env)).toBe(true);
    expect(isPayrollCutoverFlagEnabled("payrollCanonicalWrite", {})).toBe(false);
  });

  it("scopes cutover to pilot workspace", () => {
    expect(isPayrollPilotWorkspace(42, env)).toBe(true);
    expect(isPayrollPilotWorkspace(99, env)).toBe(false);
    expect(isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", 42, env)).toBe(true);
    expect(isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", 99, env)).toBe(false);
  });

  it("marks legacy runs read-only when canonical or freeze enabled", () => {
    const status = payrollCutoverStatusForWorkspace(42, env);
    expect(status.legacyRunsReadOnly).toBe(true);
    expect(status.canonicalWriteEnabled).toBe(true);
  });

  it("rollback when PAYROLL_CANONICAL_WRITE=false", () => {
    const rollback = {
      ...env,
      PAYROLL_CANONICAL_WRITE: "false",
      LEGACY_PAYROLL_FREEZE: "false",
    };
    const status = payrollCutoverStatusForWorkspace(42, rollback);
    expect(status.payrollCanonicalWrite).toBe(false);
    expect(status.legacyRunsReadOnly).toBe(false);
  });
});
