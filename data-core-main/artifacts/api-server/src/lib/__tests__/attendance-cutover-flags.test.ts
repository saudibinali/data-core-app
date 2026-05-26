import { describe, it, expect } from "vitest";
import {
  attendanceCutoverStatusForWorkspace,
  isAttendanceCutoverEnabledForWorkspace,
  isAttendancePilotWorkspace,
} from "../attendance-cutover-flags";

describe("attendance cutover flags", () => {
  const env = {
    ATTENDANCE_CANONICAL_WRITE: "true",
    LEGACY_ATTENDANCE_FREEZE: "true",
    ATTENDANCE_CUTOVER_PILOT_WORKSPACE_ID: "7",
  };

  it("scopes to pilot workspace", () => {
    expect(isAttendancePilotWorkspace(7, env)).toBe(true);
    expect(isAttendancePilotWorkspace(1, env)).toBe(false);
    expect(isAttendanceCutoverEnabledForWorkspace("attendanceCanonicalWrite", 7, env)).toBe(true);
  });

  it("marks legacy attendance read-only when canonical or freeze", () => {
    const status = attendanceCutoverStatusForWorkspace(7, env);
    expect(status.legacyAttendanceReadOnly).toBe(true);
    expect(status.canonicalWriteEnabled).toBe(true);
  });

  it("rollback when ATTENDANCE_CANONICAL_WRITE=false", () => {
    const rollback = { ...env, ATTENDANCE_CANONICAL_WRITE: "false", LEGACY_ATTENDANCE_FREEZE: "false" };
    const status = attendanceCutoverStatusForWorkspace(7, rollback);
    expect(status.attendanceCanonicalWrite).toBe(false);
    expect(status.legacyAttendanceReadOnly).toBe(false);
  });
});
