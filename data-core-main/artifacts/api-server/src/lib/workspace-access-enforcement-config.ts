/**
 * @file   workspace-access-enforcement-config.ts
 * @phase  P16-E - Commercial-to-Workspace Enforcement
 */

export const WORKSPACE_ENFORCEMENT_STATUSES = [
  "normal",
  "read_only",
  "restricted",
  "suspended_view_only",
  "terminated_view_only",
] as const;

export type WorkspaceEnforcementStatus = (typeof WORKSPACE_ENFORCEMENT_STATUSES)[number];

export const WORKSPACE_ENFORCEMENT_SOURCES = [
  "manual",
  "subscription_policy",
  "commercial_risk",
  "contract_expiry",
  "system_recommendation",
] as const;

export type WorkspaceEnforcementSource = (typeof WORKSPACE_ENFORCEMENT_SOURCES)[number];

export type WorkspaceWriteAction = "create" | "update" | "delete";

export interface WorkspaceAccessFlags {
  enforcementStatus: WorkspaceEnforcementStatus;
  allowLogin: boolean;
  allowRead: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  allowExport: boolean;
  allowAdminAccess: boolean;
}

export const NORMAL_ACCESS_FLAGS: WorkspaceAccessFlags = {
  enforcementStatus: "normal",
  allowLogin: true,
  allowRead: true,
  allowCreate: true,
  allowUpdate: true,
  allowDelete: true,
  allowExport: true,
  allowAdminAccess: true,
};

export const READ_ONLY_ACCESS_FLAGS: WorkspaceAccessFlags = {
  enforcementStatus: "read_only",
  allowLogin: true,
  allowRead: true,
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
  allowExport: true,
  allowAdminAccess: true,
};

export const SUSPENDED_VIEW_ONLY_FLAGS: WorkspaceAccessFlags = {
  enforcementStatus: "suspended_view_only",
  allowLogin: true,
  allowRead: true,
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
  allowExport: true,
  allowAdminAccess: true,
};

export const TERMINATED_VIEW_ONLY_FLAGS: WorkspaceAccessFlags = {
  enforcementStatus: "terminated_view_only",
  allowLogin: true,
  allowRead: true,
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
  allowExport: true,
  allowAdminAccess: false,
};

export function isWorkspaceEnforcementStatus(v: string): v is WorkspaceEnforcementStatus {
  return (WORKSPACE_ENFORCEMENT_STATUSES as readonly string[]).includes(v);
}

const READ_ONLY_ENFORCEMENT_STATUSES = new Set<WorkspaceEnforcementStatus>([
  "read_only",
  "suspended_view_only",
  "terminated_view_only",
  "restricted",
]);

export function isWorkspaceReadOnlyEnforcement(status: string): boolean {
  return READ_ONLY_ENFORCEMENT_STATUSES.has(status as WorkspaceEnforcementStatus);
}

export function isWorkspaceEnforcementSource(v: string): v is WorkspaceEnforcementSource {
  return (WORKSPACE_ENFORCEMENT_SOURCES as readonly string[]).includes(v);
}

export function flagsForEnforcementStatus(
  status: WorkspaceEnforcementStatus,
  opts?: { allowExport?: boolean; allowAdminAccess?: boolean },
): WorkspaceAccessFlags {
  switch (status) {
    case "normal":
      return { ...NORMAL_ACCESS_FLAGS };
    case "read_only":
      return {
        ...READ_ONLY_ACCESS_FLAGS,
        allowExport: opts?.allowExport ?? true,
        allowAdminAccess: opts?.allowAdminAccess ?? true,
      };
    case "suspended_view_only":
      return {
        ...SUSPENDED_VIEW_ONLY_FLAGS,
        allowExport: opts?.allowExport ?? true,
        allowAdminAccess: opts?.allowAdminAccess ?? true,
      };
    case "terminated_view_only":
      return {
        ...TERMINATED_VIEW_ONLY_FLAGS,
        allowExport: opts?.allowExport ?? true,
        allowAdminAccess: opts?.allowAdminAccess ?? false,
      };
    case "restricted":
      return {
        enforcementStatus: "restricted",
        allowLogin: true,
        allowRead: true,
        allowCreate: false,
        allowUpdate: false,
        allowDelete: false,
        allowExport: opts?.allowExport ?? false,
        allowAdminAccess: opts?.allowAdminAccess ?? true,
      };
    default:
      return { ...NORMAL_ACCESS_FLAGS };
  }
}

export function isReadOnlyEnforcementStatus(status: WorkspaceEnforcementStatus): boolean {
  return (
    status === "read_only" ||
    status === "suspended_view_only" ||
    status === "terminated_view_only" ||
    status === "restricted"
  );
}
