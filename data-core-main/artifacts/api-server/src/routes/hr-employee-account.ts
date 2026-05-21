import { Router } from "express";
import { requireAuth, requirePermission, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import {
  getEmployeeAccountStatus,
  linkEmployeeToUser,
  unlinkEmployeeFromUser,
} from "../lib/hr/employee-account-service";

const router = Router();

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get(
  "/hr/employees/:id/account",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const status = await getEmployeeAccountStatus(workspaceId, id);
    if (!status) { res.status(404).json({ error: "Employee not found" }); return; }
    res.json(status);
  },
);

router.post(
  "/hr/employees/:id/link-user",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const userId = Number((req.body as { userId?: unknown }).userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const result = await linkEmployeeToUser(workspaceId, id, userId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const status = await getEmployeeAccountStatus(workspaceId, id);
    res.json(status);
  },
);

router.delete(
  "/hr/employees/:id/link-user",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const result = await unlinkEmployeeFromUser(workspaceId, id);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const status = await getEmployeeAccountStatus(workspaceId, id);
    res.json(status);
  },
);

export default router;
