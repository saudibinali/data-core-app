/**
 * @file   routes/workspace-subscriptions.ts
 * @phase  P16-A - Subscription State Model
 *
 * GET    /platform/tenants/:tenantId/subscription
 * POST   /platform/tenants/:tenantId/subscription
 * PATCH  /platform/tenants/:tenantId/subscription
 * PATCH  /platform/tenants/:tenantId/subscription/status
 *
 * SAFETY: state model only - no enforcement, payment, email, or DELETE.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialContractTermsTable,
  workspaceSubscriptionsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  WORKSPACE_SUBSCRIPTION_STATUSES,
  isWorkspaceSubscriptionStatus,
  canTransitionWorkspaceSubscriptionStatus,
} from "../lib/workspace-subscription-transitions";

const MAX_TEXT = 2000;
const MAX_CODE = 80;
const MAX_NAME = 200;
const MIN_REASON_LEN = 10;
const RENEWAL_BUFFER_DAYS = 90;

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "cardNumber",
  "cardLast4",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "paymentGateway",
  "checkoutSessionId",
  "taxAmount",
  "vatAmount",
  "zatcaUuid",
  "ledgerEntryId",
  "invoiceId",
  "amountDue",
]);

function rejectForbiddenFields(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return `Field '${key}' is not allowed on workspace subscriptions`;
    }
    const lower = key.toLowerCase();
    if (lower.includes("stripe") || lower.includes("checkout") || lower.includes("payment")) {
      return `Field '${key}' is not allowed on workspace subscriptions`;
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

function strOpt(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max) || null;
}

function parseDate(v: unknown): string | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  if (typeof v !== "string") return "INVALID";
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "INVALID";
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "INVALID";
  return s;
}

function parseOptionalId(v: unknown): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

/** Convert parse* sentinels to SQL-safe nulls (never persist "MISSING" to the database). */
function dateFieldToNull(v: string | null | "INVALID" | "MISSING"): string | null {
  return v === "MISSING" ? null : v;
}

function optionalIdToNull(v: number | null | "INVALID" | "MISSING"): number | null {
  return v === "MISSING" ? null : v;
}

function parseTimestamp(v: unknown): Date | null | "INVALID" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "INVALID";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "INVALID";
  return d;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validateSubscriptionDates(input: {
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  status: string;
  gracePeriodEndsAt: Date | null;
}): string | null {
  const { startDate, endDate, renewalDate, status, gracePeriodEndsAt } = input;

  if (startDate && endDate && startDate > endDate) {
    return "startDate must be on or before endDate";
  }

  if (renewalDate) {
    if (startDate && renewalDate < startDate) {
      return "renewalDate must be on or after startDate";
    }
    const renewalUpper = endDate ? addDays(endDate, RENEWAL_BUFFER_DAYS) : null;
    if (renewalUpper && renewalDate > renewalUpper) {
      return "renewalDate must fall within the subscription period (or within 90 days after endDate)";
    }
  }

  if (status === "grace_period" && gracePeriodEndsAt && endDate) {
    const graceEnd = gracePeriodEndsAt.toISOString().slice(0, 10);
    if (graceEnd <= endDate) {
      return "gracePeriodEndsAt must be after endDate when status is grace_period";
    }
  }

  return null;
}

function serializeSubscription(row: typeof workspaceSubscriptionsTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    tenantId: row.workspaceId,
    commercialAccountId: row.commercialAccountId,
    activeContractTermId: row.activeContractTermId,
    subscriptionCode: row.subscriptionCode,
    subscriptionName: row.subscriptionName,
    status: row.status,
    statusReason: row.statusReason,
    startDate: row.startDate,
    endDate: row.endDate,
    renewalDate: row.renewalDate,
    gracePeriodEndsAt: row.gracePeriodEndsAt?.toISOString() ?? null,
    suspensionStartedAt: row.suspensionStartedAt?.toISOString() ?? null,
    terminationDate: row.terminationDate,
    planName: row.planName,
    internalNotes: row.internalNotes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function auditSubscription(
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

async function loadSubscription(workspaceId: number) {
  return db.query.workspaceSubscriptionsTable.findFirst({
    where: eq(workspaceSubscriptionsTable.workspaceId, workspaceId),
  });
}

async function validateCommercialAccountId(
  tenantId: number,
  accountId: number | null,
): Promise<string | null> {
  if (accountId == null) return null;
  const account = await db.query.commercialAccountsTable.findFirst({
    where: and(
      eq(commercialAccountsTable.id, accountId),
      eq(commercialAccountsTable.workspaceId, tenantId),
    ),
  });
  if (!account) return "commercialAccountId does not belong to this tenant";
  return null;
}

async function validateContractTermId(
  tenantId: number,
  contractId: number | null,
): Promise<string | null> {
  if (contractId == null) return null;
  const contract = await db.query.commercialContractTermsTable.findFirst({
    where: and(
      eq(commercialContractTermsTable.id, contractId),
      eq(commercialContractTermsTable.workspaceId, tenantId),
    ),
  });
  if (!contract) return "activeContractTermId does not belong to this tenant";
  return null;
}

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/subscription",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptions.read"),
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

    const sub = await loadSubscription(tenantId);
    res.json({ subscription: sub ? serializeSubscription(sub) : null });
  },
);

router.post(
  "/platform/tenants/:tenantId/subscription",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptions.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbiddenFields(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existing = await loadSubscription(tenantId);
    if (existing) {
      res.status(409).json({ error: "Subscription already exists for this tenant" });
      return;
    }

    const subscriptionCode = strRequired(body.subscriptionCode, MAX_CODE);
    if (subscriptionCode === "MISSING" || subscriptionCode === "INVALID") {
      res.status(400).json({ error: "subscriptionCode is required" });
      return;
    }

    const subscriptionName = strRequired(body.subscriptionName, MAX_NAME);
    if (subscriptionName === "MISSING" || subscriptionName === "INVALID") {
      res.status(400).json({ error: "subscriptionName is required" });
      return;
    }

    const statusRaw = body.status === undefined ? "trial" : body.status;
    if (typeof statusRaw !== "string" || !isWorkspaceSubscriptionStatus(statusRaw)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const commercialAccountIdRaw = parseOptionalId(body.commercialAccountId);
    if (commercialAccountIdRaw === "INVALID") {
      res.status(400).json({ error: "Invalid commercialAccountId" });
      return;
    }
    const activeContractTermIdRaw = parseOptionalId(body.activeContractTermId);
    if (activeContractTermIdRaw === "INVALID") {
      res.status(400).json({ error: "Invalid activeContractTermId" });
      return;
    }
    const commercialAccountId = optionalIdToNull(commercialAccountIdRaw);
    const activeContractTermId = optionalIdToNull(activeContractTermIdRaw);

    const acctErr = await validateCommercialAccountId(tenantId, commercialAccountId);
    if (acctErr) {
      res.status(400).json({ error: acctErr });
      return;
    }
    const contractErr = await validateContractTermId(tenantId, activeContractTermId);
    if (contractErr) {
      res.status(400).json({ error: contractErr });
      return;
    }

    const startDate = parseDate(body.startDate);
    if (startDate === "INVALID") {
      res.status(400).json({ error: "Invalid startDate" });
      return;
    }
    const endDate = parseDate(body.endDate);
    if (endDate === "INVALID") {
      res.status(400).json({ error: "Invalid endDate" });
      return;
    }
    const renewalDate = parseDate(body.renewalDate);
    if (renewalDate === "INVALID") {
      res.status(400).json({ error: "Invalid renewalDate" });
      return;
    }

    const gracePeriodEndsAt = parseTimestamp(body.gracePeriodEndsAt);
    if (gracePeriodEndsAt === "INVALID") {
      res.status(400).json({ error: "Invalid gracePeriodEndsAt" });
      return;
    }

    const startDateValue = dateFieldToNull(startDate);
    const endDateValue = dateFieldToNull(endDate);
    const renewalDateValue = dateFieldToNull(renewalDate);

    const dateErr = validateSubscriptionDates({
      startDate: startDateValue,
      endDate: endDateValue,
      renewalDate: renewalDateValue,
      status: statusRaw,
      gracePeriodEndsAt,
    });
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    const [created] = await db
      .insert(workspaceSubscriptionsTable)
      .values({
        workspaceId: tenantId,
        commercialAccountId,
        activeContractTermId,
        subscriptionCode,
        subscriptionName,
        status: statusRaw,
        statusReason: strOpt(body.statusReason, MAX_TEXT),
        startDate: startDateValue,
        endDate: endDateValue,
        renewalDate: renewalDateValue,
        gracePeriodEndsAt,
        planName: strOpt(body.planName, MAX_NAME),
        internalNotes: strOpt(body.internalNotes, MAX_TEXT),
        createdBy: req.userId!,
        updatedBy: req.userId!,
      })
      .returning();

    await auditSubscription("workspace_subscription_created", req.userId!, tenantId, {
      subscriptionId: created.id,
      subscriptionCode: created.subscriptionCode,
      status: created.status,
    });

    res.status(201).json({ subscription: serializeSubscription(created) });
  },
);

router.patch(
  "/platform/tenants/:tenantId/subscription",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptions.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbiddenFields(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }
    if (body.status !== undefined) {
      res.status(400).json({ error: "Use PATCH /subscription/status to change status" });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existing = await loadSubscription(tenantId);
    if (!existing) {
      res.status(404).json({ error: "No subscription found for this tenant" });
      return;
    }

    const patch: Partial<typeof workspaceSubscriptionsTable.$inferInsert> = {
      updatedBy: req.userId!,
    };
    const changedFields: string[] = [];

    if (body.subscriptionCode !== undefined) {
      const code = strRequired(body.subscriptionCode, MAX_CODE);
      if (code === "MISSING" || code === "INVALID") {
        res.status(400).json({ error: "Invalid subscriptionCode" });
        return;
      }
      if (code !== existing.subscriptionCode) changedFields.push("subscriptionCode");
      patch.subscriptionCode = code;
    }

    if (body.subscriptionName !== undefined) {
      const name = strRequired(body.subscriptionName, MAX_NAME);
      if (name === "MISSING" || name === "INVALID" || typeof name !== "string") {
        res.status(400).json({ error: "Invalid subscriptionName" });
        return;
      }
      if (name !== existing.subscriptionName) changedFields.push("subscriptionName");
      patch.subscriptionName = name;
    }

    if (body.commercialAccountId !== undefined) {
      const commercialAccountIdRaw = parseOptionalId(body.commercialAccountId);
      if (commercialAccountIdRaw === "INVALID") {
        res.status(400).json({ error: "Invalid commercialAccountId" });
        return;
      }
      const commercialAccountId = optionalIdToNull(commercialAccountIdRaw);
      const acctErr = await validateCommercialAccountId(tenantId, commercialAccountId);
      if (acctErr) {
        res.status(400).json({ error: acctErr });
        return;
      }
      if (commercialAccountId !== existing.commercialAccountId) changedFields.push("commercialAccountId");
      patch.commercialAccountId = commercialAccountId;
    }

    if (body.activeContractTermId !== undefined) {
      const activeContractTermIdRaw = parseOptionalId(body.activeContractTermId);
      if (activeContractTermIdRaw === "INVALID") {
        res.status(400).json({ error: "Invalid activeContractTermId" });
        return;
      }
      const activeContractTermId = optionalIdToNull(activeContractTermIdRaw);
      const contractErr = await validateContractTermId(tenantId, activeContractTermId);
      if (contractErr) {
        res.status(400).json({ error: contractErr });
        return;
      }
      if (activeContractTermId !== existing.activeContractTermId) {
        changedFields.push("activeContractTermId");
      }
      patch.activeContractTermId = activeContractTermId;
    }

    let startDate = existing.startDate;
    let endDate = existing.endDate;
    let renewalDate = existing.renewalDate;
    let gracePeriodEndsAt = existing.gracePeriodEndsAt;

    if (body.startDate !== undefined) {
      const parsedRaw = parseDate(body.startDate);
      if (parsedRaw === "INVALID") {
        res.status(400).json({ error: "Invalid startDate" });
        return;
      }
      const parsed = dateFieldToNull(parsedRaw);
      if (parsed !== startDate) changedFields.push("startDate");
      startDate = parsed;
      patch.startDate = parsed;
    }

    if (body.endDate !== undefined) {
      const parsedRaw = parseDate(body.endDate);
      if (parsedRaw === "INVALID") {
        res.status(400).json({ error: "Invalid endDate" });
        return;
      }
      const parsed = dateFieldToNull(parsedRaw);
      if (parsed !== endDate) changedFields.push("endDate");
      endDate = parsed;
      patch.endDate = parsed;
    }

    if (body.renewalDate !== undefined) {
      const parsedRaw = parseDate(body.renewalDate);
      if (parsedRaw === "INVALID") {
        res.status(400).json({ error: "Invalid renewalDate" });
        return;
      }
      const parsed = dateFieldToNull(parsedRaw);
      if (parsed !== renewalDate) changedFields.push("renewalDate");
      renewalDate = parsed;
      patch.renewalDate = parsed;
    }

    if (body.gracePeriodEndsAt !== undefined) {
      const parsed = parseTimestamp(body.gracePeriodEndsAt);
      if (parsed === "INVALID") {
        res.status(400).json({ error: "Invalid gracePeriodEndsAt" });
        return;
      }
      const prev = existing.gracePeriodEndsAt?.toISOString() ?? null;
      const next = parsed?.toISOString() ?? null;
      if (prev !== next) changedFields.push("gracePeriodEndsAt");
      gracePeriodEndsAt = parsed;
      patch.gracePeriodEndsAt = parsed;
    }

    if (body.planName !== undefined) {
      const planName = strOpt(body.planName, MAX_NAME);
      if (planName !== existing.planName) changedFields.push("planName");
      patch.planName = planName;
    }

    if (body.internalNotes !== undefined) {
      const internalNotes = strOpt(body.internalNotes, MAX_TEXT);
      if (internalNotes !== existing.internalNotes) changedFields.push("internalNotes");
      patch.internalNotes = internalNotes;
    }

    const dateErr = validateSubscriptionDates({
      startDate,
      endDate,
      renewalDate,
      status: existing.status,
      gracePeriodEndsAt,
    });
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    const [updated] = await db
      .update(workspaceSubscriptionsTable)
      .set(patch)
      .where(eq(workspaceSubscriptionsTable.id, existing.id))
      .returning();

    await auditSubscription("workspace_subscription_updated", req.userId!, tenantId, {
      subscriptionId: updated.id,
      changedFields,
    });

    res.json({ subscription: serializeSubscription(updated) });
  },
);

router.patch(
  "/platform/tenants/:tenantId/subscription/status",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptions.status.change"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const reason = strRequired(body.reason, MAX_TEXT);
    if (reason === "MISSING" || reason === "INVALID" || typeof reason !== "string") {
      res.status(400).json({ error: "reason is required for status change" });
      return;
    }
    if (reason.length < MIN_REASON_LEN) {
      res.status(400).json({ error: `reason must be at least ${MIN_REASON_LEN} characters` });
      return;
    }

    const nextStatusRaw = body.status;
    if (typeof nextStatusRaw !== "string" || !isWorkspaceSubscriptionStatus(nextStatusRaw)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existing = await loadSubscription(tenantId);
    if (!existing) {
      res.status(404).json({ error: "No subscription found for this tenant" });
      return;
    }

    const previousStatus = existing.status;
    if (!isWorkspaceSubscriptionStatus(previousStatus)) {
      res.status(400).json({ error: "Current subscription status is invalid" });
      return;
    }

    const transition = canTransitionWorkspaceSubscriptionStatus(previousStatus, nextStatusRaw);
    if (!transition.allowed) {
      await auditSubscription(
        "workspace_subscription_status_change_blocked",
        req.userId!,
        tenantId,
        {
          subscriptionId: existing.id,
          previousStatus,
          nextStatus: nextStatusRaw,
          reason,
          blockReason: transition.reason,
        },
      );
      res.status(400).json({ error: transition.reason ?? "Status transition not allowed" });
      return;
    }

    let gracePeriodEndsAt = existing.gracePeriodEndsAt;
    if (body.gracePeriodEndsAt !== undefined) {
      const parsed = parseTimestamp(body.gracePeriodEndsAt);
      if (parsed === "INVALID") {
        res.status(400).json({ error: "Invalid gracePeriodEndsAt" });
        return;
      }
      gracePeriodEndsAt = parsed;
    }

    let suspensionStartedAt = existing.suspensionStartedAt;
    if (nextStatusRaw === "suspended" && !suspensionStartedAt) {
      suspensionStartedAt = new Date();
    }

    let terminationDate = existing.terminationDate;
    if (nextStatusRaw === "terminated" && !terminationDate) {
      terminationDate = new Date().toISOString().slice(0, 10);
    }

    const dateErr = validateSubscriptionDates({
      startDate: existing.startDate,
      endDate: existing.endDate,
      renewalDate: existing.renewalDate,
      status: nextStatusRaw,
      gracePeriodEndsAt,
    });
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    const [updated] = await db
      .update(workspaceSubscriptionsTable)
      .set({
        status: nextStatusRaw,
        statusReason: reason,
        gracePeriodEndsAt,
        suspensionStartedAt,
        terminationDate,
        updatedBy: req.userId!,
      })
      .where(eq(workspaceSubscriptionsTable.id, existing.id))
      .returning();

    await auditSubscription("workspace_subscription_status_changed", req.userId!, tenantId, {
      subscriptionId: updated.id,
      previousStatus,
      nextStatus: nextStatusRaw,
      reason,
    });

    res.json({ subscription: serializeSubscription(updated) });
  },
);

export default router;
