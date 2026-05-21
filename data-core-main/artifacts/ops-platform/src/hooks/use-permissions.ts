import { useGetMe } from "@workspace/api-client-react";

export function usePermissions() {
  const { data: me, isLoading } = useGetMe();
  const userRole = me?.role;
  const permissions: string[] = Array.isArray(me?.permissions) ? (me.permissions as string[]) : [];

  const hasPermission = (key: string): boolean => {
    if (!userRole) return false;
    if (userRole === "super_admin" || userRole === "admin" || userRole === "manager") return true;
    return permissions.includes(key);
  };

  const hasAnyPermission = (...keys: string[]): boolean => keys.some(k => hasPermission(k));

  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isManager = userRole === "manager";
  const isAdminOrManager = isAdmin || isManager;

  return {
    hasPermission,
    hasAnyPermission,
    permissions,
    userRole,
    isLoading,
    isAdmin,
    isManager,
    isAdminOrManager,
    customRoleId: me?.customRoleId ?? null,
    customRoleName: me?.customRoleName ?? null,
  };
}
