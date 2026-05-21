import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformModulesTable, workspaceModuleSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin } from "../middlewares/requireAuth";
import { moduleGovernanceService } from "../lib/platform/module-governance-service";

const router: IRouter = Router();

async function getModulesForWorkspace(workspaceId: number | undefined) {
  const modules = await db
    .select()
    .from(platformModulesTable)
    .orderBy(platformModulesTable.displayOrder);

  if (!workspaceId) return modules.map((m) => ({ ...m, enabled: m.defaultEnabled }));

  const settings = await db
    .select()
    .from(workspaceModuleSettingsTable)
    .where(eq(workspaceModuleSettingsTable.workspaceId, workspaceId));

  const settingMap = new Map(settings.map((s) => [s.moduleKey, s.enabled]));

  return modules.map((m) => ({
    ...m,
    enabled: m.core
      ? true
      : settingMap.has(m.key)
        ? settingMap.get(m.key)!
        : m.defaultEnabled,
  }));
}

router.get("/modules", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const modules = await getModulesForWorkspace(req.workspaceId);
  res.json(modules);
});

router.patch("/modules/:key", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { key } = req.params as { key: string };
  const { enabled } = req.body as { enabled: unknown };

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }

  const [module] = await db
    .select()
    .from(platformModulesTable)
    .where(eq(platformModulesTable.key, key));

  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }

  if (module.core) {
    res.status(400).json({ error: "Core modules cannot be disabled" });
    return;
  }

  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }

  const workspaceId = req.workspaceId;

  try {
    await moduleGovernanceService.setModuleEnabled(workspaceId, key, enabled, req.userId);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const updated = (await getModulesForWorkspace(workspaceId)).find((m) => m.key === key);
  res.json(updated);
});

export default router;
