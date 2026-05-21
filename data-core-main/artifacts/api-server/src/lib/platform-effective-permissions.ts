/**
 * @phase P17-B - Effective platform permission resolver (role + overrides)
 */

import { db } from "@workspace/db";
import {
  platformUserPermissionOverridesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  PLATFORM_PERMISSION_CODES,
  getPlatformPermissionsForRole,
  getPlatformUserRoleCode,
  type PlatformPermissionCode,
  type PlatformUserPermissionIdentity,
} from "./platform-permissions";
import { isRootPlatformOwner, isProtectedPlatformAccount } from "./root-platform-owner-policy";

export interface PlatformPermissionOverrideRow {
  permissionCode: string;
  effect: "grant" | "deny";
  reason: string;
}

export interface ResolvedPlatformUserPermissions {
  rolePermissions: PlatformPermissionCode[];
  grantedOverrides: PlatformPermissionCode[];
  deniedOverrides: PlatformPermissionCode[];
  effectivePermissions: PlatformPermissionCode[];
  restrictedByProtection: boolean;
}

export function isPlatformPermissionCatalogCode(code: string): code is PlatformPermissionCode {
  return (PLATFORM_PERMISSION_CODES as readonly string[]).includes(code);
}

export function computeEffectivePermissionsFromRoleAndOverrides(
  user: PlatformUserPermissionIdentity,
  activeOverrides: readonly PlatformPermissionOverrideRow[],
): ResolvedPlatformUserPermissions {
  const isRoot = isRootPlatformOwner(user);
  const restrictedByProtection = isRoot || isProtectedPlatformAccount(user);

  if (isRoot) {
    const all = [...PLATFORM_PERMISSION_CODES];
    return {
      rolePermissions: all,
      grantedOverrides: [],
      deniedOverrides: [],
      effectivePermissions: all,
      restrictedByProtection: true,
    };
  }

  const roleCode = getPlatformUserRoleCode(user);
  const roleSet = getPlatformPermissionsForRole(roleCode);
  const rolePermissions = [...roleSet];

  const grantedOverrides: PlatformPermissionCode[] = [];
  const deniedOverrides: PlatformPermissionCode[] = [];

  for (const o of activeOverrides) {
    if (!isPlatformPermissionCatalogCode(o.permissionCode)) continue;
    if (o.effect === "grant") grantedOverrides.push(o.permissionCode);
    if (o.effect === "deny") deniedOverrides.push(o.permissionCode);
  }

  const effective = new Set<PlatformPermissionCode>(rolePermissions);
  for (const g of grantedOverrides) effective.add(g);
  for (const d of deniedOverrides) effective.delete(d);

  return {
    rolePermissions,
    grantedOverrides,
    deniedOverrides,
    effectivePermissions: [...effective],
    restrictedByProtection,
  };
}

export async function loadActiveOverridesForUser(
  platformUserId: number,
): Promise<PlatformPermissionOverrideRow[]> {
  const rows = await db
    .select({
      permissionCode: platformUserPermissionOverridesTable.permissionCode,
      effect: platformUserPermissionOverridesTable.effect,
      reason: platformUserPermissionOverridesTable.reason,
    })
    .from(platformUserPermissionOverridesTable)
    .where(
      and(
        eq(platformUserPermissionOverridesTable.platformUserId, platformUserId),
        isNull(platformUserPermissionOverridesTable.removedAt),
      ),
    );

  return rows.map((r) => ({
    permissionCode: r.permissionCode,
    effect: r.effect as "grant" | "deny",
    reason: r.reason,
  }));
}

export async function resolvePlatformUserEffectivePermissions(
  platformUserId: number,
): Promise<ResolvedPlatformUserPermissions | null> {
  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, platformUserId), isNull(usersTable.workspaceId)));

  if (!user) return null;

  const identity: PlatformUserPermissionIdentity = {
    id: user.id,
    role: user.role,
    workspaceId: user.workspaceId,
    platformRoleCode: user.platformRoleCode,
    isRootOwner: user.isRootOwner,
  };

  const overrides = await loadActiveOverridesForUser(platformUserId);
  return computeEffectivePermissionsFromRoleAndOverrides(identity, overrides);
}

export function hasEffectivePlatformPermission(
  effective: ReadonlySet<PlatformPermissionCode> | readonly PlatformPermissionCode[],
  permissionCode: PlatformPermissionCode,
): boolean {
  if (effective instanceof Set) return effective.has(permissionCode);
  return effective.includes(permissionCode);
}

export async function resolveActorEffectivePermissionSet(
  actorId: number,
): Promise<Set<PlatformPermissionCode>> {
  const resolved = await resolvePlatformUserEffectivePermissions(actorId);
  if (!resolved) return new Set();
  return new Set(resolved.effectivePermissions);
}
