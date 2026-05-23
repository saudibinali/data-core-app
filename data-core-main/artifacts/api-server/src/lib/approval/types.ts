export const APPROVAL_ROUTING_TYPES = [
  "direct_manager",
  "manager_chain",
  "org_unit_head",
  "division_head",
  "hr_director",
  "executive",
  "parallel_all",
  "parallel_any",
  "role",
] as const;

export type ApprovalRoutingType = (typeof APPROVAL_ROUTING_TYPES)[number];

export type ApprovalRuntimeMode = "legacy" | "dual" | "unified";

export type ApprovalEntityType =
  | "leave_request"
  | "hr_request"
  | "onboarding"
  | "workforce_lifecycle"
  | "procurement"
  | "ticket"
  | "workflow_execution";

export type ApprovalInstanceStatus = "pending" | "approved" | "rejected" | "cancelled" | "escalated";
export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "skipped" | "escalated" | "delegated";

export type ResolvedApprover = {
  employeeId: number;
  userId: number;
  routingSource: string;
  stepOrder: number;
};

export type StartApprovalInput = {
  workspaceId: number;
  entityType: ApprovalEntityType;
  entityId: number;
  processCode: string;
  requesterEmployeeId: number | null;
  requesterUserId: number | null;
  context?: Record<string, unknown>;
};

export type InboxItem = {
  instanceId: number;
  stepId: number;
  stepOrder: number;
  entityType: string;
  entityId: number;
  processCode: string;
  processName: string;
  status: string;
  stepStatus: string;
  dueAt: string | null;
  slaWarning: boolean;
  isDelegated: boolean;
  routingSource: string;
  context: Record<string, unknown> | null;
  requesterUserId: number | null;
  createdAt: string;
};

export type ProcessTemplate = {
  code: string;
  name: string;
  nameAr: string | null;
  routingType: string;
  chainDepth: number;
  timeoutHours: number;
  description: string;
  descriptionAr: string;
};
