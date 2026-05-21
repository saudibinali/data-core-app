/**
 * @phase P19-F — Report Center UI wiring tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("P19-F report center wiring", () => {
  const app = readSrc("App.tsx");
  const page = readSrc("pages/report-center.tsx");
  const hooks = readSrc("hooks/use-report-center.ts");
  const modules = readFileSync(resolve(ROOT, "../../api-server/src/seed/modules.ts"), "utf8");
  const notifications = readSrc("pages/notifications.tsx");

  it("registers /hr/reports route with report-center module", () => {
    expect(app).toContain("/hr/reports");
    expect(app).toContain("ReportCenterPage");
    expect(app).toContain('moduleKey="report-center"');
  });

  it("navigation module seeded", () => {
    expect(modules).toContain('key: "report-center"');
    expect(modules).toContain("/hr/reports");
    expect(modules).toContain("hr.manage");
  });

  it("page uses permission helpers and test ids", () => {
    expect(page).toContain("canViewReportCenter");
    expect(page).toContain("canManageReportCenter");
    expect(page).toContain("report-center-page");
    expect(page).toContain("report-center-access-denied");
  });

  it("create export job flow wired", () => {
    expect(page).toContain("report-create-form");
    expect(page).toContain("create-export-submit");
    expect(hooks).toContain('"/reports/export-jobs"');
    expect(hooks).toContain("useCreateExportJob");
  });

  it("download uses token stream not public URLs", () => {
    expect(hooks).toContain("/reports/generated/");
    expect(hooks).toContain("/reports/generated/download/stream?token=");
    expect(hooks).toContain("downloadWithAuth");
    expect(hooks).toContain("Direct object URLs are not permitted");
    expect(hooks).toContain("/attachments/download/stream?token=");
    expect(hooks).not.toMatch(/downloadUrl.*href/);
  });

  it("schedules and branding tabs", () => {
    expect(page).toContain("tab-schedules");
    expect(page).toContain("schedule-create-submit");
    expect(page).toContain("schedule-toggle-");
    expect(page).toContain("branding-save");
    expect(hooks).toContain('["reports", "schedules"]');
    expect(hooks).toContain('["reports", "branding"]');
  });

  it("notifications link export types to report center", () => {
    expect(notifications).toContain("export_completed");
    expect(notifications).toContain("/hr/reports");
  });

  it("does not use forbidden patterns", () => {
    const blob = (page + hooks).toLowerCase();
    for (const term of ["power bi", "tableau", "redis", "bullmq", "ocr", "openai"]) {
      expect(blob.includes(term), `forbidden: ${term}`).toBe(false);
    }
  });
});
