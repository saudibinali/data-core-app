/**
 * @phase P17-C - Active platform owner counts for protection policy
 */

import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { isPlatformOwnerAccount } from "./platform-user-lifecycle";
import { isRootPlatformOwner } from "./root-platform-owner-policy";

export async function countActivePlatformOwners(): Promise<{
  activeRootOwnerCount: number;
  activePlatformOwnerCount: number;
}> {
  const rows = await db
    .select({
      id: usersTable.id,
      isRootOwner: usersTable.isRootOwner,
      platformUserType: usersTable.platformUserType,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
    })
    .from(usersTable)
    .where(and(isNull(usersTable.workspaceId), eq(usersTable.status, "active")));

  let activeRootOwnerCount = 0;
  let activePlatformOwnerCount = 0;

  for (const r of rows) {
    if (isRootPlatformOwner(r)) activeRootOwnerCount += 1;
    if (isPlatformOwnerAccount(r)) activePlatformOwnerCount += 1;
  }

  return { activeRootOwnerCount, activePlatformOwnerCount };
}
