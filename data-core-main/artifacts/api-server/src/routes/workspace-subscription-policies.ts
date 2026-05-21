/**
 * @file   routes/workspace-subscription-policies.ts
 * @phase  P16-D - Grace Period & Suspension Rules
 *
 * GET /platform/tenants/:tenantId/subscription-policy
 * PUT /platform/tenants/:tenantId/subscription-policy
 * GET /platform/tenants/:tenantId/subscription-policy/evaluation
 *
 * SAFETY: policy model + advisory evaluation only. No DELETE, enforcement, or tenant APIs.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  workspaceSubscriptionsTable,
  workspaceSubscriptionPoliciesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  DEFAULT_SUBSCRIPTION_POLICY,
  isSubscriptionPolicyEnforcementMode,
  validatePolicyDayOrdering,
  type SubscriptionPolicyFields,
} from "../lib/subscription-policy-defaults";
import { evaluateSubscriptionPolicy } from "../lib/workspace-subscription-policy-evaluator";

const MIN_REASON_LEN = 10;
const MAX_TEXT = 2000;
const MAX_NAME = 200;

const FORBIDDEN_KEYS = new Set([
  "stripeCustomerId",
  "paymentGateway",
  "checkoutSessionId",
  "cardNumber",
  "taxAmount",
  "vatAmount",
  "zatcaUuid",
  "ledgerEntryId",
  "amountDue",
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

function strOpt(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max) || null;
}

function strRequired(v: unknown, max: number): string | null | "INVALID" | "MISSING" {
  if (v === undefined || v === null || v === "") return "MISSING";
  if (typeof v !== "string") return "INVALID";
  const s = v.trim().slice(0, max);
  return s || "INVALID";
}

function parseNonNegInt(v: unknown, field: string): number | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "INVALID";
  return n;
}

function parseOptionalTerminationDays(v: unknown): number | null | "INVALID" {
  if (v === undefined) return null;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "INVALID";
  return n;
}

function parseOptionalId(v: unknown): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

function parseBool(v: unknown, defaultValue: boolean): boolean | "INVALID" {
  if (v === undefined) return defaultValue;
  if (typeof v === "boolean") return v;
  return "INVALID";
}

function policyFieldsFromRow(
  row: typeof workspaceSubscriptionPoliciesTable.$inferSelect,
): SubscriptionPolicyFields {
  return {
    policyName: row.policyName,
    gracePeriodDays: row.gracePeriodDays,
    pastDueAfterDays: row.pastDueAfterDays,
    suspensionAfterDays: row.suspensionAfterDays,
    terminationAfterDays: row.terminationAfterDays,
    allowReadOnlyDuringSuspension: row.allowReadOnlyDuringSuspension,
    allowAdminAccessDuringSuspension: row.allowAdminAccessDuringSuspension,
    allowDataExportDuringSuspension: row.allowDataExportDuringSuspension,
    enforcementMode: isSubscriptionPolicyEnforcementMode(row.enforcementMode)
      ? row.enforcementMode
      : "advisory_only",
    isActive: row.isActive,
  };
}

function defaultPolicyPayload(workspaceId: number, subscriptionId: number | null) {
  return {
    id: null as number | null,
    workspaceId,
    tenantId: workspaceId,
    subscriptionId,
    ...DEFAULT_SUBSCRIPTION_POLICY,
    reason: null,
    internalNotes: null,
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
    isDefault: true,
  };
}

function serializePolicy(
  row: typeof workspaceSubscriptionPoliciesTable.$inferSelect,
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    tenantId: row.workspaceId,
    subscriptionId: row.subscriptionId,
    policyName: row.policyName,
    gracePeriodDays: row.gracePeriodDays,
    pastDueAfterDays: row.pastDueAfterDays,
    suspensionAfterDays: row.suspensionAfterDays,
    terminationAfterDays: row.terminationAfterDays,
    allowReadOnlyDuringSuspension: row.allowReadOnlyDuringSuspension,
    allowAdminAccessDuringSuspension: row.allowAdminAccessDuringSuspension,
    allowDataExportDuringSuspension: row.allowDataExportDuringSuspension,
    enforcementMode: row.enforcementMode,
    isActive: row.isActive,
    reason: row.reason,
    internalNotes: row.internalNotes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isDefault: false,
  };
}

async function auditPolicy(
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

async function loadPolicy(workspaceId: number) {
  return db.query.workspaceSubscriptionPoliciesTable.findFirst({
    where: eq(workspaceSubscriptionPoliciesTable.workspaceId, workspaceId),
  });
}

async function validateSubscriptionId(
  tenantId: number,
  subscriptionId: number | null,
): Promise<string | null> {
  if (subscriptionId == null) return null;
  const sub = await db.query.workspaceSubscriptionsTable.findFirst({
    where: and(
      eq(workspaceSubscriptionsTable.id, subscriptionId),
      eq(workspaceSubscriptionsTable.workspaceId, tenantId),
    ),
  });
  if (!sub) return "subscriptionId does not belong to this tenant";
  return null;
}

function parsePolicyBody(
  body: Record<string, unknown>,
  existing?: SubscriptionPolicyFields,
): { ok: true; fields: SubscriptionPolicyFields & { subscriptionId: number | null; reason: string; internalNotes: string | null } } | { ok: false; error: string; block?: boolean } {
  const base = existing ?? DEFAULT_SUBSCRIPTION_POLICY;

  const policyNameRaw = body.policyName !== undefined ? strRequired(body.policyName, MAX_NAME) : base.policyName;
  if (policyNameRaw === "MISSING" || policyNameRaw === "INVALID") {
    return { ok: false, error: "policyName is required" };
  }

  const grace = body.gracePeriodDays !== undefined ? parseNonNegInt(body.gracePeriodDays, "gracePeriodDays") : base.gracePeriodDays;
  if (grace === "MISSING" || grace === "INVALID") return { ok: false, error: "Invalid gracePeriodDays" };

  const pastDue = body.pastDueAfterDays !== undefined ? parseNonNegInt(body.pastDueAfterDays, "pastDueAfterDays") : base.pastDueAfterDays;
  if (pastDue === "MISSING" || pastDue === "INVALID") return { ok: false, error: "Invalid pastDueAfterDays" };

  const suspension = body.suspensionAfterDays !== undefined ? parseNonNegInt(body.suspensionAfterDays, "suspensionAfterDays") : base.suspensionAfterDays;
  if (suspension === "MISSING" || suspension === "INVALID") return { ok: false, error: "Invalid suspensionAfterDays" };

  const termination = body.terminationAfterDays !== undefined
    ? parseOptionalTerminationDays(body.terminationAfterDays)
    : base.terminationAfterDays;
  if (termination === "INVALID") return { ok: false, error: "Invalid terminationAfterDays" };

  const enforcementModeRaw = body.enforcementMode !== undefined ? body.enforcementMode : base.enforcementMode;
  if (typeof enforcementModeRaw !== "string" || !isSubscriptionPolicyEnforcementMode(enforcementModeRaw)) {
    return { ok: false, error: "Invalid enforcementMode", block: true };
  }

  const allowReadOnly = parseBool(body.allowReadOnlyDuringSuspension, base.allowReadOnlyDuringSuspension);
  const allowAdmin = parseBool(body.allowAdminAccessDuringSuspension, base.allowAdminAccessDuringSuspension);
  const allowExport = parseBool(body.allowDataExportDuringSuspension, base.allowDataExportDuringSuspension);
  if (allowReadOnly === "INVALID" || allowAdmin === "INVALID" || allowExport === "INVALID") {
    return { ok: false, error: "Invalid suspension access flags" };
  }

  const isActive = parseBool(body.isActive, base.isActive);
  if (isActive === "INVALID") return { ok: false, error: "Invalid isActive" };

  const subscriptionId = body.subscriptionId !== undefined
    ? parseOptionalId(body.subscriptionId)
    : ("MISSING" as const);
  const subId = subscriptionId === "MISSING" ? null : subscriptionId;
  if (subscriptionId === "INVALID") return { ok: false, error: "Invalid subscriptionId" };

  const reasonRaw = strRequired(body.reason, MAX_TEXT);
  if (reasonRaw === "MISSING" || reasonRaw === "INVALID") {
    return { ok: false, error: `reason is required (min ${MIN_REASON_LEN} chars)` };
  }
  if (reasonRaw.length < MIN_REASON_LEN) {
    return { ok: false, error: `reason is required (min ${MIN_REASON_LEN} chars)` };
  }

  const fields: SubscriptionPolicyFields = {
    policyName: policyNameRaw,
    gracePeriodDays: grace,
    pastDueAfterDays: pastDue,
    suspensionAfterDays: suspension,
    terminationAfterDays: termination,
    allowReadOnlyDuringSuspension: allowReadOnly,
    allowAdminAccessDuringSuspension: allowAdmin,
    allowDataExportDuringSuspension: allowExport,
    enforcementMode: enforcementModeRaw,
    isActive,
  };

  const orderErr = validatePolicyDayOrdering(fields);
  if (orderErr) return { ok: false, error: orderErr };

  return {
    ok: true,
    fields: {
      ...fields,
      subscriptionId: subId,
      reason: reasonRaw,
      internalNotes: strOpt(body.internalNotes, MAX_TEXT),
    },
  };
}

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/subscription-policy",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptionPolicies.read"),
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
    const policy = await loadPolicy(tenantId);

    if (!policy) {
      res.json({
        policy: defaultPolicyPayload(tenantId, sub?.id ?? null),
      });
      return;
    }

    res.json({ policy: serializePolicy(policy) });
  },
);

router.put(
  "/platform/tenants/:tenantId/subscription-policy",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptionPolicies.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbidden(body);
    if (forbidden) {
      await auditPolicy("workspace_subscription_policy_change_blocked", req.userId!, tenantId, {
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

    const existing = await loadPolicy(tenantId);
    const parsed = parsePolicyBody(body, existing ? policyFieldsFromRow(existing) : undefined);
    if (!parsed.ok) {
      if (parsed.block) {
        await auditPolicy("workspace_subscription_policy_change_blocked", req.userId!, tenantId, {
          reason: parsed.error,
        });
      }
      res.status(400).json({ error: parsed.error });
      return;
    }

    const subIdErr = await validateSubscriptionId(tenantId, parsed.fields.subscriptionId);
    if (subIdErr) {
      await auditPolicy("workspace_subscription_policy_change_blocked", req.userId!, tenantId, {
        reason: subIdErr,
        subscriptionId: parsed.fields.subscriptionId,
      });
      res.status(400).json({ error: subIdErr });
      return;
    }

    const sub = await loadSubscription(tenantId);
    const effectiveSubId = parsed.fields.subscriptionId ?? sub?.id ?? null;

    const rowData = {
      workspaceId: tenantId,
      subscriptionId: effectiveSubId,
      policyName: parsed.fields.policyName,
      gracePeriodDays: parsed.fields.gracePeriodDays,
      pastDueAfterDays: parsed.fields.pastDueAfterDays,
      suspensionAfterDays: parsed.fields.suspensionAfterDays,
      terminationAfterDays: parsed.fields.terminationAfterDays,
      allowReadOnlyDuringSuspension: parsed.fields.allowReadOnlyDuringSuspension,
      allowAdminAccessDuringSuspension: parsed.fields.allowAdminAccessDuringSuspension,
      allowDataExportDuringSuspension: parsed.fields.allowDataExportDuringSuspension,
      enforcementMode: parsed.fields.enforcementMode,
      isActive: parsed.fields.isActive,
      reason: parsed.fields.reason,
      internalNotes: parsed.fields.internalNotes,
      updatedBy: req.userId!,
    };

    let saved: typeof workspaceSubscriptionPoliciesTable.$inferSelect;

    if (existing) {
      [saved] = await db
        .update(workspaceSubscriptionPoliciesTable)
        .set(rowData)
        .where(eq(workspaceSubscriptionPoliciesTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(workspaceSubscriptionPoliciesTable)
        .values({
          ...rowData,
          createdBy: req.userId!,
        })
        .returning();
    }

    await auditPolicy("workspace_subscription_policy_updated", req.userId!, tenantId, {
      policyId: saved.id,
      subscriptionId: saved.subscriptionId,
      enforcementMode: saved.enforcementMode,
      gracePeriodDays: saved.gracePeriodDays,
      pastDueAfterDays: saved.pastDueAfterDays,
      suspensionAfterDays: saved.suspensionAfterDays,
      terminationAfterDays: saved.terminationAfterDays,
      reason: saved.reason,
    });

    res.json({ policy: serializePolicy(saved) });
  },
);

router.get(
  "/platform/tenants/:tenantId/subscription-policy/evaluation",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.subscriptionPolicies.evaluate"),
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
    const policyRow = await loadPolicy(tenantId);
    const policyFields = policyRow
      ? policyFieldsFromRow(policyRow)
      : { ...DEFAULT_SUBSCRIPTION_POLICY };

    const evaluation = evaluateSubscriptionPolicy({
      subscription: sub
        ? { id: sub.id, status: sub.status, endDate: sub.endDate }
        : null,
      policy: policyFields,
    });

    await auditPolicy("workspace_subscription_policy_evaluated", req.userId!, tenantId, {
      policyId: policyRow?.id ?? null,
      subscriptionId: sub?.id ?? null,
      enforcementMode: evaluation.enforcementMode,
      recommendedStatus: evaluation.recommendedStatus,
      recommendedAction: evaluation.recommendedAction,
      currentSubscriptionStatus: evaluation.currentSubscriptionStatus,
    });

    res.json({
      evaluation,
      policy: policyRow ? serializePolicy(policyRow) : defaultPolicyPayload(tenantId, sub?.id ?? null),
    });
  },
);

export default router;
