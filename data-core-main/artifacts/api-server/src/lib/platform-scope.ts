/**
 * Platform-scope identity: super_admin with no workspace (null or undefined after JWT load).
 */
export interface PlatformScopeIdentity {
  role?: string;
  workspaceId?: number | null;
}

/** True for platform administration users (not tenant-scoped super_admin). */
export function isPlatformScopeUser(identity: PlatformScopeIdentity): boolean {
  return identity.role === "super_admin" && identity.workspaceId == null;
}
