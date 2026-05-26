import { Router } from "express";
import { requireAuth, requirePermission, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import {
  getEmployeeAccountStatus,
  linkEmployeeToUser,
  unlinkEmployeeFromUser,
} from "../lib/hr/employee-account-service";
import {
  createUserFromEmployee,
  getEmployeeProvisionPreviewById,
  listProvisionCandidates,
  lookupEmployeeForProvisioning,
} from "../lib/hr/employee-user-provisioning";
import { readProvisionIdempotencyKey } from "../lib/hr/provision-http";

const router = Router();

/** Static routes must be registered before /hr/employees/:id/* */
router.get(
  "/hr/employees/provision/candidates",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const canProvisionOnly = req.query.canProvision === "true" || req.query.canProvision === "1";
    const search = String(req.query.search ?? "").trim() || undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const candidates = await listProvisionCandidates(workspaceId, {
      canProvisionOnly,
      search,
      limit,
    });
    res.json(candidates);
  },
);

router.get(
  "/hr/employees/provision/lookup",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const employeeNumber = String(req.query.employeeNumber ?? "").trim();
    if (!employeeNumber) { res.status(400).json({ error: "employeeNumber query parameter is required" }); return; }

    const preview = await lookupEmployeeForProvisioning(workspaceId, employeeNumber);
    if (!preview) { res.status(404).json({ error: "No employee found with this employee number" }); return; }
    res.json(preview);
  },
);

router.post(
  "/hr/employees/provision/account",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const { employeeNumber, password, role, customRoleId, mustResetPassword } = req.body as Record<string, unknown>;

    const result = await createUserFromEmployee({
      workspaceId,
      actorUserId: req.userId,
      actorRole: req.userRole,
      employeeNumber: employeeNumber ? String(employeeNumber) : undefined,
      password: String(password ?? ""),
      role: role ? String(role) : "member",
      customRoleId: customRoleId != null ? Number(customRoleId) : null,
      mustResetPassword: mustResetPassword === true,
      idempotencyKey: readProvisionIdempotencyKey(req),
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error, field: result.field });
      return;
    }

    res.status(201).json(result.data);
  },
);

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

router.get(
  "/hr/employees/:id/provision-preview",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const preview = await getEmployeeProvisionPreviewById(workspaceId, id);
    if (!preview) { res.status(404).json({ error: "Employee not found" }); return; }
    res.json(preview);
  },
);

router.post(
  "/hr/employees/:id/provision-account",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const { password, role, customRoleId, mustResetPassword } = req.body as Record<string, unknown>;

    const result = await createUserFromEmployee({
      workspaceId,
      actorUserId: req.userId,
      actorRole: req.userRole,
      employeeId: id,
      password: String(password ?? ""),
      role: role ? String(role) : "member",
      customRoleId: customRoleId != null ? Number(customRoleId) : null,
      mustResetPassword: mustResetPassword === true,
      idempotencyKey: readProvisionIdempotencyKey(req),
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error, field: result.field });
      return;
    }

    const status = await getEmployeeAccountStatus(workspaceId, id);
    res.status(201).json({ user: result.data, account: status });
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
