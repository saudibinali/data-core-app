/**
 * @phase P17-D - Platform access review & audit resolvers
 */

import { db } from "@workspace/db";
import {
  usersTable,
  activityLogsTable,
  platformUserPermissionOverridesTable,
  platformUserAccessReviewsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  ACCESS_REVIEW_AUDIT_ACTIONS,
  ACCESS_REVIEW_RECENCY_DAYS,
  SENSITIVE_EFFECTIVE_PERMISSION_CODES,
  STALE_SENSITIVE_LOGIN_DAYS,
  type AccessReviewRiskLevel,
  type AccessReviewStatus,
} from "./platform-access-review-config";
import { isCriticalPlatformPermission } from "./platform-admin-protection-policy-config";
import {
  computeEffectivePermissionsFromRoleAndOverrides,
  loadActiveOverridesForUser,
  type PlatformPermissionOverrideRow,
} from "./platform-effective-permissions";
import { isRootPlatformOwner } from "./root-platform-owner-policy";
import { isPlatformOwnerAccount } from "./platform-user-lifecycle";
import {
  getProtectionReasons,
  isProtectedPlatformAdminUser,
  type PlatformUserProtectionContext,
} from "./platform-protected-user";
import {
  getPlatformUserRoleCode,
  type PlatformPermissionCode,
} from "./platform-permissions";
import { enrichRow, parseLimit, parseDate } from "./platform-activity-helpers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface HighRiskUserSummary {
  userId: string;
  displayName: string;
  email: string | null;
  userType: string | null;
  roleCode: string;
  status: string;
  riskLevel: AccessReviewRiskLevel;
  protectionReasons: string[];
  criticalPermissionsCount: number;
  customOverridesCount: number;
  lastLoginAt: string | null;
  lastPermissionChangeAt: string | null;
  lastStatusChangeAt: string | null;
}

export interface PlatformAccessReviewSummary {
  totalPlatformUsers: number;
  activeUsers: number;
  disabledUsers: number;
  suspendedUsers: number;
  rootOwners: number;
  platformOwners: number;
  protectedUsers: number;
  usersWithCustomOverrides: number;
  usersWithCustomGrants: number;
  usersWithCustomDenies: number;
  usersWithCriticalPermissions: number;
  usersMissingRecentReview: number;
  highRiskUsers: HighRiskUserSummary[];
  staleUsers: HighRiskUserSummary[];
  generatedAt: string;
}

interface PlatformUserRow {
  id: number;
  email: string | null;
  fullName: string;
  role: string;
  status: string;
  workspaceId: number | null;
  platformRoleCode: string | null;
  isRootOwner: boolean;
  isProtected: boolean;
  platformUserType: string | null;
  lastLoginAt: Date | null;
  platformDisabledAt: Date | null;
  platformReactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toProtectionContext(row: PlatformUserRow): PlatformUserProtectionContext {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    workspaceId: row.workspaceId,
    platformRoleCode: row.platformRoleCode,
    isRootOwner: row.isRootOwner,
    isProtected: row.isProtected,
    platformUserType: row.platformUserType,
    status: row.status,
  };
}

function lastStatusChangeAt(row: PlatformUserRow): Date | null {
  const dates = [row.platformDisabledAt, row.platformReactivatedAt].filter(Boolean) as Date[];
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}

function hasSensitiveEffectivePermissions(effective: readonly PlatformPermissionCode[]): boolean {
  return SENSITIVE_EFFECTIVE_PERMISSION_CODES.some((c) => effective.includes(c));
}

function countCriticalInEffective(effective: readonly PlatformPermissionCode[]): number {
  return effective.filter((c) => isCriticalPlatformPermission(c)).length;
}

function isStaleSensitiveLogin(lastLoginAt: Date | null, hasSensitive: boolean, now: Date): boolean {
  if (!hasSensitive) return false;
  if (!lastLoginAt) return true;
  return now.getTime() - lastLoginAt.getTime() > STALE_SENSITIVE_LOGIN_DAYS * MS_PER_DAY;
}

export function computeUserRiskLevel(params: {
  user: PlatformUserProtectionContext;
  effective: readonly PlatformPermissionCode[];
  grantedOverrides: readonly PlatformPermissionCode[];
  deniedOverrides: readonly PlatformPermissionCode[];
  isStaleSensitive: boolean;
}): AccessReviewRiskLevel {
  const { user, effective, grantedOverrides, deniedOverrides, isStaleSensitive } = params;

  if (isRootPlatformOwner(user)) return "critical";
  if (effective.includes("platform.permissions.update")) return "critical";

  const criticalGrant = grantedOverrides.some((c) => isCriticalPlatformPermission(c));
  const criticalDeny = deniedOverrides.some((c) => isCriticalPlatformPermission(c));

  if (
    isProtectedPlatformAdminUser(user) ||
    hasSensitiveEffectivePermissions(effective) ||
    criticalGrant ||
    criticalDeny ||
    isStaleSensitive
  ) {
    return "high";
  }

  if (grantedOverrides.length > 0 || deniedOverrides.length > 0) {
    return "medium";
  }

  return "low";
}

function isHighOrCriticalRisk(level: AccessReviewRiskLevel): boolean {
  return level === "high" || level === "critical";
}

async function loadPlatformUsers(): Promise<PlatformUserRow[]> {
  return db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
      lastLoginAt: usersTable.lastLoginAt,
      platformDisabledAt: usersTable.platformDisabledAt,
      platformReactivatedAt: usersTable.platformReactivatedAt,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(isNull(usersTable.workspaceId));
}

async function loadOverrideAggregates(): Promise<
  Map<
    number,
    {
      grantCount: number;
      denyCount: number;
      lastChangeAt: Date | null;
      grantedCodes: PlatformPermissionCode[];
      deniedCodes: PlatformPermissionCode[];
    }
  >
> {
  const rows = await db
    .select({
      platformUserId: platformUserPermissionOverridesTable.platformUserId,
      effect: platformUserPermissionOverridesTable.effect,
      permissionCode: platformUserPermissionOverridesTable.permissionCode,
      updatedAt: platformUserPermissionOverridesTable.updatedAt,
    })
    .from(platformUserPermissionOverridesTable)
    .where(isNull(platformUserPermissionOverridesTable.removedAt));

  const map = new Map<
    number,
    {
      grantCount: number;
      denyCount: number;
      lastChangeAt: Date | null;
      grantedCodes: PlatformPermissionCode[];
      deniedCodes: PlatformPermissionCode[];
    }
  >();

  for (const r of rows) {
    let entry = map.get(r.platformUserId);
    if (!entry) {
      entry = { grantCount: 0, denyCount: 0, lastChangeAt: null, grantedCodes: [], deniedCodes: [] };
      map.set(r.platformUserId, entry);
    }
    const code = r.permissionCode as PlatformPermissionCode;
    if (r.effect === "grant") {
      entry.grantCount += 1;
      entry.grantedCodes.push(code);
    } else {
      entry.denyCount += 1;
      entry.deniedCodes.push(code);
    }
    if (!entry.lastChangeAt || r.updatedAt > entry.lastChangeAt) {
      entry.lastChangeAt = r.updatedAt;
    }
  }

  return map;
}

async function loadLatestReviews(): Promise<Map<number, { reviewedAt: Date; reviewStatus: string }>> {
  const rows = await db
    .select({
      platformUserId: platformUserAccessReviewsTable.platformUserId,
      reviewedAt: platformUserAccessReviewsTable.reviewedAt,
      reviewStatus: platformUserAccessReviewsTable.reviewStatus,
    })
    .from(platformUserAccessReviewsTable);

  const map = new Map<number, { reviewedAt: Date; reviewStatus: string }>();
  for (const r of rows) {
    map.set(r.platformUserId, { reviewedAt: r.reviewedAt, reviewStatus: r.reviewStatus });
  }
  return map;
}

type OverrideAgg = {
  grantCount: number;
  denyCount: number;
  lastChangeAt: Date | null;
  grantedCodes: PlatformPermissionCode[];
  deniedCodes: PlatformPermissionCode[];
};

function overridesFromAgg(agg: OverrideAgg | undefined): PlatformPermissionOverrideRow[] {
  if (!agg) return [];
  return [
    ...agg.grantedCodes.map((c) => ({ permissionCode: c, effect: "grant" as const, reason: "" })),
    ...agg.deniedCodes.map((c) => ({ permissionCode: c, effect: "deny" as const, reason: "" })),
  ];
}

function buildUserRiskSummary(
  row: PlatformUserRow,
  overrideMap: Map<number, OverrideAgg>,
  now: Date,
): { summary: HighRiskUserSummary; riskLevel: AccessReviewRiskLevel; hasCritical: boolean; isStale: boolean } {
  const ctx = toProtectionContext(row);
  const agg = overrideMap.get(row.id);
  const fullResolved = computeEffectivePermissionsFromRoleAndOverrides(ctx, overridesFromAgg(agg));

  const isStale = isStaleSensitiveLogin(
    row.lastLoginAt,
    hasSensitiveEffectivePermissions(fullResolved.effectivePermissions),
    now,
  );
  const riskLevel = computeUserRiskLevel({
    user: ctx,
    effective: fullResolved.effectivePermissions,
    grantedOverrides: fullResolved.grantedOverrides,
    deniedOverrides: fullResolved.deniedOverrides,
    isStaleSensitive: isStale,
  });

  return {
    riskLevel,
    hasCritical: countCriticalInEffective(fullResolved.effectivePermissions) > 0,
    isStale,
    summary: {
      userId: String(row.id),
      displayName: row.fullName,
      email: row.email,
      userType: row.platformUserType,
      roleCode: getPlatformUserRoleCode(ctx),
      status: row.status,
      riskLevel,
      protectionReasons: getProtectionReasons(ctx),
      criticalPermissionsCount: countCriticalInEffective(fullResolved.effectivePermissions),
      customOverridesCount: (agg?.grantCount ?? 0) + (agg?.denyCount ?? 0),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lastPermissionChangeAt: agg?.lastChangeAt?.toISOString() ?? null,
      lastStatusChangeAt: lastStatusChangeAt(row)?.toISOString() ?? null,
    },
  };
}

export async function buildPlatformAccessReviewSummary(): Promise<PlatformAccessReviewSummary> {
  const now = new Date();
  const users = await loadPlatformUsers();
  const overrideMap = await loadOverrideAggregates();
  const reviewMap = await loadLatestReviews();

  let activeUsers = 0;
  let disabledUsers = 0;
  let suspendedUsers = 0;
  let rootOwners = 0;
  let platformOwners = 0;
  let protectedUsers = 0;
  let usersWithCustomOverrides = 0;
  let usersWithCustomGrants = 0;
  let usersWithCustomDenies = 0;
  let usersWithCriticalPermissions = 0;
  let usersMissingRecentReview = 0;

  const highRiskUsers: HighRiskUserSummary[] = [];
  const staleUsers: HighRiskUserSummary[] = [];

  const reviewCutoff = now.getTime() - ACCESS_REVIEW_RECENCY_DAYS * MS_PER_DAY;

  for (const row of users) {
    const ctx = toProtectionContext(row);
    if (row.status === "active") activeUsers += 1;
    if (row.status === "disabled") disabledUsers += 1;
    if (row.status === "suspended" || row.status === "locked") suspendedUsers += 1;
    if (isRootPlatformOwner(ctx)) rootOwners += 1;
    if (isPlatformOwnerAccount(ctx)) platformOwners += 1;
    if (isProtectedPlatformAdminUser(ctx)) protectedUsers += 1;

    const agg = overrideMap.get(row.id);
    if (agg && agg.grantCount + agg.denyCount > 0) usersWithCustomOverrides += 1;
    if (agg && agg.grantCount > 0) usersWithCustomGrants += 1;
    if (agg && agg.denyCount > 0) usersWithCustomDenies += 1;

    const { summary, riskLevel, hasCritical, isStale } = buildUserRiskSummary(row, overrideMap, now);
    if (hasCritical) usersWithCriticalPermissions += 1;

    if (isHighOrCriticalRisk(riskLevel)) {
      highRiskUsers.push(summary);
    }

    if (isStale) staleUsers.push(summary);

    const review = reviewMap.get(row.id);
    const needsReview =
      isHighOrCriticalRisk(riskLevel) &&
      (!review || review.reviewedAt.getTime() < reviewCutoff);
    if (needsReview) usersMissingRecentReview += 1;
  }

  return {
    totalPlatformUsers: users.length,
    activeUsers,
    disabledUsers,
    suspendedUsers,
    rootOwners,
    platformOwners,
    protectedUsers,
    usersWithCustomOverrides,
    usersWithCustomGrants,
    usersWithCustomDenies,
    usersWithCriticalPermissions,
    usersMissingRecentReview,
    highRiskUsers: highRiskUsers.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    staleUsers: staleUsers.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    generatedAt: now.toISOString(),
  };
}

export interface PlatformUserAccessReviewDetail {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    userType: string | null;
    roleCode: string;
    status: string;
    isRootOwner: boolean;
    isProtected: boolean;
  };
  protectionReasons: string[];
  rolePermissions: PlatformPermissionCode[];
  grantedOverrides: PlatformPermissionCode[];
  deniedOverrides: PlatformPermissionCode[];
  effectivePermissions: PlatformPermissionCode[];
  criticalPermissions: PlatformPermissionCode[];
  sensitivePermissionFlags: {
    hasPermissionsUpdate: boolean;
    hasUsersDisable: boolean;
    hasUsersRoleUpdate: boolean;
    hasCustomGrantOnCritical: boolean;
    hasCustomDenyOnCritical: boolean;
  };
  lastLoginAt: string | null;
  createdAt: string;
  lastPermissionChangeAt: string | null;
  lastStatusChangeAt: string | null;
  recentAuditEvents: ReturnType<typeof enrichRow>[];
  riskLevel: AccessReviewRiskLevel;
  reviewNotes: string | null;
  reviewStatus: AccessReviewStatus | null;
  reviewedAt: string | null;
  generatedAt: string;
}

const AUDIT_METADATA_ALLOWLIST = new Set([
  "actorId",
  "targetUserId",
  "targetPlatformUserId",
  "action",
  "blockedReason",
  "severity",
  "requiredReason",
  "requiredApproval",
  "reason",
  "timestamp",
  "result",
  "permissionCode",
  "effect",
  "previousStatus",
  "nextStatus",
  "previousRoleCode",
  "nextRoleCode",
  "reviewStatus",
  "email",
]);

export function sanitizeAuditMetadataForReview(
  meta: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!meta) return null;
  const safe: Record<string, unknown> = {};
  for (const key of AUDIT_METADATA_ALLOWLIST) {
    if (key in meta) safe[key] = meta[key];
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

export async function buildPlatformUserAccessReview(
  userId: number,
): Promise<PlatformUserAccessReviewDetail | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
      platformUserType: usersTable.platformUserType,
      lastLoginAt: usersTable.lastLoginAt,
      platformDisabledAt: usersTable.platformDisabledAt,
      platformReactivatedAt: usersTable.platformReactivatedAt,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), isNull(usersTable.workspaceId)));
  if (!row) return null;

  const ctx = toProtectionContext(row);
  const overrides = await loadActiveOverridesForUser(userId);
  const resolved = computeEffectivePermissionsFromRoleAndOverrides(ctx, overrides);
  const criticalPermissions = resolved.effectivePermissions.filter((c) =>
    isCriticalPlatformPermission(c),
  );

  const grantedCritical = resolved.grantedOverrides.filter((c) => isCriticalPlatformPermission(c));
  const deniedCritical = resolved.deniedOverrides.filter((c) => isCriticalPlatformPermission(c));

  const isStale = isStaleSensitiveLogin(
    row.lastLoginAt,
    hasSensitiveEffectivePermissions(resolved.effectivePermissions),
    new Date(),
  );
  const riskLevel = computeUserRiskLevel({
    user: ctx,
    effective: resolved.effectivePermissions,
    grantedOverrides: resolved.grantedOverrides,
    deniedOverrides: resolved.deniedOverrides,
    isStaleSensitive: isStale,
  });

  const [reviewRow] = await db
    .select()
    .from(platformUserAccessReviewsTable)
    .where(eq(platformUserAccessReviewsTable.platformUserId, userId));

  const overrideTimes = await db
    .select({ updatedAt: platformUserPermissionOverridesTable.updatedAt })
    .from(platformUserPermissionOverridesTable)
    .where(eq(platformUserPermissionOverridesTable.platformUserId, userId))
    .orderBy(desc(platformUserPermissionOverridesTable.updatedAt))
    .limit(1);

  const auditRows = await db
    .select({
      id: activityLogsTable.id,
      actorId: activityLogsTable.userId,
      actorEmail: usersTable.email,
      actorName: usersTable.fullName,
      action: activityLogsTable.action,
      metadata: activityLogsTable.metadata,
      createdAt: activityLogsTable.createdAt,
    })
    .from(activityLogsTable)
    .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
    .where(
      and(
        isNull(activityLogsTable.workspaceId),
        inArray(activityLogsTable.action, [...ACCESS_REVIEW_AUDIT_ACTIONS]),
      ),
    )
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(200);

  const userIdStr = String(userId);
  const recentAuditEvents = auditRows
    .map(enrichRow)
    .filter((e) => {
      const tid = e.targetUserId;
      const aid = e.actorId != null ? String(e.actorId) : null;
      return tid === userIdStr || aid === userIdStr;
    })
    .slice(0, 25)
    .map((e) => ({
      ...e,
      metadataSafe: sanitizeAuditMetadataForReview(e.metadataSafe as Record<string, unknown> | null),
    }));

  return {
    user: {
      id: userIdStr,
      email: row.email,
      displayName: row.fullName,
      userType: row.platformUserType,
      roleCode: getPlatformUserRoleCode(ctx),
      status: row.status,
      isRootOwner: isRootPlatformOwner(ctx),
      isProtected: isProtectedPlatformAdminUser(ctx),
    },
    protectionReasons: getProtectionReasons(ctx),
    rolePermissions: resolved.rolePermissions,
    grantedOverrides: resolved.grantedOverrides,
    deniedOverrides: resolved.deniedOverrides,
    effectivePermissions: resolved.effectivePermissions,
    criticalPermissions,
    sensitivePermissionFlags: {
      hasPermissionsUpdate: resolved.effectivePermissions.includes("platform.permissions.update"),
      hasUsersDisable: resolved.effectivePermissions.includes("platform.users.disable"),
      hasUsersRoleUpdate: resolved.effectivePermissions.includes("platform.users.role.update"),
      hasCustomGrantOnCritical: grantedCritical.length > 0,
      hasCustomDenyOnCritical: deniedCritical.length > 0,
    },
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastPermissionChangeAt: overrideTimes[0]?.updatedAt?.toISOString() ?? null,
    lastStatusChangeAt: lastStatusChangeAt(row)?.toISOString() ?? null,
    recentAuditEvents,
    riskLevel,
    reviewNotes: reviewRow?.reviewNotes ?? null,
    reviewStatus: (reviewRow?.reviewStatus as AccessReviewStatus | undefined) ?? null,
    reviewedAt: reviewRow?.reviewedAt?.toISOString() ?? null,
    generatedAt: new Date().toISOString(),
  };
}

export interface PlatformAccessAuditQueryFilters {
  userId?: number;
  actorId?: number;
  action?: string;
  severity?: string;
  dateFrom?: Date;
  dateTo?: Date;
  permissionCode?: string;
  blockedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PlatformAccessAuditQueryResult {
  events: ReturnType<typeof enrichRow>[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export async function queryPlatformAccessAuditEvents(
  filters: PlatformAccessAuditQueryFilters,
): Promise<PlatformAccessAuditQueryResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = parseLimit(filters.pageSize, 50, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [
    isNull(activityLogsTable.workspaceId),
    inArray(activityLogsTable.action, [...ACCESS_REVIEW_AUDIT_ACTIONS]),
    ...(filters.actorId ? [eq(activityLogsTable.userId, filters.actorId)] : []),
    ...(filters.action ? [eq(activityLogsTable.action, filters.action)] : []),
    ...(filters.dateFrom ? [gte(activityLogsTable.createdAt, filters.dateFrom)] : []),
    ...(filters.dateTo ? [lte(activityLogsTable.createdAt, filters.dateTo)] : []),
  ];

  const rows = await db
    .select({
      id: activityLogsTable.id,
      actorId: activityLogsTable.userId,
      actorEmail: usersTable.email,
      actorName: usersTable.fullName,
      action: activityLogsTable.action,
      metadata: activityLogsTable.metadata,
      createdAt: activityLogsTable.createdAt,
    })
    .from(activityLogsTable)
    .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(500);

  let enriched = rows.map(enrichRow);

  if (filters.userId) {
    const uid = String(filters.userId);
    enriched = enriched.filter(
      (e) => e.targetUserId === uid || (e.actorId != null && String(e.actorId) === uid),
    );
  }

  if (filters.severity) {
    enriched = enriched.filter((e) => e.severity === filters.severity);
  }

  if (filters.blockedOnly) {
    enriched = enriched.filter(
      (e) => e.result === "blocked" || e.blockedReason != null,
    );
  }

  if (filters.permissionCode) {
    enriched = enriched.filter((e) => {
      const meta = e.metadataSafe as Record<string, unknown> | null;
      return meta?.permissionCode === filters.permissionCode;
    });
  }

  enriched = enriched.map((e) => ({
    ...e,
    metadataSafe: sanitizeAuditMetadataForReview(e.metadataSafe as Record<string, unknown> | null),
  }));

  const total = enriched.length;
  const pageEvents = enriched.slice(offset, offset + pageSize);

  return {
    events: pageEvents,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
