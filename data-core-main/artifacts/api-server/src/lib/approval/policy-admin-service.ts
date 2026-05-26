import { db, approvalProcessPoliciesTable, activityLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ApprovalProcessPolicy } from "@workspace/db";
import { describeRoutingType } from "./process-templates";

export const APPROVAL_ROUTING_TYPES = [
  "direct_manager",
  "manager_chain",
  "org_unit_head",
  "division_head",
  "hr_director",
  "executive",
  "parallel_all",
  "parallel_any",
] as const;

export const APPROVAL_ON_TIMEOUT = ["escalate", "auto_approve", "auto_reject"] as const;

export type ApprovalPolicyPatch = {
  name?: string;
  nameAr?: string | null;
  routingType?: string;
  chainDepth?: number;
  timeoutHours?: number;
  onTimeout?: string;
  isActive?: boolean;
  displayOrder?: number;
};

export type PolicyUpdateResult =
  | { ok: true; policy: ApprovalProcessPolicy }
  | { ok: false; status: number; error: string; code?: string };

function clampInt(n: unknown, min: number, max: number): number | null {
  const v = Number(n);
  if (!Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

export function validateApprovalPolicyPatch(patch: ApprovalPolicyPatch): string | null {
  if (patch.name !== undefined) {
    const t = String(patch.name).trim();
    if (t.length < 2 || t.length > 120) return "name must be 2–120 characters";
  }
  if (patch.nameAr !== undefined && patch.nameAr !== null) {
    const t = String(patch.nameAr).trim();
    if (t.length > 120) return "nameAr must be at most 120 characters";
  }
  if (patch.routingType !== undefined) {
    if (!APPROVAL_ROUTING_TYPES.includes(patch.routingType as (typeof APPROVAL_ROUTING_TYPES)[number])) {
      return `routingType must be one of: ${APPROVAL_ROUTING_TYPES.join(", ")}`;
    }
  }
  if (patch.chainDepth !== undefined) {
    const d = clampInt(patch.chainDepth, 1, 5);
    if (d === null) return "chainDepth must be an integer between 1 and 5";
  }
  if (patch.timeoutHours !== undefined) {
    const h = clampInt(patch.timeoutHours, 1, 720);
    if (h === null) return "timeoutHours must be an integer between 1 and 720";
  }
  if (patch.onTimeout !== undefined) {
    if (!APPROVAL_ON_TIMEOUT.includes(patch.onTimeout as (typeof APPROVAL_ON_TIMEOUT)[number])) {
      return `onTimeout must be one of: ${APPROVAL_ON_TIMEOUT.join(", ")}`;
    }
  }
  if (patch.displayOrder !== undefined) {
    const o = clampInt(patch.displayOrder, 0, 999);
    if (o === null) return "displayOrder must be 0–999";
  }
  return null;
}

async function writePolicyAudit(
  workspaceId: number,
  actorUserId: number,
  code: string,
  before: ApprovalProcessPolicy,
  after: ApprovalProcessPolicy,
): Promise<void> {
  try {
    await db.insert(activityLogsTable).values({
      workspaceId,
      userId: actorUserId,
      action: "approval_policy_updated",
      metadata: JSON.stringify({
        code,
        before: {
          routingType: before.routingType,
          chainDepth: before.chainDepth,
          timeoutHours: before.timeoutHours,
          onTimeout: before.onTimeout,
          isActive: before.isActive,
        },
        after: {
          routingType: after.routingType,
          chainDepth: after.chainDepth,
          timeoutHours: after.timeoutHours,
          onTimeout: after.onTimeout,
          isActive: after.isActive,
        },
      }),
    });
  } catch {
    // non-fatal
  }
}

export async function updateApprovalProcessPolicy(
  workspaceId: number,
  code: string,
  patch: ApprovalPolicyPatch,
  actorUserId: number,
): Promise<PolicyUpdateResult> {
  const validationError = validateApprovalPolicyPatch(patch);
  if (validationError) {
    return { ok: false, status: 400, error: validationError, code: "INVALID_POLICY_PATCH" };
  }

  const [existing] = await db
    .select()
    .from(approvalProcessPoliciesTable)
    .where(
      and(
        eq(approvalProcessPoliciesTable.workspaceId, workspaceId),
        eq(approvalProcessPoliciesTable.code, code),
      ),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, status: 404, error: "Approval template not found" };
  }

  const routingType = patch.routingType ?? existing.routingType;
  let chainDepth = patch.chainDepth ?? existing.chainDepth;
  if (routingType === "direct_manager" && chainDepth > 1) {
    chainDepth = 1;
  }
  if (routingType === "manager_chain" && chainDepth < 2) {
    chainDepth = 2;
  }

  const updates: Partial<typeof approvalProcessPoliciesTable.$inferInsert> = {
    updatedAt: new Date(),
    chainDepth,
  };

  if (patch.name !== undefined) updates.name = String(patch.name).trim();
  if (patch.nameAr !== undefined) updates.nameAr = patch.nameAr === null ? null : String(patch.nameAr).trim();
  if (patch.routingType !== undefined) updates.routingType = patch.routingType;
  if (patch.timeoutHours !== undefined) updates.timeoutHours = patch.timeoutHours;
  if (patch.onTimeout !== undefined) updates.onTimeout = patch.onTimeout;
  if (patch.isActive !== undefined) updates.isActive = Boolean(patch.isActive);
  if (patch.displayOrder !== undefined) updates.displayOrder = patch.displayOrder;

  const [policy] = await db
    .update(approvalProcessPoliciesTable)
    .set(updates)
    .where(eq(approvalProcessPoliciesTable.id, existing.id))
    .returning();

  if (!policy) {
    return { ok: false, status: 500, error: "Update failed" };
  }

  await writePolicyAudit(workspaceId, actorUserId, code, existing, policy);
  return { ok: true, policy };
}

export function enrichPolicyRow(
  policy: ApprovalProcessPolicy,
  isAr: boolean,
): ApprovalProcessPolicy & { routingLabel: string } {
  return {
    ...policy,
    routingLabel: describeRoutingType(policy.routingType, isAr),
  };
}
