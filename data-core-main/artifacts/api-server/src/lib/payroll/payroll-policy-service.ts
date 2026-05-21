/**
 * P21-B — Versioned workspace payroll policies
 */
import { db } from "@workspace/db";
import { payrollPoliciesTable, workspacesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

export type PayrollGeneralPolicy = {
  rounding: { mode: "half_up" | "down" | "up"; scale: number };
  proration: { method: string; excludeWeekends: boolean };
  default_currency: string;
};

export type PayrollAttendancePolicy = {
  late_deduction: { enabled: boolean };
  block_ingest_when_locked: boolean;
};

export type PayrollLockPolicy = {
  block_ingest_when_locked: boolean;
  allow_break_glass_roles: string[];
};

const DEFAULTS: Record<string, unknown> = {
  "payroll.general": {
    rounding: { mode: "half_up", scale: 2 },
    proration: { method: "working_days", excludeWeekends: true },
    default_currency: "SAR",
  },
  "payroll.attendance": {
    late_deduction: { enabled: false },
    block_ingest_when_locked: true,
  },
  "payroll.lock": {
    block_ingest_when_locked: true,
    allow_break_glass_roles: ["super_admin", "admin"],
  },
};

export class PayrollPolicyService {
  async resolvePolicy<T extends Record<string, unknown>>(
    workspaceId: number,
    policyKey: string,
    asOfDate?: string,
  ): Promise<T> {
    const conditions = [
      eq(payrollPoliciesTable.workspaceId, workspaceId),
      eq(payrollPoliciesTable.policyKey, policyKey),
    ];

    const rows = await db
      .select()
      .from(payrollPoliciesTable)
      .where(and(...conditions))
      .orderBy(desc(payrollPoliciesTable.version))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { ...(DEFAULTS[policyKey] as T) };
    }
    if (asOfDate && row.effectiveFrom > asOfDate) {
      return { ...(DEFAULTS[policyKey] as T) };
    }
    try {
      return { ...(DEFAULTS[policyKey] as object), ...JSON.parse(row.policyJson) } as T;
    } catch {
      return { ...(DEFAULTS[policyKey] as T) };
    }
  }

  async seedDefaultsForWorkspace(workspaceId: number, userId?: number): Promise<void> {
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const [existing] = await db
        .select({ id: payrollPoliciesTable.id })
        .from(payrollPoliciesTable)
        .where(
          and(
            eq(payrollPoliciesTable.workspaceId, workspaceId),
            eq(payrollPoliciesTable.policyKey, key),
          ),
        )
        .limit(1);
      if (existing) continue;

      await db.insert(payrollPoliciesTable).values({
        workspaceId,
        policyKey: key,
        policyJson: JSON.stringify(value),
        version: 1,
        effectiveFrom,
        createdByUserId: userId ?? null,
      });
    }
  }

  async seedAllWorkspaces(): Promise<number> {
    const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);
    for (const ws of workspaces) {
      await this.seedDefaultsForWorkspace(ws.id);
    }
    return workspaces.length;
  }

  getRoundingScale(workspaceId: number): Promise<number> {
    return this.resolvePolicy<PayrollGeneralPolicy>(workspaceId, "payroll.general").then(
      (p) => p.rounding?.scale ?? 2,
    );
  }
}

export const payrollPolicyService = new PayrollPolicyService();
