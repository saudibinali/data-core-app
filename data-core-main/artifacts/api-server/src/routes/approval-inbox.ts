import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  approvalInstancesTable,
  approvalStepsTable,
  approvalProcessPoliciesTable,
  workforceDelegationsTable,
  employeesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
  requireWorkspaceAdmin,
} from "../middlewares/requireAuth";
import {
  getApprovalInbox,
  decideApprovalStep,
  handleApprovalRouteError,
  BUSINESS_PROCESS_TEMPLATES,
  getProcessPolicy,
  updateApprovalProcessPolicy,
  enrichPolicyRow,
  validateApprovalPolicyPatch,
} from "../lib/approval";

const router: IRouter = Router();

function parseId(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Unified approval inbox ────────────────────────────────────────────────────

router.get("/self-service/approvals", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  const userId = req.userId;
  if (!workspaceId || !userId) { res.json([]); return; }

  try {
    const items = await getApprovalInbox(workspaceId, userId);
    res.json(items);
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "GET /self-service/approvals" })) return;
    throw e;
  }
});

router.get("/self-service/approvals/:instanceId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  const instanceId = parseId(req.params.instanceId);
  if (!workspaceId || !instanceId) { res.status(400).json({ error: "Invalid" }); return; }

  try {
    const [instance] = await db
      .select()
      .from(approvalInstancesTable)
      .where(
        and(eq(approvalInstancesTable.id, instanceId), eq(approvalInstancesTable.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!instance) { res.status(404).json({ error: "Not found" }); return; }

    const steps = await db
      .select()
      .from(approvalStepsTable)
      .where(eq(approvalStepsTable.instanceId, instanceId))
      .orderBy(approvalStepsTable.stepOrder);

    const policy = await getProcessPolicy(workspaceId, instance.processCode);
    res.json({ instance, steps, policy });
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "GET /self-service/approvals/:id" })) return;
    throw e;
  }
});

router.patch(
  "/self-service/approvals/:instanceId/steps/:stepId/approve",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const userId = req.userId;
    const stepId = parseId(req.params.stepId);
    if (!workspaceId || !userId || !stepId) { res.status(400).json({ error: "Invalid" }); return; }

    try {
      const result = await decideApprovalStep(
        workspaceId,
        stepId,
        userId,
        "approved",
        typeof req.body?.notes === "string" ? req.body.notes : null,
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ ok: true, decision: "approved" });
    } catch (e) {
      if (handleApprovalRouteError(res, e, { route: "PATCH approve" })) return;
      throw e;
    }
  },
);

router.patch(
  "/self-service/approvals/:instanceId/steps/:stepId/reject",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const userId = req.userId;
    const stepId = parseId(req.params.stepId);
    if (!workspaceId || !userId || !stepId) { res.status(400).json({ error: "Invalid" }); return; }

    try {
      const result = await decideApprovalStep(
        workspaceId,
        stepId,
        userId,
        "rejected",
        typeof req.body?.notes === "string" ? req.body.notes : null,
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ ok: true, decision: "rejected" });
    } catch (e) {
      if (handleApprovalRouteError(res, e, { route: "PATCH reject" })) return;
      throw e;
    }
  },
);

// ── Business process templates (replaces technical workflow builder for tenants) ─

router.get("/hr/approval-templates", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.json([]); return; }

  try {
    const includeInactive = req.query.includeInactive === "true" || req.query.includeInactive === "1";
    const policies = await db
      .select()
      .from(approvalProcessPoliciesTable)
      .where(
        includeInactive
          ? eq(approvalProcessPoliciesTable.workspaceId, workspaceId)
          : and(eq(approvalProcessPoliciesTable.workspaceId, workspaceId), eq(approvalProcessPoliciesTable.isActive, true)),
      )
      .orderBy(approvalProcessPoliciesTable.displayOrder);

    const isAr = req.headers["accept-language"]?.toString().startsWith("ar");
    const merged = policies.map((p) => {
      const template = BUSINESS_PROCESS_TEMPLATES.find((t) => t.code === p.code);
      return {
        ...enrichPolicyRow(p, isAr),
        description: template?.description ?? null,
        descriptionAr: template?.descriptionAr ?? null,
      };
    });
    res.json(merged);
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "GET /hr/approval-templates" })) return;
    throw e;
  }
});

router.get("/hr/approval-templates/:code", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  const code = String(req.params.code ?? "").trim();
  if (!workspaceId || !code) { res.status(400).json({ error: "Invalid" }); return; }

  try {
    const policy = await getProcessPolicy(workspaceId, code);
    const [row] = policy
      ? [policy]
      : await db
          .select()
          .from(approvalProcessPoliciesTable)
          .where(
            and(
              eq(approvalProcessPoliciesTable.workspaceId, workspaceId),
              eq(approvalProcessPoliciesTable.code, code),
            ),
          )
          .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const isAr = req.headers["accept-language"]?.toString().startsWith("ar");
    const template = BUSINESS_PROCESS_TEMPLATES.find((t) => t.code === row.code);
    res.json({
      ...enrichPolicyRow(row, isAr),
      description: template?.description ?? null,
      descriptionAr: template?.descriptionAr ?? null,
    });
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "GET /hr/approval-templates/:code" })) return;
    throw e;
  }
});

router.patch("/hr/approval-templates/:code", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  const userId = req.userId;
  const code = String(req.params.code ?? "").trim();
  if (!workspaceId || !userId || !code) { res.status(400).json({ error: "Invalid" }); return; }

  const body = req.body ?? {};
  const patch = {
    name: body.name,
    nameAr: body.nameAr,
    routingType: body.routingType,
    chainDepth: body.chainDepth,
    timeoutHours: body.timeoutHours,
    onTimeout: body.onTimeout,
    isActive: body.isActive,
    displayOrder: body.displayOrder,
  };

  const validationError = validateApprovalPolicyPatch(patch);
  if (validationError) {
    res.status(400).json({ error: validationError, code: "INVALID_POLICY_PATCH" });
    return;
  }

  try {
    const result = await updateApprovalProcessPolicy(workspaceId, code, patch, userId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: result.code });
      return;
    }
    const isAr = req.headers["accept-language"]?.toString().startsWith("ar");
    const template = BUSINESS_PROCESS_TEMPLATES.find((t) => t.code === result.policy.code);
    res.json({
      ...enrichPolicyRow(result.policy, isAr),
      description: template?.description ?? null,
      descriptionAr: template?.descriptionAr ?? null,
    });
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "PATCH /hr/approval-templates/:code" })) return;
    throw e;
  }
});

// ── Delegation foundation ─────────────────────────────────────────────────────

router.get("/hr/delegations", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  try {
    const rows = await db
      .select()
      .from(workforceDelegationsTable)
      .where(eq(workforceDelegationsTable.workspaceId, req.workspaceId))
      .orderBy(desc(workforceDelegationsTable.createdAt));
    res.json(rows);
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "GET /hr/delegations" })) return;
    throw e;
  }
});

router.post("/hr/delegations", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { delegatorEmployeeId, delegateEmployeeId, scope, startDate, endDate } = req.body;
  if (!delegatorEmployeeId || !delegateEmployeeId || !startDate) {
    res.status(400).json({ error: "delegatorEmployeeId, delegateEmployeeId, and startDate are required" });
    return;
  }

  try {
    for (const empId of [Number(delegatorEmployeeId), Number(delegateEmployeeId)]) {
      const [emp] = await db.select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, empId), eq(employeesTable.workspaceId, req.workspaceId)));
      if (!emp) {
        res.status(400).json({ error: `Employee ${empId} not found in workspace` });
        return;
      }
    }

    const [row] = await db.insert(workforceDelegationsTable).values({
      workspaceId: req.workspaceId,
      delegatorEmployeeId: Number(delegatorEmployeeId),
      delegateEmployeeId: Number(delegateEmployeeId),
      scope: scope ?? "all_approvals",
      startDate,
      endDate: endDate ?? null,
      isActive: true,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    if (handleApprovalRouteError(res, e, { route: "POST /hr/delegations" })) return;
    throw e;
  }
});

export default router;
