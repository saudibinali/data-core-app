import { Router } from "express";
import { requireAuth, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import { generateEmployeeNumber } from "../lib/employeeNumber";
import { provisionEmployee } from "../lib/hr/employee-provision-service";

const router = Router();

router.post(
  "/hr/employees/provision",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const body = req.body as Record<string, unknown>;
    const result = await provisionEmployee(
      workspaceId,
      {
        fullName: String(body.fullName ?? ""),
        email: body.email != null ? String(body.email) : null,
        phoneNumber: body.phoneNumber != null ? String(body.phoneNumber) : null,
        userId: body.userId != null ? Number(body.userId) : null,
        employmentType: body.employmentType != null ? String(body.employmentType) : null,
        hireDate: body.hireDate != null ? String(body.hireDate) : null,
        orgUnitId: body.orgUnitId != null ? Number(body.orgUnitId) : null,
        jobTitleId: body.jobTitleId != null ? Number(body.jobTitleId) : null,
      },
      generateEmployeeNumber,
    );

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(201).json({
      employee: result.employee,
      linked: result.linked,
      userId: result.userId,
      linkSource: result.linkSource,
    });
  },
);

export default router;
