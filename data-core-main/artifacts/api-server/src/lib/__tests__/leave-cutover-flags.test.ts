import { describe, it, expect } from "vitest";
import {
  getLeaveCutoverFlags,
  isLeaveCutoverEnabledForWorkspace,
  getLeavePilotWorkspaceId,
  leaveCutoverStatusForWorkspace,
  resolveLeaveCutoverStatus,
} from "../leave-cutover-flags";

describe("leave-cutover-flags", () => {
  it("defaults all flags to false when env unset", () => {
    const flags = getLeaveCutoverFlags({});
    expect(flags.canonicalLeaveSubmit).toBe(false);
    expect(flags.legacyLeaveFreeze).toBe(false);
  });

  it("does not enable submit for non-pilot workspace when global flag on", () => {
    const env = {
      CANONICAL_LEAVE_SUBMIT: "true",
      LEAVE_CUTOVER_PILOT_WORKSPACE_ID: "42",
    };
    expect(isLeaveCutoverEnabledForWorkspace("canonicalLeaveSubmit", 99, env)).toBe(false);
    expect(isLeaveCutoverEnabledForWorkspace("canonicalLeaveSubmit", 42, env)).toBe(true);
  });

  it("status payload reflects pilot workspace", () => {
    const env = {
      LEGACY_LEAVE_FREEZE: "true",
      LEAVE_CUTOVER_PILOT_WORKSPACE_ID: "7",
    };
    const status = leaveCutoverStatusForWorkspace(7, env);
    expect(status.isPilotWorkspace).toBe(true);
    expect(status.legacyFreeze).toBe(true);
    expect(leaveCutoverStatusForWorkspace(8, env).legacyFreeze).toBe(false);
  });

  it("parses pilot workspace id", () => {
    expect(getLeavePilotWorkspaceId({ LEAVE_CUTOVER_PILOT_WORKSPACE_ID: "123" })).toBe(123);
    expect(getLeavePilotWorkspaceId({})).toBeNull();
  });

  it("resolveLeaveCutoverStatus canonical overrides env pilot", () => {
    const env = { LEAVE_CUTOVER_PILOT_WORKSPACE_ID: "1" };
    const status = resolveLeaveCutoverStatus(99, "canonical", env);
    expect(status.canonicalSubmit).toBe(true);
    expect(status.legacyFreeze).toBe(true);
    expect(status.workspaceDriven).toBe(true);
  });

  it("resolveLeaveCutoverStatus transition enables canonical without pilot", () => {
    const status = resolveLeaveCutoverStatus(99, "transition", {});
    expect(status.canonicalSubmit).toBe(true);
    expect(status.legacyFreeze).toBe(false);
  });

  it("includes canonicalWriteEnabled in status payload", () => {
    const status = resolveLeaveCutoverStatus(1, "canonical", {});
    expect(status.canonicalWriteEnabled).toBe(true);
  });
});
