/**
 * P21-B — Canonical payroll foundation smoke tests
 */
import { describe, it, expect, vi } from "vitest";
import { Money, sumMoney } from "../money";
import { PayrollRunService } from "../payroll-run-service";
import { PayrollLockService } from "../payroll-lock-service";
import { PAYROLL_PERMISSION_KEYS } from "../payroll-permissions";

describe("P21-B Money (unit)", () => {
  it("adds amounts without floating-point drift", () => {
    const a = Money.fromString("1000.10", "SAR");
    const b = Money.fromString("0.20", "SAR");
    expect(a.add(b).toStorageString()).toBe("1000.3000");
  });

  it("compares amounts without float drift", () => {
    const a = Money.fromString("10.00", "SAR");
    const b = Money.fromString("9.99", "SAR");
    expect(a.compare(b)).toBeGreaterThan(0);
  });

  it("aggregates safely via sumMoney", () => {
    const values = ["100.00", "200.50", "0.25"].map((v) => Money.fromString(v, "SAR"));
    const total = sumMoney(values, "SAR");
    expect(total.toDisplayString()).toBe("300.75");
  });

  it("rejects invalid money strings", () => {
    expect(() => Money.fromString("12.3.4", "SAR")).toThrow(/Invalid money/);
  });

  it("serializes to JSON as storage string", () => {
    expect(JSON.stringify(Money.fromString("10.50", "SAR"))).toBe('"10.5000"');
  });
});

describe("P21-B payroll run idempotency (unit)", () => {
  it("builds stable idempotency keys", () => {
    const svc = new PayrollRunService();
    const k1 = svc.buildIdempotencyKey(1, 5, "preview", 1);
    const k2 = svc.buildIdempotencyKey(1, 5, "preview", 1);
    const k3 = svc.buildIdempotencyKey(1, 6, "preview", 1);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toHaveLength(48);
  });
});

describe("P21-B payroll permissions (unit)", () => {
  it("defines five granular payroll permissions", () => {
    expect(PAYROLL_PERMISSION_KEYS).toHaveLength(5);
    expect(PAYROLL_PERMISSION_KEYS).toContain("hr.payroll.calculate");
  });
});

describe("P21-B payroll lock date range (unit)", () => {
  it("detects locked dates from active lock list", async () => {
    const svc = new PayrollLockService();
    vi.spyOn(svc, "getActiveLocks").mockResolvedValue([
      {
        lockType: "attendance",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        periodId: 1,
      },
    ]);
    await expect(svc.isDateLocked(1, "2026-05-15")).resolves.toBe(true);
    await expect(svc.isDateLocked(1, "2026-06-01")).resolves.toBe(false);
  });

  it("requires break-glass reason to remove lock", async () => {
    const svc = new PayrollLockService();
    await expect(svc.removeLock(1, 1, "attendance", 1)).rejects.toThrow(/Break-glass/);
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_PAYROLL_FOUNDATION_SMOKE !== "0";

describe.skipIf(!RUN)("P21-B payroll foundation (DB)", () => {
  it("creates period and idempotent preview run", async () => {
    const { pool, initializeDatabase, workspacesTable, db } = await import("@workspace/db");
    const { payrollPeriodService } = await import("../payroll-period-service");
    const { payrollRunService } = await import("../payroll-run-service");
    const { payrollPolicyService } = await import("../payroll-policy-service");
    const { eq } = await import("drizzle-orm");

    initializeDatabase(process.env.DATABASE_URL!);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = 'payroll_periods'`,
    );
    if (Number(r.rows[0]?.c) < 1) return;

    const slug = `payroll-${Date.now()}`;
    const [ws] = await db.insert(workspacesTable).values({ name: "Payroll WS", slug }).returning();
    await payrollPolicyService.seedDefaultsForWorkspace(ws!.id);

    const period = await payrollPeriodService.createPeriod({
      workspaceId: ws!.id,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      periodLabel: `2026-05-${Date.now()}`,
    });

    const preview = await payrollRunService.createPreviewRun({
      workspaceId: ws!.id,
      periodId: period.id,
    });
    expect(preview.run.workspaceId).toBe(ws!.id);

    const dup = await payrollRunService.createPreviewRun({
      workspaceId: ws!.id,
      periodId: period.id,
    });
    expect(dup.duplicate).toBe(true);

    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws!.id));
  });
});
