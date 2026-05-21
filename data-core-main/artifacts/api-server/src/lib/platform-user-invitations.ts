/**
 * @phase P17-E - Platform user invitation lifecycle
 */

import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, activityLogsTable, platformUserInvitationsTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  PLATFORM_INVITATION_ACTIVATION_PATH,
  PLATFORM_INVITATION_DEFAULT_EXPIRY_DAYS,
  REVOKE_REASON_MIN_LENGTH,
  SYSTEM_REVOKE_REASON_REPLACED,
  type PlatformInvitationStatus,
} from "./platform-user-invitation-config";
import {
  generatePlatformInvitationToken,
  hashPlatformInvitationToken,
  verifyPlatformInvitationToken,
} from "./platform-user-invitation-token";
import { isRootPlatformOwner, type PlatformUserIdentity } from "./root-platform-owner-policy";
import { isProtectedPlatformAdminUser, type PlatformUserProtectionContext } from "./platform-protected-user";

export interface PlatformInvitationPublicView {
  id: number;
  platformUserId: number;
  email: string;
  status: PlatformInvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedBy: number | null;
  revokeReason: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationResult {
  invitation: PlatformInvitationPublicView;
  activationToken: string;
  activationUrl: string;
}

export interface AcceptInvitationPayload {
  displayName?: string;
  password?: string;
  employeeNumber?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildActivationUrl(token: string): string {
  const base =
    process.env.PLATFORM_ACTIVATION_BASE_URL?.replace(/\/$/, "") ??
    process.env.OPS_PLATFORM_PUBLIC_URL?.replace(/\/$/, "") ??
    "";
  const path = `${PLATFORM_INVITATION_ACTIVATION_PATH}?token=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

function toPublicView(row: typeof platformUserInvitationsTable.$inferSelect): PlatformInvitationPublicView {
  return {
    id: row.id,
    platformUserId: row.platformUserId,
    email: row.email,
    status: row.status as PlatformInvitationStatus,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
    revokeReason: row.revokeReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function writeInvitationAudit(
  actorId: number | null,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(activityLogsTable).values({
    userId: actorId,
    action,
    metadata: JSON.stringify({
      ...metadata,
      timestamp: new Date().toISOString(),
    }),
    workspaceId: null,
  });
}

export async function getPlatformUserForInvitation(
  platformUserId: number,
): Promise<(PlatformUserProtectionContext & { email: string | null; fullName: string; status: string }) | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, platformUserId), isNull(usersTable.workspaceId)));
  return row ?? null;
}

export function canActorManageTargetInvitations(
  actor: PlatformUserIdentity,
  target: PlatformUserProtectionContext,
): { allowed: boolean; blockedReason?: string } {
  if (isRootPlatformOwner(target) && !isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "ROOT_OWNER_IMMUTABLE" };
  }
  if (isProtectedPlatformAdminUser(target) && !isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "PROTECTED_USER_REQUIRES_ROOT" };
  }
  return { allowed: true };
}

export async function expireInvitationIfNeeded(
  invitation: typeof platformUserInvitationsTable.$inferSelect,
): Promise<PlatformInvitationStatus> {
  if (invitation.status !== "pending") {
    return invitation.status as PlatformInvitationStatus;
  }
  if (invitation.expiresAt.getTime() > Date.now()) {
    return "pending";
  }
  await db
    .update(platformUserInvitationsTable)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(platformUserInvitationsTable.id, invitation.id));
  await writeInvitationAudit(null, "platform_user_invitation_expired", {
    invitationId: invitation.id,
    targetPlatformUserId: invitation.platformUserId,
    email: invitation.email,
    status: "expired",
    expiresAt: invitation.expiresAt.toISOString(),
  });
  return "expired";
}

async function revokePendingInvitationsForUser(
  platformUserId: number,
  actorId: number,
  reason: string,
): Promise<void> {
  const pending = await db
    .select()
    .from(platformUserInvitationsTable)
    .where(
      and(
        eq(platformUserInvitationsTable.platformUserId, platformUserId),
        eq(platformUserInvitationsTable.status, "pending"),
      ),
    );

  const now = new Date();
  for (const inv of pending) {
    await db
      .update(platformUserInvitationsTable)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedBy: actorId,
        revokeReason: reason,
        updatedAt: now,
      })
      .where(eq(platformUserInvitationsTable.id, inv.id));

    await writeInvitationAudit(actorId, "platform_user_invitation_revoked", {
      invitationId: inv.id,
      targetPlatformUserId: platformUserId,
      email: inv.email,
      status: "revoked",
      reason,
      expiresAt: inv.expiresAt.toISOString(),
    });
  }
}

async function insertPendingInvitation(
  platformUserId: number,
  email: string,
  actorId: number,
  expiryDays: number,
): Promise<{ row: typeof platformUserInvitationsTable.$inferSelect; token: string }> {
  const token = generatePlatformInvitationToken();
  const tokenHash = hashPlatformInvitationToken(token);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(platformUserInvitationsTable)
    .values({
      platformUserId,
      email: normalizeEmail(email),
      tokenHash,
      status: "pending",
      expiresAt,
      createdBy: actorId,
    })
    .returning();

  if (!row) throw new Error("Failed to create invitation");

  return { row, token };
}

export async function createPlatformUserInvitation(
  platformUserId: number,
  actorId: number,
  expiryDays: number = PLATFORM_INVITATION_DEFAULT_EXPIRY_DAYS,
): Promise<CreateInvitationResult> {
  const target = await getPlatformUserForInvitation(platformUserId);
  if (!target) throw new InvitationError("PLATFORM_USER_NOT_FOUND", "Platform user not found");

  const actor = await getPlatformUserForInvitation(actorId);
  if (!actor) throw new InvitationError("ACTOR_NOT_FOUND", "Actor not found");

  const manage = canActorManageTargetInvitations(actor, target);
  if (!manage.allowed) {
    await writeInvitationAudit(actorId, "platform_user_invitation_blocked", {
      targetPlatformUserId: platformUserId,
      blockedReason: manage.blockedReason,
      action: "create",
    });
    throw new InvitationError(manage.blockedReason ?? "INVITATION_BLOCKED", "Invitation blocked by policy");
  }

  if (!target.email) {
    throw new InvitationError("MISSING_EMAIL", "Platform user must have an email for invitation");
  }

  if (target.status !== "invited") {
    throw new InvitationError("USER_NOT_INVITED_STATUS", "User must be in invited status to receive an invitation");
  }

  await revokePendingInvitationsForUser(platformUserId, actorId, SYSTEM_REVOKE_REASON_REPLACED);

  const { row, token } = await insertPendingInvitation(platformUserId, target.email, actorId, expiryDays);

  await writeInvitationAudit(actorId, "platform_user_invitation_created", {
    invitationId: row.id,
    targetPlatformUserId: platformUserId,
    email: row.email,
    status: "pending",
    expiresAt: row.expiresAt.toISOString(),
  });

  return {
    invitation: toPublicView(row),
    activationToken: token,
    activationUrl: buildActivationUrl(token),
  };
}

export async function resendPlatformUserInvitation(
  platformUserId: number,
  actorId: number,
  expiryDays: number = PLATFORM_INVITATION_DEFAULT_EXPIRY_DAYS,
): Promise<CreateInvitationResult> {
  const result = await createPlatformUserInvitation(platformUserId, actorId, expiryDays);
  await writeInvitationAudit(actorId, "platform_user_invitation_resent", {
    invitationId: result.invitation.id,
    targetPlatformUserId: platformUserId,
    email: result.invitation.email,
    status: "pending",
    expiresAt: result.invitation.expiresAt,
  });
  return result;
}

export async function revokePlatformUserInvitation(
  invitationId: number,
  actorId: number,
  reason: string,
): Promise<PlatformInvitationPublicView> {
  if (!reason || reason.trim().length < REVOKE_REASON_MIN_LENGTH) {
    throw new InvitationError("REASON_TOO_SHORT", "Revoke reason is required");
  }

  const [invitation] = await db
    .select()
    .from(platformUserInvitationsTable)
    .where(eq(platformUserInvitationsTable.id, invitationId));

  if (!invitation) throw new InvitationError("INVITATION_NOT_FOUND", "Invitation not found");

  const target = await getPlatformUserForInvitation(invitation.platformUserId);
  const actor = await getPlatformUserForInvitation(actorId);
  if (!target || !actor) throw new InvitationError("NOT_FOUND", "User not found");

  const manage = canActorManageTargetInvitations(actor, target);
  if (!manage.allowed) {
    await writeInvitationAudit(actorId, "platform_user_invitation_blocked", {
      invitationId,
      targetPlatformUserId: invitation.platformUserId,
      blockedReason: manage.blockedReason,
      action: "revoke",
    });
    throw new InvitationError(manage.blockedReason ?? "INVITATION_BLOCKED", "Revoke blocked by policy");
  }

  const effectiveStatus = await expireInvitationIfNeeded(invitation);
  if (effectiveStatus === "accepted") {
    throw new InvitationError("INVITATION_ALREADY_ACCEPTED", "Cannot revoke an accepted invitation");
  }

  const now = new Date();
  const [updated] = await db
    .update(platformUserInvitationsTable)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedBy: actorId,
      revokeReason: reason.trim(),
      updatedAt: now,
    })
    .where(eq(platformUserInvitationsTable.id, invitationId))
    .returning();

  await writeInvitationAudit(actorId, "platform_user_invitation_revoked", {
    invitationId,
    targetPlatformUserId: invitation.platformUserId,
    email: invitation.email,
    status: "revoked",
    reason: reason.trim(),
    expiresAt: invitation.expiresAt.toISOString(),
  });

  return toPublicView(updated!);
}

export async function listPlatformUserInvitations(
  platformUserId: number,
): Promise<PlatformInvitationPublicView[]> {
  const rows = await db
    .select()
    .from(platformUserInvitationsTable)
    .where(eq(platformUserInvitationsTable.platformUserId, platformUserId))
    .orderBy(desc(platformUserInvitationsTable.createdAt));

  const result: PlatformInvitationPublicView[] = [];
  for (const row of rows) {
    const status = await expireInvitationIfNeeded(row);
    result.push(toPublicView({ ...row, status }));
  }
  return result;
}

export async function findInvitationByToken(token: string) {
  const hash = hashPlatformInvitationToken(token);
  const [row] = await db
    .select()
    .from(platformUserInvitationsTable)
    .where(eq(platformUserInvitationsTable.tokenHash, hash));
  if (!row) return null;
  const status = await expireInvitationIfNeeded(row);
  return { ...row, status };
}

export async function verifyPlatformInvitation(token: string) {
  const invitation = await findInvitationByToken(token);
  if (!invitation) {
    return { valid: false, status: "invalid" as const, email: null, expiresAt: null };
  }

  if (invitation.status === "pending" && verifyPlatformInvitationToken(token, invitation.tokenHash)) {
    const target = await getPlatformUserForInvitation(invitation.platformUserId);
    return {
      valid: true,
      status: invitation.status,
      email: maskEmail(invitation.email),
      emailFull: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      displayName: target?.fullName ?? null,
    };
  }

  return {
    valid: false,
    status: invitation.status,
    email: maskEmail(invitation.email),
    emailFull: null,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "***";
  const visible = local.length <= 2 ? "*" : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export async function acceptPlatformUserInvitation(
  token: string,
  payload: AcceptInvitationPayload,
): Promise<{ userId: number; invitationId: number }> {
  const invitation = await findInvitationByToken(token);
  if (!invitation || !verifyPlatformInvitationToken(token, invitation.tokenHash)) {
    await writeInvitationAudit(null, "platform_user_invitation_blocked", {
      blockedReason: "INVALID_TOKEN",
      action: "accept",
    });
    throw new InvitationError("INVALID_TOKEN", "Invalid invitation token");
  }

  if (invitation.status === "accepted") {
    throw new InvitationError("INVITATION_ALREADY_ACCEPTED", "Invitation already accepted");
  }
  if (invitation.status === "revoked") {
    throw new InvitationError("INVITATION_REVOKED", "Invitation has been revoked");
  }
  if (invitation.status === "expired") {
    throw new InvitationError("INVITATION_EXPIRED", "Invitation has expired");
  }
  if (invitation.status !== "pending") {
    throw new InvitationError("INVITATION_NOT_PENDING", "Invitation is not pending");
  }

  const target = await getPlatformUserForInvitation(invitation.platformUserId);
  if (!target) throw new InvitationError("PLATFORM_USER_NOT_FOUND", "Platform user not found");

  if (target.status === "disabled" || target.status === "suspended" || target.status === "locked") {
    await writeInvitationAudit(null, "platform_user_invitation_blocked", {
      invitationId: invitation.id,
      targetPlatformUserId: invitation.platformUserId,
      blockedReason: "USER_STATUS_BLOCKED",
      action: "accept",
    });
    throw new InvitationError("USER_STATUS_BLOCKED", "Cannot activate a disabled or suspended account");
  }

  if (target.status !== "invited" && target.status !== "active") {
    throw new InvitationError("USER_NOT_ELIGIBLE", "User is not eligible for activation");
  }

  const password = payload.password?.trim();
  if (!password || password.length < 8) {
    throw new InvitationError("PASSWORD_REQUIRED", "Password is required (minimum 8 characters)");
  }

  const empNum =
    payload.employeeNumber?.trim().toUpperCase() ??
    `PU${invitation.platformUserId}`;

  const [empConflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.employeeNumber, empNum));
  if (empConflict && empConflict.id !== invitation.platformUserId) {
    throw new InvitationError("EMPLOYEE_NUMBER_IN_USE", "Employee number already in use");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  await db
    .update(usersTable)
    .set({
      status: "active",
      fullName: payload.displayName?.trim() || target.fullName,
      employeeNumber: empNum,
      passwordHash,
      mustResetPassword: false,
      updatedAt: now,
    })
    .where(eq(usersTable.id, invitation.platformUserId));

  await db
    .update(platformUserInvitationsTable)
    .set({
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
    })
    .where(eq(platformUserInvitationsTable.id, invitation.id));

  await writeInvitationAudit(null, "platform_user_invitation_accepted", {
    invitationId: invitation.id,
    targetPlatformUserId: invitation.platformUserId,
    email: invitation.email,
    status: "accepted",
    expiresAt: invitation.expiresAt.toISOString(),
  });

  return { userId: invitation.platformUserId, invitationId: invitation.id };
}

export class InvitationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}
