/**
 * @phase P16-E - Workspace access resolver tests
 */

import { describe, it, expect } from "vitest";
import {
  flagsForEnforcementStatus,
  isReadOnlyEnforcementStatus,
} from "../workspace-access-enforcement-config";
import { canPerformWriteAction } from "../workspace-access-resolver";

describe("workspace access flags", () => {
  it("normal allows all writes", () => {
    const f = flagsForEnforcementStatus("normal");
    expect(f.allowLogin).toBe(true);
    expect(f.allowRead).toBe(true);
    expect(f.allowCreate).toBe(true);
    expect(f.allowUpdate).toBe(true);
    expect(f.allowDelete).toBe(true);
  });

  it("read_only blocks writes but allows login and read", () => {
    const f = flagsForEnforcementStatus("read_only");
    expect(f.allowLogin).toBe(true);
    expect(f.allowRead).toBe(true);
    expect(f.allowCreate).toBe(false);
    expect(f.allowUpdate).toBe(false);
    expect(f.allowDelete).toBe(false);
    expect(isReadOnlyEnforcementStatus("read_only")).toBe(true);
  });

  it("suspended_view_only blocks writes", () => {
    const f = flagsForEnforcementStatus("suspended_view_only");
    expect(f.allowCreate).toBe(false);
    expect(f.allowRead).toBe(true);
  });

  it("terminated_view_only blocks writes", () => {
    const f = flagsForEnforcementStatus("terminated_view_only");
    expect(f.allowDelete).toBe(false);
    expect(f.allowRead).toBe(true);
  });
});

describe("canPerformWriteAction", () => {
  it("maps actions to flags", () => {
    const mode = {
      workspaceId: 1,
      tenantId: 1,
      enforcementId: null,
      enforcementStatus: "read_only" as const,
      allowLogin: true,
      allowRead: true,
      allowCreate: false,
      allowUpdate: false,
      allowDelete: false,
      allowExport: true,
      allowAdminAccess: true,
      reason: "test",
      source: "manual",
      subscriptionId: null,
      subscriptionStatus: "suspended",
      appliedBy: null,
      appliedAt: null,
      expiresAt: null,
      policy: null,
      isDefault: false,
    };
    expect(canPerformWriteAction(mode, "create")).toBe(false);
    expect(canPerformWriteAction(mode, "update")).toBe(false);
    expect(canPerformWriteAction(mode, "delete")).toBe(false);
  });
});
