import { db } from "@workspace/db";
import {
  approvalProcessPoliciesTable,
  employeesTable,
  workforceExecutiveOverridesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getFullReportingChain,
  resolveManagerUserIdForEmployee,
} from "../workforce/org/reporting-hierarchy-service";
import { getOrgUnitHeadEmployeeId, getOrgUnitAncestors } from "../workforce/org/org-graph-service";
import { resolveEffectiveApproverUserId } from "./delegation-resolver";
import type { ApprovalProcessPolicy } from "@workspace/db";
import type { ResolvedApprover } from "./types";

export async function getProcessPolicy(
  workspaceId: number,
  processCode: string,
): Promise<ApprovalProcessPolicy | null> {
  const [row] = await db
    .select()
    .from(approvalProcessPoliciesTable)
    .where(
      and(
        eq(approvalProcessPoliciesTable.workspaceId, workspaceId),
        eq(approvalProcessPoliciesTable.code, processCode),
        eq(approvalProcessPoliciesTable.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function employeeUserId(
  workspaceId: number,
  employeeId: number,
): Promise<number | null> {
  const [emp] = await db
    .select({ userId: employeesTable.userId, status: employeesTable.status })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);
  if (emp?.userId && emp.status === "active") return emp.userId;
  return null;
}

export async function resolveApproversForPolicy(
  workspaceId: number,
  policy: ApprovalProcessPolicy,
  requesterEmployeeId: number,
): Promise<ResolvedApprover[]> {
  const routingType = policy.routingType;
  const result: ResolvedApprover[] = [];

  if (routingType === "direct_manager") {
    const resolved = await resolveManagerUserIdForEmployee(workspaceId, requesterEmployeeId);
    if (resolved) {
      const [emp] = await db
        .select({ id: employeesTable.id, directManagerId: employeesTable.directManagerId })
        .from(employeesTable)
        .where(eq(employeesTable.id, requesterEmployeeId))
        .limit(1);
      const mgrId = emp?.directManagerId;
      if (mgrId) {
        const effective = await resolveEffectiveApproverUserId(workspaceId, mgrId, resolved.userId);
        result.push({
          employeeId: mgrId,
          userId: effective.userId,
          routingSource: resolved.source,
          stepOrder: 1,
        });
      }
    }
    return result;
  }

  if (routingType === "manager_chain") {
    const chain = await getFullReportingChain(workspaceId, requesterEmployeeId, policy.chainDepth + 1);
    let order = 1;
    for (const node of chain) {
      if (node.depth === 0) continue;
      if (!node.userId) continue;
      const effective = await resolveEffectiveApproverUserId(workspaceId, node.employeeId, node.userId);
      result.push({
        employeeId: node.employeeId,
        userId: effective.userId,
        routingSource: "direct",
        stepOrder: order++,
      });
      if (order > policy.chainDepth) break;
    }
    return result;
  }

  if (routingType === "org_unit_head" || routingType === "division_head") {
    const [emp] = await db
      .select({ orgUnitId: employeesTable.orgUnitId })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, requesterEmployeeId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);

    if (routingType === "org_unit_head" && emp?.orgUnitId) {
      const headId = await getOrgUnitHeadEmployeeId(workspaceId, emp.orgUnitId);
      if (headId && headId !== requesterEmployeeId) {
        const userId = await employeeUserId(workspaceId, headId);
        if (userId) {
          const effective = await resolveEffectiveApproverUserId(workspaceId, headId, userId);
          result.push({
            employeeId: headId,
            userId: effective.userId,
            routingSource: "org_unit_head",
            stepOrder: 1,
          });
        }
      }
    }

    if (routingType === "division_head" && emp?.orgUnitId) {
      const ancestors = await getOrgUnitAncestors(workspaceId, emp.orgUnitId);
      const division = [...ancestors].reverse().find((u) => u.type === "division")
        ?? ancestors.find((u) => u.type === "division");
      if (division) {
        const headId = await getOrgUnitHeadEmployeeId(workspaceId, division.id);
        if (headId && headId !== requesterEmployeeId) {
          const userId = await employeeUserId(workspaceId, headId);
          if (userId) {
            const effective = await resolveEffectiveApproverUserId(workspaceId, headId, userId);
            result.push({
              employeeId: headId,
              userId: effective.userId,
              routingSource: "division_head",
              stepOrder: 1,
            });
          }
        }
      }
    }
    return result;
  }

  if (routingType === "hr_director" || routingType === "executive") {
    const [overrides] = await db
      .select()
      .from(workforceExecutiveOverridesTable)
      .where(eq(workforceExecutiveOverridesTable.workspaceId, workspaceId))
      .limit(1);

    const targetId = routingType === "hr_director"
      ? overrides?.hrDirectorEmployeeId
      : overrides?.ceoEmployeeId;

    if (targetId) {
      const userId = await employeeUserId(workspaceId, targetId);
      if (userId) {
        const effective = await resolveEffectiveApproverUserId(workspaceId, targetId, userId);
        result.push({
          employeeId: targetId,
          userId: effective.userId,
          routingSource: routingType,
          stepOrder: 1,
        });
      }
    }
    return result;
  }

  if (routingType === "parallel_all" || routingType === "parallel_any") {
    const direct = await resolveApproversForPolicy(
      workspaceId,
      { ...policy, routingType: "direct_manager", parallelMode: null },
      requesterEmployeeId,
    );
    const orgHead = await resolveApproversForPolicy(
      workspaceId,
      { ...policy, routingType: "org_unit_head", parallelMode: null },
      requesterEmployeeId,
    );
    const combined = [...direct, ...orgHead.filter((o) => !direct.some((d) => d.userId === o.userId))];
    for (const a of combined) {
      result.push({ ...a, stepOrder: 1, routingSource: `${routingType}:${a.routingSource}` });
    }
  }

  return result;
}
