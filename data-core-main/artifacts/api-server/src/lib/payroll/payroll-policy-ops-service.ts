/**
 * P21-D — Payroll policy versioning operations
 */
import { db } from "@workspace/db";
import { payrollPoliciesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logPayrollAccess } from "./payroll-audit";

const POLICY_KEYS = [
  "payroll.general",
  "payroll.attendance",
  "payroll.lock",
  "payroll.deduction",
  "payroll.overtime",
  "payroll.correction",
  "payroll.approval",
] as const;

export class PayrollPolicyOpsService {
  async listPolicies(workspaceId: number, policyKey?: string) {
    const conditions = [eq(payrollPoliciesTable.workspaceId, workspaceId)];
    if (policyKey) conditions.push(eq(payrollPoliciesTable.policyKey, policyKey));

    const rows = await db
      .select()
      .from(payrollPoliciesTable)
      .where(and(...conditions))
      .orderBy(desc(payrollPoliciesTable.version), desc(payrollPoliciesTable.effectiveFrom));

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.policyKey) ?? [];
      list.push(row);
      grouped.set(row.policyKey, list);
    }

    return {
      keys: POLICY_KEYS,
      policies: Object.fromEntries(grouped),
      latest: rows.length ? rows[0] : null,
    };
  }

  async createPolicyVersion(input: {
    workspaceId: number;
    policyKey: string;
    policyJson: Record<string, unknown>;
    effectiveFrom: string;
    userId?: number;
  }) {
    const existing = await db
      .select({ version: payrollPoliciesTable.version })
      .from(payrollPoliciesTable)
      .where(
        and(
          eq(payrollPoliciesTable.workspaceId, input.workspaceId),
          eq(payrollPoliciesTable.policyKey, input.policyKey),
        ),
      )
      .orderBy(desc(payrollPoliciesTable.version))
      .limit(1);

    const nextVersion = (existing[0]?.version ?? 0) + 1;

    const [row] = await db
      .insert(payrollPoliciesTable)
      .values({
        workspaceId: input.workspaceId,
        policyKey: input.policyKey,
        policyJson: JSON.stringify(input.policyJson),
        version: nextVersion,
        effectiveFrom: input.effectiveFrom,
        createdByUserId: input.userId ?? null,
      })
      .returning();

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "policy_version_create",
      resourceType: "payroll_policy",
      resourceId: row!.id,
      metadata: { policyKey: input.policyKey, version: nextVersion },
    });

    return row!;
  }

  async getVersionHistory(workspaceId: number, policyKey: string) {
    return db
      .select()
      .from(payrollPoliciesTable)
      .where(
        and(
          eq(payrollPoliciesTable.workspaceId, workspaceId),
          eq(payrollPoliciesTable.policyKey, policyKey),
        ),
      )
      .orderBy(desc(payrollPoliciesTable.version));
  }
}

export const payrollPolicyOpsService = new PayrollPolicyOpsService();
