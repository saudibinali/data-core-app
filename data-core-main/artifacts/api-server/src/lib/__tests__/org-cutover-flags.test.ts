import { describe, it, expect } from "vitest";
import {
  isOrgCutoverEnabledForWorkspace,
  isOrgCutoverFlagEnabled,
  isOrgPilotWorkspace,
} from "../org-cutover-flags";

describe("org cutover flags", () => {
  const env = {
    ORG_CUTOVER: "true",
    ORG_CUTOVER_PILOT_WORKSPACE_ID: "42",
  };

  it("parses global flag", () => {
    expect(isOrgCutoverFlagEnabled(env)).toBe(true);
    expect(isOrgCutoverFlagEnabled({})).toBe(false);
  });

  it("scopes cutover to pilot workspace", () => {
    expect(isOrgPilotWorkspace(42, env)).toBe(true);
    expect(isOrgPilotWorkspace(99, env)).toBe(false);
    expect(isOrgCutoverEnabledForWorkspace(42, env)).toBe(true);
    expect(isOrgCutoverEnabledForWorkspace(99, env)).toBe(false);
  });

  it("all workspaces when PLATFORM_STABILIZATION_ALL_WORKSPACES", () => {
    const all = { ...env, PLATFORM_STABILIZATION_ALL_WORKSPACES: "true" };
    expect(isOrgCutoverEnabledForWorkspace(99, all)).toBe(true);
  });
});
