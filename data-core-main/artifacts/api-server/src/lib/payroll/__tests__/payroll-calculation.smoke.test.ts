/**
 * P21-C — Payroll calculation engine smoke tests
 */
import { describe, it, expect, vi } from "vitest";
import { Money, sumMoney } from "../money";
import { PayrollRunService } from "../payroll-run-service";
import { PayrollRunWorkflow } from "../payroll-run-workflow";
import { issuePayslipDownloadToken, verifyPayslipDownloadToken } from "../payroll-download-token";

describe("P21-C Money & calculation (unit)", () => {
  it("prorates without float drift", () => {
    const base = Money.fromString("3000.00", "SAR");
    const prorated = base.div("20").mul("10");
    expect(prorated.round("half_up", 2).toDisplayString()).toBe("1500.00");
  });

  it("sums component lines", () => {
    const lines = [Money.fromString("1000", "SAR"), Money.fromString("250.50", "SAR")];
    expect(sumMoney(lines, "SAR").toDisplayString()).toBe("1250.50");
  });

  it("builds idempotency keys for correction runs", () => {
    const svc = new PayrollRunService();
    const k1 = svc.buildIdempotencyKey(1, 2, "correction", 1, 10);
    const k2 = svc.buildIdempotencyKey(1, 2, "correction", 1, 11);
    expect(k1).not.toBe(k2);
  });
});

describe("P21-C workflow guards (unit)", () => {
  it("blocks approve when not in review", async () => {
    const wf = new PayrollRunWorkflow();
    vi.spyOn(wf, "getRun").mockResolvedValue({
      id: 1,
      workspaceId: 1,
      periodId: 1,
      runType: "final",
      status: "draft",
    } as never);
    await expect(wf.approveRun(1, 1)).rejects.toThrow(/review/i);
  });
});

describe("P21-C payslip download token (unit)", () => {
  it("issues and verifies signed token", () => {
    const token = issuePayslipDownloadToken({ payslipId: 5, workspaceId: 1, userId: 9 });
    const payload = verifyPayslipDownloadToken(token);
    expect(payload).toEqual({ payslipId: 5, workspaceId: 1, userId: 9 });
  });
});
