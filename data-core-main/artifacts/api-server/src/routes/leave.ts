/**
 * @file        routes/leave.ts
 * @purpose     Leave Domain - Phase 1 canonical leave request lifecycle.
 *
 * Routes implemented in Phase 1:
 *   POST   /hr/leave-requests             - submit a leave request
 *   GET    /hr/leave-requests             - list (HR sees all; employee sees own)
 *   GET    /hr/leave-requests/:id         - get single request with approval steps
 *   PATCH  /hr/leave-requests/:id/approve - approver approves
 *   PATCH  /hr/leave-requests/:id/reject  - approver rejects
 *   PATCH  /hr/leave-requests/:id/withdraw - employee withdraws own request
 *
 * ── Intentionally deferred (Phase 2+) ────────────────────────────────────────
 *   DELETE /hr/leave-requests/:id/cancel  - HR/admin cancels an approved leave
 *   POST   /hr/leave-balances/adjust      - HR manual balance adjustment
 *   Bulk balance initialisation
 *   Multi-step approval chain
 *   Payroll hooks
 *   Attendance record creation on approval
 *   Calendar event creation on approval
 *
 * ── Synchronous invariants ────────────────────────────────────────────────────
 *   All business-critical state changes (balance reservation, conflict check,
 *   request INSERT) happen inside a single DB transaction BEFORE the HTTP
 *   response is sent.  Only after the transaction commits do we emit bus events.
 *
 *   This guarantees:
 *     • No double-booking - conflict check and balance update are atomic.
 *     • No phantom balance - balance is reserved the moment the request exists.
 *     • Event emission failure cannot corrupt DB state (it is fire-and-forget).
 *
 * ── Why approvalsTable is intentionally excluded ──────────────────────────────
 *   The generic approvalsTable has a ticketId NOT NULL constraint.  Adapting it
 *   for leave requests would require a schema migration that breaks the
 *   approvals module's coupling assumptions.  Leave approvals have domain-
 *   specific state (multi-step chains, SLA per step, balance enforcement,
 *   attendance side effects) that belong in leave_approval_steps.
 *
 * ── Why workflows are supplementary only ─────────────────────────────────────
 *   Workflow automations (WorkflowEngine) are triggered by bus events via the
 *   bridge.  They can send notifications or trigger external actions, but they
 *   must NEVER mutate leave_requests or hrLeaveBalancesTable directly - the
 *   lifecycle state machine lives exclusively in this route file.
 *
 * ── Legacy path note ─────────────────────────────────────────────────────────
 *   POST /hr/employees/:id/leaves  (hr.ts)  ← LEGACY
 *   POST /hr/me/leave-requests     (hr.ts)  ← LEGACY
 *   PATCH /hr/attendance/leaves/:id (hr.ts) ← LEGACY
 *   These routes write to hrEmployeeLeavesTable (ad-hoc) with no event emission,
 *   no balance enforcement, and no approval chain.  They are preserved for
 *   backward compatibility only and will be deprecated in Phase 2+.
 *   New code should use the routes in this file.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employeesTable,
  hrLeaveBalancesTable,
  hrLeavePoliciesTable,
  hrWorkCalendarsTable,
  hrCalendarHolidaysTable,
  leaveRequestsTable,
  leaveApprovalStepsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, or, inArray, ne, asc } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
} from "../middlewares/requireAuth";
import { appEventBus, EVENT_TYPES } from "../lib/events";
import { logger } from "../lib/logger";
import {
  findLeaveDateOverlaps,
  leaveOverlapErrorMessage,
} from "../lib/leave-overlap";
import { incrementLeaveMetric, getLeaveCutoverMetrics } from "../lib/leave-cutover-metrics";
import { leaveCutoverStatusForWorkspace } from "../lib/leave-cutover-flags";
import { getEffectiveLeaveCutoverStatus } from "../lib/leave/canonical-write-policy";
import { mirrorCanonicalLeaveToLegacy } from "../lib/leave/legacy-mirror-service";
import { getLeaveRuntimeMode } from "../lib/hr/hcm-workspace-settings";
import { resolveLeaveApprover } from "../lib/workforce/manager-resolver";
import { startLeaveApproval, syncLeaveStepDecision } from "../lib/approval/runtime-service";
import { isWorkspaceRbacStrict } from "../lib/workspace-rbac-config";
import { SubmitLeaveRequestBody, formatZodError } from "../lib/security-validation";
const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseId(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** HR-wide leave list (not limited to role name manager). */
function canViewAllLeaveRequests(req: AuthRequest): boolean {
  if (req.userPermissions?.includes("leave.view") || req.userPermissions?.includes("hr.manage")) {
    return true;
  }
  if (isWorkspaceRbacStrict()) return false;
  if (req.userRole === "admin" || req.userRole === "super_admin" || req.userRole === "manager") {
    return true;
  }
  return false;
}

/** Approver authorization: designated approver, role manager/admin, or leave.manage / hr.manage. */
function canActAsLeaveApprover(req: AuthRequest): boolean {
  if (req.userPermissions?.includes("leave.manage") || req.userPermissions?.includes("hr.manage")) {
    return true;
  }
  if (isWorkspaceRbacStrict()) return false;
  if (req.userRole === "admin" || req.userRole === "super_admin" || req.userRole === "manager") {
    return true;
  }
  return false;
}

async function employeeOwnedByUser(
  workspaceId: number,
  employeeId: number,
  userId: number,
): Promise<boolean> {
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.id, employeeId),
        eq(employeesTable.workspaceId, workspaceId),
        eq(employeesTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(emp);
}

/**
 * calcBusinessDays - server-side business day calculation.
 *
 * Reads the workspace's default work calendar and its holiday list.
 * Falls back to Mon-Fri (no holidays) when no default calendar is configured.
 *
 * Both startDate and endDate are INCLUSIVE.
 *
 * @param workspaceId  Workspace scoping for calendar lookup.
 * @param startDate    ISO date string "YYYY-MM-DD".
 * @param endDate      ISO date string "YYYY-MM-DD".
 */
async function calcBusinessDays(
  workspaceId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const [calendar] = await db
    .select()
    .from(hrWorkCalendarsTable)
    .where(
      and(
        eq(hrWorkCalendarsTable.workspaceId, workspaceId),
        eq(hrWorkCalendarsTable.isDefault, true),
        eq(hrWorkCalendarsTable.isActive, true),
      ),
    )
    .limit(1);

  const workDays: number[] = calendar
    ? (calendar.workDays as number[])
    : [1, 2, 3, 4, 5]; // Mon-Fri default

  const holidaySet = new Set<string>();
  if (calendar) {
    const hols = await db
      .select({ date: hrCalendarHolidaysTable.date })
      .from(hrCalendarHolidaysTable)
      .where(
        and(
          eq(hrCalendarHolidaysTable.calendarId, calendar.id),
          gte(hrCalendarHolidaysTable.date, startDate),
          lte(hrCalendarHolidaysTable.date, endDate),
        ),
      );
    for (const h of hols) holidaySet.add(h.date);
  }

  let count = 0;
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    const dayOfWeek = current.getUTCDay();
    const dateStr = current.toISOString().split("T")[0]!;
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

/**
 * generateRequestNumber - unique leave request number per workspace.
 *
 * Format: LRQ-{YYYY}{MM}-{4-digit-random}
 * The uniqueIndex on (workspaceId, requestNumber) prevents collisions at DB level.
 */
function generateRequestNumber(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `LRQ-${year}${month}-${rand}`;
}

/**
 * findApproverForEmployee - Phase 1 single-step approver resolution.
 *
 * Priority:
 *   1. Employee's directManagerId (if that manager has a userId → active user)
 *   2. Any workspace admin/HR user (fallback)
 *
 * Returns null when no approver can be found (caller should use requiresApproval=false
 * or the workspace admin can manually assign later).
 */
async function findApproverForEmployee(
  workspaceId: number,
  employeeId: number,
  requestedByUserId: number,
): Promise<{ approverUserId: number; approverRole: string } | null> {
  const resolved = await resolveLeaveApprover(workspaceId, employeeId, requestedByUserId);
  if (!resolved) return null;
  return { approverUserId: resolved.approverUserId, approverRole: resolved.approverRole };
}

/** Ensures every pending_approval request has an approver step (P18-D4). */
async function resolveApproverWithFallback(
  workspaceId: number,
  employeeId: number,
  requestedByUserId: number,
): Promise<{ approverUserId: number; approverRole: string }> {
  const primary = await findApproverForEmployee(workspaceId, employeeId, requestedByUserId);
  if (primary) return primary;

  const [anyAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.workspaceId, workspaceId),
        eq(usersTable.status, "active"),
        or(eq(usersTable.role, "admin"), eq(usersTable.role, "super_admin")),
      ),
    )
    .limit(1);

  if (anyAdmin) {
    return { approverUserId: anyAdmin.id, approverRole: "admin" };
  }

  return { approverUserId: requestedByUserId, approverRole: "fallback" };
}

// ── Validation helpers ─────────────────────────────────────────────────────────

function parseSubmitLeaveBody(body: unknown):
  | {
      ok: true;
      leaveType: string;
      startDate: string;
      endDate: string;
      employeeNote?: string;
      leavePolicyId?: number;
      attachmentUrls?: string[];
    }
  | { ok: false; error: string } {
  const parsed = SubmitLeaveRequestBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  return { ok: true, ...parsed.data };
}

function parseComment(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  return typeof b.comment === "string" && b.comment.length <= 1000 ? b.comment : undefined;
}

function parseReason(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  return typeof b.reason === "string" && b.reason.length <= 500 ? b.reason : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /hr/leave-requests - Submit a leave request
// ═══════════════════════════════════════════════════════════════════════════════
//
// Synchronous invariants enforced before HTTP response:
//   1. Date validation      - startDate ≤ endDate, businessDaysCount > 0
//   2. Conflict validation  - no overlapping requests in pending/pending_approval/approved
//   3. Balance validation   - entitled - used - pending ≥ businessDaysCount
//   4. Balance reservation  - pending += businessDaysCount (or used += for auto-approved)
//   5. Request INSERT       - leave_requests row written atomically with balance update
//   6. Approval step INSERT - leave_approval_steps row if requiresApproval = true
//
// All 6 steps run inside a single DB transaction.
// Bus events are emitted AFTER the transaction commits (fire-and-forget).

router.post("/hr/leave-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const parsed = parseSubmitLeaveBody(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const { leaveType, startDate, endDate, employeeNote, leavePolicyId, attachmentUrls } = parsed;

  // ── Date ordering validation ─────────────────────────────────────────────────
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate must be on or before endDate" });
    return;
  }

  // ── Resolve employee record ──────────────────────────────────────────────────
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));

  if (!employee) { res.status(403).json({ error: "No employee profile found for your account" }); return; }

  // ── Calendar days ────────────────────────────────────────────────────────────
  const start = new Date(`${startDate}T00:00:00Z`);
  const end   = new Date(`${endDate}T00:00:00Z`);
  const daysRequested = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

  // ── Business day calculation (server-side, never trusted from client) ─────────
  const businessDaysCount = await calcBusinessDays(workspaceId, startDate, endDate);
  if (businessDaysCount <= 0) {
    res.status(400).json({ error: "The selected date range contains no working days" });
    return;
  }

  // ── Resolve leave policy ─────────────────────────────────────────────────────
  let policy: { id: number; requiresApproval: boolean } | null = null;
  if (leavePolicyId) {
    const [p] = await db
      .select({ id: hrLeavePoliciesTable.id, requiresApproval: hrLeavePoliciesTable.requiresApproval })
      .from(hrLeavePoliciesTable)
      .where(and(eq(hrLeavePoliciesTable.id, leavePolicyId), eq(hrLeavePoliciesTable.workspaceId, workspaceId)));
    if (!p) { res.status(400).json({ error: "Leave policy not found in this workspace" }); return; }
    policy = p;
  }

  const requiresApproval = policy?.requiresApproval ?? true;

  // ── Resolve approver (always set when approval required — P18-D4) ───────────
  const approver = requiresApproval
    ? await resolveApproverWithFallback(workspaceId, employee.id, userId)
    : null;

  // ── Main transaction: conflict check + balance check + inserts ───────────────
  let leaveRequest: typeof leaveRequestsTable.$inferSelect;
  let leaveApprovalStep: typeof leaveApprovalStepsTable.$inferSelect | null = null;
  let balanceId: number | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Conflict check — canonical + legacy active rows (P18-D4)
      const overlaps = await findLeaveDateOverlaps(tx, {
        workspaceId,
        employeeId: employee.id,
        startDate,
        endDate,
      });
      if (overlaps.length > 0) {
        if (overlaps.some((h) => h.source === "legacy")) incrementLeaveMetric("overlap_legacy_hit");
        if (overlaps.some((h) => h.source === "canonical")) incrementLeaveMetric("overlap_canonical_hit");
        throw Object.assign(new Error("CONFLICT"), {
          statusCode: 409,
          message: leaveOverlapErrorMessage(overlaps),
        });
      }

      // 2. Balance check (read with FOR UPDATE to prevent race conditions)
      let balance: typeof hrLeaveBalancesTable.$inferSelect | null = null;
      if (leavePolicyId) {
        const year = new Date(`${startDate}T00:00:00Z`).getUTCFullYear();
        const [bal] = await tx
          .select()
          .from(hrLeaveBalancesTable)
          .where(
            and(
              eq(hrLeaveBalancesTable.employeeId, employee.id),
              eq(hrLeaveBalancesTable.leavePolicyId, leavePolicyId),
              eq(hrLeaveBalancesTable.year, year),
            ),
          )
          .for("update")
          .limit(1);

        if (bal) {
          const entitled = parseFloat(bal.entitled) || 0;
          const used     = parseFloat(bal.used)     || 0;
          const pending  = parseFloat(bal.pending)  || 0;
          const available = entitled - used - pending;

          if (available < businessDaysCount) {
            throw Object.assign(new Error("BALANCE"), {
              statusCode: 422,
              message: `Insufficient leave balance. Available: ${available.toFixed(1)} days, Requested: ${businessDaysCount} days`,
            });
          }
          balance = bal;
        }
      }

      // 3. Generate unique request number (retry on collision is handled by DB unique constraint)
      const requestNumber = generateRequestNumber();

      // 4. Determine initial status
      const initialStatus = requiresApproval ? "pending_approval" : "approved";

      // 5. Insert the leave request
      const [inserted] = await tx
        .insert(leaveRequestsTable)
        .values({
          workspaceId,
          employeeId:        employee.id,
          requestedByUserId: userId,
          leavePolicyId:     leavePolicyId ?? null,
          leaveType,
          startDate,
          endDate,
          daysRequested,
          businessDaysCount,
          status:            initialStatus,
          employeeNote:      employeeNote ?? null,
          currentApproverId: requiresApproval ? approver!.approverUserId : null,
          approvedByUserId:  requiresApproval ? null : userId,
          approvedAt:        requiresApproval ? null : new Date(),
          requestNumber,
          attachmentUrls:    attachmentUrls?.length ? attachmentUrls : null,
        })
        .returning();

      if (!inserted) throw new Error("Failed to insert leave request");

      // 6. Update balance
      if (balance) {
        if (requiresApproval) {
          // Reserve as pending
          await tx
            .update(hrLeaveBalancesTable)
            .set({ pending: String(parseFloat(balance.pending) + businessDaysCount) })
            .where(eq(hrLeaveBalancesTable.id, balance.id));
        } else {
          // Auto-approved: move directly to used
          await tx
            .update(hrLeaveBalancesTable)
            .set({ used: String(parseFloat(balance.used) + businessDaysCount) })
            .where(eq(hrLeaveBalancesTable.id, balance.id));
        }
        balanceId = balance.id;
      }

      // 7. Create approval step (required when pending_approval)
      let step: typeof leaveApprovalStepsTable.$inferSelect | null = null;
      if (requiresApproval) {
        const [s] = await tx
          .insert(leaveApprovalStepsTable)
          .values({
            leaveRequestId: inserted.id,
            stepOrder:      1,
            approverUserId: approver!.approverUserId,
            approverRole:   approver!.approverRole,
            status:         "pending",
            notifiedAt:     new Date(),
          })
          .returning();
        step = s ?? null;
        if (!step) throw new Error("Failed to create approval step");
      }

      return { leaveRequest: inserted, leaveApprovalStep: step };
    });

    leaveRequest     = result.leaveRequest;
    leaveApprovalStep = result.leaveApprovalStep;
  } catch (err: unknown) {
    const typed = err as { statusCode?: number; message?: string };
    if (typed.statusCode === 409) incrementLeaveMetric("canonical_submit_conflict");
    if (typed.statusCode === 409 || typed.statusCode === 422) {
      res.status(typed.statusCode).json({ error: typed.message });
      return;
    }
    logger.error({ err, employeeId: employee.id }, "[leave] Failed to submit leave request");
    res.status(500).json({ error: "Failed to submit leave request" });
    return;
  }

  incrementLeaveMetric("canonical_submit_total");

  // ── HTTP response ─────────────────────────────────────────────────────────────
  res.status(201).json({ leaveRequest, leaveApprovalStep });

  void mirrorCanonicalLeaveToLegacy(workspaceId, leaveRequest.id).catch(() => undefined);

  if (requiresApproval && leaveApprovalStep) {
    void startLeaveApproval(
      workspaceId,
      leaveRequest.id,
      employee.id,
      userId,
      { leaveType, startDate, endDate, daysRequested: businessDaysCount },
      leaveApprovalStep.id,
    ).catch((err) => logger.warn({ err, leaveRequestId: leaveRequest.id }, "Unified approval dual-write skipped"));
  }

  if (attachmentUrls?.length) {
    const { bridgeLeaveAttachments } = await import("../lib/documents/document-bridge");
    void bridgeLeaveAttachments({
      workspaceId,
      userId,
      leaveRequestId: leaveRequest.id,
      attachmentUrls,
    });
  }

  // ── Bus: leave.requested ──────────────────────────────────────────────────────
  void appEventBus.emit({
    type:      EVENT_TYPES.LEAVE_REQUESTED,
    module:    "hr",
    workspace: { workspaceId },
    actor:     { userId, role: req.userRole },
    metadata:  { idempotencyKey: `leave-requested-${leaveRequest.id}`, requestId: String(req.id) },
    data: {
      leaveRequestId:  leaveRequest.id,
      employeeUserId:  userId,
      leaveType,
      startDate,
      endDate,
      daysRequested:   businessDaysCount,
      departmentId:    null,
      employeeNote:    employeeNote ?? undefined,
      leavePolicyId:   leavePolicyId ?? null,
      requiresApproval,
    },
  });

  // ── Bus: leave.approved (auto-approved path only) ─────────────────────────────
  if (!requiresApproval) {
    void appEventBus.emit({
      type:      EVENT_TYPES.LEAVE_APPROVED,
      module:    "hr",
      workspace: { workspaceId },
      actor:     { userId, role: req.userRole },
      metadata:  { idempotencyKey: `leave-approved-${leaveRequest.id}`, requestId: String(req.id) },
      data: {
        leaveRequestId:  leaveRequest.id,
        employeeUserId:  userId,
        leaveType,
        startDate,
        endDate,
        daysApproved:    businessDaysCount,
        approvedByUserId: userId,
        leavePolicyId:   leavePolicyId ?? null,
        departmentId:    null,
      },
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /hr/leave-requests - List leave requests
// ═══════════════════════════════════════════════════════════════════════════════
//
// HR managers (hr.manage permission) see all workspace requests.
// Employees without hr.manage see only their own requests.

router.get("/hr/leave-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const { status, leaveType, employeeId: qEmpId } = req.query as Record<string, string | undefined>;

  const viewAll = canViewAllLeaveRequests(req);

  const conditions: Parameters<typeof and>[0][] = [
    eq(leaveRequestsTable.workspaceId, workspaceId),
  ];

  if (!viewAll) {
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));
    if (!emp) { res.json([]); return; }
    conditions.push(eq(leaveRequestsTable.employeeId, emp.id));
  } else if (qEmpId) {
    const empId = parseId(qEmpId);
    if (empId) conditions.push(eq(leaveRequestsTable.employeeId, empId));
  }

  if (status && typeof status === "string" && status !== "__all__") {
    if (status === "pending") {
      conditions.push(inArray(leaveRequestsTable.status, ["pending", "pending_approval"]));
    } else {
      conditions.push(eq(leaveRequestsTable.status, status));
    }
  }
  if (leaveType && typeof leaveType === "string") {
    conditions.push(eq(leaveRequestsTable.leaveType, leaveType));
  }

  const rows = await db
    .select({
      id: leaveRequestsTable.id,
      workspaceId: leaveRequestsTable.workspaceId,
      employeeId: leaveRequestsTable.employeeId,
      requestedByUserId: leaveRequestsTable.requestedByUserId,
      leavePolicyId: leaveRequestsTable.leavePolicyId,
      leaveType: leaveRequestsTable.leaveType,
      startDate: leaveRequestsTable.startDate,
      endDate: leaveRequestsTable.endDate,
      daysRequested: leaveRequestsTable.daysRequested,
      businessDaysCount: leaveRequestsTable.businessDaysCount,
      status: leaveRequestsTable.status,
      employeeNote: leaveRequestsTable.employeeNote,
      managerNote: leaveRequestsTable.managerNote,
      attachmentUrls: leaveRequestsTable.attachmentUrls,
      currentApproverId: leaveRequestsTable.currentApproverId,
      approvedByUserId: leaveRequestsTable.approvedByUserId,
      approvedAt: leaveRequestsTable.approvedAt,
      rejectedByUserId: leaveRequestsTable.rejectedByUserId,
      rejectedAt: leaveRequestsTable.rejectedAt,
      cancelledAt: leaveRequestsTable.cancelledAt,
      requestNumber: leaveRequestsTable.requestNumber,
      sourceFormId: leaveRequestsTable.sourceFormId,
      sourceSubmissionId: leaveRequestsTable.sourceSubmissionId,
      createdAt: leaveRequestsTable.createdAt,
      updatedAt: leaveRequestsTable.updatedAt,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
    })
    .from(leaveRequestsTable)
    .innerJoin(employeesTable, eq(leaveRequestsTable.employeeId, employeesTable.id))
    .where(and(...(conditions as [ReturnType<typeof eq>])))
    .orderBy(desc(leaveRequestsTable.createdAt))
    .limit(200);

  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /hr/leave-requests/team-calendar — read-only team leave overlay (F5.3)
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/hr/leave-requests/team-calendar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const monthRaw = String(req.query.month ?? "").trim();
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthRaw);
  if (!monthMatch) {
    res.status(400).json({ error: "month query required (YYYY-MM)" });
    return;
  }
  const year = Number(monthMatch[1]);
  const mon = Number(monthMatch[2]);
  if (mon < 1 || mon > 12) { res.status(400).json({ error: "Invalid month" }); return; }

  const monthStart = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const monthEnd = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const viewAll = canViewAllLeaveRequests(req);
  let teamEmployeeIds: number[] | null = null;

  if (!viewAll) {
    const [mgr] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));
    if (!mgr) {
      res.json({ month: monthRaw, scope: "team", readOnly: true, entries: [] });
      return;
    }
    const reports = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.workspaceId, workspaceId),
          eq(employeesTable.directManagerId, mgr.id),
        ),
      );
    teamEmployeeIds = reports.map((r) => r.id);
    if (!teamEmployeeIds.length) {
      res.json({ month: monthRaw, scope: "team", readOnly: true, entries: [] });
      return;
    }
  }

  const conditions: Parameters<typeof and>[0][] = [
    eq(leaveRequestsTable.workspaceId, workspaceId),
    lte(leaveRequestsTable.startDate, monthEnd),
    gte(leaveRequestsTable.endDate, monthStart),
    inArray(leaveRequestsTable.status, ["pending", "pending_approval", "approved"]),
  ];

  if (teamEmployeeIds) {
    conditions.push(inArray(leaveRequestsTable.employeeId, teamEmployeeIds));
  }

  const rows = await db
    .select({
      requestId: leaveRequestsTable.id,
      employeeId: leaveRequestsTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      leaveType: leaveRequestsTable.leaveType,
      startDate: leaveRequestsTable.startDate,
      endDate: leaveRequestsTable.endDate,
      status: leaveRequestsTable.status,
      businessDaysCount: leaveRequestsTable.businessDaysCount,
      requestNumber: leaveRequestsTable.requestNumber,
    })
    .from(leaveRequestsTable)
    .innerJoin(employeesTable, eq(leaveRequestsTable.employeeId, employeesTable.id))
    .where(and(...(conditions as [ReturnType<typeof eq>])))
    .orderBy(asc(leaveRequestsTable.startDate));

  res.json({
    month: monthRaw,
    scope: viewAll ? "workspace" : "team",
    readOnly: true,
    entries: rows,
  });
});

// Self-service: active leave policies (read-only; no hr.view required)
router.get("/hr/me/leave-policies", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace access" }); return; }

  const rows = await db
    .select({
      id: hrLeavePoliciesTable.id,
      name: hrLeavePoliciesTable.name,
      nameAr: hrLeavePoliciesTable.nameAr,
      leaveType: hrLeavePoliciesTable.leaveType,
      requiresApproval: hrLeavePoliciesTable.requiresApproval,
      isActive: hrLeavePoliciesTable.isActive,
    })
    .from(hrLeavePoliciesTable)
    .where(
      and(eq(hrLeavePoliciesTable.workspaceId, workspaceId), eq(hrLeavePoliciesTable.isActive, true)),
    )
    .orderBy(asc(hrLeavePoliciesTable.displayOrder), asc(hrLeavePoliciesTable.name));

  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /hr/leave-requests/:id - Get single request with approval steps
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/hr/leave-requests/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [leaveReq] = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.workspaceId, workspaceId)));

  if (!leaveReq) { res.status(404).json({ error: "Leave request not found" }); return; }

  const viewAll = canViewAllLeaveRequests(req);
  if (!viewAll) {
    const ownsRequest =
      leaveReq.requestedByUserId === userId ||
      (await employeeOwnedByUser(workspaceId, leaveReq.employeeId, userId));
    if (!ownsRequest) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const steps = await db
    .select()
    .from(leaveApprovalStepsTable)
    .where(eq(leaveApprovalStepsTable.leaveRequestId, id))
    .orderBy(leaveApprovalStepsTable.stepOrder);

  res.json({ leaveRequest: leaveReq, approvalSteps: steps });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /hr/leave-requests/:id/approve - Approver approves the request
// ═══════════════════════════════════════════════════════════════════════════════
//
// The acting user must be the designated approver on the current pending step
// OR have hr.manage permission (admin override).
//
// Synchronous actions in transaction:
//   1. Mark approval step as approved
//   2. Update leave_requests: status → approved, approvedByUserId, approvedAt
//   3. Update balance: pending -= businessDaysCount, used += businessDaysCount

router.patch("/hr/leave-requests/:id/approve", requireAuth, requirePermission("leave.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const comment = parseComment(req.body);
  const canOverride = canActAsLeaveApprover(req);

  let updated: typeof leaveRequestsTable.$inferSelect;

  try {
    const result = await db.transaction(async (tx) => {
      const [leaveReq] = await tx
        .select()
        .from(leaveRequestsTable)
        .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.workspaceId, workspaceId)))
        .for("update")
        .limit(1);

      if (!leaveReq) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404, message: "Leave request not found" });
      if (leaveReq.status !== "pending_approval") {
        throw Object.assign(new Error("INVALID_STATE"), {
          statusCode: 422,
          message: `Cannot approve a request with status "${leaveReq.status}"`,
        });
      }

      let [step] = await tx
        .select()
        .from(leaveApprovalStepsTable)
        .where(
          and(
            eq(leaveApprovalStepsTable.leaveRequestId, id),
            eq(leaveApprovalStepsTable.status, "pending"),
          ),
        )
        .orderBy(leaveApprovalStepsTable.stepOrder)
        .limit(1);

      if (!step && canOverride) {
        const [repaired] = await tx
          .insert(leaveApprovalStepsTable)
          .values({
            leaveRequestId: id,
            stepOrder:      1,
            approverUserId: userId,
            approverRole:   req.userPermissions?.includes("hr.manage") ? "hr" : "admin",
            status:         "pending",
            notifiedAt:     new Date(),
          })
          .returning();
        step = repaired;
      }

      if (!step) throw Object.assign(new Error("NO_STEP"), { statusCode: 422, message: "No pending approval step found" });

      if (step.approverUserId !== userId && !canOverride) {
        throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403, message: "You are not the designated approver for this request" });
      }

      // Mark step as approved
      await tx
        .update(leaveApprovalStepsTable)
        .set({ status: "approved", comment: comment ?? null, decidedAt: new Date() })
        .where(eq(leaveApprovalStepsTable.id, step.id));

      // Update leave request status
      const [approvedReq] = await tx
        .update(leaveRequestsTable)
        .set({
          status:           "approved",
          approvedByUserId: userId,
          approvedAt:       new Date(),
          currentApproverId: null,
          managerNote:      comment ?? null,
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();

      // Update balance: pending → used
      if (leaveReq.leavePolicyId) {
        const year = new Date(`${leaveReq.startDate}T00:00:00Z`).getUTCFullYear();
        const [bal] = await tx
          .select()
          .from(hrLeaveBalancesTable)
          .where(
            and(
              eq(hrLeaveBalancesTable.employeeId, leaveReq.employeeId),
              eq(hrLeaveBalancesTable.leavePolicyId, leaveReq.leavePolicyId),
              eq(hrLeaveBalancesTable.year, year),
            ),
          )
          .for("update")
          .limit(1);

        if (bal) {
          const newPending = Math.max(0, parseFloat(bal.pending) - leaveReq.businessDaysCount);
          const newUsed    = parseFloat(bal.used) + leaveReq.businessDaysCount;
          await tx
            .update(hrLeaveBalancesTable)
            .set({ pending: String(newPending), used: String(newUsed) })
            .where(eq(hrLeaveBalancesTable.id, bal.id));
        }
      }

      return approvedReq!;
    });

    updated = result;
  } catch (err: unknown) {
    const typed = err as { statusCode?: number; message?: string };
    if (typed.statusCode) { res.status(typed.statusCode).json({ error: typed.message }); return; }
    logger.error({ err, leaveRequestId: id }, "[leave] Failed to approve leave request");
    res.status(500).json({ error: "Failed to approve leave request" });
    return;
  }

  incrementLeaveMetric("canonical_approve_total");
  res.json(updated);

  void mirrorCanonicalLeaveToLegacy(workspaceId, id).catch(() => undefined);
  void syncLeaveStepDecision(workspaceId, id, "approved", userId, comment ?? null).catch(() => undefined);

  // ── Bus: leave.approved ───────────────────────────────────────────────────────
  void appEventBus.emit({
    type:      EVENT_TYPES.LEAVE_APPROVED,
    module:    "hr",
    workspace: { workspaceId },
    actor:     { userId, role: req.userRole },
    metadata:  { idempotencyKey: `leave-approved-${id}`, requestId: String(req.id) },
    data: {
      leaveRequestId:   id,
      employeeUserId:   updated.requestedByUserId,
      leaveType:        updated.leaveType,
      startDate:        updated.startDate,
      endDate:          updated.endDate,
      daysApproved:     updated.businessDaysCount,
      approvedByUserId: userId,
      leavePolicyId:    updated.leavePolicyId ?? null,
      departmentId:     null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /hr/leave-requests/:id/reject - Approver rejects the request
// ═══════════════════════════════════════════════════════════════════════════════
//
// Synchronous actions in transaction:
//   1. Mark approval step as rejected
//   2. Update leave_requests: status → rejected, rejectedByUserId, rejectedAt
//   3. Update balance: pending -= businessDaysCount (release reservation)

router.patch("/hr/leave-requests/:id/reject", requireAuth, requirePermission("leave.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const comment = parseComment(req.body);
  if (!comment?.trim()) {
    res.status(400).json({
      error: "Rejection reason is required",
      code: "REJECT_REASON_REQUIRED",
    });
    return;
  }
  const canOverride = canActAsLeaveApprover(req);

  let rejectedReq: typeof leaveRequestsTable.$inferSelect;

  try {
    const result = await db.transaction(async (tx) => {
      const [leaveReq] = await tx
        .select()
        .from(leaveRequestsTable)
        .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.workspaceId, workspaceId)))
        .for("update")
        .limit(1);

      if (!leaveReq) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404, message: "Leave request not found" });
      if (leaveReq.status !== "pending_approval" && leaveReq.status !== "pending") {
        throw Object.assign(new Error("INVALID_STATE"), {
          statusCode: 422,
          message: `Cannot reject a request with status "${leaveReq.status}"`,
        });
      }

      // Find current pending step
      const [step] = await tx
        .select()
        .from(leaveApprovalStepsTable)
        .where(
          and(
            eq(leaveApprovalStepsTable.leaveRequestId, id),
            eq(leaveApprovalStepsTable.status, "pending"),
          ),
        )
        .orderBy(leaveApprovalStepsTable.stepOrder)
        .limit(1);

      if (step) {
        if (step.approverUserId !== userId && !canOverride) {
          throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403, message: "You are not the designated approver for this request" });
        }
        await tx
          .update(leaveApprovalStepsTable)
          .set({ status: "rejected", comment: comment ?? null, decidedAt: new Date() })
          .where(eq(leaveApprovalStepsTable.id, step.id));
      } else if (!canOverride) {
        throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403, message: "Access denied" });
      }

      const [rejected] = await tx
        .update(leaveRequestsTable)
        .set({
          status:           "rejected",
          rejectedByUserId: userId,
          rejectedAt:       new Date(),
          currentApproverId: null,
          managerNote:      comment ?? null,
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();

      // Release pending balance reservation
      if (leaveReq.leavePolicyId) {
        const year = new Date(`${leaveReq.startDate}T00:00:00Z`).getUTCFullYear();
        const [bal] = await tx
          .select()
          .from(hrLeaveBalancesTable)
          .where(
            and(
              eq(hrLeaveBalancesTable.employeeId, leaveReq.employeeId),
              eq(hrLeaveBalancesTable.leavePolicyId, leaveReq.leavePolicyId),
              eq(hrLeaveBalancesTable.year, year),
            ),
          )
          .for("update")
          .limit(1);

        if (bal) {
          const newPending = Math.max(0, parseFloat(bal.pending) - leaveReq.businessDaysCount);
          await tx
            .update(hrLeaveBalancesTable)
            .set({ pending: String(newPending) })
            .where(eq(hrLeaveBalancesTable.id, bal.id));
        }
      }

      return rejected!;
    });

    rejectedReq = result;
  } catch (err: unknown) {
    const typed = err as { statusCode?: number; message?: string };
    if (typed.statusCode) { res.status(typed.statusCode).json({ error: typed.message }); return; }
    logger.error({ err, leaveRequestId: id }, "[leave] Failed to reject leave request");
    res.status(500).json({ error: "Failed to reject leave request" });
    return;
  }

  incrementLeaveMetric("canonical_reject_total");
  res.json(rejectedReq);

  void mirrorCanonicalLeaveToLegacy(workspaceId, id).catch(() => undefined);
  void syncLeaveStepDecision(workspaceId, id, "rejected", userId, comment ?? null).catch(() => undefined);

  // ── Bus: leave.rejected ───────────────────────────────────────────────────────
  void appEventBus.emit({
    type:      EVENT_TYPES.LEAVE_REJECTED,
    module:    "hr",
    workspace: { workspaceId },
    actor:     { userId, role: req.userRole },
    metadata:  { idempotencyKey: `leave-rejected-${id}`, requestId: String(req.id) },
    data: {
      leaveRequestId:   id,
      employeeUserId:   rejectedReq.requestedByUserId,
      leaveType:        rejectedReq.leaveType,
      startDate:        rejectedReq.startDate,
      endDate:          rejectedReq.endDate,
      daysRequested:    rejectedReq.businessDaysCount,
      rejectedByUserId: userId,
      rejectionReason:  comment ?? undefined,
      departmentId:     null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /hr/leave-requests/:id/withdraw - Employee withdraws their own request
// ═══════════════════════════════════════════════════════════════════════════════
//
// Only the employee who submitted the request can withdraw it.
// Only allowed when status is "pending" or "pending_approval".
//
// Synchronous actions in transaction:
//   1. Update leave_requests: status → withdrawn
//   2. Cancel pending approval step
//   3. Release balance: pending -= businessDaysCount

router.patch("/hr/leave-requests/:id/withdraw", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace access" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const reason = parseReason(req.body);
  let withdrawnReq: typeof leaveRequestsTable.$inferSelect;

  try {
    const result = await db.transaction(async (tx) => {
      const [leaveReq] = await tx
        .select()
        .from(leaveRequestsTable)
        .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.workspaceId, workspaceId)))
        .for("update")
        .limit(1);

      if (!leaveReq) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404, message: "Leave request not found" });

      // Only the requester can withdraw
      if (leaveReq.requestedByUserId !== userId) {
        throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403, message: "You can only withdraw your own leave requests" });
      }

      if (leaveReq.status !== "pending" && leaveReq.status !== "pending_approval") {
        throw Object.assign(new Error("INVALID_STATE"), {
          statusCode: 422,
          message: `Cannot withdraw a request with status "${leaveReq.status}". Only pending or pending_approval requests can be withdrawn.`,
        });
      }

      // Cancel pending approval steps
      await tx
        .update(leaveApprovalStepsTable)
        .set({ status: "skipped", decidedAt: new Date() })
        .where(
          and(
            eq(leaveApprovalStepsTable.leaveRequestId, id),
            eq(leaveApprovalStepsTable.status, "pending"),
          ),
        );

      const [withdrawn] = await tx
        .update(leaveRequestsTable)
        .set({
          status:           "withdrawn",
          currentApproverId: null,
          managerNote:      reason ?? null,
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();

      // Release pending balance reservation
      if (leaveReq.leavePolicyId) {
        const year = new Date(`${leaveReq.startDate}T00:00:00Z`).getUTCFullYear();
        const [bal] = await tx
          .select()
          .from(hrLeaveBalancesTable)
          .where(
            and(
              eq(hrLeaveBalancesTable.employeeId, leaveReq.employeeId),
              eq(hrLeaveBalancesTable.leavePolicyId, leaveReq.leavePolicyId),
              eq(hrLeaveBalancesTable.year, year),
            ),
          )
          .for("update")
          .limit(1);

        if (bal) {
          const newPending = Math.max(0, parseFloat(bal.pending) - leaveReq.businessDaysCount);
          await tx
            .update(hrLeaveBalancesTable)
            .set({ pending: String(newPending) })
            .where(eq(hrLeaveBalancesTable.id, bal.id));
        }
      }

      return withdrawn!;
    });

    withdrawnReq = result;
  } catch (err: unknown) {
    const typed = err as { statusCode?: number; message?: string };
    if (typed.statusCode) { res.status(typed.statusCode).json({ error: typed.message }); return; }
    logger.error({ err, leaveRequestId: id }, "[leave] Failed to withdraw leave request");
    res.status(500).json({ error: "Failed to withdraw leave request" });
    return;
  }

  res.json(withdrawnReq);

  void mirrorCanonicalLeaveToLegacy(workspaceId, id).catch(() => undefined);

  // ── Bus: leave.withdrawn ──────────────────────────────────────────────────────
  void appEventBus.emit({
    type:      EVENT_TYPES.LEAVE_WITHDRAWN,
    module:    "hr",
    workspace: { workspaceId },
    actor:     { userId, role: req.userRole },
    metadata:  { idempotencyKey: `leave-withdrawn-${id}`, requestId: String(req.id) },
    data: {
      leaveRequestId: id,
      employeeUserId: userId,
      leaveType:      withdrawnReq.leaveType,
      startDate:      withdrawnReq.startDate,
      endDate:        withdrawnReq.endDate,
      daysRequested:  withdrawnReq.businessDaysCount,
      departmentId:   null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /hr/leave-cutover/status — pilot + effective flags for current workspace
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/hr/leave-cutover/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.json(leaveCutoverStatusForWorkspace(null));
    return;
  }
  const status = await getEffectiveLeaveCutoverStatus(workspaceId);
  res.json(status);
});

router.get(
  "/hr/leave-cutover/metrics",
  requireAuth,
  requirePermission("hr.manage"),
  async (_req: AuthRequest, res): Promise<void> => {
    res.json({
      metrics: getLeaveCutoverMetrics(),
      pilotWorkspaceId: leaveCutoverStatusForWorkspace(null).pilotWorkspaceId,
    });
  },
);

export default router;
