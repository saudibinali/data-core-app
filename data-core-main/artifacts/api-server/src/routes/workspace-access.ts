/**
 * @file   routes/workspace-access.ts
 * @phase  P16-E - Workspace Access Enforcement (platform APIs)
 *
 * GET   /platform/tenants/:tenantId/workspace-access
 * GET   /platform/tenants/:tenantId/workspace-access/evaluation
 * PATCH /platform/tenants/:tenantId/workspace-access
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  workspaceAccessEnforcementTable,
  workspaceSubscriptionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  isWorkspaceEnforcementStatus,
  isWorkspaceEnforcementSource,
  flagsForEnforcementStatus,
  type WorkspaceEnforcementStatus,
} from "../lib/workspace-access-enforcement-config";
import { resolveWorkspaceAccessMode } from "../lib/workspace-access-resolver";
import { evaluateCommercialWorkspaceEnforcement } from "../lib/commercial-workspace-enforcement-evaluator";

const MIN_REASON_LEN = 10;
const MAX_TEXT = 2000;

const FORBIDDEN_KEYS = new Set([
  "stripeCustomerId",
  "paymentGateway",
  "checkoutSessionId",
  "cardNumber",
  "purgeData",
  "deleteWorkspace",
]);

function rejectForbidden(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_KEYS.has(key)) return `Field '${key}' is not allowed`;
    const lower = key.toLowerCase();
    if (lower.includes("stripe") || lower.includes("payment") || lower.includes("checkout")) {
      return `Field '${key}' is not allowed`;
    }
  }
  return null;
}

function strRequired(v: unknown, max: number): string | null | "INVALID" | "MISSING" {
  if (v === undefined || v === null || v === "") return "MISSING";
  if (typeof v !== "string") return "INVALID";
  const s = v.trim().slice(0, max);
  return s || "INVALID";
}

function parseOptionalId(v: unknown): number | null | "INVALID" {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

async function auditAccess(
  action: string,
  actorId: number,
  workspaceId: number,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId: actorId,
    workspaceId,
    action,
    metadata: JSON.stringify({
      ...meta,
      actorId,
      workspaceId,
      tenantId: workspaceId,
      timestamp: new Date().toISOString(),
    }),
  });
}

async function loadTenant(tenantId: number) {
  return db.query.workspacesTable.findFirst({
    where: eq(workspacesTable.id, tenantId),
  });
}

async function validateSubscriptionId(
  tenantId: number,
  subscriptionId: number | null,
): Promise<string | null> {
  if (subscriptionId == null) return null;
  const sub = await db.query.workspaceSubscriptionsTable.findFirst({
    where: eq(workspaceSubscriptionsTable.id, subscriptionId),
  });
  if (!sub || sub.workspaceId !== tenantId) {
    return "subscriptionId does not belong to this tenant";
  }
  return null;
}

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/workspace-access",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.workspaceAccess.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }
    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const access = await resolveWorkspaceAccessMode(tenantId);
    res.json({ access });
  },
);

router.get(
  "/platform/tenants/:tenantId/workspace-access/evaluation",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.workspaceAccess.evaluate"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }
    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const evaluation = await evaluateCommercialWorkspaceEnforcement(tenantId);
    const access = await resolveWorkspaceAccessMode(tenantId);

    await auditAccess("workspace_access_evaluated", req.userId!, tenantId, {
      recommendation: evaluation.recommendation,
      subscriptionStatus: evaluation.subscriptionStatus,
      currentEnforcementStatus: access.enforcementStatus,
    });

    res.json({ evaluation, currentAccess: access });
  },
);

router.patch(
  "/platform/tenants/:tenantId/workspace-access",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.workspaceAccess.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbidden(body);
    if (forbidden) {
      await auditAccess("workspace_access_change_blocked", req.userId!, tenantId, {
        reason: forbidden,
      });
      res.status(400).json({ error: forbidden });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const statusRaw = body.enforcementStatus;
    if (typeof statusRaw !== "string" || !isWorkspaceEnforcementStatus(statusRaw)) {
      await auditAccess("workspace_access_change_blocked", req.userId!, tenantId, {
        reason: "Invalid enforcementStatus",
      });
      res.status(400).json({ error: "Invalid enforcementStatus" });
      return;
    }
    const enforcementStatus = statusRaw as WorkspaceEnforcementStatus;

    const reasonRaw = strRequired(body.reason, MAX_TEXT);
    if (reasonRaw === "MISSING" || reasonRaw === "INVALID" || reasonRaw.length < MIN_REASON_LEN) {
      res.status(400).json({ error: `reason is required (min ${MIN_REASON_LEN} chars)` });
      return;
    }

    if (body.allowLogin === false) {
      await auditAccess("workspace_access_change_blocked", req.userId!, tenantId, {
        reason: "Full login blocking is not allowed in P16-E",
      });
      res.status(400).json({ error: "allowLogin=false is not permitted in this phase" });
      return;
    }

    if (body.allowRead === false) {
      await auditAccess("workspace_access_change_blocked", req.userId!, tenantId, {
        reason: "allowRead=false is not permitted",
      });
      res.status(400).json({ error: "allowRead=false is not permitted" });
      return;
    }

    const sourceRaw = body.source;
    const source =
      typeof sourceRaw === "string" && isWorkspaceEnforcementSource(sourceRaw)
        ? sourceRaw
        : "manual";

    const subscriptionId = parseOptionalId(body.subscriptionId);
    if (subscriptionId === "INVALID") {
      res.status(400).json({ error: "Invalid subscriptionId" });
      return;
    }

    const subErr = await validateSubscriptionId(tenantId, subscriptionId);
    if (subErr) {
      await auditAccess("workspace_access_change_blocked", req.userId!, tenantId, {
        reason: subErr,
      });
      res.status(400).json({ error: subErr });
      return;
    }

    const sub = await db.query.workspaceSubscriptionsTable.findFirst({
      where: eq(workspaceSubscriptionsTable.workspaceId, tenantId),
    });
    const effectiveSubId = subscriptionId ?? sub?.id ?? null;

    const flags = flagsForEnforcementStatus(enforcementStatus, {
      allowExport: body.allowExport !== false,
      allowAdminAccess: body.allowAdminAccess !== false,
    });

    const previous = await resolveWorkspaceAccessMode(tenantId);

    const rowData = {
      workspaceId: tenantId,
      subscriptionId: effectiveSubId,
      enforcementStatus: flags.enforcementStatus,
      enforcementReason: reasonRaw,
      source,
      appliedBy: req.userId!,
      appliedAt: new Date(),
      allowLogin: true,
      allowRead: true,
      allowCreate: flags.allowCreate,
      allowUpdate: flags.allowUpdate,
      allowDelete: flags.allowDelete,
      allowExport: flags.allowExport,
      allowAdminAccess: flags.allowAdminAccess,
      internalNotes:
        typeof body.internalNotes === "string"
          ? body.internalNotes.trim().slice(0, MAX_TEXT) || null
          : null,
    };

    const existing = await db.query.workspaceAccessEnforcementTable.findFirst({
      where: eq(workspaceAccessEnforcementTable.workspaceId, tenantId),
    });

    let saved: typeof workspaceAccessEnforcementTable.$inferSelect;
    if (existing) {
      [saved] = await db
        .update(workspaceAccessEnforcementTable)
        .set(rowData)
        .where(eq(workspaceAccessEnforcementTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(workspaceAccessEnforcementTable)
        .values(rowData)
        .returning();
    }

    await auditAccess("workspace_access_mode_changed", req.userId!, tenantId, {
      previousMode: previous.enforcementStatus,
      nextMode: saved.enforcementStatus,
      subscriptionId: saved.subscriptionId,
      reason: reasonRaw,
      source,
    });

    const access = await resolveWorkspaceAccessMode(tenantId);
    res.json({ access });
  },
);

export default router;
