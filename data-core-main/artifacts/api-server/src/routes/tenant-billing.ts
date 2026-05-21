/**
 * @file   routes/tenant-billing.ts
 * @phase  P15-D - Tenant Billing Portal Visibility
 *
 * GET /tenant/billing/invoices
 * GET /tenant/billing/invoices/:invoiceId
 * GET /tenant/billing/invoices/:invoiceId/document
 *
 * SAFETY: read/download only - no upload, edit, delete, payment, or email.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  activityLogsTable,
  commercialInvoicesTable,
  commercialInvoiceDocumentsTable,
} from "@workspace/db";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import {
  TENANT_BILLING_PERMISSIONS,
  TENANT_VISIBLE_INVOICE_STATUSES,
} from "../lib/tenant-billing-config";
import {
  invoiceDocumentStorage,
  INVOICE_PDF_MIME,
} from "../lib/invoice-document-storage";

const PERM_READ = TENANT_BILLING_PERMISSIONS.INVOICES_READ;
const PERM_DOWNLOAD = TENANT_BILLING_PERMISSIONS.INVOICE_DOCUMENTS_DOWNLOAD;

const router: IRouter = Router();

function requireWorkspaceMember(req: AuthRequest, res: import("express").Response): number | null {
  if (req.userRole === "super_admin") {
    res.status(403).json({ error: "Tenant billing is not available for platform users" });
    return null;
  }
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ error: "No workspace context" });
    return null;
  }
  return workspaceId;
}

async function auditTenantBilling(
  action: string,
  actorId: number | undefined,
  workspaceId: number,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId: actorId ?? null,
    workspaceId,
    action,
    metadata: JSON.stringify({
      ...meta,
      workspaceId,
      timestamp: new Date().toISOString(),
    }),
  });
}

type InvoiceRow = typeof commercialInvoicesTable.$inferSelect;
type DocRow = typeof commercialInvoiceDocumentsTable.$inferSelect;

function toTenantInvoiceSummary(inv: InvoiceRow, doc: DocRow | null | undefined) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceTitle: inv.invoiceTitle,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    invoiceAmount: inv.invoiceAmount,
    currency: inv.currency,
    billingPeriodStart: inv.billingPeriodStart,
    billingPeriodEnd: inv.billingPeriodEnd,
    status: inv.status,
    documentAvailable: !!doc,
    documentFileName: doc?.originalFileName ?? null,
    uploadedAt: doc?.uploadedAt ?? null,
  };
}

async function loadInvoiceForWorkspace(workspaceId: number, invoiceId: number) {
  return db.query.commercialInvoicesTable.findFirst({
    where: and(
      eq(commercialInvoicesTable.id, invoiceId),
      eq(commercialInvoicesTable.workspaceId, workspaceId),
      ne(commercialInvoicesTable.status, "draft"),
    ),
  });
}

// ── GET list ──────────────────────────────────────────────────────────────────

router.get(
  "/tenant/billing/invoices",
  requireAuth,
  requirePermission(PERM_READ),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (statusFilter && !TENANT_VISIBLE_INVOICE_STATUSES.includes(statusFilter as typeof TENANT_VISIBLE_INVOICE_STATUSES[number])) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }

    const conditions = [
      eq(commercialInvoicesTable.workspaceId, workspaceId),
      ne(commercialInvoicesTable.status, "draft"),
    ];

    if (statusFilter) {
      conditions.push(eq(commercialInvoicesTable.status, statusFilter));
    }
    if (from) {
      conditions.push(gte(commercialInvoicesTable.invoiceDate, from));
    }
    if (to) {
      conditions.push(lte(commercialInvoicesTable.invoiceDate, to));
    }

    const invoices = await db.query.commercialInvoicesTable.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => [desc(t.invoiceDate), desc(t.id)],
    });

    const summaries = await Promise.all(
      invoices.map(async (inv) => {
        const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
          where: eq(commercialInvoiceDocumentsTable.invoiceId, inv.id),
        });
        return toTenantInvoiceSummary(inv, doc);
      }),
    );

    await auditTenantBilling("tenant_invoice_viewed", req.userId, workspaceId, {
      actorId: req.userId,
      action: "list",
      result: "success",
      count: summaries.length,
    });

    res.json({ invoices: summaries });
  },
);

// ── GET one ───────────────────────────────────────────────────────────────────

router.get(
  "/tenant/billing/invoices/:invoiceId",
  requireAuth,
  requirePermission(PERM_READ),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid invoiceId" });
      return;
    }

    const invoice = await loadInvoiceForWorkspace(workspaceId, invoiceId);
    if (!invoice) {
      await auditTenantBilling("tenant_invoice_access_denied", req.userId, workspaceId, {
        actorId: req.userId,
        invoiceId,
        action: "detail",
        result: "denied",
        reason: "not_found_or_forbidden",
      });
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
      where: eq(commercialInvoiceDocumentsTable.invoiceId, invoiceId),
    });

    await auditTenantBilling("tenant_invoice_viewed", req.userId, workspaceId, {
      actorId: req.userId,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      action: "detail",
      result: "success",
    });

    res.json({ invoice: toTenantInvoiceSummary(invoice, doc) });
  },
);

// ── GET document download ─────────────────────────────────────────────────────

router.get(
  "/tenant/billing/invoices/:invoiceId/document",
  requireAuth,
  requirePermission(PERM_DOWNLOAD),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      res.status(400).json({ error: "Invalid invoiceId" });
      return;
    }

    const invoice = await loadInvoiceForWorkspace(workspaceId, invoiceId);
    if (!invoice) {
      await auditTenantBilling("tenant_invoice_access_denied", req.userId, workspaceId, {
        actorId: req.userId,
        invoiceId,
        action: "download",
        result: "denied",
        reason: "not_found_or_forbidden",
      });
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const doc = await db.query.commercialInvoiceDocumentsTable.findFirst({
      where: eq(commercialInvoiceDocumentsTable.invoiceId, invoiceId),
    });
    if (!doc) {
      await auditTenantBilling("tenant_invoice_document_download_blocked", req.userId, workspaceId, {
        actorId: req.userId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        action: "download",
        result: "blocked",
        reason: "no_document",
      });
      res.status(404).json({ error: "No PDF document available for this invoice" });
      return;
    }

    try {
      const stream = invoiceDocumentStorage.getInvoicePdfStream(doc.storageKey);
      await auditTenantBilling("tenant_invoice_document_downloaded", req.userId, workspaceId, {
        actorId: req.userId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        action: "download",
        result: "success",
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
      await auditTenantBilling("tenant_invoice_document_download_blocked", req.userId, workspaceId, {
        actorId: req.userId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        action: "download",
        result: "blocked",
        reason: "storage_error",
      });
      res.status(404).json({ error: "Document file not found" });
    }
  },
);

export default router;
