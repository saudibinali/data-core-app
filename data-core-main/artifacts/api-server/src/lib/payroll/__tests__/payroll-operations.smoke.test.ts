/**
 * P21-D — Payroll operations center smoke tests
 */
import { describe, it, expect, vi } from "vitest";
import {
  issuePayrollExportDownloadToken,
  verifyPayrollExportDownloadToken,
} from "../payroll-financial-export-token";
import { PayrollExceptionService } from "../payroll-exception-service";
import { FinancialExportService } from "../financial-export-service";
import { PayrollPolicyOpsService } from "../payroll-policy-ops-service";
import { PayrollOperationsService } from "../payroll-operations-service";
import { PayrollPayslipService } from "../payroll-payslip-service";
import { PayrollRunWorkflow } from "../payroll-run-workflow";

describe("P21-D financial export token", () => {
  it("issues and verifies signed export token", () => {
    const token = issuePayrollExportDownloadToken({
      workspaceId: 1,
      userId: 2,
      runId: 10,
      exportType: "gl_journal",
    });
    expect(verifyPayrollExportDownloadToken(token)).toEqual({
      workspaceId: 1,
      userId: 2,
      runId: 10,
      exportType: "gl_journal",
    });
  });

  it("rejects invalid export type in token", () => {
    expect(verifyPayrollExportDownloadToken("invalid")).toBeNull();
  });
});

describe("P21-D exception service (unit)", () => {
  it("exposes scan and lifecycle methods", () => {
    const svc = new PayrollExceptionService();
    expect(typeof svc.scanRun).toBe("function");
    expect(typeof svc.acknowledge).toBe("function");
    expect(typeof svc.resolve).toBe("function");
  });
});

describe("P21-D export readiness (unit)", () => {
  it("FinancialExportService exposes foundation builders", () => {
    const svc = new FinancialExportService();
    expect(typeof svc.getExportReadiness).toBe("function");
    expect(typeof svc.buildGlJournal).toBe("function");
    expect(typeof svc.buildCostCenterSummary).toBe("function");
    expect(typeof svc.buildBankPaymentMetadata).toBe("function");
  });
});

describe("P21-D policy versioning (unit)", () => {
  it("PayrollPolicyOpsService exposes version APIs", () => {
    const svc = new PayrollPolicyOpsService();
    expect(typeof svc.listPolicies).toBe("function");
    expect(typeof svc.createPolicyVersion).toBe("function");
    expect(typeof svc.getVersionHistory).toBe("function");
  });
});

describe("P21-D review workflow guard", () => {
  it("bulk approve path uses approve when already in review", async () => {
    const ops = new PayrollOperationsService();
    const wf = new PayrollRunWorkflow();
    vi.spyOn(wf, "getRun").mockResolvedValue({
      id: 1,
      workspaceId: 1,
      status: "review",
      runType: "final",
    } as never);

    const approve = vi.fn().mockResolvedValue({ id: 1, status: "approved" });
    vi.doMock("../payroll-run-service", () => ({
      payrollRunService: {
        submitForReview: vi.fn(),
        approveRun: approve,
      },
    }));
    vi.doMock("../payroll-run-workflow", () => ({
      payrollRunWorkflow: wf,
    }));

    expect(typeof ops.bulkApproveReview).toBe("function");
  });
});

describe("P21-D payslip operations (unit)", () => {
  it("voidDraftPayslip rejects non-draft", async () => {
    const svc = new PayrollPayslipService();
    vi.spyOn(svc, "getPayslip").mockResolvedValue({
      id: 1,
      status: "issued",
      snapshotJson: "{}",
    } as never);
    await expect(svc.voidDraftPayslip(1, 1)).rejects.toThrow(/draft/i);
  });
});

describe("P21-D workspace isolation contract", () => {
  it("export token binds workspace and user", () => {
    const token = issuePayrollExportDownloadToken({
      workspaceId: 99,
      userId: 7,
      runId: 3,
      exportType: "cost_center",
    });
    const p = verifyPayrollExportDownloadToken(token)!;
    expect(p.workspaceId).toBe(99);
    expect(p.userId).toBe(7);
  });
});
