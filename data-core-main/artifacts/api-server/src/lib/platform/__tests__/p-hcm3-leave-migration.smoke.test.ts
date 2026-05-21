/**
 * P-HCM3 — Leave migration + employee provision smoke
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../../../../../../");

describe("P-HCM3 leave migration & provision", () => {
  it("migration 0021 creates hr_leave_migration_map", () => {
    const sql = readFileSync(
      resolve(repoRoot, "lib/db/drizzle/0021_hr_leave_migration_map.sql"),
      "utf8",
    );
    expect(sql).toContain("hr_leave_migration_map");
  });

  it("leave migration routes registered", () => {
    const index = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/index.ts"), "utf8");
    expect(index).toContain("hrLeaveMigrationRouter");
    const routes = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/routes/hr-leave-migration.ts"),
      "utf8",
    );
    expect(routes).toContain("/hr/leave-migration/report");
    expect(routes).toContain("/hr/leave-migration/run");
  });

  it("employee provision route registered", () => {
    const routes = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/routes/hr-employee-provision.ts"),
      "utf8",
    );
    expect(routes).toContain("/hr/employees/provision");
  });

  it("migration service uses idempotent request numbers", () => {
    const svc = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/lib/hr/leave-migration-service.ts"),
      "utf8",
    );
    expect(svc).toContain("LRQ-MIG-");
    expect(svc).toContain("hrLeaveMigrationMapTable");
  });

  it("stabilization snapshot includes leave migration", () => {
    const svc = readFileSync(
      resolve(repoRoot, "artifacts/api-server/src/lib/platform/platform-stabilization-service.ts"),
      "utf8",
    );
    expect(svc).toContain("leaveMigration");
    expect(svc).toContain("0021_hr_leave_migration_map");
  });
});
