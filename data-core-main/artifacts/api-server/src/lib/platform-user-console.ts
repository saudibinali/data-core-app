/**
 * @phase P17-F - Platform user console read-only aggregations
 */

import { db } from "@workspace/db";
import {
  platformUserInvitationsTable,
  platformUserPermissionOverridesTable,
  platformUserAccessReviewsTable,
} from "@workspace/db";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { buildPlatformAccessReviewSummary, buildPlatformUserAccessReview, queryPlatformAccessAuditEvents } from "./platform-access-review";
import { getProtectionReasons } from "./platform-protected-user";
import { getSafePolicySnapshot } from "./platform-admin-protection-policy-config";
import { isProtectedPlatformAdminUser } from "./platform-protected-user";
import { isRootPlatformOwner } from "./root-platform-owner-policy";
import { listPlatformUserInvitations } from "./platform-user-invitations";
import {
  computeEffectivePermissionsFromRoleAndOverrides,
  loadActiveOverridesForUser,
} from "./platform-effective-permissions";
import { getPlatformUserRoleCode } from "./platform-permissions";
import { usersTable } from "@workspace/db";

export interface PlatformUserDirectoryRow {
  userId: string;
  customOverridesCount: number;
  riskLevel: string | null;
  invitationStatus: string | null;
  lastReviewedAt: string | null;
}

export interface PlatformUsersConsoleSummary {
  totalPlatformUsers: number;
  active: number;
  invited: number;
  suspendedDisabled: number;
  protectedUsers: number;
  usersWithCustomOverrides: number;
  pendingInvitations: number;
  highRiskUsers: number;
  directory: PlatformUserDirectoryRow[];
  generatedAt: string;
}

export interface PlatformUserConsoleDetail {
  profile: Record<string, unknown>;
  permissionSummary: {
    rolePermissions: string[];
    grantedOverrides: string[];
    deniedOverrides: string[];
    effectivePermissions: string[];
    customOverridesCount: number;
    restrictedByProtection: boolean;
  };
  protectionSummary: {
    protectionReasons: string[];
    policySnapshot: Record<string, unknown>;
    blockedActions: Array<{ action: string; blockedReason: string }>;
  };
  invitationSummary: {
    latestStatus: string | null;
    pendingCount: number;
    invitations: Array<{
      id: number;
      status: string;
      expiresAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }>;
  };
  accessReviewSummary: {
    riskLevel: string;
    criticalPermissions: string[];
    reviewStatus: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
  } | null;
  recentAuditEvents: Array<{
    id: number;
    action: string;
    actionLabel: string;
    severity: string;
    result: string | null;
    blockedReason: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
}

export async function buildPlatformUsersConsoleSummary(): Promise<PlatformUsersConsoleSummary> {
  const review = await buildPlatformAccessReviewSummary();

  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(platformUserInvitationsTable)
    .where(eq(platformUserInvitationsTable.status, "pending"));

  const platformUsers = await db
    .select({ id: usersTable.id, status: usersTable.status })
    .from(usersTable)
    .where(isNull(usersTable.workspaceId));

  const invited = platformUsers.filter((u) => u.status === "invited").length;
  const active = platformUsers.filter((u) => u.status === "active").length;
  const suspendedDisabled = platformUsers.filter((u) =>
    ["disabled", "suspended", "locked"].includes(u.status),
  ).length;

  const riskByUser = new Map<string, string>();
  for (const row of [...review.highRiskUsers, ...review.staleUsers]) {
    riskByUser.set(row.userId, row.riskLevel);
  }

  const overrideCounts = await db
    .select({
      userId: platformUserPermissionOverridesTable.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(platformUserPermissionOverridesTable)
    .groupBy(platformUserPermissionOverridesTable.userId);

  const overrideMap = new Map(overrideCounts.map((r) => [String(r.userId), r.count]));

  const latestInvitations = await db
    .select()
    .from(platformUserInvitationsTable)
    .orderBy(desc(platformUserInvitationsTable.createdAt));

  const invitationByUser = new Map<number, string>();
  for (const inv of latestInvitations) {
    if (!invitationByUser.has(inv.platformUserId)) {
      invitationByUser.set(inv.platformUserId, inv.status);
    }
  }

  const reviews = await db
    .select()
    .from(platformUserAccessReviewsTable)
    .orderBy(desc(platformUserAccessReviewsTable.reviewedAt));

  const reviewByUser = new Map<number, string>();
  for (const r of reviews) {
    if (!reviewByUser.has(r.platformUserId) && r.reviewedAt) {
      reviewByUser.set(r.platformUserId, r.reviewedAt.toISOString());
    }
  }

  const directory: PlatformUserDirectoryRow[] = platformUsers.map((u) => ({
    userId: String(u.id),
    customOverridesCount: overrideMap.get(String(u.id)) ?? 0,
    riskLevel: riskByUser.get(String(u.id)) ?? null,
    invitationStatus: invitationByUser.get(u.id) ?? null,
    lastReviewedAt: reviewByUser.get(u.id) ?? null,
  }));

  return {
    totalPlatformUsers: review.totalPlatformUsers,
    active,
    invited,
    suspendedDisabled,
    protectedUsers: review.protectedUsers,
    usersWithCustomOverrides: review.usersWithCustomOverrides,
    pendingInvitations: pendingRow?.count ?? 0,
    highRiskUsers: review.highRiskUsers.length,
    directory,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildPlatformUserConsole(userId: number): Promise<PlatformUserConsoleDetail | null> {
  const accessReview = await buildPlatformUserAccessReview(userId);
  if (!accessReview) return null;

  const invitations = await listPlatformUserInvitations(userId);
  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const latestStatus = invitations[0]?.status ?? null;

  const overrides = await loadActiveOverridesForUser(userId);
  const roleCode = getPlatformUserRoleCode({
    id: userId,
    role: "super_admin",
    workspaceId: null,
    platformRoleCode: accessReview.user.roleCode,
    isRootOwner: accessReview.user.isRootOwner,
    isProtected: accessReview.user.isProtected,
    platformUserType: accessReview.user.userType,
    status: accessReview.user.status,
  });
  const effective = computeEffectivePermissionsFromRoleAndOverrides(roleCode, overrides);

  const protectionCtx = {
    id: userId,
    email: accessReview.user.email,
    role: "super_admin",
    workspaceId: null,
    platformRoleCode: accessReview.user.roleCode,
    isRootOwner: accessReview.user.isRootOwner,
    isProtected: accessReview.user.isProtected,
    platformUserType: accessReview.user.userType,
    status: accessReview.user.status,
  };

  const blockedActions: Array<{ action: string; blockedReason: string }> = [];
  if (isRootPlatformOwner(protectionCtx)) {
    blockedActions.push(
      { action: "disable_user", blockedReason: "ROOT_OWNER_IMMUTABLE" },
      { action: "change_role", blockedReason: "ROOT_OWNER_IMMUTABLE" },
      { action: "update_permission_override", blockedReason: "ROOT_OWNER_IMMUTABLE" },
    );
  } else if (isProtectedPlatformAdminUser(protectionCtx)) {
    blockedActions.push(
      { action: "disable_user", blockedReason: "PROTECTED_USER_REQUIRES_ROOT" },
      { action: "change_role", blockedReason: "PROTECTED_USER_REQUIRES_ROOT" },
      { action: "update_permission_override", blockedReason: "PROTECTED_USER_REQUIRES_ROOT" },
    );
  }

  const audit = await queryPlatformAccessAuditEvents({
    userId,
    page: 1,
    pageSize: 15,
  });

  return {
    profile: {
      ...accessReview.user,
      lastLoginAt: accessReview.lastLoginAt,
      createdAt: accessReview.createdAt,
      lastPermissionChangeAt: accessReview.lastPermissionChangeAt,
      lastStatusChangeAt: accessReview.lastStatusChangeAt,
    },
    permissionSummary: {
      rolePermissions: [...accessReview.rolePermissions],
      grantedOverrides: [...accessReview.grantedOverrides],
      deniedOverrides: [...accessReview.deniedOverrides],
      effectivePermissions: [...effective],
      customOverridesCount: accessReview.grantedOverrides.length + accessReview.deniedOverrides.length,
      restrictedByProtection: accessReview.user.isProtected || accessReview.user.isRootOwner,
    },
    protectionSummary: {
      protectionReasons: getProtectionReasons(protectionCtx),
      policySnapshot: getSafePolicySnapshot(),
      blockedActions,
    },
    invitationSummary: {
      latestStatus,
      pendingCount,
      invitations: invitations.map((i) => ({
        id: i.id,
        status: i.status,
        expiresAt: i.expiresAt,
        acceptedAt: i.acceptedAt,
        revokedAt: i.revokedAt,
      })),
    },
    accessReviewSummary: {
      riskLevel: accessReview.riskLevel,
      criticalPermissions: [...accessReview.criticalPermissions],
      reviewStatus: accessReview.reviewStatus,
      reviewedAt: accessReview.reviewedAt,
      reviewNotes: accessReview.reviewNotes,
    },
    recentAuditEvents: audit.events.map((e) => ({
      id: e.id,
      action: e.action,
      actionLabel: e.actionLabel,
      severity: e.severity,
      result: e.result,
      blockedReason: e.blockedReason,
      reason: e.reason,
      createdAt: e.createdAt,
    })),
    generatedAt: new Date().toISOString(),
  };
}
