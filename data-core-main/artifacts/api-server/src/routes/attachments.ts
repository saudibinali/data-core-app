import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { documentService } from "../lib/documents/document-service";
import { documentAccessService } from "../lib/documents/document-access-service";
import { verifyDocumentDownloadToken } from "../lib/documents/download-token";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { Readable } from "stream";
import {
  db,
  generatedReportsTable,
  importJobsTable,
  exportJobsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

function parseEntityQuery(req: AuthRequest): {
  sourceEntityType: string;
  sourceEntityId: string;
} | null {
  const sourceEntityType = String(req.query.entityType ?? "");
  const sourceEntityId = String(req.query.entityId ?? "");
  if (!sourceEntityType || !sourceEntityId) return null;
  return { sourceEntityType, sourceEntityId };
}

/** POST /attachments/upload-request — secure presign + registry row */
router.post(
  "/attachments/upload-request",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "Workspace context required" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const fileName = String(body.fileName ?? "");
    const mimeType = String(body.mimeType ?? "");
    const sizeBytes = Number(body.sizeBytes ?? 0);
    const sourceEntityType = String(body.entityType ?? body.sourceEntityType ?? "");
    const sourceEntityId = String(body.entityId ?? body.sourceEntityId ?? "");
    const sourceType = String(body.sourceType ?? sourceEntityType);
    const domain = body.domain != null ? String(body.domain) : undefined;

    if (!fileName || !mimeType || !sourceEntityType || !sourceEntityId) {
      res.status(400).json({ error: "fileName, mimeType, entityType, entityId required" });
      return;
    }

    try {
      const result = await documentService.beginUpload({
        workspaceId: req.workspaceId,
        userId: req.userId,
        fileName,
        mimeType,
        sizeBytes,
        title: body.title != null ? String(body.title) : undefined,
        isConfidential: Boolean(body.isConfidential),
        classification: body.classification != null ? String(body.classification) : undefined,
        entity: { sourceType, sourceEntityType, sourceEntityId, domain },
      });

      res.status(201).json({
        documentId: result.document.id,
        versionId: result.versionId,
        uploadUrl: result.uploadUrl,
        objectPath: result.objectPath,
        expiresInSec: result.expiresInSec,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload request failed";
      res.status(400).json({ error: message });
    }
  },
);

/** POST /attachments/:id/complete */
router.post(
  "/attachments/:id/complete",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "Workspace context required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const doc = await documentService.completeUpload(id, req.workspaceId, req.userId);
      res.json(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Complete failed";
      res.status(400).json({ error: message });
    }
  },
);

/** GET /attachments?entityType=&entityId= */
router.get("/attachments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }
  const entity = parseEntityQuery(req);
  if (!entity) {
    res.status(400).json({ error: "entityType and entityId required" });
    return;
  }

  const rows = await documentService.listByEntity(
    req.workspaceId,
    entity.sourceEntityType,
    entity.sourceEntityId,
    req.query.includeArchived === "true",
  );

  const sanitized = rows.map((r) => ({
    id: r.id,
    title: r.title,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    status: r.status,
    classification: r.classification,
    isConfidential: r.isConfidential,
    currentVersionId: r.currentVersionId,
    sourceType: r.sourceType,
    sourceEntityType: r.sourceEntityType,
    sourceEntityId: r.sourceEntityId,
    createdAt: r.createdAt,
  }));

  res.json(sanitized);
});

/** GET /attachments/:id/download — signed URL (no public access) */
router.get(
  "/attachments/:id/download",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "Workspace context required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const signed = await documentService.issueSignedDownload(id, req.workspaceId, req);
      res.json(signed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download denied";
      res.status(err instanceof Error && message === "Forbidden" ? 403 : 404).json({ error: message });
    }
  },
);

/** GET /attachments/download/stream?token= — token-gated stream (no anonymous public URLs) */
router.get(
  "/attachments/download/stream",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const token = String(req.query.token ?? "");
    const payload = verifyDocumentDownloadToken(token);
    if (!payload || payload.userId !== req.userId || payload.workspaceId !== req.workspaceId) {
      res.status(403).json({ error: "Invalid or expired download token" });
      return;
    }

    const doc = await documentAccessService.assertActiveDocument(payload.documentId, payload.workspaceId);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const allowed = await documentAccessService.canAccess({
      userId: req.userId!,
      workspaceId: payload.workspaceId,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      document: doc,
      action: "download",
    });
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const objectFile = await objectStorage.getObjectEntityFile(doc.storageKey);
      const response = await objectStorage.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Cache-Control", "private, no-store");
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.status(500).json({ error: "Download failed" });
    }
  },
);

/** POST /attachments/:id/archive */
router.post(
  "/attachments/:id/archive",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "Workspace context required" });
      return;
    }
    const id = Number(req.params.id);
    try {
      const doc = await documentService.archive(id, req.workspaceId, req.userId);
      res.json(doc);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
    }
  },
);

// ── Import / export / generated_reports foundation (structure only) ─────────

router.post("/import-jobs", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res) => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const { importType, dryRun, sourceStorageKey } = req.body as Record<string, unknown>;
  if (!importType) {
    res.status(400).json({ error: "importType required" });
    return;
  }
  const [row] = await db
    .insert(importJobsTable)
    .values({
      workspaceId: req.workspaceId,
      importType: String(importType),
      dryRun: Boolean(dryRun),
      sourceStorageKey: sourceStorageKey != null ? String(sourceStorageKey) : null,
      createdByUserId: req.userId,
      status: "pending",
    })
    .returning();
  res.status(201).json(row);
});

router.get("/import-jobs/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(importJobsTable)
    .where(and(eq(importJobsTable.id, id), eq(importJobsTable.workspaceId, req.workspaceId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/export-jobs", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res) => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const { exportType, filterParams } = req.body as Record<string, unknown>;
  if (!exportType) {
    res.status(400).json({ error: "exportType required" });
    return;
  }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(exportJobsTable)
    .values({
      workspaceId: req.workspaceId,
      exportType: String(exportType),
      filterParamsJson: filterParams ? JSON.stringify(filterParams) : null,
      createdByUserId: req.userId,
      status: "pending",
      expiresAt,
    })
    .returning();
  res.status(201).json(row);
});

router.post("/generated-reports", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res) => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const { reportDefinitionKey, format, parametersHash } = req.body as Record<string, unknown>;
  if (!reportDefinitionKey || !format) {
    res.status(400).json({ error: "reportDefinitionKey and format required" });
    return;
  }
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(generatedReportsTable)
    .values({
      workspaceId: req.workspaceId,
      reportDefinitionKey: String(reportDefinitionKey),
      format: String(format),
      parametersHash: parametersHash != null ? String(parametersHash) : null,
      requestedByUserId: req.userId,
      status: "pending",
      expiresAt,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/generated-reports/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res) => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = Number(req.params.id);
  const { status, storageKey } = req.body as Record<string, unknown>;
  const [row] = await db
    .update(generatedReportsTable)
    .set({
      status: status != null ? String(status) : undefined,
      storageKey: storageKey != null ? String(storageKey) : undefined,
      completedAt: status === "completed" ? new Date() : undefined,
    })
    .where(and(eq(generatedReportsTable.id, id), eq(generatedReportsTable.workspaceId, req.workspaceId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

export default router;
