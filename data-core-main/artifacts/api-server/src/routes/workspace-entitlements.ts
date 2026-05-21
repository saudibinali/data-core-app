/**
 * @file   routes/workspace-entitlements.ts
 * @phase  P16-B - Entitlement & Feature Access Model
 *
 * GET  /platform/tenants/:tenantId/entitlements/catalog
 * GET  /platform/tenants/:tenantId/entitlements
 * PUT  /platform/tenants/:tenantId/entitlements
 * PATCH /platform/tenants/:tenantId/entitlements/:entitlementId
 *
 * SAFETY: model only - no enforcement, DELETE, tenant APIs, or payment fields.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  workspaceEntitlementsTable,
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
  buildEntitlementCatalogPayload,
  featureBelongsToModule,
  isCoreModule,
  isEntitlementModuleKey,
  isEntitlementSource,
} from "../lib/workspace-entitlement-catalog";

const MIN_REASON_LEN = 10;
const MAX_TEXT = 2000;
const MAX_KEY = 120;

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

function parseDate(v: unknown): string | null | "INVALID" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "INVALID";
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "INVALID";
  return s;
}

function parseOptionalId(v: unknown): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

function normalizeFeatureKey(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") return "__INVALID__";
  return v.trim().slice(0, MAX_KEY);
}

function serializeEntitlement(row: typeof workspaceEntitlementsTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    tenantId: row.workspaceId,
    subscriptionId: row.subscriptionId,
    moduleKey: row.moduleKey,
    featureKey: row.featureKey ? row.featureKey : null,
    isEnabled: row.isEnabled,
    source: row.source,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    reason: row.reason,
    internalNotes: row.internalNotes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function auditEntitlement(
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
    where: and(
      eq(workspaceSubscriptionsTable.id, subscriptionId),
      eq(workspaceSubscriptionsTable.workspaceId, tenantId),
    ),
  });
  if (!sub) return "subscriptionId does not belong to this tenant";
  return null;
}

interface EntitlementInput {
  moduleKey: string;
  featureKey: string;
  isEnabled: boolean;
  source: string;
  subscriptionId: number | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  reason: string | null;
  internalNotes: string | null;
}

function validateEntitlementInput(
  input: EntitlementInput,
): { ok: true } | { ok: false; error: string; block?: boolean } {
  if (!isEntitlementModuleKey(input.moduleKey)) {
    return { ok: false, error: "Invalid moduleKey" };
  }

  if (input.featureKey && input.featureKey !== "__INVALID__") {
    if (!featureBelongsToModule(input.featureKey, input.moduleKey)) {
      return { ok: false, error: "featureKey does not belong to moduleKey", block: true };
    }
  } else if (input.featureKey === "__INVALID__") {
    return { ok: false, error: "Invalid featureKey" };
  }

  if (isCoreModule(input.moduleKey) && !input.isEnabled) {
    return { ok: false, error: "core module cannot be disabled", block: true };
  }

  if (!input.isEnabled) {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < MIN_REASON_LEN) {
      return { ok: false, error: `reason is required when disabling (min ${MIN_REASON_LEN} chars)` };
    }
  }

  if (input.effectiveFrom && input.effectiveUntil && input.effectiveFrom > input.effectiveUntil) {
    return { ok: false, error: "effectiveFrom must be on or before effectiveUntil" };
  }

  if (!isEntitlementSource(input.source)) {
    return { ok: false, error: "Invalid source" };
  }

  return { ok: true };
}

function parseEntitlementItem(raw: Record<string, unknown>): EntitlementInput | "INVALID" {
  const moduleKey = typeof raw.moduleKey === "string" ? raw.moduleKey.trim() : "";
  const featureKey = normalizeFeatureKey(raw.featureKey);
  if (featureKey === "__INVALID__") return "INVALID";

  if (typeof raw.isEnabled !== "boolean") return "INVALID";

  const source =
    typeof raw.source === "string" && isEntitlementSource(raw.source)
      ? raw.source
      : "manual";

  const subscriptionId = parseOptionalId(raw.subscriptionId);
  if (subscriptionId === "INVALID") return "INVALID";

  const effectiveFrom = parseDate(raw.effectiveFrom);
  if (effectiveFrom === "INVALID") return "INVALID";
  const effectiveUntil = parseDate(raw.effectiveUntil);
  if (effectiveUntil === "INVALID") return "INVALID";

  return {
    moduleKey,
    featureKey,
    isEnabled: raw.isEnabled,
    source,
    subscriptionId: subscriptionId === "MISSING" ? null : subscriptionId,
    effectiveFrom,
    effectiveUntil,
    reason: strOpt(raw.reason, MAX_TEXT),
    internalNotes: strOpt(raw.internalNotes, MAX_TEXT),
  };
}

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/entitlements/catalog",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.entitlements.read"),
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
    res.json({ catalog: buildEntitlementCatalogPayload() });
  },
);

router.get(
  "/platform/tenants/:tenantId/entitlements",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.entitlements.read"),
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

    const rows = await db
      .select()
      .from(workspaceEntitlementsTable)
      .where(eq(workspaceEntitlementsTable.workspaceId, tenantId));

    res.json({
      entitlements: rows.map(serializeEntitlement),
      catalog: buildEntitlementCatalogPayload(),
    });
  },
);

router.put(
  "/platform/tenants/:tenantId/entitlements",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.entitlements.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenant ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbidden(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const list = body.entitlements;
    if (!Array.isArray(list) || list.length === 0) {
      res.status(400).json({ error: "entitlements array is required" });
      return;
    }

    const parsed: EntitlementInput[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) {
        res.status(400).json({ error: "Invalid entitlement item" });
        return;
      }
      const row = parseEntitlementItem(item as Record<string, unknown>);
      if (row === "INVALID") {
        res.status(400).json({ error: "Invalid entitlement item" });
        return;
      }
      const validation = validateEntitlementInput(row);
      if (!validation.ok) {
        if (validation.block) {
          await auditEntitlement("workspace_entitlement_change_blocked", req.userId!, tenantId, {
            moduleKey: row.moduleKey,
            featureKey: row.featureKey || null,
            blockReason: validation.error,
          });
        }
        res.status(400).json({ error: validation.error });
        return;
      }
      const subErr = await validateSubscriptionId(tenantId, row.subscriptionId);
      if (subErr) {
        res.status(400).json({ error: subErr });
        return;
      }
      parsed.push(row);
    }

    const results: ReturnType<typeof serializeEntitlement>[] = [];

    for (const row of parsed) {
      const [upserted] = await db
        .insert(workspaceEntitlementsTable)
        .values({
          workspaceId: tenantId,
          subscriptionId: row.subscriptionId,
          moduleKey: row.moduleKey,
          featureKey: row.featureKey,
          isEnabled: row.isEnabled,
          source: row.source,
          effectiveFrom: row.effectiveFrom,
          effectiveUntil: row.effectiveUntil,
          reason: row.reason,
          internalNotes: row.internalNotes,
          createdBy: req.userId!,
          updatedBy: req.userId!,
        })
        .onConflictDoUpdate({
          target: [
            workspaceEntitlementsTable.workspaceId,
            workspaceEntitlementsTable.moduleKey,
            workspaceEntitlementsTable.featureKey,
          ],
          set: {
            subscriptionId: row.subscriptionId,
            isEnabled: row.isEnabled,
            source: row.source,
            effectiveFrom: row.effectiveFrom,
            effectiveUntil: row.effectiveUntil,
            reason: row.reason,
            internalNotes: row.internalNotes,
            updatedBy: req.userId!,
          },
        })
        .returning();

      results.push(serializeEntitlement(upserted));
    }

    await auditEntitlement("workspace_entitlements_updated", req.userId!, tenantId, {
      count: results.length,
      moduleKeys: [...new Set(parsed.map((p) => p.moduleKey))],
    });

    res.json({ entitlements: results });
  },
);

router.patch(
  "/platform/tenants/:tenantId/entitlements/:entitlementId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.entitlements.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const entitlementId = Number(req.params.entitlementId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(entitlementId) || entitlementId < 1) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbidden(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }

    const ws = await loadTenant(tenantId);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existing = await db.query.workspaceEntitlementsTable.findFirst({
      where: and(
        eq(workspaceEntitlementsTable.id, entitlementId),
        eq(workspaceEntitlementsTable.workspaceId, tenantId),
      ),
    });

    if (!existing) {
      res.status(404).json({ error: "Entitlement not found" });
      return;
    }

    const nextEnabled =
      body.isEnabled !== undefined ? Boolean(body.isEnabled) : existing.isEnabled;

    const nextModule = typeof body.moduleKey === "string" ? body.moduleKey.trim() : existing.moduleKey;
    const nextFeature =
      body.featureKey !== undefined ? normalizeFeatureKey(body.featureKey) : existing.featureKey;
    if (nextFeature === "__INVALID__") {
      res.status(400).json({ error: "Invalid featureKey" });
      return;
    }

    const nextSource =
      typeof body.source === "string" && isEntitlementSource(body.source)
        ? body.source
        : existing.source;

    const subscriptionId = body.subscriptionId !== undefined
      ? parseOptionalId(body.subscriptionId)
      : existing.subscriptionId;
    if (subscriptionId === "INVALID") {
      res.status(400).json({ error: "Invalid subscriptionId" });
      return;
    }
    const subErr = await validateSubscriptionId(
      tenantId,
      subscriptionId === "MISSING" ? existing.subscriptionId : subscriptionId,
    );
    if (subErr) {
      res.status(400).json({ error: subErr });
      return;
    }

    const effectiveFrom =
      body.effectiveFrom !== undefined ? parseDate(body.effectiveFrom) : existing.effectiveFrom;
    if (effectiveFrom === "INVALID") {
      res.status(400).json({ error: "Invalid effectiveFrom" });
      return;
    }
    const effectiveUntil =
      body.effectiveUntil !== undefined ? parseDate(body.effectiveUntil) : existing.effectiveUntil;
    if (effectiveUntil === "INVALID") {
      res.status(400).json({ error: "Invalid effectiveUntil" });
      return;
    }

    const reason = body.reason !== undefined ? strOpt(body.reason, MAX_TEXT) : existing.reason;
    const internalNotes =
      body.internalNotes !== undefined ? strOpt(body.internalNotes, MAX_TEXT) : existing.internalNotes;

    const candidate: EntitlementInput = {
      moduleKey: nextModule,
      featureKey: nextFeature,
      isEnabled: nextEnabled,
      source: nextSource,
      subscriptionId: subscriptionId === "MISSING" ? existing.subscriptionId : subscriptionId,
      effectiveFrom,
      effectiveUntil,
      reason,
      internalNotes,
    };

    const validation = validateEntitlementInput(candidate);
    if (!validation.ok) {
      if (validation.block) {
        await auditEntitlement("workspace_entitlement_change_blocked", req.userId!, tenantId, {
          entitlementId,
          moduleKey: candidate.moduleKey,
          featureKey: candidate.featureKey || null,
          previousEnabled: existing.isEnabled,
          nextEnabled: candidate.isEnabled,
          blockReason: validation.error,
        });
      }
      res.status(400).json({ error: validation.error });
      return;
    }

    const [updated] = await db
      .update(workspaceEntitlementsTable)
      .set({
        subscriptionId: candidate.subscriptionId,
        moduleKey: candidate.moduleKey,
        featureKey: candidate.featureKey,
        isEnabled: candidate.isEnabled,
        source: candidate.source,
        effectiveFrom: candidate.effectiveFrom,
        effectiveUntil: candidate.effectiveUntil,
        reason: candidate.reason,
        internalNotes: candidate.internalNotes,
        updatedBy: req.userId!,
      })
      .where(eq(workspaceEntitlementsTable.id, entitlementId))
      .returning();

    await auditEntitlement("workspace_entitlement_changed", req.userId!, tenantId, {
      entitlementId,
      moduleKey: updated.moduleKey,
      featureKey: updated.featureKey || null,
      previousEnabled: existing.isEnabled,
      nextEnabled: updated.isEnabled,
      source: updated.source,
      reason: updated.reason,
    });

    res.json({ entitlement: serializeEntitlement(updated) });
  },
);

export default router;
