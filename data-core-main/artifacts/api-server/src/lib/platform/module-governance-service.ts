/**
 * P23-A — Module governance (dependencies, staged toggles)
 */
import { db } from "@workspace/db";
import { platformModulesTable, workspaceModuleSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { platformGovernanceAuditService } from "./platform-governance-audit-service";

/** Module key → required module keys that must be enabled first */
/** HCM integrated module dependency graph (ISO 30414-aligned nucleus). */
export const MODULE_DEPENDENCIES: Record<string, string[]> = {
  hr: [],
  payroll: ["hr"],
  attendance: ["hr"],
  "self-service": ["hr"],
  "report-center": ["hr"],
  workflows: [],
  approvals: [],
};

export class ModuleGovernanceService {
  async assertToggleAllowed(workspaceId: number, moduleKey: string, enabled: boolean) {
    if (enabled) {
      const deps = MODULE_DEPENDENCIES[moduleKey] ?? [];
      for (const dep of deps) {
        const ok = await this.isModuleEnabled(workspaceId, dep);
        if (!ok) {
          throw new Error(`Cannot enable ${moduleKey}: dependency "${dep}" must be enabled first`);
        }
      }
    } else {
      const dependents = Object.entries(MODULE_DEPENDENCIES)
        .filter(([, deps]) => deps.includes(moduleKey))
        .map(([k]) => k);
      for (const d of dependents) {
        if (await this.isModuleEnabled(workspaceId, d)) {
          throw new Error(`Cannot disable ${moduleKey}: disable "${d}" first`);
        }
      }
    }
  }

  async isModuleEnabled(workspaceId: number, moduleKey: string): Promise<boolean> {
    const [mod] = await db
      .select()
      .from(platformModulesTable)
      .where(eq(platformModulesTable.key, moduleKey))
      .limit(1);
    if (!mod) return false;
    if (mod.core) return true;

    const [row] = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(
        and(
          eq(workspaceModuleSettingsTable.workspaceId, workspaceId),
          eq(workspaceModuleSettingsTable.moduleKey, moduleKey),
        ),
      )
      .limit(1);

    if (row) return row.enabled;
    return mod.defaultEnabled;
  }

  async setModuleEnabled(
    workspaceId: number,
    moduleKey: string,
    enabled: boolean,
    actorUserId?: number,
  ) {
    await this.assertToggleAllowed(workspaceId, moduleKey, enabled);

    const [module] = await db
      .select()
      .from(platformModulesTable)
      .where(eq(platformModulesTable.key, moduleKey))
      .limit(1);

    if (!module) throw new Error("Module not found");
    if (module.core && !enabled) {
      throw new Error("Core modules cannot be disabled");
    }

    const [existing] = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(
        and(
          eq(workspaceModuleSettingsTable.workspaceId, workspaceId),
          eq(workspaceModuleSettingsTable.moduleKey, moduleKey),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(workspaceModuleSettingsTable)
        .set({ enabled, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceModuleSettingsTable.workspaceId, workspaceId),
            eq(workspaceModuleSettingsTable.moduleKey, moduleKey),
          ),
        );
    } else {
      await db.insert(workspaceModuleSettingsTable).values({ workspaceId, moduleKey, enabled });
    }

    await platformGovernanceAuditService.log({
      workspaceId,
      actorUserId: actorUserId ?? null,
      scope: "workspace",
      action: "module_governance_toggle",
      resourceType: "workspace_module_settings",
      resourceId: workspaceId,
      metadata: { moduleKey, enabled },
    });

    return { moduleKey, enabled };
  }
}

export const moduleGovernanceService = new ModuleGovernanceService();
