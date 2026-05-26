import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { employeesTable, attendanceGeofencesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { executeWebClock } from "../lib/workforce-attendance/clock-service";
import { selfServiceAttendanceService } from "../lib/workforce-attendance/self-service-attendance-service";
import { attendancePolicyService } from "../lib/workforce-attendance/attendance-policy-service";
import { parsePolicyJson } from "../lib/workforce-attendance/policy-types";
import { attendanceCutoverStatusForWorkspace } from "../lib/attendance-cutover-flags";
import { listAdminAttendanceSummaries } from "../lib/workforce-attendance/admin-attendance-list";

const router: IRouter = Router();

// GET /hr/attendance-cutover/status — F6.2 pilot + effective attendance canonical flags
router.get("/hr/attendance-cutover/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.json(attendanceCutoverStatusForWorkspace(null));
    return;
  }
  res.json(attendanceCutoverStatusForWorkspace(workspaceId));
});

// GET /hr/workforce/attendance/summaries — canonical daily summaries (admin list)
router.get(
  "/hr/workforce/attendance/summaries",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const q = req.query as Record<string, string>;
    const rows = await listAdminAttendanceSummaries(req.workspaceId, {
      employeeId: q.employeeId ? Number(q.employeeId) : undefined,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      status: q.status,
    });
    res.json(rows);
  },
);

async function resolveEmployeeForUser(req: AuthRequest) {
  if (!req.workspaceId || !req.userId) return null;
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.workspaceId, req.workspaceId), eq(employeesTable.userId, req.userId)),
    )
    .limit(1);
  return emp ?? null;
}

// ── Self-service read APIs ────────────────────────────────────────────────────

router.get("/hr/workforce/me/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "Workspace context required" });
    return;
  }
  const emp = await selfServiceAttendanceService.getEmployeeContext(req.workspaceId, req.userId);
  if (!emp) {
    res.status(404).json({ error: "No employee profile linked to this user" });
    return;
  }
  const status = await selfServiceAttendanceService.getCurrentStatus(
    req.workspaceId,
    emp.id,
    req.userId,
  );
  res.json({ ...status, employeeName: emp.fullName, workLocation: emp.locationName });
});

router.get("/hr/workforce/me/today", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "Workspace context required" });
    return;
  }
  const emp = await resolveEmployeeForUser(req);
  if (!emp) {
    res.status(404).json({ error: "No employee profile linked to this user" });
    return;
  }
  const summary = await selfServiceAttendanceService.getTodaySummary(req.workspaceId, emp.id);
  res.json(summary);
});

router.get("/hr/workforce/me/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "Workspace context required" });
    return;
  }
  const emp = await resolveEmployeeForUser(req);
  if (!emp) {
    res.json([]);
    return;
  }
  const q = req.query as Record<string, string>;
  const rows = await selfServiceAttendanceService.getMyHistory(
    req.workspaceId,
    emp.id,
    q.dateFrom,
    q.dateTo,
  );
  res.json(rows);
});

// ── Clock APIs (aliases + legacy paths) ─────────────────────────────────────

async function handleClock(
  req: AuthRequest,
  res: import("express").Response,
  eventType: "clock_in" | "clock_out",
): Promise<void> {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "Workspace context required" });
    return;
  }
  const emp = await resolveEmployeeForUser(req);
  if (!emp) {
    res.status(404).json({ error: "No employee profile linked to this user" });
    return;
  }

  const body = req.body as {
    location?: { lat?: number; lng?: number; accuracyM?: number; capturedAt?: string; provider?: string };
  };

  try {
    const result = await executeWebClock({
      workspaceId: req.workspaceId,
      employeeId: emp.id,
      userId: req.userId,
      eventType,
      location: body.location,
      ipAddress: req.ip,
    });
    res.status(201).json({
      success: true,
      duplicate: result.duplicate,
      rawEventId: result.rawEventId,
      eventId: result.eventId,
      summaryId: result.summaryId,
      legacyAttendanceId: result.legacyAttendanceId,
      warnings: result.warnings,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Clock failed" });
  }
}

router.post("/hr/workforce/clock-in", requireAuth, (req, res) => handleClock(req, res, "clock_in"));
router.post("/hr/workforce/clock-out", requireAuth, (req, res) => handleClock(req, res, "clock_out"));

// ── Geofence admin (foundation) ───────────────────────────────────────────────

router.get(
  "/hr/workforce/geofences",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const rows = await db
      .select()
      .from(attendanceGeofencesTable)
      .where(eq(attendanceGeofencesTable.workspaceId, req.workspaceId));
    res.json(rows);
  },
);

router.post(
  "/hr/workforce/geofences",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const body = req.body as {
      name: string;
      workLocationId?: number;
      latitude: number;
      longitude: number;
      radiusMeters?: number;
    };
    const [row] = await db
      .insert(attendanceGeofencesTable)
      .values({
        workspaceId: req.workspaceId,
        name: body.name,
        workLocationId: body.workLocationId ?? null,
        latitude: body.latitude,
        longitude: body.longitude,
        radiusMeters: body.radiusMeters ?? 200,
        createdByUserId: req.userId ?? null,
      })
      .returning();
    res.status(201).json(row);
  },
);

router.get(
  "/hr/workforce/policies",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const rows = await attendancePolicyService.listPolicies(req.workspaceId);
    res.json(
      rows.map((r) => ({
        ...r,
        policy: parsePolicyJson(r.policyJson),
      })),
    );
  },
);

router.post(
  "/hr/workforce/policies",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const body = req.body as { name?: string; policy: Record<string, unknown>; isDefault?: boolean };
    const row = await attendancePolicyService.upsertPolicy({
      workspaceId: req.workspaceId,
      userId: req.userId,
      name: body.name ?? "Custom",
      policy: parsePolicyJson(JSON.stringify(body.policy)),
      isDefault: body.isDefault,
    });
    res.status(201).json({ ...row, policy: parsePolicyJson(row.policyJson) });
  },
);

export default router;
