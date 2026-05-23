/**
 * Phase 3 — Workbook verification (metadata, stale, validation sheet, ref sheets).
 */

import * as XLSX from "xlsx";
import { HrImportTemplateRegistryV2 } from "../template/template-registry-v2";
import { detectStaleTemplate } from "../template/stale-template-detector";
import { parseMetadataSheet } from "./workbook-parser";

export type WorkbookVerificationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type WorkbookVerificationResult = {
  ok: boolean;
  templateKey?: string;
  templateVersion?: string;
  generatedAt?: string;
  staleCheck?: ReturnType<typeof detectStaleTemplate>;
  issues: WorkbookVerificationIssue[];
  referenceSheetsPresent: string[];
  referenceSheetsMissing: string[];
  validationSheetPresent: boolean;
  metadataPresent: boolean;
};

const EMPLOYEE_REF_SHEETS = [
  "Ref_EmploymentTypes",
  "Ref_Statuses",
  "Ref_OrgUnits",
  "Ref_JobTitles",
  "Ref_JobGrades",
  "Ref_Positions",
  "Ref_WorkLocations",
];

export function verifyWorkbook(
  workbook: XLSX.WorkBook,
  expectedTemplateKey?: string,
): WorkbookVerificationResult {
  const issues: WorkbookVerificationIssue[] = [];
  const meta = parseMetadataSheet(workbook);
  const metadataPresent = Object.keys(meta).length > 0;
  const validationSheetPresent = Boolean(workbook.Sheets["_validation"]);

  if (!metadataPresent) {
    issues.push({ code: "MISSING_METADATA", severity: "warning", message: "_metadata sheet missing or empty" });
  }

  if (!validationSheetPresent) {
    issues.push({ code: "MISSING_VALIDATION_SHEET", severity: "warning", message: "_validation sheet missing" });
  }

  const templateKey = meta.template_key ?? expectedTemplateKey;
  const templateVersion = meta.template_version;
  const generatedAt = meta.generated_at;

  if (templateKey && !HrImportTemplateRegistryV2.get(templateKey)) {
    issues.push({ code: "INVALID_TEMPLATE_KEY", severity: "error", message: `Unknown template key: ${templateKey}` });
  }

  const staleCheck = templateKey
    ? detectStaleTemplate(templateKey, templateVersion, generatedAt)
    : undefined;

  if (staleCheck?.stale) {
    issues.push({
      code: "STALE_TEMPLATE",
      severity: "warning",
      message: `Template version stale: ${staleCheck.reason ?? "unknown"}`,
    });
  }

  const referenceSheetsPresent: string[] = [];
  const referenceSheetsMissing: string[] = [];
  if (templateKey?.includes("employee")) {
    for (const ref of EMPLOYEE_REF_SHEETS) {
      if (workbook.Sheets[ref]) referenceSheetsPresent.push(ref);
      else referenceSheetsMissing.push(ref);
    }
    if (referenceSheetsPresent.length === 0) {
      issues.push({
        code: "MISSING_REF_SHEETS",
        severity: "warning",
        message: "No reference lookup sheets found",
      });
    }
  }

  if (workbook.Sheets["_validation"]) {
    try {
      const valSheet = workbook.Sheets["_validation"]!;
      const rows = XLSX.utils.sheet_to_json<string[]>(valSheet, { header: 1, defval: "" });
      if (rows.length < 2) {
        issues.push({ code: "CORRUPT_VALIDATION_SHEET", severity: "warning", message: "_validation sheet has no rules" });
      }
    } catch {
      issues.push({ code: "CORRUPT_VALIDATION_SHEET", severity: "error", message: "_validation sheet unreadable" });
    }
  }

  const hasError = issues.some((i) => i.severity === "error");
  return {
    ok: !hasError,
    templateKey,
    templateVersion,
    generatedAt,
    staleCheck,
    issues,
    referenceSheetsPresent,
    referenceSheetsMissing,
    validationSheetPresent,
    metadataPresent,
  };
}
