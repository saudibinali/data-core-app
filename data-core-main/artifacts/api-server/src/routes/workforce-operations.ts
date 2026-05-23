import { Router, type IRouter } from "express";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
} from "../middlewares/requireAuth";
import { getEmployeeFileAggregate } from "../lib/workforce/operations/employee-file-service";
import { getEmployeeTimeline } from "../lib/workforce/operations/timeline-service";
import { listEmployeeMovements, recordAndApplyMovement } from "../lib/workforce/operations/movement-service";
import {
  initiateLifecycleEvent,
  completeLifecycleEvent,
  listLifecycleEvents,
  type LifecycleEventType,
} from "../lib/workforce/operations/lifecycle-service";
import { handleWorkforceOpsRouteError } from "../lib/workforce/operations/schema-guard";

const router: IRouter = Router();

function parseId(val: unknown): number | null {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

const LIFECYCLE_TYPES = new Set<string>([
  "onboarding",
  "transfer",
  "promotion",
  "department_movement",
  "manager_change",
  "offboarding",
  "termination",
]);

function handleOpsError(res: import("express").Response, e: unknown, route: string): boolean {
  if (handleWorkforceOpsRouteError(res, e, { route })) return true;
  const err = e as { statusCode?: number; code?: string; message?: string };
  if (err.statusCode) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

// GET /hr/employees/:id/file — unified employee file runtime
router.get(
  "/hr/employees/:id/file",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const file = await getEmployeeFileAggregate(workspaceId, employeeId);
      res.json(file);
    } catch (e) {
      if (handleOpsError(res, e, "GET /hr/employees/:id/file")) return;
      throw e;
    }
  },
);

// GET /hr/employees/:id/timeline — unified workforce timeline
router.get(
  "/hr/employees/:id/timeline",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.json([]);
      return;
    }
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    try {
      const rows = await getEmployeeTimeline(workspaceId, employeeId, limit);
      res.json(rows);
    } catch (e) {
      if (handleOpsError(res, e, "GET /hr/employees/:id/timeline")) return;
      throw e;
    }
  },
);

// GET /hr/employees/:id/movements
router.get(
  "/hr/employees/:id/movements",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.json([]);
      return;
    }
    try {
      const rows = await listEmployeeMovements(workspaceId, employeeId);
      res.json(rows);
    } catch (e) {
      if (handleOpsError(res, e, "GET /hr/employees/:id/movements")) return;
      throw e;
    }
  },
);

// POST /hr/employees/:id/movements — record + apply movement
router.post(
  "/hr/employees/:id/movements",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const {
      movementType,
      effectiveDate,
      toOrgUnitId,
      toManagerId,
      toJobTitleId,
      toStatus,
      reason,
      notes,
      applyImmediately,
    } = req.body ?? {};

    if (!movementType || !effectiveDate) {
      res.status(400).json({ error: "movementType and effectiveDate are required" });
      return;
    }

    try {
      const result = await recordAndApplyMovement({
        workspaceId,
        employeeId,
        movementType,
        effectiveDate,
        toOrgUnitId,
        toManagerId,
        toJobTitleId,
        toStatus,
        reason,
        notes,
        applyImmediately: applyImmediately !== false,
        actorUserId: req.userId,
      });
      res.status(201).json(result);
    } catch (e) {
      if (handleOpsError(res, e, "POST /hr/employees/:id/movements")) return;
      throw e;
    }
  },
);

// GET /hr/employees/:id/lifecycle
router.get(
  "/hr/employees/:id/lifecycle",
  requireAuth,
  requirePermission("hr.view"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.json([]);
      return;
    }
    try {
      const rows = await listLifecycleEvents(workspaceId, employeeId);
      res.json(rows);
    } catch (e) {
      if (handleOpsError(res, e, "GET /hr/employees/:id/lifecycle")) return;
      throw e;
    }
  },
);

// POST /hr/employees/:id/lifecycle — initiate lifecycle event
router.post(
  "/hr/employees/:id/lifecycle",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const employeeId = parseId(req.params.id);
    if (!workspaceId || !employeeId) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { eventType, effectiveDate, payload, requesterEmployeeId } = req.body ?? {};
    if (!eventType || !LIFECYCLE_TYPES.has(eventType)) {
      res.status(400).json({ error: "Valid eventType is required" });
      return;
    }

    try {
      const result = await initiateLifecycleEvent({
        workspaceId,
        employeeId,
        eventType: eventType as LifecycleEventType,
        effectiveDate,
        payload,
        actorUserId: req.userId,
        requesterEmployeeId: requesterEmployeeId ?? employeeId,
      });
      res.status(201).json(result);
    } catch (e) {
      if (handleOpsError(res, e, "POST /hr/employees/:id/lifecycle")) return;
      throw e;
    }
  },
);

// POST /hr/employees/:id/lifecycle/:eventId/complete
router.post(
  "/hr/employees/:id/lifecycle/:eventId/complete",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    const eventId = parseId(req.params.eventId);
    if (!workspaceId || !eventId) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const result = await completeLifecycleEvent(
        workspaceId,
        eventId,
        req.userId ?? null,
        { applyImmediately: req.body?.applyImmediately },
      );
      res.json(result);
    } catch (e) {
      if (handleOpsError(res, e, "POST /hr/employees/:id/lifecycle/:eventId/complete")) return;
      throw e;
    }
  },
);

export default router;
