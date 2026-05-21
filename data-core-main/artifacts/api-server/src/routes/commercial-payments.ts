/**
 * @file   routes/commercial-payments.ts
 * @phase  P15-E - Manual Payment & Collection Tracking
 *
 * Platform-only manual payment records - no electronic payment or tenant APIs.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialInvoicesTable,
  commercialPaymentRecordsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  PAYMENT_METHODS,
  COLLECTION_STATUSES,
  computeInvoiceCollectionSummary,
  VERIFIED_COLLECTION_STATUSES,
} from "../lib/invoice-collection-summary";

const VALID_CURRENCIES = new Set(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR"]);
const EDITABLE_STATUSES = new Set(["pending_verification"]);
const MIN_REASON_LEN = 10;
const MAX_TEXT = 2000;
const MAX_REF = 120;

const SENSITIVE_KEYS = new Set([
  "cardNumber",
  "cardLast4",
  "cardBrand",
  "bankAccount",
  "iban",
  "swift",
  "routingNumber",
  "stripePaymentId",
  "stripeCustomerId",
  "checkoutSessionId",
  "paymentGateway",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  ...SENSITIVE_KEYS,
  "taxAmount",
  "taxRate",
  "vatAmount",
  "zatcaUuid",
  "ledgerEntryId",
]);

function rejectSensitiveFields(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return `Field '${key}' is not allowed on payment records`;
    }
    if (lower.includes("card") || lower.includes("iban") || lower.includes("bankaccount")) {
      return `Field '${key}' is not allowed on payment records`;
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
  if (v === undefined || v === null || v === "") return "MISSING";
  if (typeof v !== "string") return "INVALID";
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "INVALID";
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "INVALID";
  return s;
}

function parseReceivedAmount(v: unknown): string | null | "INVALID" | "MISSING" {
  if (v === undefined || v === null || v === "") return "MISSING";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "INVALID";
  return n.toFixed(2);
}

async function loadTenantContext(tenantId: number) {
  const ws = await db.query.workspacesTable.findFirst({
    where: eq(workspacesTable.id, tenantId),
  });
  if (!ws) return { error: "Tenant not found" as const, status: 404 };
  const account = await db.query.commercialAccountsTable.findFirst({
    where: eq(commercialAccountsTable.workspaceId, tenantId),
  });
  if (!account) {
    return { error: "No commercial account found for this tenant. Create one first." as const, status: 404 };
  }
  return { ws, account };
}

async function loadInvoiceForTenant(tenantId: number, invoiceId: number) {
  return db.query.commercialInvoicesTable.findFirst({
    where: and(
      eq(commercialInvoicesTable.id, invoiceId),
      eq(commercialInvoicesTable.workspaceId, tenantId),
    ),
  });
}

async function loadPaymentForTenant(tenantId: number, paymentId: number) {
  return db.query.commercialPaymentRecordsTable.findFirst({
    where: and(
      eq(commercialPaymentRecordsTable.id, paymentId),
      eq(commercialPaymentRecordsTable.workspaceId, tenantId),
    ),
  });
}

async function auditPayment(
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
      tenantId: workspaceId,
      workspaceId,
      timestamp: new Date().toISOString(),
    }),
  });
}

function serializePayment(row: typeof commercialPaymentRecordsTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    commercialAccountId: row.commercialAccountId,
    invoiceId: row.invoiceId,
    paymentReference: row.paymentReference,
    paymentDate: row.paymentDate,
    receivedAmount: row.receivedAmount,
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    collectionStatus: row.collectionStatus,
    recordedByUserId: row.recordedByUserId,
    verifiedByUserId: row.verifiedByUserId,
    verificationDate: row.verificationDate,
    internalNotes: row.internalNotes,
    rejectionReason: row.rejectionReason,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadPaymentsForInvoice(invoiceId: number) {
  return db.query.commercialPaymentRecordsTable.findMany({
    where: eq(commercialPaymentRecordsTable.invoiceId, invoiceId),
    orderBy: (t, { desc }) => [desc(t.paymentDate), desc(t.id)],
  });
}

const router: IRouter = Router();

// ── GET payments list ─────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-payments",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const invoiceIdFilter = req.query.invoiceId !== undefined ? Number(req.query.invoiceId) : undefined;
    const statusFilter = typeof req.query.collectionStatus === "string"
      ? req.query.collectionStatus
      : undefined;
    const methodFilter = typeof req.query.paymentMethod === "string"
      ? req.query.paymentMethod
      : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (statusFilter && !COLLECTION_STATUSES.includes(statusFilter as typeof COLLECTION_STATUSES[number])) {
      res.status(400).json({ error: "Invalid collectionStatus filter" });
      return;
    }
    if (methodFilter && !PAYMENT_METHODS.includes(methodFilter as typeof PAYMENT_METHODS[number])) {
      res.status(400).json({ error: "Invalid paymentMethod filter" });
      return;
    }

    let payments = await db.query.commercialPaymentRecordsTable.findMany({
      where: eq(commercialPaymentRecordsTable.workspaceId, tenantId),
      orderBy: (t, { desc }) => [desc(t.paymentDate), desc(t.id)],
    });

    if (invoiceIdFilter !== undefined) {
      if (!Number.isFinite(invoiceIdFilter)) {
        res.status(400).json({ error: "Invalid invoiceId filter" });
        return;
      }
      payments = payments.filter(p => p.invoiceId === invoiceIdFilter);
    }
    if (statusFilter) payments = payments.filter(p => p.collectionStatus === statusFilter);
    if (methodFilter) payments = payments.filter(p => p.paymentMethod === methodFilter);
    if (from) payments = payments.filter(p => p.paymentDate && p.paymentDate >= from);
    if (to) payments = payments.filter(p => p.paymentDate && p.paymentDate <= to);

    res.json({ payments: payments.map(serializePayment) });
  },
);

// ── GET collection summary ────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId/collection-summary",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const invoice = await loadInvoiceForTenant(tenantId, invoiceId);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const payments = await loadPaymentsForInvoice(invoiceId);
    const summary = computeInvoiceCollectionSummary(
      invoiceId,
      invoice.invoiceAmount,
      invoice.currency,
      payments.map(p => ({
        receivedAmount: p.receivedAmount,
        collectionStatus: p.collectionStatus,
      })),
    );

    res.json({ summary });
  },
);

// ── POST record payment ─────────────────────────────────────────────────────────

router.post(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId/payments",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.record"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    const actorId = req.userId!;
    const body = req.body as Record<string, unknown>;

    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const sensitive = rejectSensitiveFields(body);
    if (sensitive) {
      res.status(400).json({ error: sensitive });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const invoice = await loadInvoiceForTenant(tenantId, invoiceId);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const paymentReference = strRequired(body.paymentReference, MAX_REF);
    if (paymentReference === "MISSING") {
      res.status(400).json({ error: "paymentReference is required" });
      return;
    }
    if (paymentReference === "INVALID") {
      res.status(400).json({ error: "Invalid paymentReference" });
      return;
    }

    const paymentDate = parseDate(body.paymentDate);
    if (paymentDate === "MISSING") {
      res.status(400).json({ error: "paymentDate is required" });
      return;
    }
    if (paymentDate === "INVALID") {
      res.status(400).json({ error: "Invalid paymentDate" });
      return;
    }

    const receivedAmount = parseReceivedAmount(body.receivedAmount);
    if (receivedAmount === "MISSING") {
      res.status(400).json({ error: "receivedAmount is required" });
      return;
    }
    if (receivedAmount === "INVALID") {
      res.status(400).json({ error: "receivedAmount must be greater than 0" });
      return;
    }

    const currencyRaw = strRequired(body.currency ?? invoice.currency, 10);
    if (currencyRaw === "MISSING" || currencyRaw === "INVALID") {
      res.status(400).json({ error: "currency is required" });
      return;
    }
    const currency = currencyRaw.toUpperCase();
    if (!VALID_CURRENCIES.has(currency)) {
      res.status(400).json({ error: "Invalid currency" });
      return;
    }
    const invoiceCurrency = (invoice.currency ?? "SAR").toUpperCase();
    if (currency !== invoiceCurrency) {
      res.status(400).json({
        error: `Currency must match invoice currency (${invoiceCurrency})`,
      });
      return;
    }

    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";
    if (!PAYMENT_METHODS.includes(paymentMethod as typeof PAYMENT_METHODS[number])) {
      res.status(400).json({ error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}` });
      return;
    }

    const commercialAccountId = Number(body.commercialAccountId ?? invoice.commercialAccountId);
    if (commercialAccountId !== invoice.commercialAccountId) {
      res.status(400).json({ error: "commercialAccountId must match the invoice commercial account" });
      return;
    }

    const internalNotes = strOpt(body.internalNotes, MAX_TEXT);

    const [created] = await db
      .insert(commercialPaymentRecordsTable)
      .values({
        workspaceId: tenantId,
        commercialAccountId,
        invoiceId,
        paymentReference,
        paymentDate,
        receivedAmount,
        currency,
        paymentMethod,
        collectionStatus: "pending_verification",
        recordedByUserId: actorId,
        internalNotes,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    await auditPayment("commercial_payment_recorded", actorId, tenantId, {
      actorId,
      commercialAccountId,
      invoiceId,
      paymentId: created!.id,
      paymentReference,
      receivedAmount,
      currency,
      paymentMethod,
      nextStatus: "pending_verification",
      result: "success",
    });

    res.status(201).json({ payment: serializePayment(created!) });
  },
);

// ── PATCH update payment ────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-payments/:paymentId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.record"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const paymentId = Number(req.params.paymentId);
    const actorId = req.userId!;
    const body = req.body as Record<string, unknown>;

    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(paymentId) || paymentId < 1) {
      res.status(400).json({ error: "Invalid tenantId or paymentId" });
      return;
    }

    const sensitive = rejectSensitiveFields(body);
    if (sensitive) {
      res.status(400).json({ error: sensitive });
      return;
    }

    const existing = await loadPaymentForTenant(tenantId, paymentId);
    if (!existing) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!EDITABLE_STATUSES.has(existing.collectionStatus)) {
      await auditPayment("commercial_payment_action_blocked", actorId, tenantId, {
        actorId,
        paymentId,
        invoiceId: existing.invoiceId,
        previousStatus: existing.collectionStatus,
        action: "update",
        reason: "payment_not_editable",
        result: "blocked",
      });
      res.status(409).json({
        error: "Payment cannot be edited after verification or reversal",
      });
      return;
    }

    const invoice = await loadInvoiceForTenant(tenantId, existing.invoiceId);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const updates: Partial<typeof commercialPaymentRecordsTable.$inferInsert> = {
      updatedBy: actorId,
      updatedAt: new Date(),
    };

    if (body.paymentReference !== undefined) {
      const pr = strRequired(body.paymentReference, MAX_REF);
      if (pr === "MISSING" || pr === "INVALID") {
        res.status(400).json({ error: "Invalid paymentReference" });
        return;
      }
      updates.paymentReference = pr;
    }
    if (body.paymentDate !== undefined) {
      const pd = parseDate(body.paymentDate);
      if (pd === "MISSING" || pd === "INVALID") {
        res.status(400).json({ error: "Invalid paymentDate" });
        return;
      }
      updates.paymentDate = pd;
    }
    if (body.receivedAmount !== undefined) {
      const ra = parseReceivedAmount(body.receivedAmount);
      if (ra === "MISSING" || ra === "INVALID") {
        res.status(400).json({ error: "receivedAmount must be greater than 0" });
        return;
      }
      updates.receivedAmount = ra;
    }
    if (body.currency !== undefined) {
      const cur = strRequired(body.currency, 10);
      if (cur === "MISSING" || cur === "INVALID" || !VALID_CURRENCIES.has(cur.toUpperCase())) {
        res.status(400).json({ error: "Invalid currency" });
        return;
      }
      const invoiceCurrency = (invoice.currency ?? "SAR").toUpperCase();
      if (cur.toUpperCase() !== invoiceCurrency) {
        res.status(400).json({ error: `Currency must match invoice currency (${invoiceCurrency})` });
        return;
      }
      updates.currency = cur.toUpperCase();
    }
    if (body.paymentMethod !== undefined) {
      const pm = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";
      if (!PAYMENT_METHODS.includes(pm as typeof PAYMENT_METHODS[number])) {
        res.status(400).json({ error: "Invalid paymentMethod" });
        return;
      }
      updates.paymentMethod = pm;
    }
    if (body.internalNotes !== undefined) {
      updates.internalNotes = strOpt(body.internalNotes, MAX_TEXT);
    }

    const [updated] = await db
      .update(commercialPaymentRecordsTable)
      .set(updates)
      .where(eq(commercialPaymentRecordsTable.id, paymentId))
      .returning();

    await auditPayment("commercial_payment_updated", actorId, tenantId, {
      actorId,
      paymentId,
      invoiceId: existing.invoiceId,
      paymentReference: updated!.paymentReference,
      previousStatus: existing.collectionStatus,
      nextStatus: updated!.collectionStatus,
      receivedAmount: updated!.receivedAmount,
      currency: updated!.currency,
      result: "success",
    });

    res.json({ payment: serializePayment(updated!) });
  },
);

// ── Status transitions (verify / reject / reverse) ─────────────────────────────

async function transitionPayment(
  req: AuthRequest,
  res: import("express").Response,
  targetStatus: "verified" | "rejected" | "reversed",
  auditSuccess: string,
) {
  const tenantId = Number(req.params.tenantId);
  const paymentId = Number(req.params.paymentId);
  const actorId = req.userId!;
  const body = req.body as Record<string, unknown>;

  if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(paymentId) || paymentId < 1) {
    res.status(400).json({ error: "Invalid tenantId or paymentId" });
    return;
  }

  const sensitive = rejectSensitiveFields(body);
  if (sensitive) {
    res.status(400).json({ error: sensitive });
    return;
  }

  const reason = strRequired(body.reason, MAX_TEXT);
  if (reason === "MISSING") {
    res.status(400).json({ error: "reason is required" });
    return;
  }
  if (reason === "INVALID" || reason.length < MIN_REASON_LEN) {
    res.status(400).json({ error: `reason must be at least ${MIN_REASON_LEN} characters` });
    return;
  }

  const existing = await loadPaymentForTenant(tenantId, paymentId);
  if (!existing) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  if (existing.collectionStatus === "reversed") {
    await auditPayment("commercial_payment_action_blocked", actorId, tenantId, {
      actorId,
      paymentId,
      invoiceId: existing.invoiceId,
      previousStatus: existing.collectionStatus,
      action: targetStatus,
      reason: "already_reversed",
      result: "blocked",
    });
    res.status(409).json({ error: "Payment is already reversed" });
    return;
  }

  if (targetStatus === "verified" && VERIFIED_COLLECTION_STATUSES.has(existing.collectionStatus)) {
    await auditPayment("commercial_payment_action_blocked", actorId, tenantId, {
      actorId,
      paymentId,
      previousStatus: existing.collectionStatus,
      action: "verify",
      reason: "already_verified",
      result: "blocked",
    });
    res.status(409).json({ error: "Payment is already verified" });
    return;
  }

  if (targetStatus === "rejected" && existing.collectionStatus === "rejected") {
    res.status(409).json({ error: "Payment is already rejected" });
    return;
  }

  const updates: Partial<typeof commercialPaymentRecordsTable.$inferInsert> = {
    collectionStatus: targetStatus,
    updatedBy: actorId,
    updatedAt: new Date(),
  };

  if (targetStatus === "verified") {
    updates.verifiedByUserId = actorId;
    updates.verificationDate = new Date();
    updates.rejectionReason = null;
    const notePrefix = `[verified ${new Date().toISOString()}] ${reason}`;
    updates.internalNotes = existing.internalNotes
      ? `${existing.internalNotes}\n${notePrefix}`
      : notePrefix;
  } else if (targetStatus === "rejected") {
    updates.rejectionReason = reason;
    updates.verifiedByUserId = null;
    updates.verificationDate = null;
  } else {
    const notePrefix = `[reversed ${new Date().toISOString()}] ${reason}`;
    updates.internalNotes = existing.internalNotes
      ? `${existing.internalNotes}\n${notePrefix}`
      : notePrefix;
    updates.verifiedByUserId = actorId;
    updates.verificationDate = new Date();
  }

  const [updated] = await db
    .update(commercialPaymentRecordsTable)
    .set(updates)
    .where(eq(commercialPaymentRecordsTable.id, paymentId))
    .returning();

  await auditPayment(auditSuccess, actorId, tenantId, {
    actorId,
    paymentId,
    invoiceId: existing.invoiceId,
    paymentReference: existing.paymentReference,
    previousStatus: existing.collectionStatus,
    nextStatus: targetStatus,
    receivedAmount: existing.receivedAmount,
    currency: existing.currency,
    reason,
    result: "success",
  });

  res.json({ payment: serializePayment(updated!) });
}

router.patch(
  "/platform/tenants/:tenantId/commercial-payments/:paymentId/verify",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.verify"),
  (req, res) => void transitionPayment(req, res, "verified", "commercial_payment_verified"),
);

router.patch(
  "/platform/tenants/:tenantId/commercial-payments/:paymentId/reject",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.verify"),
  (req, res) => void transitionPayment(req, res, "rejected", "commercial_payment_rejected"),
);

router.patch(
  "/platform/tenants/:tenantId/commercial-payments/:paymentId/reverse",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.payments.verify"),
  (req, res) => void transitionPayment(req, res, "reversed", "commercial_payment_reversed"),
);

export default router;
