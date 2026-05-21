import { db } from "@workspace/db";
import {
  documentsTable,
  documentVersionsTable,
  type Document,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage";
import { validateMimeType, validateUploadSize, sanitizeFileName } from "./mime-policy";
import { documentAccessService } from "./document-access-service";
import { issueDocumentDownloadToken, getDownloadTtlSec } from "./download-token";
import {
  ensureEmployeeFolder,
  ensurePayrollFolder,
  ensureReportsFolder,
  ensureWorkspaceFolder,
} from "./folder-service";
import type { AuthRequest } from "../../middlewares/requireAuth";

const objectStorage = new ObjectStorageService();

export type EntityRef = {
  sourceType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  domain?: string;
};

export type BeginUploadInput = {
  workspaceId: number;
  userId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  title?: string;
  entity: EntityRef;
  isConfidential?: boolean;
  classification?: string;
};

export class DocumentService {
  async beginUpload(input: BeginUploadInput): Promise<{
    document: Document;
    versionId: number;
    uploadUrl: string;
    objectPath: string;
    expiresInSec: number;
  }> {
    const mimeCheck = validateMimeType(input.mimeType);
    if (!mimeCheck.ok) throw new Error(mimeCheck.error);
    const sizeCheck = validateUploadSize(input.sizeBytes);
    if (!sizeCheck.ok) throw new Error(sizeCheck.error);

    const fileName = sanitizeFileName(input.fileName);
    const domain = input.entity.domain ?? input.entity.sourceType;
    const folderId = await this.resolveFolder(input.workspaceId, input.entity);

    const [doc] = await db
      .insert(documentsTable)
      .values({
        workspaceId: input.workspaceId,
        title: input.title?.trim() || fileName,
        fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: "pending",
        status: "uploading",
        classification: input.classification ?? "internal",
        isConfidential: input.isConfidential ?? false,
        sourceType: input.entity.sourceType,
        sourceEntityType: input.entity.sourceEntityType,
        sourceEntityId: input.entity.sourceEntityId,
        folderId,
        createdByUserId: input.userId,
      })
      .returning();

    const relativeKey = objectStorage.buildRegistryRelativePath(
      input.workspaceId,
      domain,
      input.entity.sourceEntityType,
      input.entity.sourceEntityId,
      doc!.id,
      1,
    );
    const objectPath = objectStorage.toObjectPath(relativeKey);

    const [version] = await db
      .insert(documentVersionsTable)
      .values({
        documentId: doc!.id,
        versionNumber: 1,
        storageKey: objectPath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedByUserId: input.userId,
      })
      .returning();

    await db
      .update(documentsTable)
      .set({ storageKey: objectPath, currentVersionId: version!.id })
      .where(eq(documentsTable.id, doc!.id));

    const uploadUrl = await objectStorage.getRegistryUploadURL(relativeKey);

    return {
      document: { ...doc!, storageKey: objectPath, currentVersionId: version!.id },
      versionId: version!.id,
      uploadUrl,
      objectPath,
      expiresInSec: 900,
    };
  }

  /** Register a file already uploaded via legacy presign flow (dual-write bridge). */
  async registerExistingFile(input: BeginUploadInput & { objectPath: string }): Promise<Document> {
    const mimeCheck = validateMimeType(input.mimeType);
    if (!mimeCheck.ok) throw new Error(mimeCheck.error);
    if (!objectStorage.isObjectInWorkspace(input.objectPath, input.workspaceId)) {
      throw new Error("objectPath is not in workspace scope");
    }

    const fileName = sanitizeFileName(input.fileName);
    const folderId = await this.resolveFolder(input.workspaceId, input.entity);

    const [doc] = await db
      .insert(documentsTable)
      .values({
        workspaceId: input.workspaceId,
        title: input.title?.trim() || fileName,
        fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.objectPath,
        status: "active",
        classification: input.classification ?? "internal",
        isConfidential: input.isConfidential ?? false,
        sourceType: input.entity.sourceType,
        sourceEntityType: input.entity.sourceEntityType,
        sourceEntityId: input.entity.sourceEntityId,
        folderId,
        createdByUserId: input.userId,
      })
      .returning();

    const [version] = await db
      .insert(documentVersionsTable)
      .values({
        documentId: doc!.id,
        versionNumber: 1,
        storageKey: input.objectPath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedByUserId: input.userId,
      })
      .returning();

    const [updated] = await db
      .update(documentsTable)
      .set({ currentVersionId: version!.id })
      .where(eq(documentsTable.id, doc!.id))
      .returning();

    await documentAccessService.logAccess({
      workspaceId: input.workspaceId,
      documentId: doc!.id,
      userId: input.userId,
      action: "upload",
    });

    return updated!;
  }

  async completeUpload(documentId: number, workspaceId: number, userId: number): Promise<Document> {
    const doc = await documentAccessService.assertActiveDocument(documentId, workspaceId);
    if (!doc || doc.status !== "uploading") {
      throw new Error("Document not found or not in uploading state");
    }

    const [updated] = await db
      .update(documentsTable)
      .set({ status: "active" })
      .where(eq(documentsTable.id, documentId))
      .returning();

    await documentAccessService.logAccess({
      workspaceId,
      documentId,
      userId,
      action: "upload",
    });

    return updated!;
  }

  async attachToEntity(
    documentId: number,
    workspaceId: number,
    entity: EntityRef,
  ): Promise<void> {
    await db
      .update(documentsTable)
      .set({
        sourceType: entity.sourceType,
        sourceEntityType: entity.sourceEntityType,
        sourceEntityId: entity.sourceEntityId,
      })
      .where(and(eq(documentsTable.id, documentId), eq(documentsTable.workspaceId, workspaceId)));
  }

  async createVersion(params: {
    documentId: number;
    workspaceId: number;
    userId: number;
    mimeType: string;
    sizeBytes: number;
  }): Promise<{ versionId: number; uploadUrl: string; objectPath: string }> {
    const doc = await documentAccessService.assertActiveDocument(params.documentId, params.workspaceId);
    if (!doc) throw new Error("Document not found");

    const mimeCheck = validateMimeType(params.mimeType);
    if (!mimeCheck.ok) throw new Error(mimeCheck.error);
    const sizeCheck = validateUploadSize(params.sizeBytes);
    if (!sizeCheck.ok) throw new Error(sizeCheck.error);

    const [last] = await db
      .select({ versionNumber: documentVersionsTable.versionNumber })
      .from(documentVersionsTable)
      .where(eq(documentVersionsTable.documentId, params.documentId))
      .orderBy(desc(documentVersionsTable.versionNumber))
      .limit(1);

    const nextVersion = (last?.versionNumber ?? 0) + 1;
    const domain = doc.sourceType ?? "general";
    const relativeKey = objectStorage.buildRegistryRelativePath(
      params.workspaceId,
      domain,
      doc.sourceEntityType ?? "unlinked",
      doc.sourceEntityId ?? "0",
      doc.id,
      nextVersion,
    );
    const objectPath = objectStorage.toObjectPath(relativeKey);

    const [version] = await db
      .insert(documentVersionsTable)
      .values({
        documentId: params.documentId,
        versionNumber: nextVersion,
        storageKey: objectPath,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        uploadedByUserId: params.userId,
      })
      .returning();

    await db
      .update(documentsTable)
      .set({
        storageKey: objectPath,
        currentVersionId: version!.id,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        status: "active",
      })
      .where(eq(documentsTable.id, params.documentId));

    const uploadUrl = await objectStorage.getRegistryUploadURL(relativeKey);
    return { versionId: version!.id, uploadUrl, objectPath };
  }

  async listByEntity(
    workspaceId: number,
    sourceEntityType: string,
    sourceEntityId: string,
    includeArchived = false,
  ): Promise<Document[]> {
    const conditions = [
      eq(documentsTable.workspaceId, workspaceId),
      eq(documentsTable.sourceEntityType, sourceEntityType),
      eq(documentsTable.sourceEntityId, sourceEntityId),
      isNull(documentsTable.deletedAt),
    ];
    const rows = await db
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .orderBy(desc(documentsTable.createdAt));

    if (includeArchived) return rows;
    return rows.filter((r) => r.status !== "purged");
  }

  async issueSignedDownload(
    documentId: number,
    workspaceId: number,
    req: AuthRequest,
  ): Promise<{ downloadUrl: string; token: string; expiresInSec: number }> {
    const doc = await documentAccessService.assertActiveDocument(documentId, workspaceId);
    if (!doc || !req.userId) throw new Error("Document not found");

    const allowed = await documentAccessService.canAccess({
      userId: req.userId,
      workspaceId,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      document: doc,
      action: "download",
    });
    if (!allowed) {
      const err = new Error("Forbidden");
      throw err;
    }

    const versionId = doc.currentVersionId;
    if (!versionId) throw new Error("No version available");

    const [version] = await db
      .select()
      .from(documentVersionsTable)
      .where(eq(documentVersionsTable.id, versionId))
      .limit(1);
    if (!version) throw new Error("Version not found");

    if (!objectStorage.isObjectInWorkspace(version.storageKey, workspaceId)) {
      throw new Error("Storage key outside workspace");
    }

    const ttl = getDownloadTtlSec();
    const downloadUrl = await objectStorage.getSignedDownloadURL(version.storageKey, ttl);
    const token = issueDocumentDownloadToken({
      documentId,
      versionId,
      workspaceId,
      userId: req.userId,
    });

    await documentAccessService.logAccess({
      workspaceId,
      documentId,
      userId: req.userId,
      action: "download",
      req,
    });

    return { downloadUrl, token, expiresInSec: ttl };
  }

  async archive(documentId: number, workspaceId: number, userId: number): Promise<Document> {
    const [row] = await db
      .update(documentsTable)
      .set({ status: "archived" })
      .where(
        and(
          eq(documentsTable.id, documentId),
          eq(documentsTable.workspaceId, workspaceId),
          isNull(documentsTable.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new Error("Document not found");
    await documentAccessService.logAccess({ workspaceId, documentId, userId, action: "archive" });
    return row;
  }

  async softDelete(documentId: number, workspaceId: number, userId: number): Promise<void> {
    await db
      .update(documentsTable)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(and(eq(documentsTable.id, documentId), eq(documentsTable.workspaceId, workspaceId)));
    await documentAccessService.logAccess({ workspaceId, documentId, userId, action: "archive" });
  }

  private async resolveFolder(workspaceId: number, entity: EntityRef): Promise<number | null> {
    if (entity.sourceEntityType === "employee") {
      return ensureEmployeeFolder(workspaceId, Number(entity.sourceEntityId));
    }
    if (entity.sourceType === "payroll" || entity.domain === "payroll") {
      return ensurePayrollFolder(workspaceId);
    }
    if (entity.sourceType === "report" || entity.domain === "reports") {
      return ensureReportsFolder(workspaceId);
    }
    return ensureWorkspaceFolder(workspaceId);
  }
}

export const documentService = new DocumentService();
