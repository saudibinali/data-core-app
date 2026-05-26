/**
 * F2.6 — Log super_admin reads/writes against tenant-scoped routes.
 */

import { db, activityLogsTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/requireAuth";

const TENANT_ROUTE_PREFIXES = ["/hr/", "/users", "/tickets", "/departments", "/admin/"];

export function recordPlatformTenantAccessIfNeeded(req: AuthRequest): void {
  if (req.userRole !== "super_admin" || !req.workspaceId || !req.userId) return;

  const path = req.originalUrl?.split("?")[0] ?? req.path ?? "";
  if (!TENANT_ROUTE_PREFIXES.some((p) => path.includes(p))) return;

  void db
    .insert(activityLogsTable)
    .values({
      userId: req.userId,
      workspaceId: req.workspaceId,
      action: "platform_tenant_data_access",
      metadata: JSON.stringify({ method: req.method, path }),
    })
    .catch(() => undefined);
}
