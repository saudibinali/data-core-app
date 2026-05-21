/**
 * Platform-scope identity: super_admin with no workspace (null or undefined after JWT load).
 */
export interface PlatformScopeIdentity {
  role?: string;
  workspaceId?: number | null;
  isRootOwner?: boolean;
}

/** True for platform administration users (not tenant-scoped super_admin). */
export function isPlatformScopeUser(identity: PlatformScopeIdentity): boolean {
  return identity.role === "super_admin" && identity.workspaceId == null;
}

/**
 * Self-service account routes (/platform/me/*): any signed-in super_admin may manage
 * only their own profile/credentials. Routes never accept a target user id.
 */
export function canAccessPlatformSelfManagement(identity: PlatformScopeIdentity): boolean {
  return identity.role === "super_admin";
}
