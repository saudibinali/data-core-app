/**
 * P23-A — Workspace lifecycle execution (non-destructive; uses existing status model)
 */
import { db } from "@workspace/db";
import {
  workspacesTable,
  usersTable,
  activityLogsTable,
  workspaceLifecycleEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  deriveLifecycleState,
  validateLifecycleRequest,
  lifecycleStateToDbStatus,
  LIFECYCLE_ACTION_MODEL,
  buildLifecycleAuditPayload,
  type LifecycleRequest,
} from "../workspace-lifecycle";
import { platformGovernanceAuditService } from "./platform-governance-audit-service";
export type LifecycleTransitionBody = {
  action?: string;
  reason?: string;
  internalNote?: string;
  confirmation?: unknown;
};

export class WorkspaceLifecycleService {
  async executePlatformLifecycleTransition(input: {
    workspaceId: number;
    actorUserId: number;
    body: LifecycleTransitionBody;
    tenantIdString: string;
  }) {
    const { workspaceId, actorUserId, body, tenantIdString } = input;
    const now = new Date();

    const [workspace] = await db
      .select({
        id: workspacesTable.id,
        name: workspacesTable.name,
        slug: workspacesTable.slug,
        status: workspacesTable.status,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));

    if (!workspace) throw new Error("Tenant not found");

    const currentState = deriveLifecycleState(workspace.status);

    const request: LifecycleRequest = {
      action: String(body.action ?? ""),
      reason: String(body.reason ?? ""),
      confirmation: body.confirmation === true,
      internalNote: body.internalNote ? String(body.internalNote) : undefined,
    };

    const validation = validateLifecycleRequest(request, currentState);
    if (!validation.valid) {
      const err = new Error(validation.error) as Error & { code?: string };
      err.code = validation.code;
      throw err;
    }

    const action = validation.action;
    const targetState = LIFECYCLE_ACTION_MODEL[action].targetState;
    const newDbStatus = lifecycleStateToDbStatus(targetState);

    await db
      .update(workspacesTable)
      .set({ status: newDbStatus })
      .where(eq(workspacesTable.id, workspaceId));

    const auditPayload = buildLifecycleAuditPayload({
      tenantId: tenantIdString,
      workspaceId,
      actorId: actorUserId,
      action,
      previousState: currentState,
      targetState,
      reason: request.reason.trim(),
      internalNote: request.internalNote ?? null,
      now,
    });

    await db.insert(activityLogsTable).values({
      userId: actorUserId,
      workspaceId,
      action: auditPayload.eventType,
      metadata: JSON.stringify({
        action: auditPayload.action,
        previousState: auditPayload.previousState,
        targetState: auditPayload.targetState,
        reason: auditPayload.reason,
        internalNote: auditPayload.internalNote,
        tenantId: auditPayload.tenantId,
      }),
    });

    await db.insert(workspaceLifecycleEventsTable).values({
      workspaceId,
      actorUserId,
      action,
      previousStatus: workspace.status,
      newStatus: newDbStatus,
      reason: request.reason.trim(),
      metadataJson: JSON.stringify({ internalNote: request.internalNote ?? null }),
    });

    await platformGovernanceAuditService.log({
      workspaceId,
      actorUserId,
      scope: "platform",
      action: auditPayload.eventType,
      resourceType: "workspace",
      resourceId: workspaceId,
      metadata: { lifecycle: auditPayload },
    });

    return {
      auditPayload,
      newDbStatus,
      workspace: { ...workspace, status: newDbStatus, updatedAt: now },
    };
  }

  async getWorkspaceAdminContact(workspaceId: number) {
    const [owner] = await db
      .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(and(eq(usersTable.workspaceId, workspaceId), eq(usersTable.role, "admin")))
      .limit(1);
    return owner ?? null;
  }
}

export const workspaceLifecycleService = new WorkspaceLifecycleService();
