import { db } from "@workspace/db";
import { attendancePoliciesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  DEFAULT_ATTENDANCE_POLICY,
  parsePolicyJson,
  type AttendancePolicyConfig,
} from "./policy-types";

export class AttendancePolicyService {
  async getDefaultPolicy(workspaceId: number): Promise<{
    id: number | null;
    config: AttendancePolicyConfig;
  }> {
    const [row] = await db
      .select()
      .from(attendancePoliciesTable)
      .where(
        and(
          eq(attendancePoliciesTable.workspaceId, workspaceId),
          eq(attendancePoliciesTable.isDefault, true),
          eq(attendancePoliciesTable.isActive, true),
        ),
      )
      .limit(1);

    if (!row) {
      return { id: null, config: { ...DEFAULT_ATTENDANCE_POLICY } };
    }
    return { id: row.id, config: parsePolicyJson(row.policyJson) };
  }

  async ensureDefaultPolicy(workspaceId: number): Promise<void> {
    const existing = await this.getDefaultPolicy(workspaceId);
    if (existing.id) return;

    await db.insert(attendancePoliciesTable).values({
      workspaceId,
      name: "Default",
      isDefault: true,
      isActive: true,
      policyJson: JSON.stringify(DEFAULT_ATTENDANCE_POLICY),
    });
  }

  async listPolicies(workspaceId: number) {
    return db
      .select()
      .from(attendancePoliciesTable)
      .where(eq(attendancePoliciesTable.workspaceId, workspaceId))
      .orderBy(desc(attendancePoliciesTable.isDefault));
  }

  async upsertPolicy(params: {
    workspaceId: number;
    userId?: number;
    name: string;
    policy: AttendancePolicyConfig;
    isDefault?: boolean;
  }) {
    if (params.isDefault) {
      await db
        .update(attendancePoliciesTable)
        .set({ isDefault: false })
        .where(eq(attendancePoliciesTable.workspaceId, params.workspaceId));
    }

    const [row] = await db
      .insert(attendancePoliciesTable)
      .values({
        workspaceId: params.workspaceId,
        name: params.name,
        policyJson: JSON.stringify(params.policy),
        isDefault: params.isDefault ?? false,
        isActive: true,
        createdByUserId: params.userId ?? null,
      })
      .returning();
    return row!;
  }
}

export const attendancePolicyService = new AttendancePolicyService();
