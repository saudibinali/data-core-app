/**
 * @file   routes/workspace-quotas.ts
 * @phase  P16-C - Workspace Limits & Quotas
 *
 * GET  /platform/tenants/:tenantId/quotas/catalog
 * GET  /platform/tenants/:tenantId/quotas
 * PUT  /platform/tenants/:tenantId/quotas
 * PATCH /platform/tenants/:tenantId/quotas/:quotaLimitId
 * GET  /platform/tenants/:tenantId/quotas/usage
 *
 * SAFETY: model only - no enforcement, DELETE, tenant APIs, or payment fields.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  workspaceQuotaLimitsTable,
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
  buildQuotaCatalogPayload,
  getQuotaCatalogEntry,
  isQuotaKey,
  isQuotaSource,
} from "../lib/workspace-quota-catalog";
import { resolveWorkspaceQuotaUsage } from "../lib/workspace-quota-resolver";

const MIN_REASON_LEN = 10;
const MAX_TEXT = 2000;

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

function parseLimitValue(v: unknown): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "INVALID";
  return Math.floor(n);
}

function parseWarningPercent(v: unknown): number | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) return "INVALID";
  return n;
}

function serializeQuotaLimit(row: typeof workspaceQuotaLimitsTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    tenantId: row.workspaceId,
    subscriptionId: row.subscriptionId,
    quotaKey: row.quotaKey,
    limitValue: row.limitValue,
    warningThresholdPercent: row.warningThresholdPercent,
    isHardLimit: row.isHardLimit,
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

async function auditQuota(
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

interface QuotaInput {
  quotaKey: string;
  limitValue: number | null;
  warningThresholdPercent: number;
  isHardLimit: boolean;
  source: string;
  subscriptionId: number | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  reason: string | null;
  internalNotes: string | null;
}

function validateQuotaInput(
  input: QuotaInput,
  opts?: { previousLimit?: number | null; previousHardLimit?: boolean },
): { ok: true } | { ok: false; error: string; block?: boolean } {
  if (!isQuotaKey(input.quotaKey)) {
    return { ok: false, error: "Invalid quotaKey", block: true };
  }

  const catalog = getQuotaCatalogEntry(input.quotaKey)!;

  if (input.limitValue !== null && input.limitValue < 0) {
    return { ok: false, error: "limitValue must be >= 0" };
  }

  if (input.warningThresholdPercent < 1 || input.warningThresholdPercent > 100) {
    return { ok: false, error: "warningThresholdPercent must be between 1 and 100" };
  }

  if (input.isHardLimit && !catalog.hardLimitSupported) {
    return {
      ok: false,
      error: `hard limit not supported for quota ${input.quotaKey}`,
      block: true,
    };
  }

  if (!isQuotaSource(input.source)) {
    return { ok: false, error: "Invalid source" };
  }

  if (input.effectiveFrom && input.effectiveUntil && input.effectiveFrom > input.effectiveUntil) {
    return { ok: false, error: "effectiveFrom must be on or before effectiveUntil" };
  }

  const prevLimit = opts?.previousLimit;
  const prevHard = opts?.previousHardLimit ?? false;

  const reducingLimit =
    prevLimit !== undefined &&
    input.limitValue !== null &&
    prevLimit !== null &&
    input.limitValue < prevLimit;

  const enablingHard = !prevHard && input.isHardLimit;

  if (reducingLimit || enablingHard) {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < MIN_REASON_LEN) {
      return {
        ok: false,
        error: `reason is required when reducing limit or enabling hard limit (min ${MIN_REASON_LEN} chars)`,
      };
    }
  }

  return { ok: true };
}

function parseQuotaItem(raw: Record<string, unknown>): QuotaInput | "INVALID" {
  const quotaKey = typeof raw.quotaKey === "string" ? raw.quotaKey.trim() : "";
  if (!quotaKey) return "INVALID";

  const limitValue = parseLimitValue(raw.limitValue);
  if (limitValue === "INVALID") return "INVALID";

  const warningThresholdPercent = parseWarningPercent(
    raw.warningThresholdPercent ?? getQuotaCatalogEntry(quotaKey)?.warningThresholdPercent ?? 80,
  );
  if (warningThresholdPercent === "INVALID") return "INVALID";

  if (typeof raw.isHardLimit !== "boolean") return "INVALID";

  const source =
    typeof raw.source === "string" && isQuotaSource(raw.source) ? raw.source : "manual";

  const subscriptionId = parseOptionalId(raw.subscriptionId);
  if (subscriptionId === "INVALID") return "INVALID";

  const effectiveFrom = parseDate(raw.effectiveFrom);
  if (effectiveFrom === "INVALID") return "INVALID";
  const effectiveUntil = parseDate(raw.effectiveUntil);
  if (effectiveUntil === "INVALID") return "INVALID";

  const catalogDefault = getQuotaCatalogEntry(quotaKey)?.defaultLimit ?? 0;

  return {
    quotaKey,
    limitValue: limitValue === "MISSING" ? catalogDefault : limitValue,
    warningThresholdPercent:
      warningThresholdPercent === "MISSING" ? 80 : warningThresholdPercent,
    isHardLimit: raw.isHardLimit,
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
  "/platform/tenants/:tenantId/quotas/catalog",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.quotas.read"),
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
    res.json({ catalog: buildQuotaCatalogPayload() });
  },
);

router.get(
  "/platform/tenants/:tenantId/quotas/usage",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.quotas.read"),
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
    const usage = await resolveWorkspaceQuotaUsage(tenantId);
    res.json({ usage });
  },
);

router.get(
  "/platform/tenants/:tenantId/quotas",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.quotas.read"),
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
      .from(workspaceQuotaLimitsTable)
      .where(eq(workspaceQuotaLimitsTable.workspaceId, tenantId));

    res.json({
      quotas: rows.map(serializeQuotaLimit),
      catalog: buildQuotaCatalogPayload(),
    });
  },
);

router.put(
  "/platform/tenants/:tenantId/quotas",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.quotas.update"),
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

    const list = body.quotas;
    if (!Array.isArray(list) || list.length === 0) {
      res.status(400).json({ error: "quotas array is required" });
      return;
    }

    const parsed: QuotaInput[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) {
        res.status(400).json({ error: "Invalid quota item" });
        return;
      }
      const row = parseQuotaItem(item as Record<string, unknown>);
      if (row === "INVALID") {
        res.status(400).json({ error: "Invalid quota item" });
        return;
      }

      const existing = await db.query.workspaceQuotaLimitsTable.findFirst({
        where: and(
          eq(workspaceQuotaLimitsTable.workspaceId, tenantId),
          eq(workspaceQuotaLimitsTable.quotaKey, row.quotaKey),
        ),
      });

      const validation = validateQuotaInput(row, {
        previousLimit: existing?.limitValue ?? null,
        previousHardLimit: existing?.isHardLimit ?? false,
      });
      if (!validation.ok) {
        if (validation.block) {
          await auditQuota("workspace_quota_change_blocked", req.userId!, tenantId, {
            quotaKey: row.quotaKey,
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

    const results: ReturnType<typeof serializeQuotaLimit>[] = [];

    for (const row of parsed) {
      const existing = await db.query.workspaceQuotaLimitsTable.findFirst({
        where: and(
          eq(workspaceQuotaLimitsTable.workspaceId, tenantId),
          eq(workspaceQuotaLimitsTable.quotaKey, row.quotaKey),
        ),
      });

      const [upserted] = await db
        .insert(workspaceQuotaLimitsTable)
        .values({
          workspaceId: tenantId,
          subscriptionId: row.subscriptionId,
          quotaKey: row.quotaKey,
          limitValue: row.limitValue,
          warningThresholdPercent: row.warningThresholdPercent,
          isHardLimit: row.isHardLimit,
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
            workspaceQuotaLimitsTable.workspaceId,
            workspaceQuotaLimitsTable.quotaKey,
          ],
          set: {
            subscriptionId: row.subscriptionId,
            limitValue: row.limitValue,
            warningThresholdPercent: row.warningThresholdPercent,
            isHardLimit: row.isHardLimit,
            source: row.source,
            effectiveFrom: row.effectiveFrom,
            effectiveUntil: row.effectiveUntil,
            reason: row.reason,
            internalNotes: row.internalNotes,
            updatedBy: req.userId!,
          },
        })
        .returning();

      await auditQuota("workspace_quota_changed", req.userId!, tenantId, {
        quotaLimitId: upserted.id,
        quotaKey: row.quotaKey,
        previousLimit: existing?.limitValue ?? null,
        nextLimit: upserted.limitValue,
        warningThresholdPercent: upserted.warningThresholdPercent,
        isHardLimit: upserted.isHardLimit,
        source: upserted.source,
        reason: upserted.reason,
      });

      results.push(serializeQuotaLimit(upserted));
    }

    await auditQuota("workspace_quotas_updated", req.userId!, tenantId, {
      count: results.length,
      quotaKeys: [...new Set(parsed.map((p) => p.quotaKey))],
    });

    res.json({ quotas: results });
  },
);

router.patch(
  "/platform/tenants/:tenantId/quotas/:quotaLimitId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("platform.quotas.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const quotaLimitId = Number(req.params.quotaLimitId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(quotaLimitId) || quotaLimitId < 1) {
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

    const existing = await db.query.workspaceQuotaLimitsTable.findFirst({
      where: and(
        eq(workspaceQuotaLimitsTable.id, quotaLimitId),
        eq(workspaceQuotaLimitsTable.workspaceId, tenantId),
      ),
    });

    if (!existing) {
      res.status(404).json({ error: "Quota limit not found" });
      return;
    }

    const nextQuotaKey =
      typeof body.quotaKey === "string" ? body.quotaKey.trim() : existing.quotaKey;

    const limitValue =
      body.limitValue !== undefined ? parseLimitValue(body.limitValue) : existing.limitValue;
    if (limitValue === "INVALID") {
      res.status(400).json({ error: "Invalid limitValue" });
      return;
    }

    const warningThresholdPercent =
      body.warningThresholdPercent !== undefined
        ? parseWarningPercent(body.warningThresholdPercent)
        : existing.warningThresholdPercent;
    if (warningThresholdPercent === "INVALID") {
      res.status(400).json({ error: "Invalid warningThresholdPercent" });
      return;
    }

    const isHardLimit =
      body.isHardLimit !== undefined ? Boolean(body.isHardLimit) : existing.isHardLimit;

    const nextSource =
      typeof body.source === "string" && isQuotaSource(body.source)
        ? body.source
        : existing.source;

    const subscriptionId =
      body.subscriptionId !== undefined
        ? parseOptionalId(body.subscriptionId)
        : existing.subscriptionId;
    if (subscriptionId === "INVALID") {
      res.status(400).json({ error: "Invalid subscriptionId" });
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

    const candidate: QuotaInput = {
      quotaKey: nextQuotaKey,
      limitValue: limitValue === "MISSING" ? existing.limitValue : limitValue,
      warningThresholdPercent:
        warningThresholdPercent === "MISSING"
          ? existing.warningThresholdPercent
          : warningThresholdPercent,
      isHardLimit,
      source: nextSource,
      subscriptionId: subscriptionId === "MISSING" ? existing.subscriptionId : subscriptionId,
      effectiveFrom,
      effectiveUntil,
      reason,
      internalNotes,
    };

    const validation = validateQuotaInput(candidate, {
      previousLimit: existing.limitValue,
      previousHardLimit: existing.isHardLimit,
    });
    if (!validation.ok) {
      if (validation.block) {
        await auditQuota("workspace_quota_change_blocked", req.userId!, tenantId, {
          quotaLimitId,
          quotaKey: candidate.quotaKey,
          previousLimit: existing.limitValue,
          nextLimit: candidate.limitValue,
          blockReason: validation.error,
        });
      }
      res.status(400).json({ error: validation.error });
      return;
    }

    const subErr = await validateSubscriptionId(
      tenantId,
      candidate.subscriptionId,
    );
    if (subErr) {
      res.status(400).json({ error: subErr });
      return;
    }

    const [updated] = await db
      .update(workspaceQuotaLimitsTable)
      .set({
        subscriptionId: candidate.subscriptionId,
        quotaKey: candidate.quotaKey,
        limitValue: candidate.limitValue,
        warningThresholdPercent: candidate.warningThresholdPercent,
        isHardLimit: candidate.isHardLimit,
        source: candidate.source,
        effectiveFrom: candidate.effectiveFrom,
        effectiveUntil: candidate.effectiveUntil,
        reason: candidate.reason,
        internalNotes: candidate.internalNotes,
        updatedBy: req.userId!,
      })
      .where(eq(workspaceQuotaLimitsTable.id, quotaLimitId))
      .returning();

    await auditQuota("workspace_quota_changed", req.userId!, tenantId, {
      quotaLimitId,
      quotaKey: updated.quotaKey,
      previousLimit: existing.limitValue,
      nextLimit: updated.limitValue,
      warningThresholdPercent: updated.warningThresholdPercent,
      isHardLimit: updated.isHardLimit,
      source: updated.source,
      reason: updated.reason,
    });

    res.json({ quota: serializeQuotaLimit(updated) });
  },
);

export default router;
