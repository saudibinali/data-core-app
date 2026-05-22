/**
 * Operational commercial contracts — timeline records with optional PDF.
 * No ERP fields, no single-active contract demotion, no status workflow.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialContractTermsTable,
  commercialContractDocumentsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import { toOperationalContract } from "../lib/commercial-operational";
import {
  contractDocumentStorage,
  CONTRACT_PDF_MIME,
} from "../lib/contract-document-storage";
import { parseContractPdfUpload } from "../lib/parse-contract-pdf-upload";
import {
  parseOptionalDate,
  isSchemaMismatchError,
  pgErrorInfo,
} from "../lib/commercial-route-utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 4000;
const MAX_TITLE = 200;
const MAX_NAME = 200;
const MAX_NUMBER = 100;
const MAX_PHONE = 40;

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

function validateDates(start: string | null, end: string | null, renewal: string | null): string | null {
  if (start && end && start > end) return "startDate must be on or before endDate";
  if (renewal && start && renewal < start) return "renewalReminderDate must be on or after startDate";
  if (renewal && end && renewal > end) return "renewalReminderDate must be on or before endDate";
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
    return {
      error: "No commercial account found for this tenant. Create one first." as const,
      status: 404,
    };
  }
  return { ws, account };
}

async function audit(action: string, actorId: number, workspaceId: number, meta: Record<string, unknown>) {
  await db.insert(activityLogsTable).values({
    userId: actorId,
    workspaceId,
    action,
    metadata: JSON.stringify({ ...meta, workspaceId, tenantId: workspaceId, timestamp: new Date().toISOString() }),
  });
}

async function loadContractDoc(contractId: number) {
  return db.query.commercialContractDocumentsTable.findFirst({
    where: eq(commercialContractDocumentsTable.contractId, contractId),
  });
}

function resolveContractDates(body: Record<string, unknown>): {
  start: string | null;
  end: string | null;
  renewal: string | null;
  error: string | null;
} {
  const startRaw = parseOptionalDate(body.startDate ?? body.contractStartDate);
  const endRaw = parseOptionalDate(body.endDate ?? body.contractEndDate);
  const renewalRaw = parseOptionalDate(body.renewalReminderDate ?? body.renewalDate);
  if (startRaw === "INVALID" || endRaw === "INVALID" || renewalRaw === "INVALID") {
    return { start: null, end: null, renewal: null, error: "Dates must be YYYY-MM-DD" };
  }
  const start = startRaw;
  const end = endRaw;
  const renewal = renewalRaw;
  const dateErr = validateDates(start, end, renewal);
  if (dateErr) return { start, end, renewal, error: dateErr };
  return { start, end, renewal, error: null };
}

function mapBodyToInsert(
  body: Record<string, unknown>,
  commercialAccountId: number,
  workspaceId: number,
) {
  const { start, end, renewal, error } = resolveContractDates(body);
  if (error) throw new Error(error);

  return {
    workspaceId,
    commercialAccountId,
    contractNumber: strOpt(body.contractNumber, MAX_NUMBER),
    contractTitle: strOpt(body.contractTitle, MAX_TITLE),
    companyName: strOpt(body.companyName, MAX_NAME),
    responsiblePersonName: strOpt(body.responsiblePersonName, MAX_NAME),
    responsiblePersonPhone: strOpt(body.responsiblePersonPhone, MAX_PHONE),
    responsiblePersonEmail: strOpt(body.responsiblePersonEmail, MAX_NAME),
    notes: strOpt(body.notes, MAX_TEXT),
    contractStartDate: start,
    contractEndDate: end,
    renewalDate: renewal,
    renewalType: "manual" as const,
    renewalCommitmentStatus: "not_started" as const,
    status: "active" as const,
  };
}

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/commercial-contracts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.read"),
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

    const rows = await db
      .select()
      .from(commercialContractTermsTable)
      .where(eq(commercialContractTermsTable.workspaceId, tenantId))
      .orderBy(desc(commercialContractTermsTable.createdAt));

    const now = new Date();
    const contracts = await Promise.all(
      rows.map(async (row) => {
        const doc = await loadContractDoc(row.id);
        return toOperationalContract(row, doc, now);
      }),
    );

    res.json({ contracts });
  },
);

router.get(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    const row = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const doc = await loadContractDoc(row.id);
    res.json({ contract: toOperationalContract(row, doc) });
  },
);

router.post(
  "/platform/tenants/:tenantId/commercial-contracts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const acctRaw = body.commercialAccountId ?? ctx.account.id;
    if (Number(acctRaw) !== ctx.account.id) {
      res.status(400).json({ error: "commercialAccountId does not match tenant account" });
      return;
    }

    const email = strOpt(body.responsiblePersonEmail, MAX_NAME);
    if (email && !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Invalid responsiblePersonEmail" });
      return;
    }

    let fields: ReturnType<typeof mapBodyToInsert>;
    try {
      fields = mapBodyToInsert(body, ctx.account.id, tenantId);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Invalid contract data" });
      return;
    }

    try {
      const [row] = await db
        .insert(commercialContractTermsTable)
        .values({
          ...fields,
          createdBy: req.userId ?? null,
          updatedBy: req.userId ?? null,
        })
        .returning();

      await audit("commercial_contract_created", req.userId!, tenantId, { contractId: row.id });
      res.status(201).json({ contract: toOperationalContract(row, null) });
    } catch (e: unknown) {
      console.error("[commercial-contracts POST]", e);
      if (isSchemaMismatchError(e)) {
        const { message } = pgErrorInfo(e);
        res.status(503).json({
          error:
            "Database schema is missing operational commercial columns. Run scripts/migrate-commercial-simplification.cjs",
          detail: message,
        });
        return;
      }
      throw e;
    }
  },
);

router.patch(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    const existing = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedBy: req.userId! };

    const setDate = (key: "contractStartDate" | "contractEndDate" | "renewalDate", raw: unknown) => {
      if (raw === undefined) return;
      const p = parseOptionalDate(raw);
      if (p === "INVALID") throw new Error("INVALID_DATE");
      patch[key] = p;
    };

    try {
      if (body.contractNumber !== undefined) patch.contractNumber = strOpt(body.contractNumber, MAX_NUMBER);
      if (body.contractTitle !== undefined) patch.contractTitle = strOpt(body.contractTitle, MAX_TITLE);
      if (body.companyName !== undefined) patch.companyName = strOpt(body.companyName, MAX_NAME);
      if (body.responsiblePersonName !== undefined) {
        patch.responsiblePersonName = strOpt(body.responsiblePersonName, MAX_NAME);
      }
      if (body.responsiblePersonPhone !== undefined) {
        patch.responsiblePersonPhone = strOpt(body.responsiblePersonPhone, MAX_PHONE);
      }
      if (body.responsiblePersonEmail !== undefined) {
        const em = strOpt(body.responsiblePersonEmail, MAX_NAME);
        if (em && !EMAIL_RE.test(em)) {
          res.status(400).json({ error: "Invalid responsiblePersonEmail" });
          return;
        }
        patch.responsiblePersonEmail = em;
      }
      if (body.notes !== undefined) patch.notes = strOpt(body.notes, MAX_TEXT);
      setDate("contractStartDate", body.startDate ?? body.contractStartDate);
      setDate("contractEndDate", body.endDate ?? body.contractEndDate);
      setDate("renewalDate", body.renewalReminderDate ?? body.renewalDate);
    } catch {
      res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      return;
    }

    const start = (patch.contractStartDate as string | null | undefined) ?? existing.contractStartDate;
    const end = (patch.contractEndDate as string | null | undefined) ?? existing.contractEndDate;
    const renewal = (patch.renewalDate as string | null | undefined) ?? existing.renewalDate;
    const dateErr = validateDates(start, end, renewal);
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    const [row] = await db
      .update(commercialContractTermsTable)
      .set(patch)
      .where(eq(commercialContractTermsTable.id, contractId))
      .returning();

    const doc = await loadContractDoc(row.id);
    res.json({ contract: toOperationalContract(row, doc) });
  },
);

router.post(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId/document",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  parseContractPdfUpload,
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    const upload = req.contractPdfUpload;
    if (!upload) {
      res.status(400).json({ error: "PDF file is required" });
      return;
    }

    const row = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const actorId = req.userId!;
    const storageKey = contractDocumentStorage.buildStorageKey(tenantId, contractId);
    const safeName = upload.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);

    try {
      const { checksum } = await contractDocumentStorage.saveContractPdf(storageKey, upload.buffer);
      const existingDoc = await loadContractDoc(contractId);

      if (existingDoc) {
        await contractDocumentStorage.deleteContractPdfIfExists(existingDoc.storageKey);
        const [doc] = await db
          .update(commercialContractDocumentsTable)
          .set({
            fileName: safeName,
            originalFileName: upload.originalFileName.slice(0, 255),
            fileSize: upload.buffer.length,
            mimeType: CONTRACT_PDF_MIME,
            storageKey,
            checksum,
            uploadedBy: actorId,
            uploadedAt: new Date(),
          })
          .where(eq(commercialContractDocumentsTable.id, existingDoc.id))
          .returning();
        res.json({ document: doc });
        return;
      }

      const [doc] = await db
        .insert(commercialContractDocumentsTable)
        .values({
          contractId,
          fileName: safeName,
          originalFileName: upload.originalFileName.slice(0, 255),
          fileSize: upload.buffer.length,
          mimeType: CONTRACT_PDF_MIME,
          storageKey,
          checksum,
          uploadedBy: actorId,
        })
        .returning();

      res.status(201).json({ document: doc });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Upload failed" });
    }
  },
);

router.get(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId/document",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    const row = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const doc = await loadContractDoc(contractId);
    if (!doc) {
      res.status(404).json({ error: "No PDF uploaded for this contract" });
      return;
    }

    try {
      const stream = contractDocumentStorage.getContractPdfStream(doc.storageKey);
      res.setHeader("Content-Type", CONTRACT_PDF_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${doc.originalFileName.replace(/"/g, "")}"`,
      );
      res.setHeader("Content-Length", String(doc.fileSize));
      stream.pipe(res);
    } catch {
      res.status(404).json({ error: "Document file not found" });
    }
  },
);

/** Legacy status workflow removed — contracts are immutable timeline records. */
router.patch(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId/status",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  (_req, res) => {
    res.status(410).json({
      error: "Contract status workflow removed. Edit the contract record directly.",
    });
  },
);

export default router;
