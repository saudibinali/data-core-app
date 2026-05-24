/**
 * Smart form configuration: audience targeting and workflow compilation.
 * Stored in form_definitions.permissions (audience) and settings (workflowPlan, workflowId).
 */
import { db } from "@workspace/db";
import {
  workflowDefinitionsTable,
  employeesTable,
  groupMembersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Slug / event helpers ──────────────────────────────────────────────────────

export function toFormSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 60) || "form";
}

/** WorkflowEngine TIER-2 hint stored in form_definitions.workflow_event */
export function buildFormWorkflowEvent(module: string, formName: string): string {
  return `${module}.${toFormSlug(formName)}.submitted`;
}

// ── Audience ──────────────────────────────────────────────────────────────────

export type RolePreset = "all" | "member" | "manager_above" | "admin_only";

export interface FormAudienceConfig {
  /** Legacy preset — kept for backward compatibility */
  visibleTo?: RolePreset;
  /** all | preset | targeted */
  mode?: "all" | "preset" | "targeted";
  departmentIds?: number[];
  orgUnitIds?: number[];
  positionIds?: number[];
  jobTitleIds?: number[];
  userIds?: number[];
  groupIds?: number[];
}

export interface AudienceContext {
  userId: number;
  userRole: string;
  departmentId?: number | null;
  employee?: {
    id: number;
    orgUnitId?: number | null;
    positionId?: number | null;
    jobTitleId?: number | null;
  } | null;
  groupIds?: number[];
}

export function parseAudience(permissions: Record<string, unknown> | null | undefined): FormAudienceConfig {
  if (!permissions) return { mode: "all", visibleTo: "all" };
  const audience = permissions.audience as FormAudienceConfig | undefined;
  if (audience && typeof audience === "object") {
    return {
      visibleTo: (permissions.visibleTo as RolePreset | undefined) ?? audience.visibleTo ?? "all",
      ...audience,
    };
  }
  const visibleTo = (permissions.visibleTo as RolePreset | undefined) ?? "all";
  if (visibleTo === "all") return { mode: "all", visibleTo: "all" };
  return { mode: "preset", visibleTo };
}

export function buildPermissionsPayload(audience: FormAudienceConfig): Record<string, unknown> {
  const visibleTo = audience.visibleTo ?? (audience.mode === "all" ? "all" : "member");
  return {
    visibleTo,
    audience: {
      mode: audience.mode ?? (visibleTo === "all" ? "all" : "preset"),
      visibleTo,
      departmentIds: audience.departmentIds?.length ? audience.departmentIds : undefined,
      orgUnitIds: audience.orgUnitIds?.length ? audience.orgUnitIds : undefined,
      positionIds: audience.positionIds?.length ? audience.positionIds : undefined,
      jobTitleIds: audience.jobTitleIds?.length ? audience.jobTitleIds : undefined,
      userIds: audience.userIds?.length ? audience.userIds : undefined,
      groupIds: audience.groupIds?.length ? audience.groupIds : undefined,
    },
  };
}

function matchesRolePreset(ctx: AudienceContext, preset: RolePreset): boolean {
  const role = ctx.userRole ?? "member";
  const isManagerAbove = ["manager", "admin", "super_admin"].includes(role);
  const isAdminAbove = ["admin", "super_admin"].includes(role);
  switch (preset) {
    case "all": return true;
    case "member": return role === "member";
    case "manager_above": return isManagerAbove;
    case "admin_only": return isAdminAbove;
    default: return true;
  }
}

function matchesTargeted(ctx: AudienceContext, audience: FormAudienceConfig): boolean {
  const checks: boolean[] = [];

  if (audience.departmentIds?.length) {
    checks.push(ctx.departmentId != null && audience.departmentIds.includes(ctx.departmentId));
  }
  if (audience.orgUnitIds?.length) {
    checks.push(ctx.employee?.orgUnitId != null && audience.orgUnitIds.includes(ctx.employee.orgUnitId));
  }
  if (audience.positionIds?.length) {
    checks.push(ctx.employee?.positionId != null && audience.positionIds.includes(ctx.employee.positionId));
  }
  if (audience.jobTitleIds?.length) {
    checks.push(ctx.employee?.jobTitleId != null && audience.jobTitleIds.includes(ctx.employee.jobTitleId));
  }
  if (audience.userIds?.length) {
    checks.push(audience.userIds.includes(ctx.userId));
  }
  if (audience.groupIds?.length) {
    const userGroups = ctx.groupIds ?? [];
    checks.push(audience.groupIds.some((g) => userGroups.includes(g)));
  }

  if (!checks.length) return true;
  return checks.some(Boolean);
}

export function evaluateFormAudience(ctx: AudienceContext, permissions: Record<string, unknown> | null | undefined): boolean {
  const audience = parseAudience(permissions);
  const mode = audience.mode ?? (audience.visibleTo === "all" ? "all" : "preset");

  if (mode === "all") return true;

  if (mode === "preset") {
    const preset = audience.visibleTo ?? "all";
    return matchesRolePreset(ctx, preset);
  }

  if (mode === "targeted") {
    if (matchesTargeted(ctx, audience)) return true;
    const preset = audience.visibleTo;
    if (preset && preset !== "all") return matchesRolePreset(ctx, preset);
    return false;
  }

  return true;
}

export async function loadAudienceContext(
  workspaceId: number,
  userId: number,
  userRole: string,
  departmentId?: number | null,
): Promise<AudienceContext> {
  const [emp] = await db
    .select({
      id: employeesTable.id,
      orgUnitId: employeesTable.orgUnitId,
      positionId: employeesTable.positionId,
      jobTitleId: employeesTable.jobTitleId,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)))
    .limit(1);

  const groupRows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.userId, userId));

  return {
    userId,
    userRole,
    departmentId: departmentId ?? null,
    employee: emp ?? null,
    groupIds: groupRows.map((r) => r.groupId),
  };
}

// ── Workflow plan ─────────────────────────────────────────────────────────────

export type WorkflowApproverType =
  | "manager"
  | "department_head"
  | "role"
  | "specific"
  | "hr_admin";

export interface FormWorkflowStepPlan {
  id: string;
  type: "approval" | "notify";
  approverType?: WorkflowApproverType;
  approverRole?: string;
  approverUserIds?: number[];
  approvalMode?: "single" | "any" | "all";
  title?: string;
  titleAr?: string;
  condition?: { field: string; operator: string; value: string };
}

export interface FormWorkflowPlan {
  enabled: boolean;
  steps: FormWorkflowStepPlan[];
}

function mapApprovalType(mode?: string): string {
  if (mode === "any") return "parallel";
  if (mode === "all") return "multi";
  return "single";
}

function mapApproverType(t?: WorkflowApproverType): string {
  switch (t) {
    case "department_head": return "department_head";
    case "role": return "role";
    case "specific": return "specific";
    case "hr_admin": return "role";
    case "manager":
    default: return "manager";
  }
}

export function compileWorkflowSteps(
  plan: FormWorkflowPlan,
  formName: string,
  formNameAr?: string | null,
): Record<string, unknown>[] {
  const steps: Record<string, unknown>[] = [];
  let idx = 0;

  const wfSteps = plan.steps.length
    ? plan.steps
    : [{ id: "default", type: "approval" as const, approverType: "manager" as const, approvalMode: "single" as const }];

  steps.push({
    index: idx++,
    type: "notification",
    name: "Submission received",
    config: {
      recipientType: "creator",
      title: `${formName} received`,
      titleAr: formNameAr ? `تم استلام ${formNameAr}` : undefined,
      message: `Your ${formName} submission has been received and is being processed.`,
      messageAr: formNameAr ? `تم استلام طلبك "${formNameAr}" وجاري المعالجة.` : undefined,
    },
  });

  for (const s of wfSteps) {
    if (s.type === "notify") {
      steps.push({
        index: idx++,
        type: "notification",
        name: s.title ?? "Notify",
        config: {
          recipientType: s.approverType === "specific" ? "specific" : "manager",
          recipientIds: s.approverUserIds,
          title: s.title ?? "Notification",
          titleAr: s.titleAr,
          message: s.title ?? "You have a new form request to review.",
        },
        ...(s.condition
          ? {
              conditions: {
                logic: "and",
                conditions: [{ field: s.condition.field, operator: s.condition.operator, value: s.condition.value }],
              },
            }
          : {}),
      });
      continue;
    }

    const approverType = mapApproverType(s.approverType);
    const config: Record<string, unknown> = {
      approvalType: mapApprovalType(s.approvalMode),
      approverType,
      title: s.title ?? `Approve: ${formName}`,
      titleAr: s.titleAr,
      timeoutHours: 48,
      onTimeout: "escalate",
    };
    if (approverType === "role") {
      config.approverRole = s.approverType === "hr_admin" ? "admin" : (s.approverRole ?? "admin");
    }
    if (approverType === "specific" && s.approverUserIds?.length) {
      config.approverIds = s.approverUserIds;
    }

    steps.push({
      index: idx++,
      type: "approval",
      name: s.title ?? "Approval",
      config,
      ...(s.condition
        ? {
            conditions: {
              logic: "and",
              conditions: [{ field: s.condition.field, operator: s.condition.operator, value: s.condition.value }],
            },
          }
        : {}),
    });
  }

  return steps;
}

export async function upsertFormWorkflow(
  workspaceId: number,
  formId: number,
  formName: string,
  formNameAr: string | null | undefined,
  module: string,
  triggerEvent: string,
  plan: FormWorkflowPlan | undefined | null,
  createdByUserId: number | null,
  existingWorkflowId?: number | null,
): Promise<number | null> {
  if (!plan?.enabled) return existingWorkflowId ?? null;

  const key = `form_${formId}_wf`;
  const steps = compileWorkflowSteps(plan, formName, formNameAr);
  const wfName = `${formName} — Approval Flow`;
  const wfNameAr = formNameAr ? `${formNameAr} — مسار الموافقة` : null;

  if (existingWorkflowId) {
    await db
      .update(workflowDefinitionsTable)
      .set({
        triggerEvent,
        steps,
        name: wfName,
        nameAr: wfNameAr,
        module,
      })
      .where(and(
        eq(workflowDefinitionsTable.id, existingWorkflowId),
        eq(workflowDefinitionsTable.workspaceId, workspaceId),
      ));
    return existingWorkflowId;
  }

  const [existing] = await db
    .select({ id: workflowDefinitionsTable.id })
    .from(workflowDefinitionsTable)
    .where(and(
      eq(workflowDefinitionsTable.workspaceId, workspaceId),
      eq(workflowDefinitionsTable.key, key),
    ));

  if (existing) {
    await db
      .update(workflowDefinitionsTable)
      .set({ triggerEvent, steps, name: wfName, nameAr: wfNameAr, module })
      .where(eq(workflowDefinitionsTable.id, existing.id));
    return existing.id;
  }

  const [wf] = await db
    .insert(workflowDefinitionsTable)
    .values({
      workspaceId,
      key,
      name: wfName,
      nameAr: wfNameAr,
      description: `Auto workflow for form: ${formName}`,
      module,
      triggerEvent,
      status: "draft",
      isActive: false,
      conditions: [],
      steps,
      createdBy: createdByUserId,
    })
    .returning({ id: workflowDefinitionsTable.id });

  return wf?.id ?? null;
}
