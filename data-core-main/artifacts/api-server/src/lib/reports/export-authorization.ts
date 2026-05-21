import type { AuthRequest } from "../../middlewares/requireAuth";
import { reportDefinitionRegistry } from "./report-definition-registry";
import {
  hasPlatformPermission,
  type PlatformPermissionCode,
  type PlatformUserPermissionIdentity,
} from "../platform-permissions";
import {
  hasEffectivePlatformPermission,
  resolveActorEffectivePermissionSet,
} from "../platform-effective-permissions";

export type ExportAuthContext = {
  workspaceId?: number;
  userId?: number;
  userRole?: string;
  userPermissions?: string[];
  platformRoleCode?: string | null;
  isRootOwner?: boolean;
};

export async function assertExportAuthorized(
  ctx: ExportAuthContext | AuthRequest,
  reportDefinitionKey: string,
): Promise<void> {
  const def = reportDefinitionRegistry.get(reportDefinitionKey);
  if (!def) throw new Error(`Unknown report: ${reportDefinitionKey}`);

  if (def.key.startsWith("platform.")) {
    if (!ctx.userId) throw new Error("Forbidden");
    if (ctx.userRole !== "super_admin") throw new Error("Forbidden");
    if (!ctx.workspaceId) throw new Error("Workspace context required");

    const perm = def.permission as PlatformPermissionCode;
    const actor: PlatformUserPermissionIdentity = {
      id: ctx.userId,
      role: ctx.userRole,
      platformRoleCode: "platformRoleCode" in ctx ? ctx.platformRoleCode : null,
      isRootOwner: "isRootOwner" in ctx ? ctx.isRootOwner : false,
    };

    const effective = await resolveActorEffectivePermissionSet(ctx.userId);
    const allowed =
      effective.size > 0
        ? hasEffectivePlatformPermission(effective, perm)
        : hasPlatformPermission(actor, perm);

    if (!allowed) throw new Error("Forbidden");
    return;
  }

  if (!ctx.workspaceId || !ctx.userId) throw new Error("Workspace context required");

  const perms = ctx.userPermissions ?? [];
  const isAdmin = ctx.userRole === "admin" || ctx.userRole === "super_admin";
  if (isAdmin) return;
  if (perms.includes(def.permission) || perms.includes("reports.view")) return;
  if (
    def.permission.startsWith("hr.payroll.") &&
    (perms.includes("hr.payroll.export") || perms.includes("hr.payroll.admin") || perms.includes("hr.manage"))
  ) {
    return;
  }

  throw new Error("Forbidden");
}
