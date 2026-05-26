import { describe, expect, it } from "vitest";
import {
  buildMasterDataLookupMaps,
  detectMasterDataMismatches,
  resolveMasterDataIds,
} from "../employee-import-governance";

describe("employee-import-governance", () => {
  const maps = buildMasterDataLookupMaps({
    orgUnits: [{ id: 1, name: "IT", code: "IT" }],
    jobTitles: [{ id: 2, name: "Engineer", code: "ENG" }],
    jobGrades: [{ id: 3, name: "Grade 1", code: "G1" }],
    positions: [{ id: 4, title: "Dev", code: "DEV" }],
    workLocations: [{ id: 5, name: "HQ", code: "HQ" }],
  });

  it("resolves by canonical code", () => {
    const ids = resolveMasterDataIds({
      jgCode: "G1",
      maps,
    });
    expect(ids.jobGradeId).toBe(3);
  });

  it("detects unknown grade code as mismatch", () => {
    const mismatches = detectMasterDataMismatches({
      jgCode: "G1F",
      maps,
    });
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.entityType).toBe("job_grade");
    expect(mismatches[0]?.value).toBe("G1F");
  });

  it("does not mismatch when code exists", () => {
    const mismatches = detectMasterDataMismatches({
      jgCode: "G1",
      jtCode: "ENG",
      maps,
    });
    expect(mismatches).toHaveLength(0);
  });
});
