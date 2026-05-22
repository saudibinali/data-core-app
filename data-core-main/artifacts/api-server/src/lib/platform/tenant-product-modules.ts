/**
 * Canonical product access — workspace_module_settings + platform_modules catalog.
 */
import { db } from "@workspace/db";
import { platformModulesTable, workspaceModuleSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type TenantProductModuleRow = {
  key: string;
  name: string;
  description: string | null;
  core: boolean;
  defaultEnabled: boolean;
  enabled: boolean;
  displayOrder: number;
};

export async function listTenantProductModules(
  workspaceId: number,
): Promise<TenantProductModuleRow[]> {
  const modules = await db
    .select()
    .from(platformModulesTable)
    .orderBy(platformModulesTable.displayOrder);

  const settings = await db
    .select()
    .from(workspaceModuleSettingsTable)
    .where(eq(workspaceModuleSettingsTable.workspaceId, workspaceId));

  const settingMap = new Map(settings.map((s) => [s.moduleKey, s.enabled]));

  return modules.map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description,
    core: m.core,
    defaultEnabled: m.defaultEnabled,
    enabled: m.core
      ? true
      : settingMap.has(m.key)
        ? settingMap.get(m.key)!
        : m.defaultEnabled,
    displayOrder: m.displayOrder,
  }));
}
