/**
 * P23-A — Support impersonation governance (scoped sessions, no unrestricted access)
 */
import { db } from "@workspace/db";
import { supportImpersonationSessionsTable, usersTable, workspacesTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { platformGovernanceAuditService } from "./platform-governance-audit-service";

const ALLOWED_SCOPES = new Set(["read_tickets", "read_users", "read_audit", "read_billing"]);

const MAX_SESSION_MINUTES = 60;

export class SupportGovernanceService {
  async startSession(input: {
    actorUserId: number;
    targetWorkspaceId: number;
    targetUserId: number;
    scopes: string[];
    breakGlass?: boolean;
    consentReference?: string;
  }) {
    if (input.scopes.length === 0 || input.scopes.length > 8) {
      throw new Error("Between 1 and 8 scopes required");
    }
    for (const s of input.scopes) {
      if (!ALLOWED_SCOPES.has(s)) {
        throw new Error(`Scope not allowed for support session: ${s}`);
      }
    }

    const [actor] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, input.actorUserId))
      .limit(1);
    if (!actor || actor.role !== "super_admin") {
      throw new Error("Support sessions require super_admin actor");
    }

    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, input.targetUserId),
          eq(usersTable.workspaceId, input.targetWorkspaceId),
        ),
      )
      .limit(1);
    if (!targetUser) throw new Error("Target user not in workspace");

    const [ws] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, input.targetWorkspaceId))
      .limit(1);
    if (!ws) throw new Error("Workspace not found");

    const active = await db
      .select({ id: supportImpersonationSessionsTable.id })
      .from(supportImpersonationSessionsTable)
      .where(
        and(
          eq(supportImpersonationSessionsTable.actorUserId, input.actorUserId),
          eq(supportImpersonationSessionsTable.status, "active"),
          gt(supportImpersonationSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (active[0]) {
      throw new Error("Actor already has an active support session");
    }

    const expiresAt = new Date(Date.now() + MAX_SESSION_MINUTES * 60 * 1000);

    const [session] = await db
      .insert(supportImpersonationSessionsTable)
      .values({
        actorUserId: input.actorUserId,
        targetWorkspaceId: input.targetWorkspaceId,
        targetUserId: input.targetUserId,
        scopesJson: JSON.stringify(input.scopes),
        breakGlass: input.breakGlass ?? false,
        consentReference: input.consentReference ?? null,
        status: "active",
        expiresAt,
        metadataJson: JSON.stringify({ maxMinutes: MAX_SESSION_MINUTES }),
      })
      .returning();

    await platformGovernanceAuditService.log({
      workspaceId: input.targetWorkspaceId,
      actorUserId: input.actorUserId,
      scope: "support",
      action: "support_impersonation_start",
      resourceType: "support_impersonation_session",
      resourceId: session!.id,
      metadata: {
        scopes: input.scopes,
        breakGlass: input.breakGlass ?? false,
        consentReference: input.consentReference ?? null,
      },
    });

    return session!;
  }

  async endSession(sessionId: number, actorUserId: number) {
    const [row] = await db
      .update(supportImpersonationSessionsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(
        and(
          eq(supportImpersonationSessionsTable.id, sessionId),
          eq(supportImpersonationSessionsTable.actorUserId, actorUserId),
          eq(supportImpersonationSessionsTable.status, "active"),
        ),
      )
      .returning();

    if (!row) throw new Error("Session not found or not owned by actor");

    await platformGovernanceAuditService.log({
      workspaceId: row.targetWorkspaceId,
      actorUserId,
      scope: "support",
      action: "support_impersonation_end",
      resourceType: "support_impersonation_session",
      resourceId: sessionId,
      metadata: {},
    });

    return row;
  }

  async listActiveForActor(actorUserId: number) {
    return db
      .select()
      .from(supportImpersonationSessionsTable)
      .where(
        and(
          eq(supportImpersonationSessionsTable.actorUserId, actorUserId),
          eq(supportImpersonationSessionsTable.status, "active"),
          gt(supportImpersonationSessionsTable.expiresAt, new Date()),
        ),
      );
  }
}

export const supportGovernanceService = new SupportGovernanceService();
