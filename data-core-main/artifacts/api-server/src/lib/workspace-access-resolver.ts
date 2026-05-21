/**
 * @file   workspace-access-resolver.ts
 * @phase  P16-E - Resolve workspace access mode and assert writes
 */

import { db } from "@workspace/db";
import {
  workspaceAccessEnforcementTable,
  workspaceSubscriptionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  NORMAL_ACCESS_FLAGS,
  type WorkspaceAccessFlags,
  type WorkspaceEnforcementStatus,
  type WorkspaceWriteAction,
  isWorkspaceEnforcementStatus,
  flagsForEnforcementStatus,
} from "./workspace-access-enforcement-config";

export interface ResolvedWorkspaceAccessMode {
  workspaceId: number;
  tenantId: number;
  enforcementStatus: WorkspaceEnforcementStatus;
  allowLogin: boolean;
  allowRead: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  allowExport: boolean;
  allowAdminAccess: boolean;
  reason: string | null;
  source: string | null;
  subscriptionId: number | null;
  subscriptionStatus: string | null;
  appliedBy: number | null;
  appliedAt: string | null;
  expiresAt: string | null;
  enforcementId: number | null;
  policy: null;
  isDefault: boolean;
}

export class WorkspaceWriteBlockedError extends Error {
  readonly code = "WORKSPACE_READ_ONLY";
  readonly workspaceId: number;
  readonly action: WorkspaceWriteAction;
  readonly enforcementStatus: WorkspaceEnforcementStatus;

  constructor(
    workspaceId: number,
    action: WorkspaceWriteAction,
    enforcementStatus: WorkspaceEnforcementStatus,
    message?: string,
  ) {
    super(
      message ??
        "Workspace is in read-only mode due to subscription status.",
    );
    this.name = "WorkspaceWriteBlockedError";
    this.workspaceId = workspaceId;
    this.action = action;
    this.enforcementStatus = enforcementStatus;
  }
}

function serializeRow(
  workspaceId: number,
  row: typeof workspaceAccessEnforcementTable.$inferSelect,
  subscriptionStatus: string | null,
): ResolvedWorkspaceAccessMode {
  const status = isWorkspaceEnforcementStatus(row.enforcementStatus)
    ? row.enforcementStatus
    : "normal";

  return {
    workspaceId,
    tenantId: workspaceId,
    enforcementId: row.id,
    enforcementStatus: status,
    allowLogin: row.allowLogin,
    allowRead: row.allowRead,
    allowCreate: row.allowCreate,
    allowUpdate: row.allowUpdate,
    allowDelete: row.allowDelete,
    allowExport: row.allowExport,
    allowAdminAccess: row.allowAdminAccess,
    reason: row.enforcementReason,
    source: row.source,
    subscriptionId: row.subscriptionId,
    subscriptionStatus,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    policy: null,
    isDefault: false,
  };
}

function defaultMode(workspaceId: number, subscriptionStatus: string | null): ResolvedWorkspaceAccessMode {
  return {
    workspaceId,
    tenantId: workspaceId,
    enforcementId: null,
    ...NORMAL_ACCESS_FLAGS,
    reason: null,
    source: null,
    subscriptionId: null,
    subscriptionStatus,
    appliedBy: null,
    appliedAt: null,
    expiresAt: null,
    policy: null,
    isDefault: true,
  };
}

export async function resolveWorkspaceAccessMode(
  workspaceId: number,
): Promise<ResolvedWorkspaceAccessMode> {
  const sub = await db.query.workspaceSubscriptionsTable.findFirst({
    where: eq(workspaceSubscriptionsTable.workspaceId, workspaceId),
  });
  const subscriptionStatus = sub?.status ?? null;

  const row = await db.query.workspaceAccessEnforcementTable.findFirst({
    where: eq(workspaceAccessEnforcementTable.workspaceId, workspaceId),
  });

  if (!row) {
    return defaultMode(workspaceId, subscriptionStatus);
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return defaultMode(workspaceId, subscriptionStatus);
  }

  return serializeRow(workspaceId, row, subscriptionStatus);
}

export function canPerformWriteAction(
  mode: ResolvedWorkspaceAccessMode,
  action: WorkspaceWriteAction,
): boolean {
  switch (action) {
    case "create":
      return mode.allowCreate;
    case "update":
      return mode.allowUpdate;
    case "delete":
      return mode.allowDelete;
    default:
      return false;
  }
}

export async function assertWorkspaceCanWrite(
  workspaceId: number,
  action: WorkspaceWriteAction,
): Promise<ResolvedWorkspaceAccessMode> {
  const mode = await resolveWorkspaceAccessMode(workspaceId);
  if (!canPerformWriteAction(mode, action)) {
    throw new WorkspaceWriteBlockedError(workspaceId, action, mode.enforcementStatus);
  }
  return mode;
}

export function buildAccessFlagsFromStatus(
  status: WorkspaceEnforcementStatus,
  policyOpts?: { allowExport?: boolean; allowAdminAccess?: boolean },
): WorkspaceAccessFlags {
  return flagsForEnforcementStatus(status, policyOpts);
}
