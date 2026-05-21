/**
 * @file   routes/commercial-invoices.ts
 * @phase  P15-C - Invoice Records & Uploaded Invoice PDFs
 *
 * SAFETY: no invoice generation, tax, payment, email, or hard delete.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialContractTermsTable,
  commercialInvoicesTable,
  commercialInvoiceDocumentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  hasPlatformPermission,
  type PlatformUserPermissionIdentity,
} from "../lib/platform-permissions";
import {
  invoiceDocumentStorage,
  INVOICE_PDF_MIME,
} from "../lib/invoice-document-storage";
import { parseInvoicePdfUpload } from "../lib/parse-invoice-pdf-upload";

const VALID_STATUSES = ["draft", "issued", "shared", "paid", "overdue", "cancelled"] as const;
const VALID_CURRENCIES = new Set(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR"]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "taxAmount", "taxRate", "vatAmount", "zatcaUuid", "zatcaHash",
  "paymentStatus", "paymentMethod", "paymentGateway", "stripePaymentId",
  "stripeCustomerId", "cardLast4", "cardBrand", "checkoutSessionId",
  "paidAmount", "ledgerEntryId", "accountingLedgerId",
]);

const MAX_TEXT = 2000;
const MAX_TITLE = 200;
const MAX_NUMBER = 100;
const MAX_SYSTEM_NAME = 120;
const MIN_REASON_LEN = 10;

function actorFromReq(req: AuthRequest): PlatformUserPermissionIdentity {
  return {
    id: req.userId,
    role: req.userRole ?? "",
    platformRoleCode: req.platformRoleCode,
    isRootOwner: req.isRootOwner,
  };
}

function canReadInvoiceDocuments(req: AuthRequest): boolean {
  return hasPlatformPermission(actorFromReq(req), "commercial.invoiceDocuments.read");
}

function rejectForbiddenFields(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return `Field '${key}' is not allowed on commercial invoices`;
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
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "INVALID";
  return s;
}

function parseInvoiceAmount(v: unknown): string | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "INVALID";
  return n.toFixed(2);
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function validateInvoiceDates(input: {
  invoiceDate: string | null;
  dueDate: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
}): string | null {
  const { invoiceDate, dueDate, billingPeriodStart: bpStart, billingPeriodEnd: bpEnd } = input;
  if (invoiceDate && dueDate && compareDates(invoiceDate, dueDate) > 0) {
    return "invoiceDate must be on or before dueDate";
  }
  if (bpStart && bpEnd && compareDates(bpStart, bpEnd) > 0) {
    return "billingPeriodStart must be on or before billingPeriodEnd";
  }
  return null;
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

async function assertContractTermForTenant(
  contractTermId: number,
  tenantId: number,
  commercialAccountId: number,
): Promise<boolean> {
  const term = await db.query.commercialContractTermsTable.findFirst({
    where: and(
      eq(commercialContractTermsTable.id, contractTermId),
      eq(commercialContractTermsTable.workspaceId, tenantId),
    ),
  });
  return !!term && term.commercialAccountId === commercialAccountId;
}

async function auditInvoice(
  action: string,
  actorId: number,
  workspaceId: number,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId:      actorId,
    workspaceId,
    action,
    metadata:    JSON.stringify(meta),
  });
}

function serializeDocument(doc: typeof commercialInvoiceDocumentsTable.$inferSelect) {
  return {
    id:               doc.id,
    invoiceId:        doc.invoiceId,
    fileName:         doc.fileName,
    originalFileName: doc.originalFileName,
    fileSize:         doc.fileSize,
    mimeType:         doc.mimeType,
    uploadedBy:       doc.uploadedBy,
    uploadedAt:       doc.uploadedAt,
    createdAt:        doc.createdAt,
    hasDocument:      true,
  };
}

const router: IRouter = Router();

// ── GET list ──────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-invoices",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoices.read"),
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

    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
    const contractTermFilter = req.query.contractTermId !== undefined
      ? Number(req.query.contractTermId)
      : undefined;

    if (statusFilter && !VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])) {
      res.status(400).json({ error: `Invalid status filter. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    let invoices = await db.query.commercialInvoicesTable.findMany({
      where: eq(commercialInvoicesTable.workspaceId, tenantId),
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    if (statusFilter) {
      invoices = invoices.filter(i => i.status === statusFilter);
    }
    if (contractTermFilter !== undefined) {
      if (!Number.isFinite(contractTermFilter)) {
        res.status(400).json({ error: "Invalid contractTermId filter" });
        return;
      }
      invoices = invoices.filter(i => i.contractTermId === contractTermFilter);
    }

    const showDocMeta = canReadInvoiceDocuments(req);
    const docByInvoice = new Map<number, { hasDocument: boolean }>();

    if (showDocMeta && invoices.length > 0) {
      for (const inv of invoices) {
        const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
          where: eq(commercialInvoiceDocumentsTable.invoiceId, inv.id),
        });
        docByInvoice.set(inv.id, { hasDocument: !!doc });
      }
    }

    res.json({
      invoices: invoices.map(inv => ({
        ...inv,
        documentStatus: showDocMeta
          ? (docByInvoice.get(inv.id)?.hasDocument ? "uploaded" : "missing")
          : undefined,
      })),
    });
  },
);

// ── GET one ───────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoices.read"),
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const invoice = await db.query.commercialInvoicesTable.findFirst({
      where: and(
        eq(commercialInvoicesTable.id, invoiceId),
        eq(commercialInvoicesTable.workspaceId, tenantId),
      ),
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    let document = undefined;
    if (canReadInvoiceDocuments(req)) {
      const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
        where: eq(commercialInvoiceDocumentsTable.invoiceId, invoiceId),
      });
      document = doc ? serializeDocument(doc) : null;
    }

    res.json({ invoice, document });
  },
);

// ── POST create ───────────────────────────────────────────────────────────────

router.post(
  "/platform/tenants/:tenantId/commercial-invoices",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoices.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbiddenFields(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const validationError = await validateInvoiceBody(body, ctx.account.id, tenantId, true);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const fields = mapInvoiceFields(body, ctx.account.id, tenantId);
    const actorId = req.userId!;

    try {
      const [invoice] = await db
        .insert(commercialInvoicesTable)
        .values({
          ...fields,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      await auditInvoice("commercial_invoice_created", actorId, tenantId, {
        tenantId,
        commercialAccountId: ctx.account.id,
        contractTermId: invoice.contractTermId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
      });

      res.status(201).json({ invoice });
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        res.status(400).json({ error: "invoiceNumber must be unique for this tenant" });
        return;
      }
      throw e;
    }
  },
);

// ── PATCH update ──────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoices.update"),
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const forbidden = rejectForbiddenFields(body);
    if (forbidden) {
      res.status(400).json({ error: forbidden });
      return;
    }

    const existing = await db.query.commercialInvoicesTable.findFirst({
      where: and(
        eq(commercialInvoicesTable.id, invoiceId),
        eq(commercialInvoicesTable.workspaceId, tenantId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const validationError = await validateInvoiceBody(
      body,
      existing.commercialAccountId,
      tenantId,
      false,
      existing,
    );
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const patch = mapInvoicePatch(body, existing);
    const actorId = req.userId!;

    try {
      const [invoice] = await db
        .update(commercialInvoicesTable)
        .set({ ...patch, updatedBy: actorId })
        .where(eq(commercialInvoicesTable.id, invoiceId))
        .returning();

      const changedFields = Object.keys(patch).filter(k => k !== "updatedBy");

      await auditInvoice("commercial_invoice_updated", actorId, tenantId, {
        tenantId,
        commercialAccountId: existing.commercialAccountId,
        contractTermId: invoice.contractTermId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        changedFields,
      });

      res.json({ invoice });
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        res.status(400).json({ error: "invoiceNumber must be unique for this tenant" });
        return;
      }
      throw e;
    }
  },
);

// ── PATCH status ──────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId/status",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoices.update"),
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!status || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < MIN_REASON_LEN) {
      await auditInvoice("commercial_invoice_status_change_blocked", req.userId!, tenantId, {
        tenantId,
        invoiceId,
        nextStatus: status,
        reason: "reason_required",
      });
      res.status(400).json({ error: `reason is required and must be at least ${MIN_REASON_LEN} characters` });
      return;
    }

    const existing = await db.query.commercialInvoicesTable.findFirst({
      where: and(
        eq(commercialInvoicesTable.id, invoiceId),
        eq(commercialInvoicesTable.workspaceId, tenantId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (existing.status === status) {
      res.status(400).json({ error: "Invoice is already in this status" });
      return;
    }

    const actorId = req.userId!;
    const previousStatus = existing.status;

    const [invoice] = await db
      .update(commercialInvoicesTable)
      .set({ status, updatedBy: actorId })
      .where(eq(commercialInvoicesTable.id, invoiceId))
      .returning();

    await auditInvoice("commercial_invoice_status_changed", actorId, tenantId, {
      tenantId,
      commercialAccountId: existing.commercialAccountId,
      contractTermId: existing.contractTermId,
      invoiceId,
      invoiceNumber: existing.invoiceNumber,
      previousStatus,
      nextStatus: status,
      reason: reason.trim().slice(0, MAX_TEXT),
    });

    res.json({ invoice });
  },
);

// ── POST document upload ──────────────────────────────────────────────────────

router.post(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId/document",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoiceDocuments.upload"),
  parseInvoicePdfUpload,
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const upload = req.invoicePdfUpload;
    if (!upload) {
      await auditInvoice("commercial_invoice_document_upload_blocked", req.userId!, tenantId, {
        tenantId,
        invoiceId,
        reason: "missing_file",
      });
      res.status(400).json({ error: "PDF file is required" });
      return;
    }

    const invoice = await db.query.commercialInvoicesTable.findFirst({
      where: and(
        eq(commercialInvoicesTable.id, invoiceId),
        eq(commercialInvoicesTable.workspaceId, tenantId),
      ),
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const actorId = req.userId!;
    const storageKey = invoiceDocumentStorage.buildStorageKey(tenantId, invoiceId);
    const safeName = upload.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);

    try {
      const { checksum } = await invoiceDocumentStorage.saveInvoicePdf(storageKey, upload.buffer);
      const existingDoc = await db.query.commercialInvoiceDocumentsTable.findFirst({
        where: eq(commercialInvoiceDocumentsTable.invoiceId, invoiceId),
      });

      if (existingDoc) {
        await invoiceDocumentStorage.deleteInvoicePdfIfExists(existingDoc.storageKey);
        const [doc] = await db
          .update(commercialInvoiceDocumentsTable)
          .set({
            fileName:         safeName,
            originalFileName: upload.originalFileName.slice(0, 255),
            fileSize:         upload.buffer.length,
            mimeType:         INVOICE_PDF_MIME,
            storageKey,
            checksum,
            uploadedBy: actorId,
            uploadedAt: new Date(),
          })
          .where(eq(commercialInvoiceDocumentsTable.id, existingDoc.id))
          .returning();

        await auditInvoice("commercial_invoice_document_uploaded", actorId, tenantId, {
          tenantId,
          commercialAccountId: invoice.commercialAccountId,
          contractTermId: invoice.contractTermId,
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          fileName: safeName,
          fileSize: upload.buffer.length,
          mimeType: INVOICE_PDF_MIME,
          replaced: true,
        });

        res.json({ document: serializeDocument(doc) });
        return;
      }

      const [doc] = await db
        .insert(commercialInvoiceDocumentsTable)
        .values({
          invoiceId,
          fileName:         safeName,
          originalFileName: upload.originalFileName.slice(0, 255),
          fileSize:         upload.buffer.length,
          mimeType:         INVOICE_PDF_MIME,
          storageKey,
          checksum,
          uploadedBy: actorId,
        })
        .returning();

      await auditInvoice("commercial_invoice_document_uploaded", actorId, tenantId, {
        tenantId,
        commercialAccountId: invoice.commercialAccountId,
        contractTermId: invoice.contractTermId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        fileName: safeName,
        fileSize: upload.buffer.length,
        mimeType: INVOICE_PDF_MIME,
        replaced: false,
      });

      res.status(201).json({ document: serializeDocument(doc) });
    } catch (e: unknown) {
      await auditInvoice("commercial_invoice_document_upload_blocked", actorId, tenantId, {
        tenantId,
        invoiceId,
        reason: e instanceof Error ? e.message : "upload_failed",
      });
      res.status(400).json({ error: e instanceof Error ? e.message : "Upload failed" });
    }
  },
);

// ── GET document download ─────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-invoices/:invoiceId/document",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.invoiceDocuments.read"),
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid tenantId or invoiceId" });
      return;
    }

    const invoice = await db.query.commercialInvoicesTable.findFirst({
      where: and(
        eq(commercialInvoicesTable.id, invoiceId),
        eq(commercialInvoicesTable.workspaceId, tenantId),
      ),
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
      where: eq(commercialInvoiceDocumentsTable.invoiceId, invoiceId),
    });
    if (!doc) {
      res.status(404).json({ error: "No PDF document uploaded for this invoice" });
      return;
    }

    const actorId = req.userId!;

    try {
      const stream = invoiceDocumentStorage.getInvoicePdfStream(doc.storageKey);
      await auditInvoice("commercial_invoice_document_downloaded", actorId, tenantId, {
        tenantId,
        commercialAccountId: invoice.commercialAccountId,
        contractTermId: invoice.contractTermId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
      });

      res.setHeader("Content-Type", INVOICE_PDF_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${doc.originalFileName.replace(/"/g, "")}"`,
      );
      res.setHeader("Content-Length", String(doc.fileSize));
      stream.on("error", () => {
        if (!res.headersSent) res.status(404).json({ error: "Document file not found" });
      });
      stream.pipe(res);
    } catch {
      res.status(404).json({ error: "Document file not found" });
    }
  },
);

// ── Validation helpers ────────────────────────────────────────────────────────

type ExistingInvoice = typeof commercialInvoicesTable.$inferSelect;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "23505";
}

async function validateInvoiceBody(
  body: Record<string, unknown>,
  commercialAccountId: number,
  tenantId: number,
  isCreate: boolean,
  existing?: ExistingInvoice,
): Promise<string | null> {
  if (isCreate) {
    const rawAcctId = body.commercialAccountId;
    if (rawAcctId === undefined || rawAcctId === null) {
      return "commercialAccountId is required";
    }
    const acctId = Number(rawAcctId);
    if (!Number.isFinite(acctId) || acctId !== commercialAccountId) {
      return "commercialAccountId does not match this tenant's commercial account";
    }

    const num = strRequired(body.invoiceNumber, MAX_NUMBER);
    if (num === "MISSING") return "invoiceNumber is required";
    if (num === "INVALID") return "invoiceNumber is invalid";
  } else if (body.invoiceNumber !== undefined) {
    const num = strRequired(body.invoiceNumber, MAX_NUMBER);
    if (num === "MISSING" || num === "INVALID") return "invoiceNumber is invalid";
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      return `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`;
    }
  }

  const currency = body.currency;
  if (currency !== undefined && currency !== null && currency !== "") {
    if (typeof currency !== "string" || currency.trim().length > 8) return "Invalid currency";
    const c = currency.trim().toUpperCase();
    if (!VALID_CURRENCIES.has(c)) {
      return `Invalid currency. Supported: ${[...VALID_CURRENCIES].join(", ")}`;
    }
  }

  const amount = body.invoiceAmount !== undefined
    ? parseInvoiceAmount(body.invoiceAmount)
    : "MISSING";
  if (amount === "INVALID") return "invoiceAmount must be a non-negative number";

  const invoiceDate = body.invoiceDate !== undefined
    ? parseDate(body.invoiceDate)
    : (existing?.invoiceDate ?? null);
  const dueDate = body.dueDate !== undefined
    ? parseDate(body.dueDate)
    : (existing?.dueDate ?? null);
  const bpStart = body.billingPeriodStart !== undefined
    ? parseDate(body.billingPeriodStart)
    : (existing?.billingPeriodStart ?? null);
  const bpEnd = body.billingPeriodEnd !== undefined
    ? parseDate(body.billingPeriodEnd)
    : (existing?.billingPeriodEnd ?? null);

  if (invoiceDate === "INVALID" || dueDate === "INVALID" || bpStart === "INVALID" || bpEnd === "INVALID") {
    return "Dates must be ISO format YYYY-MM-DD";
  }

  const dateErr = validateInvoiceDates({
    invoiceDate: invoiceDate as string | null,
    dueDate: dueDate as string | null,
    billingPeriodStart: bpStart as string | null,
    billingPeriodEnd: bpEnd as string | null,
  });
  if (dateErr) return dateErr;

  if (body.contractTermId !== undefined && body.contractTermId !== null && body.contractTermId !== "") {
    const termId = Number(body.contractTermId);
    if (!Number.isFinite(termId) || termId < 1) return "Invalid contractTermId";
    if (!(await assertContractTermForTenant(termId, tenantId, commercialAccountId))) {
      return "contractTermId does not belong to this tenant's commercial account";
    }
  }

  return null;
}

function mapInvoiceFields(
  body: Record<string, unknown>,
  commercialAccountId: number,
  workspaceId: number,
) {
  const invoiceNumber = strRequired(body.invoiceNumber, MAX_NUMBER);
  const invoiceDate = parseDate(body.invoiceDate);
  const dueDate = parseDate(body.dueDate);
  const bpStart = parseDate(body.billingPeriodStart);
  const bpEnd = parseDate(body.billingPeriodEnd);
  const amount = parseInvoiceAmount(body.invoiceAmount);

  let contractTermId: number | null = null;
  if (body.contractTermId !== undefined && body.contractTermId !== null && body.contractTermId !== "") {
    contractTermId = Number(body.contractTermId);
  }

  return {
    workspaceId,
    commercialAccountId,
    contractTermId,
    invoiceNumber: invoiceNumber === "INVALID" || invoiceNumber === "MISSING" ? "" : invoiceNumber,
    invoiceTitle:  strOpt(body.invoiceTitle, MAX_TITLE),
    invoiceDate:   invoiceDate === "INVALID" ? null : invoiceDate,
    dueDate:       dueDate === "INVALID" ? null : dueDate,
    invoiceAmount: amount === "INVALID" || amount === "MISSING" ? null : amount,
    currency:      typeof body.currency === "string" ? body.currency.trim().toUpperCase().slice(0, 8) : null,
    billingPeriodStart: bpStart === "INVALID" ? null : bpStart,
    billingPeriodEnd:   bpEnd === "INVALID" ? null : bpEnd,
    status: typeof body.status === "string" ? body.status : "draft",
    externalAccountingSystemName: strOpt(body.externalAccountingSystemName, MAX_SYSTEM_NAME),
    externalAccountingReference:  strOpt(body.externalAccountingReference, MAX_NUMBER),
    notes: strOpt(body.notes, MAX_TEXT),
  };
}

function mapInvoicePatch(body: Record<string, unknown>, existing: ExistingInvoice) {
  const patch: Record<string, unknown> = {};

  if (body.invoiceNumber !== undefined) {
    const n = strRequired(body.invoiceNumber, MAX_NUMBER);
    if (n !== "MISSING" && n !== "INVALID") patch.invoiceNumber = n;
  }
  if (body.invoiceTitle !== undefined) patch.invoiceTitle = strOpt(body.invoiceTitle, MAX_TITLE);
  if (body.invoiceDate !== undefined) {
    const d = parseDate(body.invoiceDate);
    patch.invoiceDate = d === "INVALID" ? existing.invoiceDate : d;
  }
  if (body.dueDate !== undefined) {
    const d = parseDate(body.dueDate);
    patch.dueDate = d === "INVALID" ? existing.dueDate : d;
  }
  if (body.billingPeriodStart !== undefined) {
    const d = parseDate(body.billingPeriodStart);
    patch.billingPeriodStart = d === "INVALID" ? existing.billingPeriodStart : d;
  }
  if (body.billingPeriodEnd !== undefined) {
    const d = parseDate(body.billingPeriodEnd);
    patch.billingPeriodEnd = d === "INVALID" ? existing.billingPeriodEnd : d;
  }
  if (body.invoiceAmount !== undefined) {
    const v = parseInvoiceAmount(body.invoiceAmount);
    if (v !== "INVALID" && v !== "MISSING") patch.invoiceAmount = v;
  }
  if (body.currency !== undefined && typeof body.currency === "string") {
    patch.currency = body.currency.trim().toUpperCase().slice(0, 8);
  }
  if (body.contractTermId !== undefined) {
    if (body.contractTermId === null || body.contractTermId === "") {
      patch.contractTermId = null;
    } else {
      patch.contractTermId = Number(body.contractTermId);
    }
  }
  if (body.externalAccountingSystemName !== undefined) {
    patch.externalAccountingSystemName = strOpt(body.externalAccountingSystemName, MAX_SYSTEM_NAME);
  }
  if (body.externalAccountingReference !== undefined) {
    patch.externalAccountingReference = strOpt(body.externalAccountingReference, MAX_NUMBER);
  }
  if (body.notes !== undefined) patch.notes = strOpt(body.notes, MAX_TEXT);
  if (body.status !== undefined && typeof body.status === "string") patch.status = body.status;

  return patch;
}

export default router;
